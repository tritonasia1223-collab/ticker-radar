import type { Point } from "./capitalism-refresh.js";

function ratio(numerator: Point[], denominator: Point[], first: string, cadence: number): Point[] {
  if (numerator[0]?.[0] !== first || denominator[0]?.[0] !== first) throw new Error("Unexpected net exports/GDP coverage");
  const month = (d: string) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7));
  for (const series of [numerator, denominator]) {
    if (series.some(([d, v], i) => !Number.isFinite(v) || (i > 0 && month(d) - month(series[i - 1][0]) !== cadence))) throw new Error("Invalid net exports/GDP observations");
  }
  // Reject mismatched releases/missing periods, rather than dropping a counterpart.
  if (numerator.length !== denominator.length || numerator.some(([d], i) => d !== denominator[i][0])) throw new Error("Missing net exports/GDP counterpart");
  return numerator.map(([d, v], i) => {
    const gdp = denominator[i][1];
    if (gdp <= 0) throw new Error("GDP must be positive");
    return [d, v / gdp * 100];
  });
}

/** Same-period NIPA current-dollar values. Both quarterly inputs are SAAR. */
export function buildNetExportsGdp(annualNet: Point[], annualGdp: Point[], quarterlyNet: Point[], quarterlyGdp: Point[]) {
  const annual = ratio(annualNet, annualGdp, "1929-01-01", 12);
  const quarterly = ratio(quarterlyNet, quarterlyGdp, "1947-01-01", 3);
  // Annual current-dollar levels must match the mean of the four SAAR quarters.
  // Do not average quarterly ratios: GDP weights differ across quarters.
  // Cross-frequency sanity check, not an exact accounting identity at published precision.
  // Reviewed FRED history differs by at most $1.5m (net exports) / $7.5m (GDP).
  // Record differences and reject larger discrepancies; never adjust official observations.
  const audits = [[annualNet, quarterlyNet], [annualGdp, quarterlyGdp]].map(([years, quarters], index) => {
    const byYear = new Map<string, number[]>();
    for (const [d, v] of quarters) { const y = d.slice(0, 4); byYear.set(y, [...(byYear.get(y) ?? []), v]); }
    const errors = years.flatMap(([d, v]) => {
      const q = byYear.get(d.slice(0, 4));
      return q?.length === 4 ? [Math.abs(v - q.reduce((a, b) => a + b, 0) / 4)] : [];
    });
    const toleranceBillions = index === 0 ? .002 : .01;
    if (!errors.length || errors.some(e => e > toleranceBillions + 1e-9)) throw new Error(`Annual/quarterly NIPA source mismatch: ${errors.length} years, max ${Math.max(...errors)} billion`);
    return { years: errors.length, toleranceBillions, maxDifferenceBillions: Math.max(...errors) };
  });
  // Preserve small surpluses/deficits; format for display separately.
  const points = [...annual.filter(([d]) => d < "1947-01-01"), ...quarterly];
  return { points, annualNetVsQuarterly: audits[0], annualGdpVsQuarterly: audits[1] };
}
