export function dragPoints(kind, start, end, bounds = { width: 2400, height: 1600 }) {
  if (kind !== 'circle') return [start.x, start.y, end.x, end.y];
  const radius = Math.min(Math.hypot(end.x - start.x, end.y - start.y), start.x, start.y, bounds.width - start.x, bounds.height - start.y);
  return Array.from({ length: 97 }, (_, i) => {
    const angle = i / 96 * Math.PI * 2;
    return [start.x + radius * Math.cos(angle), start.y + radius * Math.sin(angle)];
  }).flat();
}
