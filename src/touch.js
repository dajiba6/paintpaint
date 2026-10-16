// A touch starts as a tap candidate. Pinching suppresses drawing until every
// finger is lifted, so the remaining finger cannot accidentally start a line.
export class TouchIntent {
  pending = null;
  pinching = false;
  begin(point) { if (!this.pinching) this.pending = point; }
  pinch() { this.pending = null; this.pinching = true; }
  drag(point) {
    if (this.pinching || !this.pending || Math.hypot(point.x - this.pending.x, point.y - this.pending.y) < 4) return null;
    const start = this.pending; this.pending = null; return start;
  }
  end(point, remaining) {
    if (this.pinching) { if (!remaining) this.pinching = false; return null; }
    const start = this.pending; this.pending = null;
    return start && Math.hypot(point.x - start.x, point.y - start.y) <= 8 ? start : null;
  }
  reset() { this.pending = null; this.pinching = false; }
}

export function resizeView(view, before, after) {
  return { ...view, x: view.x + (after.width - before.width) / 2, y: view.y + (after.height - before.height) / 2 };
}
