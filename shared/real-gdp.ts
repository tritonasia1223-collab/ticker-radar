import type { Point } from "./capitalism-refresh.js";

/** Official chained-2017-dollar levels, not compounded or inverted growth rates. */
export function buildRealGdp(annual: Point[], quarterly: Point[]) {
  const month = (d: string) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7));
  for (const [points, first, cadence] of [[annual, "1929-01-01", 12], [quarterly, "1947-01-01", 3]] as const) {
    if (points[0]?.[0] !== first || points.some(([d,v], i) => !/^\d{4}-(01|04|07|10)-01$/.test(d) || !Number.isFinite(v) || v <= 0 || (i > 0 && month(d) - month(points[i - 1][0]) !== cadence))) throw new Error("Invalid real GDP coverage/observations");
  }
  const early = annual.filter(([d]) => d < "1947-01-01");
  if (early.length !== 18) throw new Error("Missing annual real GDP history");
  const byYear = new Map<string, number[]>();
  for (const [d,v] of quarterly) { const year = d.slice(0,4); byYear.set(year, [...(byYear.get(year) ?? []), v]); }
  const differences = annual.flatMap(([date, value]) => {
    const quarters = byYear.get(date.slice(0,4));
    if (quarters?.length !== 4) return [];
    const average = quarters.reduce((a,b) => a+b, 0) / 4;
    return [{ date, differenceBillions: Math.abs(value-average), relativeDifference: Math.abs(value-average)/value }];
  });
  // Compare published levels across frequencies to catch wrong units/price bases.
  // Keep each official observation unchanged; this is not a rebase or an interpolation.
  if (!differences.length || differences.some(d => d.relativeDifference > .001)) throw new Error("Annual/quarterly real GDP scale mismatch");
  return { points: [...early, ...quarterly], overlap: { years: differences.length, maxDifferenceBillions: Math.max(...differences.map(d=>d.differenceBillions)), maxRelativeDifference: Math.max(...differences.map(d=>d.relativeDifference)) } };
}
