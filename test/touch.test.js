import test from 'node:test';
import assert from 'node:assert/strict';
import { TouchIntent, resizeView } from '../src/touch.js';

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
