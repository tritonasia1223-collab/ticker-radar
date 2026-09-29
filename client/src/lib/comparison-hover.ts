import type { ComparePoint } from "../../../shared/cap-comparison";

export const HOVER_RADIUS = 18;
export interface HoverSegment { points: ComparePoint[]; rendered: ComparePoint[] }

// Hit-test the drawn segments, but report a real observation, never an interpolated value.
export function nearbyObservation(segments: HoverSegment[], pointer: { x: number; y: number }, x: (time: number) => number, y: (value: number) => number, radius = HOVER_RADIUS) {
  let best: { distance: number; x: number; y: number; points: ComparePoint[] } | null = null;
  for (const segment of segments) {
    for (let i = 0; i < segment.rendered.length; i++) {
      const a = segment.rendered[i], b = segment.rendered[i + 1] ?? a;
      const ax = x(a.time), ay = y(a.value), dx = x(b.time) - ax, dy = y(b.value) - ay;
      const lengthSquared = dx * dx + dy * dy;
      const fraction = lengthSquared ? Math.max(0, Math.min(1, ((pointer.x - ax) * dx + (pointer.y - ay) * dy) / lengthSquared)) : 0;
      const hx = ax + dx * fraction, hy = ay + dy * fraction;
      const distance = Math.hypot(pointer.x - hx, pointer.y - hy);
      if (distance > radius || (best && distance >= best.distance)) continue;
      best = { distance, x: hx, y: hy, points: segment.points };
    }
  }
  if (!best) return null;
  const point = best.points.reduce((near, p) => Math.abs(x(p.time) - pointer.x) < Math.abs(x(near.time) - pointer.x) ? p : near);
  return { distance: best.distance, x: best.x, y: best.y, point };
}
