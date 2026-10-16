import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WIDTH = 2400, HEIGHT = 1600;
export function createWall({ database = 'data/wall.sqlite', basePath = '' } = {}) {
  if (database !== ':memory:') mkdirSync(dirname(database), { recursive: true });
  const db = new DatabaseSync(database);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS strokes (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, owner TEXT NOT NULL, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS removed (id TEXT PRIMARY KEY, owner TEXT NOT NULL)');
  const app = express(), http = createServer(app);
  const io = new Server(http, { maxHttpBufferSize: 256_000, path: `${basePath}/socket.io` });
  if (basePath) app.use((req, _res, next) => {
    if (req.url === basePath || req.url.startsWith(`${basePath}/`)) req.url = req.url.slice(basePath.length) || '/';
    next();
  });
  const active = new Map();
  const all = () => db.prepare('SELECT seq, body FROM strokes ORDER BY seq').all().map(row => ({ ...JSON.parse(row.body), seq: row.seq }));
  const people = () => [...new Map([...io.sockets.sockets.values()].map(s => [s.data.owner, s.data.person])).values()];
  const valid = s => s && typeof s.id === 'string' && /^[\w-]{1,80}$/.test(s.id) && /^#[0-9a-f]{6}$/i.test(s.color) && Number.isFinite(s.width) && s.width >= 1 && s.width <= 32 && Array.isArray(s.points) && s.points.length >= 2 && s.points.length <= 12000 && s.points.length % 2 === 0 && s.points.every((p, i) => Number.isFinite(p) && p >= 0 && p <= (i % 2 ? HEIGHT : WIDTH));
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return next(new Error('无效的访客身份'));
    const owner = createHash('sha256').update(token).digest('hex');
    socket.data.owner = owner;
    socket.data.person = { id: owner, name: `画友 ${owner.slice(0, 4).toUpperCase()}`, color: ['#ed7659', '#7b75d6', '#5d9b83', '#568eb9'][parseInt(owner[0], 16) % 4] };
    next();
  });
  io.on('connection', socket => {
    const owner = socket.data.owner;
    socket.emit('snapshot', { strokes: all(), active: [...active.values()].map(x => x.stroke), me: socket.data.person, width: WIDTH, height: HEIGHT });
    io.emit('people', people());
    let budget = 160, reset = Date.now();
    const allow = () => { if (Date.now() - reset > 1000) { budget = 160; reset = Date.now(); } return budget-- > 0; };
    const validKind = s => s && (s.kind === undefined || ['pen', 'eraser', 'line', 'circle', 'polygon'].includes(s.kind));
    const clean = s => ({ id: s.id, kind: s.kind || 'pen', color: s.color, width: s.width, points: s.points, owner });
    socket.on('stroke:preview', s => {
      if (!allow() || !valid(s) || !validKind(s)) return;
      if (db.prepare('SELECT id FROM strokes WHERE id = ? UNION SELECT id FROM removed WHERE id = ?').get(s.id, s.id)) return;
      const existing = active.get(s.id);
      if (existing && existing.stroke.owner !== owner) return;
      // Each connection may only have one unfinished stroke.
      for (const [id, value] of active) if (value.socketId === socket.id && id !== s.id) { active.delete(id); io.emit('stroke:remove', id); }
      const stroke = clean(s);
      active.set(s.id, { socketId: socket.id, stroke });
      socket.broadcast.emit('stroke:preview', stroke);
    });
    socket.on('stroke:commit', (s, ack = () => {}) => {
      if (typeof ack !== 'function') ack = () => {};
      if (!allow() || !valid(s) || !validKind(s) || (s.kind === 'polygon' && s.points.length < 6)) return ack({ error: '笔画数据无效或发送过快' });
      const previous = db.prepare('SELECT owner FROM strokes WHERE id = ? UNION SELECT owner FROM removed WHERE id = ?').get(s.id, s.id);
      if (previous) {
        if (previous.owner !== owner) return ack({ error: '笔画编号重复' });
        const stored = db.prepare('SELECT seq, body FROM strokes WHERE id = ?').get(s.id);
        if (stored) socket.emit('stroke:commit', { ...JSON.parse(stored.body), seq: stored.seq });
        else socket.emit('stroke:remove', s.id);
        return ack({ ok: true });
      }
      if (active.has(s.id) && active.get(s.id).stroke.owner !== owner) return ack({ error: '笔画编号重复' });
      const stroke = clean(s);
      try { stroke.seq = Number(db.prepare('INSERT INTO strokes (id, owner, body) VALUES (?, ?, ?)').run(s.id, owner, JSON.stringify(stroke)).lastInsertRowid); }
      catch { return ack({ error: '保存失败，请重试' }); }
      active.delete(s.id);
      io.emit('stroke:commit', stroke);
      ack({ ok: true });
    });
    socket.on('stroke:cancel', id => {
      if (!allow() || active.get(id)?.socketId !== socket.id) return;
      active.delete(id); io.emit('stroke:remove', id);
    });
    socket.on('stroke:undo', (ack = () => {}) => {
      if (typeof ack !== 'function') ack = () => {};
      if (!allow()) return ack({ error: '操作太快了' });
      const row = db.prepare('SELECT id FROM strokes WHERE owner = ? ORDER BY seq DESC LIMIT 1').get(owner);
      if (row) {
        db.exec('BEGIN');
        try { db.prepare('INSERT OR IGNORE INTO removed (id, owner) VALUES (?, ?)').run(row.id, owner); db.prepare('DELETE FROM strokes WHERE id = ? AND owner = ?').run(row.id, owner); db.exec('COMMIT'); }
        catch { db.exec('ROLLBACK'); return ack({ error: '撤销失败' }); }
        io.emit('stroke:remove', row.id);
      }
      ack({ ok: true });
    });
    socket.on('cursor', point => {
      if (!allow() || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > WIDTH || point.y < 0 || point.y > HEIGHT) return;
      socket.broadcast.emit('cursor', { ...socket.data.person, x: point.x, y: point.y });
    });
    socket.on('disconnect', () => {
      for (const [id, value] of active) if (value.socketId === socket.id) { active.delete(id); io.emit('stroke:remove', id); }
      io.emit('people', people());
      if (!people().some(p => p.id === owner)) io.emit('cursor:leave', owner);
    });
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use(express.static(resolve('dist')));
  return { http, io, db, close: () => new Promise(resolveClose => io.close(() => { db.close(); resolveClose(); })) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const wall = createWall({ basePath: process.env.BASE_PATH || '' });
  wall.http.listen(Number(process.env.PORT || 3001), process.env.HOST || '0.0.0.0', () => console.log(`Wall server listening on port ${process.env.PORT || 3001}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await wall.close(); process.exit(0); });
}
