import type { ComparePoint } from "../../../shared/cap-comparison";

export const HOVER_RADIUS = 18;
export interface HoverSegment { points: ComparePoint[]; rendered: ComparePoint[] }

// Fixed dimensions before mounting prevent tooltip measurement from changing page scrollbars.
export function hoverLayout(count: number, viewport: { width: number; height: number }) {
  const maxRows = Math.max(1, Math.floor((viewport.height - 34) / 24));
  const columns = Math.max(1, Math.ceil(count / maxRows));
  const rows = Math.max(1, Math.ceil(count / columns));
  return { columns, rows, width: Math.min(columns * 260, viewport.width - 16), height: rows * 24 + 18 };
}

// Hit-test the drawn segments, but report a real observation, never an interpolated value.
export function nearbyObservation(segments: HoverSegment[], pointer: { x: number; y: number }, x: (time: number) => number, y: (value: number) => number, radius = HOVER_RADIUS) {
  let best: { distance: number; x: number; y: number; points: ComparePoint[] } | null = null;
  for (const segment of segments) {
    for (let i = 0; i < segment.rendered.length; i++) {
      const a = segment.rendered[i], b = segment.rendered[i + 1] ?? a;
      const ax = x(a.time), ay = y(a.value), bx = x(b.time), dy = y(b.value) - ay;
      // Every marker belongs to the cursor's time column, not the nearest diagonal point.
      if (pointer.x < ax || pointer.x > bx) continue;
      const fraction = bx === ax ? 0 : (pointer.x - ax) / (bx - ax);
      const hx = pointer.x, hy = ay + dy * fraction;
      const distance = Math.abs(pointer.y - hy);
      if (distance > radius || (best && distance >= best.distance)) continue;
      best = { distance, x: hx, y: hy, points: segment.points };
    }
  }
  if (!best) return null;
  const point = best.points.reduce((near, p) => Math.abs(x(p.time) - pointer.x) < Math.abs(x(near.time) - pointer.x) ? p : near);
  return { distance: best.distance, x: best.x, y: best.y, point };
}
