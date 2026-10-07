import { type ComparePoint } from "../../../shared/cap-comparison";
import { smoothComparison, type Crossing } from "./comparison-smoothing";

// Explicit source frequency boundaries: missing monthly/quarterly data must not
// be mistaken for annual data just because observations happen to be far apart.
const annualUntil: Record<string, string> = {
  debt_gdp: "1966-01", gdp_growth: "1947-04", trade: "1947-01", trade_bal: "1992-01",
};
export const isAnnualObservation = (id: string, month: string) => !!annualUntil[id] && month < annualUntil[id];
const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));
export function comparisonSegments(points: ComparePoint[], id: string, cadence: number) {
  const groups: { original: ComparePoint[]; dashed: boolean }[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i], previous = points[i - 1];
    const dashed = !!previous && isAnnualObservation(id, previous.month);
    const gap = previous ? monthIndex(p.month) - monthIndex(previous.month) : Infinity;
    if (!previous || gap > (dashed ? 12 : cadence)) {
      groups.push({ original: [p], dashed: isAnnualObservation(id, p.month) });
      continue;
    }
    const last = groups.at(-1)!;
    if (last.dashed === dashed) last.original.push(p);
    else groups.push({ original: [previous, p], dashed });
  }
  return groups;
}

export function comparisonPaths(points: ComparePoint[], id: string, cadence: number, smoothingMonths = 0) {
  return comparisonSegments(points, id, cadence).flatMap(({ original, dashed }) => {
    // Annual observations remain straight guides, even in the smoothed view.
    if (smoothingMonths && !dashed) return smoothComparison(original, cadence, smoothingMonths).map(g => ({ ...g, dashed }));
    const crossings: Crossing[] = [];
    if (smoothingMonths) original.forEach((p, i) => {
      const before = original[i - 1];
      if (p.value === 0) crossings.push({ time: p.time, estimated: false });
      if (before && before.value * p.value < 0) crossings.push({ time: before.time + (p.time - before.time) * -before.value / (p.value - before.value), estimated: true });
    });
    return [{ original, rendered: original, crossings, dashed }];
  });
}

// Include the adjacent observations so a guide still appears when zoomed
// between two annual dates, without filling the gap with invented observations.
export function visiblePathPoints(points: ComparePoint[], from: number, to: number) {
  return points.filter((p, i) => (points[i + 1]?.time ?? p.time) >= from && (points[i - 1]?.time ?? p.time) <= to);
}
