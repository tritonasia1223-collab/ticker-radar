type Point = { x: number; y: number };
type Rect = { left: number; right: number; top: number; bottom: number };

/** Clip the direct segment against actual occupied blocks, with a small text clearance. */
function intersects(start: Point, end: Point, rect: Rect) {
  let enter = 0;
  let leave = 1;
  for (const [from, to, min, max] of [
    [start.x, end.x, rect.left - 4, rect.right + 4],
    [start.y, end.y, rect.top - 4, rect.bottom + 4],
  ]) {
    const delta = to - from;
    if (delta === 0) {
      if (from < min || from > max) return false;
      continue;
    }
    const a = (min - from) / delta;
    const b = (max - from) / delta;
    enter = Math.max(enter, Math.min(a, b));
    leave = Math.min(leave, Math.max(a, b));
    if (enter > leave) return false;
  }
  return true;
}

export function timelineHoverPath(start: Point, end: Point, obstacles: Rect[], railY: number) {
  if (!obstacles.some(rect => intersects(start, end, rect))) {
    return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
  }
  const targetX = end.x - 6;
  const elbow = Math.min(start.x + 7, targetX);
  return `M ${start.x} ${start.y} H ${elbow} V ${railY} H ${targetX} V ${end.y} h 6`;
}
