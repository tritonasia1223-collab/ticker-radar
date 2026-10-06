import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { automaticComparisonView, buildComparisonAxes, defaultAxis, rawUnitKey, sameComparisonView } from "../client/src/lib/comparison-axes";
import { COMPARE_SERIES } from "../client/src/lib/comparison-series";
import { comparisonInsightSchema, monthlyPoints, type ComparisonView, type Observation } from "../shared/cap-comparison";
import { diff, merge } from "../shared/cap-collaboration";
import { withRealInterestRate } from "../shared/real-interest-rate";
import { validateEdit } from "../server/cap-collaboration";

const data = withRealInterestRate(JSON.parse(readFileSync("client/src/data/capitalism-series.json", "utf8")) as Record<string, Observation[]>);
const view: ComparisonView = { mode: "mixed", base: "2000-01", assignments: {}, rightUnit: null };
const raw = (ids: string[]) => ids.map(id => ({ def: COMPARE_SERIES.find(s => s.id === id)!, points: monthlyPoints(data[id]) }));
const build = (ids: string[], overrides: Partial<ComparisonView> = {}) => buildComparisonAxes(raw(ids), { ...view, ...overrides });

describe("mixed comparison axes", () => {
  it("automatically migrates old views and follows the last selected right-side unit", () => {
    const ids = ["dxy", "fx_eur", "trade_bal", "real_tb3ms"];
    const automatic = automaticComparisonView(ids, { ...view, mode: "raw", assignments: { fx_eur: "right" }, rightUnit: "trade-balance" });
    expect(automatic).toEqual({ ...view, rightUnit: "%" });
    expect(buildComparisonAxes(raw(ids), automatic).pending).toEqual(["trade_bal"]);
    expect(automaticComparisonView(ids.slice(0, -1), automatic).rightUnit).toBe("trade-balance");
    expect(automaticComparisonView([], automatic).rightUnit).toBeNull();
    expect(automaticComparisonView(["dxy", "real_tb3ms", "trade_bal"], automatic).rightUnit).toBe("trade-balance");
  });
  it("assigns prices and amounts left; rates, ratios and signed flows right", () => {
    for (const id of ["dxy", "cpi_level", "fx_eur", "fx_krw", "fx_jpy", "nasdaq", "gold", "oil", "m2"]) expect(defaultAxis(id)).toBe("left");
    for (const id of ["real_tb3ms", "gdp_growth", "inflation", "debt_gdp", "trade", "trade_bal"]) expect(defaultAxis(id)).toBe("right");
  });
  it("overlays four indexed currencies and a negative trade balance without losing selections", () => {
    const ids = ["dxy", "fx_krw", "fx_jpy", "fx_eur", "trade_bal"];
    const result = build(ids);
    expect(result.series.map(s => s.def.id)).toEqual(ids);
    expect(result.axes.map(a => a.side)).toEqual(["left", "right"]);
    expect(result.series.filter(s => s.axis === "index").every(s => s.points.find(p => p.month === result.base)!.value === 100)).toBe(true);
    expect(result.series.at(-1)!.points.every(p => p.value === p.raw)).toBe(true);
    expect(result.series.at(-1)!.points.some(p => p.raw < 0)).toBe(true);
    expect(result.series.at(-1)!.points.some(p => p.raw > 0)).toBe(true);
  });
  it("fixes the 1990 base/EUR/real-net-export combination and preserves a three-series legacy context", () => {
    for (const ids of [["fx_eur", "trade"], ["dxy", "fx_eur", "trade_bal"]]) {
      const result = build(ids, { base: "1990-01" });
      expect(result.series).toHaveLength(ids.length);
      expect(result.series.every(s => s.points.length > 0)).toBe(true);
      expect(result.unavailable).toEqual([]);
    }
  });
  it("shares one actual-value scale between rates and growth rates and retains their raw values", () => {
    const result = build(["dxy", "real_tb3ms", "debt_gdp", "gdp_growth"]);
    expect(result.groups).toHaveLength(1);
    expect(result.series.slice(1).map(s => s.axis)).toEqual(["right:%", "right:%", "right:%"]);
    expect(result.series.slice(1).every(s => s.points.every(p => p.value === p.raw))).toBe(true);
  });
  it("separates nominal/monthly, real/annualized and rate units", () => {
    const ids = ["dxy", "trade_bal", "trade", "real_tb3ms"];
    const result = build(ids, { rightUnit: "trade-balance" });
    expect(result.groups).toHaveLength(3);
    expect(result.pending).toEqual(["trade", "real_tb3ms"]);
    const switched = build(ids, { rightUnit: "%" });
    expect(switched.series.map(s => s.def.id)).toEqual(["dxy", "real_tb3ms"]);
    expect(switched.groups).toEqual(result.groups);
    expect(switched.series[0].points).toEqual(result.series[0].points);
  });
  it("supports manual axis assignments and falls back when the active unit was removed", () => {
    const result = build(["fx_eur", "real_tb3ms"], { assignments: { fx_eur: "right", real_tb3ms: "left" }, rightUnit: "trade-balance" });
    expect(result.series.find(s => s.def.id === "fx_eur")!.axis).toBe("right:달러 / 1유로");
    expect(result.series.find(s => s.def.id === "real_tb3ms")!.axis).toBe("index");
    expect(result.rightUnit).toBe(rawUnitKey(COMPARE_SERIES.find(s => s.id === "fx_eur")!));
  });
  it("leaves valid series visible if a manually indexed series cannot be rebased", () => {
    const result = build(["dxy", "trade_bal"], { assignments: { trade_bal: "left" } });
    expect(result.series.map(s => s.def.id)).toEqual(["dxy"]);
    expect(result.unavailable).toEqual(["trade_bal"]);
    expect(build(["dxy", "trade_bal"], { base: "2100-01" }).series.map(s => s.def.id)).toEqual(["trade_bal"]);
  });
  it("keeps raw and all-index modes available", () => {
    const rawResult = build(["trade", "trade_bal"], { mode: "raw" });
    expect(rawResult.axes.every(a => !a.normalized)).toBe(true);
    expect(rawResult.series.every(s => s.points.every(p => p.value === p.raw))).toBe(true);
    expect(build(["dxy", "fx_eur"], { mode: "index" }).axes).toHaveLength(1);
  });
  it("stores axis settings atomically in insight context and accepts legacy notes", () => {
    const note = { title: "비교", date: "2005-01-01", endDate: null, text: "본문", caption: "", sortOrder: 1, context: { ids: ["dxy", "trade_bal"], spread: null } };
    expect(comparisonInsightSchema.parse(note)).toEqual(note);
    const linked = comparisonInsightSchema.parse({ ...note, context: { ...note.context, view } });
    const changes = diff(note, linked);
    expect(validateEdit({ id: crypto.randomUUID(), session: crypto.randomUUID(), resource: "note:mixed", editor: "검증", changes }).changes).toEqual(changes);
    expect(merge({ ...note, text: "다른 본문" }, changes).doc).toEqual({ ...linked, text: "다른 본문" });
    expect(comparisonInsightSchema.safeParse({ ...linked, context: { ...linked.context, view: { ...view, assignments: { dxy: "middle" } } } }).success).toBe(false);
  });
  it("detects changed axis settings for note restoration, ignoring unrelated assignments", () => {
    expect(sameComparisonView(view, { ...view, assignments: { real_tb3ms: "left" } }, ["dxy"])).toBe(true);
    expect(sameComparisonView(view, { ...view, assignments: { dxy: "right" } }, ["dxy"])).toBe(false);
    expect(sameComparisonView(view, { ...view, base: "2010-01" }, ["dxy"])).toBe(false);
    expect(sameComparisonView(undefined, view, ["dxy"])).toBe(true);
  });
});
