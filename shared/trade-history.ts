import { differenceSeries, type Point } from "./capitalism-refresh.js";

const rounded = (points: Point[], scale = 1, decimals = 1): Point[] => points.map(([d, v]) => [d, Number((v * scale).toFixed(decimals))]);

function requireSeries(points: Point[], first: string) {
  if (points[0]?.[0] !== first) throw new Error(`Unexpected trade coverage: expected ${first}`);
  for (let i = 0; i < points.length; i++) {
    if (!Number.isFinite(points[i][1]) || (i > 0 && points[i - 1][0] >= points[i][0])) throw new Error("Invalid trade observations");
  }
}

/** Verify every overlapping observation, not only the latest tail. Units are billions. */
export function verifyTradeOverlap(a: Point[], b: Point[], minimum: number, tolerance: number) {
  const other = new Map(b);
  const errors = a.filter(([d]) => other.has(d)).map(([d, v]) => ({ date: d, error: Math.abs(v - other.get(d)!) }));
  if (errors.length < minimum || errors.some(p => !Number.isFinite(p.error) || p.error > tolerance + 1e-9)) {
    throw new Error(`Trade source mismatch: ${errors.length} overlapping observations, max error ${Math.max(...errors.map(p => p.error))}`);
  }
  return { observations: errors.length, maxDifferenceBillions: Math.max(...errors.map(p => p.error)) };
}

export function buildRealTrade(annualExports: Point[], annualImports: Point[], exports: Point[], imports: Point[], official: Point[]) {
  requireSeries(annualExports, "1929-01-01"); requireSeries(annualImports, "1929-01-01");
  requireSeries(exports, "1947-01-01"); requireSeries(imports, "1947-01-01"); requireSeries(official, "1970-01-01");
  // Net exports is explicitly defined by BEA as this difference (NIPA Handbook ch. 8).
  const annual = differenceSeries(annualExports, annualImports, 3), quarterly = differenceSeries(exports, imports, 3);
  if (annual.length !== annualExports.length || annual.length !== annualImports.length || quarterly.length !== exports.length || quarterly.length !== imports.length) throw new Error("Missing trade counterpart");
  const overlap = verifyTradeOverlap(official, quarterly, official.length, .00101);
  const points = rounded([...annual.filter(([d]) => d < "1947-01-01"), ...quarterly.filter(([d]) => d < "1970-01-01"), ...official]);
  requireSeries(points, "1929-01-01");
  return { points, overlap };
}

export function buildNominalTrade(annualMillions: Point[], monthlyMillions: Point[]) {
  requireSeries(annualMillions, "1960-01-01"); requireSeries(monthlyMillions, "1992-01-01");
  const years = new Map<string, number[]>();
  for (const [d, v] of monthlyMillions) { const year = d.slice(0, 4); years.set(year, [...(years.get(year) ?? []), v]); }
  const totals: Point[] = [...years].filter(([, v]) => v.length === 12).map(([y, v]) => [`${y}-01-01`, v.reduce((a, b) => a + b, 0) / 1000]);
  const overlap = verifyTradeOverlap(annualMillions.map(([d, v]) => [d, v / 1000]), totals, 7, .006);
  // One point per year. Do not fabricate 12 monthly observations from an annual total.
  const points = [...rounded(annualMillions.filter(([d]) => d < "1992-01-01"), 1 / 12000, 3), ...rounded(monthlyMillions, 1 / 1000, 3)];
  requireSeries(points, "1960-01-01");
  return { points, overlap };
}

export function tradeObservationLabel(id: string, date: string): string {
  if (id === "trade_bal" && date < "1992-01-01") return "연간·월평균 환산";
  if (id === "trade" && date < "1947-01-01") return "연간·계산값";
  if (id === "trade" && date < "1970-01-01") return "분기·계산값";
  return "";
}
