import test from 'node:test';
import assert from 'node:assert/strict';
import { TouchIntent, resizeView, constrainView, pinchView } from '../src/touch.js';

test('pinching never commits a tap, including when one finger remains', () => {
  const touch = new TouchIntent();
  touch.begin({ x: 20, y: 20 }); touch.pinch();
  assert.equal(touch.end({ x: 20, y: 20 }, 1), null);
  assert.equal(touch.drag({ x: 50, y: 50 }), null);
  assert.equal(touch.end({ x: 50, y: 50 }, 0), null);
  touch.begin({ x: 60, y: 60 });
  assert.deepEqual(touch.end({ x: 60, y: 60 }, 0), { x: 60, y: 60 });
});

test('touch begins drawing only after movement and cannot become a tap on release', () => {
  const touch = new TouchIntent(); touch.begin({ x: 10, y: 10 });
  assert.equal(touch.drag({ x: 11, y: 10 }), null);
  assert.deepEqual(touch.drag({ x: 20, y: 20 }), { x: 10, y: 10 });
  assert.equal(touch.drag({ x: 30, y: 30 }), null);
  assert.equal(touch.end({ x: 30, y: 30 }, 0), null);
});

test('polygon tap candidates reject drags and two-finger gestures', () => {
  const touch = new TouchIntent(); touch.begin({ x: 10, y: 10 });
  assert.equal(touch.end({ x: 50, y: 50 }, 0), null);
  touch.begin({ x: 10, y: 10 });touch.pinch();
  assert.equal(touch.end({ x: 10, y: 10 }, 1), null);
  assert.equal(touch.end({ x: 20, y: 20 }, 0), null);
});

test('viewport resize preserves zoom and the world coordinate under its center', () => {
  const before = { width: 390, height: 600 }, after = { width: 600, height: 390 };
  const view = { x: -120, y: -300, scale: 1.7 }, next = resizeView(view, before, after);
  assert.equal(next.scale, view.scale);
  assert.equal((before.width / 2 - view.x) / view.scale, (after.width / 2 - next.x) / next.scale);
  assert.equal((before.height / 2 - view.y) / view.scale, (after.height / 2 - next.y) / next.scale);
});

test('a mobile viewport never loses the whole board after moving or shrinking', () => {
  const size = { width: 369, height: 650 };
  const view = resizeView({ x: -900, y: -700, scale: .1 }, size, size);
  assert.ok(view.x + 2400 * view.scale > 0 && view.y + 1600 * view.scale > 0, 'board must remain visible');
});

test('phone pinch, pan and rotation keep the board visible at every zoom', () => {
  for (const size of [{ width: 369, height: 650 }, { width: 650, height: 369 }]) {
    for (const scale of [.1, .3, 1, 3]) {
      for (const offset of [-10000, 0, 10000]) {
        const view = constrainView({ x: offset, y: offset, scale }, size);
        assert.ok(view.x <= size.width && view.x + 2400 * scale > 0);
        assert.ok(view.y <= size.height && view.y + 1600 * scale > 0);
        if (2400 * scale < size.width) assert.equal(view.x, (size.width - 2400 * scale) / 2);
        if (1600 * scale < size.height) assert.equal(view.y, (size.height - 1600 * scale) / 2);
      }
    }
  }
  const before = { x: -100, y: -100, scale: .5 };
  const previous = { center: { x: 180, y: 300 }, distance: 200 };
  const current = { center: { x: 190, y: 310 }, distance: 100 };
  const next = pinchView(before, previous, current);
  assert.equal((previous.center.x - before.x) / before.scale, (current.center.x - next.x) / next.scale);
  assert.equal((previous.center.y - before.y) / before.scale, (current.center.y - next.y) / next.scale);
});
