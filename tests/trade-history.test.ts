import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildRealTrade, buildNominalTrade, verifyTradeOverlap, tradeObservationLabel } from "../shared/trade-history";
import { monthlyPoints, lineSegments } from "../shared/cap-comparison";
import type { Point } from "../shared/capitalism-refresh";
import { sourcePeriods } from "../client/src/lib/capitalism-history";
import { buildAlignedComparison } from "../client/src/lib/comparison-experiment";
import { COMPARE_SERIES } from "../client/src/lib/comparison-series";
import { calibrate } from "../shared/comparison-alignment";

const data = JSON.parse(readFileSync("client/src/data/capitalism-series.json", "utf8")) as Record<string, Point[]>;
describe("verified trade histories", () => {
  it("rejects nominal data under the real series identity, before writing", () => {
    const annual: Point[] = [["1929-01-01", 40]];
    const exports: Point[] = [["1947-01-01", 93.767], ["1970-01-01", 186.842]];
    const imports: Point[] = [["1947-01-01", 53.861], ["1970-01-01", 245.653]];
    expect(buildRealTrade(annual, [["1929-01-01", 50]], exports, imports, [["1970-01-01", -58.811]]).points).toEqual([
      ["1929-01-01", -10], ["1947-01-01", 39.9], ["1970-01-01", -58.8],
    ]);
    expect(() => buildRealTrade(annual, annual, exports, imports, [["1970-01-01", 3.514]])).toThrow("mismatch");
    expect(() => buildRealTrade(annual, annual, exports, imports.slice(0, 1), [["1970-01-01", -58.811]])).toThrow("counterpart");
  });
  it("converts annual nominal totals to monthly equivalents without inventing monthly samples", () => {
    const months: Point[] = Array.from({ length: 84 }, (_, i) => [`${1992 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, "0")}-01`, -1000]);
    const annual: Point[] = [["1960-01-01", 3508], ...Array.from({ length: 7 }, (_, i): Point => [`${1992 + i}-01-01`, -12000])];
    const result = buildNominalTrade(annual, months);
    expect(result.points[0]).toEqual(["1960-01-01", .292]);
    expect(result.points.length).toBe(85);
    expect(result.points[1]).toEqual(["1992-01-01", -1]);
    expect(() => buildNominalTrade(annual.map(([d,v]) => [d,v*1000]), months)).toThrow("mismatch");
    expect(() => verifyTradeOverlap(months, [], 1, .001)).toThrow();
  });
  it("corrects the nominal/real boundary and preserves annual observation frequency", () => {
    const real = new Map(data.trade), nominal = new Map(data.trade_bal);
    expect(real.get("1947-01-01")).toBe(39.9);
    expect(real.get("1969-10-01")).toBe(-62.1);
    expect(real.get("1970-01-01")).toBe(-58.8);
    expect(data.trade.filter(([d]) => d < "1947")).toHaveLength(18);
    expect(data.trade_bal.filter(([d]) => d < "1992")).toHaveLength(32);
    expect(nominal.get("1968-01-01")).toBe(.021); // Small surplus must not round to zero.
    expect(nominal.get("1969-01-01")).toBe(.007);
    for (const [id, cadence, end] of [["trade", 3, "1947"], ["trade_bal", 1, "1992"]] as const) {
      const early = monthlyPoints(data[id].filter(([d]) => d < end));
      expect(lineSegments(early, cadence).every(g => g.length === 1)).toBe(true);
      for (const [date] of data[id]) expect(sourcePeriods(id).filter(s => s.from <= date && (!s.to || date <= s.to))).toHaveLength(1);
    }
    expect(tradeObservationLabel("trade_bal", "1991-01-01")).toContain("월평균");
    expect(tradeObservationLabel("trade", "1929-01-01")).toContain("연간");
    expect(tradeObservationLabel("trade", "1970-01-01")).toBe("");
  });
  it("recomputes obsolete experiment scales, including scales restored from old insights", () => {
    const points = monthlyPoints(data.trade_bal), def = COMPARE_SERIES.find(s => s.id === "trade_bal")!;
    const old = { ...calibrate("trade_bal", points, null, null)!, scale: 99999 };
    const alignment = { method: "median-iqr-asinh-v1" as const, from: null, to: null, calibrations: { trade_bal: old } };
    const result = buildAlignedComparison([{ def, points }], alignment);
    expect(result.alignment.calibrations.trade_bal.scale).not.toBe(99999);
    expect(result.alignment.calibrations.trade_bal.dataRevision).toBe("trade-history-2026-10-06");
    expect(alignment.calibrations.trade_bal.scale).toBe(99999); // Do not mutate saved note contents.
    expect(buildAlignedComparison([{ def, points }], result.alignment).alignment.calibrations).toEqual(result.alignment.calibrations);
  });
});
