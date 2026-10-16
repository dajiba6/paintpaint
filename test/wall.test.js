import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io } from 'socket.io-client';
import { createWall } from '../server/index.js';

const event = (socket, name) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => { socket.off(name, done); reject(new Error(`Timed out: ${name}`)); }, 3000);
  const done = value => { clearTimeout(timeout); resolve(value); };
  socket.once(name, done);
});
const send = (socket, name, value) => new Promise((resolve, reject) => {
  const callback = (err, result) => err ? reject(err) : resolve(result);
  if (value === undefined) socket.timeout(3000).emit(name, callback);
  else socket.timeout(3000).emit(name, value, callback);
});
const stroke = (id, extra = {}) => ({ id, color: '#ee795c', width: 8, points: [10, 20, 30, 40], ...extra });
async function start(database = ':memory:') {
  const wall = createWall({ database });
  await new Promise(resolve => wall.http.listen(0, '127.0.0.1', resolve));
  return { wall, url: `http://127.0.0.1:${wall.http.address().port}` };
}
async function client(url, token) {
  const socket = io(url, { auth: { token: token.repeat(64) }, transports: ['websocket'], autoConnect: false });
  const snapshot = event(socket, 'snapshot'); socket.connect();
  return { socket, snapshot: await snapshot };
}

test('live preview, committed strokes, ownership, undo and retry converge across clients', async t => {
  const { wall, url } = await start();
  const clients = []; t.after(async () => { clients.forEach(s => s.disconnect()); await wall.close(); });
  const a = await client(url, 'a'), b = await client(url, 'b'); clients.push(a.socket, b.socket);
  const preview = event(b.socket, 'stroke:preview');
  a.socket.emit('stroke:preview', stroke('first'));
  assert.equal((await preview).id, 'first');
  const commit = event(b.socket, 'stroke:commit');
  assert.deepEqual(await send(a.socket, 'stroke:commit', stroke('first')), { ok: true });
  const committed = await commit;
  assert.equal(committed.owner, a.snapshot.me.id);
  assert.equal(committed.seq, 1);
  assert.match((await send(b.socket, 'stroke:commit', stroke('first'))).error, /重复/);
  await send(b.socket, 'stroke:commit', stroke('second'));
  const removed = event(b.socket, 'stroke:remove');
  await send(a.socket, 'stroke:undo'); assert.equal(await removed, 'first');
  // A late retry of an acknowledged-but-undone stroke must not resurrect it.
  await send(a.socket, 'stroke:commit', stroke('first'));
  const c = await client(url, 'c'); clients.push(c.socket);
  assert.deepEqual(c.snapshot.strokes.map(s => s.id), ['second']);
  assert.equal(c.snapshot.active.length, 0);
});

test('completed drawing survives restart and disconnected previews are removed', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'wall-test-')), database = join(dir, 'test.sqlite');
  let { wall, url } = await start(database); const clients = [];
  t.after(async () => { clients.forEach(s => s.disconnect()); await wall.close(); rmSync(dir, { recursive: true, force: true }); });
  const a = await client(url, 'a'), b = await client(url, 'b'); clients.push(a.socket, b.socket);
  await send(a.socket, 'stroke:commit', stroke('saved'));
  const preview = event(b.socket, 'stroke:preview'); a.socket.emit('stroke:preview', stroke('unfinished')); await preview;
  const remove = event(b.socket, 'stroke:remove'); a.socket.disconnect(); assert.equal(await remove, 'unfinished');
  b.socket.disconnect(); await wall.close();
  ({ wall, url } = await start(database));
  const c = await client(url, 'a'); clients.push(c.socket);
  assert.deepEqual(c.snapshot.strokes.map(s => s.id), ['saved']); assert.deepEqual(c.snapshot.active, []);
  await send(c.socket, 'stroke:undo'); assert.equal(wall.db.prepare('SELECT count(*) AS count FROM strokes').get().count, 0);
});

test('malformed data and unauthenticated connections are rejected without breaking the server', async t => {
  const { wall, url } = await start(); const clients = [];
  t.after(async () => { clients.forEach(s => s.disconnect()); await wall.close(); });
  const bad = io(url, { autoConnect: false, reconnection: false }); clients.push(bad);
  const error = event(bad, 'connect_error'); bad.connect(); assert.match((await error).message, /身份/);
  const a = await client(url, 'a'); clients.push(a.socket);
  for (const data of [null, stroke('outside', { points: [-1, 0] }), stroke('bad-width', { width: 1000 }), stroke('odd', { points: [1, 2, 3] })]) {
    assert.ok((await send(a.socket, 'stroke:commit', data)).error);
  }
  a.socket.emit('stroke:undo', { fake: 'callback' });
  assert.deepEqual(await send(a.socket, 'stroke:commit', stroke('valid')), { ok: true });
  assert.equal(wall.db.prepare('SELECT count(*) AS count FROM strokes').get().count, 1);
});

test('a reconnect replaces stale state and includes drawings made while offline', async t => {
  const { wall, url } = await start(); const clients = [];
  t.after(async () => { clients.forEach(s => s.disconnect()); await wall.close(); });
  const a = await client(url, 'a'), b = await client(url, 'b'); clients.push(a.socket, b.socket);
  await send(a.socket, 'stroke:commit', stroke('old'));
  b.socket.disconnect();
  await send(a.socket, 'stroke:undo');
  await send(a.socket, 'stroke:commit', stroke('new'));
  const preview = event(a.socket, 'stroke:commit');
  await send(a.socket, 'stroke:commit', stroke('new')); await preview;
  const snapshot = event(b.socket, 'snapshot'); b.socket.connect();
  const recovered = await snapshot;
  assert.deepEqual(recovered.strokes.map(s => s.id), ['new']);
  assert.equal(recovered.me.id, b.snapshot.me.id);
});

test('shape kinds and arbitrary colors survive sync; erasing is an undoable operation', async t => {
  const { wall, url } = await start(); const clients = [];
  t.after(async () => { clients.forEach(s => s.disconnect()); await wall.close(); });
  const a = await client(url, 'a'), b = await client(url, 'b'); clients.push(a.socket, b.socket);
  for (const kind of ['line', 'circle', 'polygon', 'eraser']) {
    const data = stroke(kind, { kind, color: '#123abc', points: [10, 10, 30, 10, 30, 30] });
    const preview = event(b.socket, 'stroke:preview'); a.socket.emit('stroke:preview', data);
    assert.equal((await preview).kind, kind);
    const committed = event(b.socket, 'stroke:commit');
    assert.deepEqual(await send(a.socket, 'stroke:commit', data), { ok: true });
    assert.equal((await committed).color, '#123abc');
  }
  const c = await client(url, 'c'); clients.push(c.socket);
  assert.deepEqual(c.snapshot.strokes.map(s => s.kind), ['line', 'circle', 'polygon', 'eraser']);
  const removed = event(b.socket, 'stroke:remove'); await send(a.socket, 'stroke:undo'); assert.equal(await removed, 'eraser');
  assert.equal(wall.db.prepare('SELECT count(*) AS count FROM strokes').get().count, 3);
  assert.ok((await send(a.socket, 'stroke:commit', stroke('bad-kind', { kind: 'unknown' }))).error);
  assert.ok((await send(a.socket, 'stroke:commit', stroke('short-polygon', { kind: 'polygon' }))).error);
});

test('only the originating connection can cancel its unfinished shape', async t => {
  const { wall, url } = await start(); const clients = [];
  t.after(async () => { clients.forEach(s => s.disconnect()); await wall.close(); });
  const a = await client(url, 'a'), b = await client(url, 'b'); clients.push(a.socket, b.socket);
  const preview = event(b.socket, 'stroke:preview');
  a.socket.emit('stroke:preview', stroke('draft', { kind: 'polygon', points: [10, 20] })); await preview;
  b.socket.emit('stroke:cancel', 'draft');
  await send(b.socket, 'stroke:undo'); // Barrier: cancellation has been processed.
  const c = await client(url, 'c'); clients.push(c.socket); assert.equal(c.snapshot.active[0].id, 'draft');
  const removed = event(b.socket, 'stroke:remove'); a.socket.emit('stroke:cancel', 'draft'); assert.equal(await removed, 'draft');
  const d = await client(url, 'd'); clients.push(d.socket); assert.deepEqual(d.snapshot.active, []);
});
