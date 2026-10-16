import test from 'node:test';
import assert from 'node:assert/strict';
import { dragPoints } from '../src/geometry.js';

test('dragged circle stays circular and fits inside the shared board at its edges', () => {
  for (const center of [{ x: 1200, y: 800 }, { x: 5, y: 1595 }, { x: 2399, y: 10 }]) {
    const points = dragPoints('circle', center, { x: 2400, y: 1600 });
    const radius = Math.hypot(points[0] - center.x, points[1] - center.y);
    for (let i = 0; i < points.length; i += 2) {
      assert.ok(points[i] >= 0 && points[i] <= 2400);
      assert.ok(points[i + 1] >= 0 && points[i + 1] <= 1600);
      assert.ok(Math.abs(Math.hypot(points[i] - center.x, points[i + 1] - center.y) - radius) < 1e-8);
    }
    assert.ok(Math.hypot(points[0] - points.at(-2), points[1] - points.at(-1)) < 1e-8);
  }
});
