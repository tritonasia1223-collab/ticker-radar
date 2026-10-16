import { periodObservations, type ComparePoint } from "../../../shared/cap-comparison";
import { comparisonSegments } from "./comparison-paths";

// A compact view of actual observations, using the same bounds as the summary.
export function periodSparkline(id: string, points: ComparePoint[], cadence: number, from: string, to: string) {
  const visible = periodObservations(points, from, to);
  if (visible.length < 2) return null;
  const first = visible[0], last = visible.at(-1)!;
  const low = visible.reduce((a, b) => a.raw <= b.raw ? a : b);
  const high = visible.reduce((a, b) => a.raw >= b.raw ? a : b);
  const span = high.raw - low.raw;
  const x = (p: ComparePoint) => 8 + (p.time - first.time) / Math.max(1, last.time - first.time) * 264;
  const y = (p: ComparePoint) => span ? 54 - (p.raw - low.raw) / span * 32 : 38;
  const endpointHigh = Math.max(first.raw, last.raw), endpointLow = Math.min(first.raw, last.raw);
  const turning = [
    { point: high, kind: "high" as const, excess: high.raw - endpointHigh },
    { point: low, kind: "low" as const, excess: endpointLow - low.raw },
  ].filter(t => t.excess > span * .15 && x(t.point) > 42 && x(t.point) < 238)
    .sort((a, b) => b.excess - a.excess)[0];
  return {
    first: { point: first, x: x(first), y: y(first) }, last: { point: last, x: x(last), y: y(last) },
    turning: turning ? { ...turning, x: x(turning.point), y: y(turning.point) } : null,
    zeroY: low.raw < 0 && high.raw > 0 ? y({ ...first, raw: 0 }) : null,
    segments: comparisonSegments(visible, id, cadence).map(g => ({
      dashed: g.dashed, points: g.original.map(p => ({ x: x(p), y: y(p), point: p })),
      d: g.original.map((p, i) => `${i ? "L" : "M"}${x(p)},${y(p)}`).join(" "),
    })),
  };
}
