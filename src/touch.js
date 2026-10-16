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
  return constrainView({ ...view, x: view.x + (after.width - before.width) / 2, y: view.y + (after.height - before.height) / 2 }, after);
}

// Keep small boards centered and prevent larger boards from leaving the viewport.
export function constrainView(view, size) {
  const position = (offset, viewport, board) => board <= viewport
    ? (viewport - board) / 2
    : Math.max(viewport - board, Math.min(0, offset));
  return { ...view, x: position(view.x, size.width, 2400 * view.scale), y: position(view.y, size.height, 1600 * view.scale) };
}

export function pinchView(view, previous, current) {
  const scale = Math.max(.1, Math.min(3, view.scale * current.distance / previous.distance));
  return { scale, x: current.center.x - (previous.center.x - view.x) / view.scale * scale, y: current.center.y - (previous.center.y - view.y) / view.scale * scale };
}
