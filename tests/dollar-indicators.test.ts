import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dxyMonthEnds, longReer, withPurchasingPower } from "../shared/dollar-indicators";
import { mergeObservations, type Point } from "../shared/capitalism-refresh";
import { COMPARE_SERIES, activeSeriesIds, viewingSeriesIds, seriesLabel } from "../client/src/lib/comparison-series";
import { sourcePeriods } from "../client/src/lib/capitalism-history";
import { buildComparisonAxes } from "../client/src/lib/comparison-axes";
import { monthlyPoints } from "../shared/cap-comparison";

const data = withPurchasingPower(JSON.parse(readFileSync("client/src/data/capitalism-series.json", "utf8")) as Record<string, Point[]>);
const sources = JSON.parse(readFileSync("client/src/data/capitalism-series-sources.json", "utf8"));
const chart = (dates: string[], close: (number | null)[], symbol = "DX-Y.NYB", instrumentType = "INDEX") => ({ chart: { result: [{ meta: { symbol, instrumentType, exchangeTimezoneName: "America/New_York" }, timestamp: dates.map(d => Date.parse(d) / 1000), indicators: { quote: [{ close }] } }] } });

describe("dollar indicator replacement", () => {
  it("aggregates actual index closes in exchange-local dates, excludes partial months and does not fill gaps", () => {
    const result = dxyMonthEnds(chart(["1972-12-29T21:00:00Z", "1973-03-02T21:00:00Z", "1973-04-01T00:00:00Z", "1973-05-31T20:00:00Z", "1973-06-01T20:00:00Z"], [120, 100, 101.17, null, 102]), new Date("1973-06-02"));
    expect(result).toEqual([["1973-03-01", 101.17]]);
    for (const [symbol, type] of [["DX=F", "FUTURE"], ["UUP", "ETF"], ["DX-Y.NYB", "FUTURE"]]) expect(() => dxyMonthEnds(chart(["2020-01-31"], [100], symbol, type))).toThrow(/identity/);
  });
  it("scales only the Fed head, preserves BIS values and the seam's monthly change", () => {
    const fed: Point[] = Array.from({ length: 264 }, (_, i) => [new Date(Date.UTC(1973, i, 1)).toISOString().slice(0, 10), 100 + i / 10]);
    const bis: Point[] = fed.slice(252).map(([d, v]) => [d, v * .9]);
    const result = longReer(fed, bis);
    expect(result.factor).toBeCloseTo(.9);
    expect(result.points.slice(252)).toEqual(bis);
    expect(result.points[252][1] / result.points[251][1]).toBeCloseTo(fed[252][1] / fed[251][1]);
    expect(() => longReer(fed.slice(1), bis)).toThrow();
    expect(() => longReer(fed, bis.slice(1))).toThrow();
    expect(mergeObservations(result.points, [...bis, ["1995-01-01", 130]]).points.slice(0, 252)).toEqual(result.points.slice(0, 252));
  });
  it("turns a 25% price rise into a 20% purchasing-power loss and follows the chosen base", () => {
    const source: Record<string, Point[]> = { cpi_level: [["2000-01-01", 100], ["2000-02-01", 125], ["2000-03-01", 0], ["2000-04-01", -1], ["2000-05-01", NaN]] };
    const derived = withPurchasingPower(source);
    expect(derived.usd_purchasing_power).toEqual([["2000-01-01", 100], ["2000-02-01", 80]]);
    expect(derived.cpi_level).toBe(source.cpi_level);
    expect(source.usd_purchasing_power).toBeUndefined();
    expect(withPurchasingPower({}).usd_purchasing_power).toEqual([]);
    const raw = [{ def: COMPARE_SERIES.find(s => s.id === "usd_purchasing_power")!, points: monthlyPoints(derived.usd_purchasing_power) }];
    const rebased = buildComparisonAxes(raw, { mode: "mixed", base: "2000-02", assignments: {}, rightUnit: null });
    expect(rebased.series[0].points.map(p => p.value)).toEqual([125, 100]);
    expect(viewingSeriesIds(["cpi_level", "usd_purchasing_power", "dxy"])).toEqual(["usd_purchasing_power", "dxy"]);
    expect(activeSeriesIds(["cpi_level"])).toEqual([]); // Do not reinterpret saved notes.
    expect(sourcePeriods("usd_purchasing_power")[0].id).toBe("CPIAUCNS");
  });
  it("keeps three distinct identities, sources, historical coverage and indexable axes", () => {
    expect(data.dollar).toBeUndefined();
    expect(COMPARE_SERIES.some(s => s.id === "dollar")).toBe(false);
    expect(activeSeriesIds(["dollar", "dxy", "dxy", "cpi_level", "reer"])).toEqual(["dxy", "reer"]);
    expect(seriesLabel("dollar")).toBe("기존 달러지수(삭제됨)");
    expect(seriesLabel("dxy")).toContain("명목");
    expect(seriesLabel("reer")).toContain("실질");
    expect(data.dxy[0]).toEqual(["1973-03-01", 101.17]);
    expect(data.cpi_level[0]).toEqual(["1913-01-01", 9.8]);
    expect(data.reer[0][0]).toBe("1973-01-01");
    expect(sourcePeriods("dxy")[0].id).toBe("DX-Y.NYB");
    expect(sourcePeriods("cpi_level")[0].id).toBe("CPIAUCNS");
    const ratio = sources.reer.segments[0].factor;
    expect(ratio).toBeCloseTo(88.66 / 91.3648, 12);
    expect(data.reer[0][1]).toBe(Number((107.6163 * ratio).toFixed(3)));
    expect(new Map(data.reer).get("1994-01-01")).toBe(88.66);
    const raw = ["usd_purchasing_power", "dxy", "reer"].map(id => ({ def: COMPARE_SERIES.find(s => s.id === id)!, points: monthlyPoints(data[id]) }));
    const comparison = buildComparisonAxes(raw, { mode: "mixed", base: "1973-01", assignments: {}, rightUnit: null });
    expect(comparison.base).toBe("1973-03");
    expect(comparison.unavailable).toEqual([]);
    expect(comparison.series).toHaveLength(3);
    expect(comparison.series.every(s => s.points.find(p => p.month === comparison.base)?.value === 100)).toBe(true);
  });
});
