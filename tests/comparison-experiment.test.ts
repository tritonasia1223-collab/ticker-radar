import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { calibrate, alignedValue, alignmentSchema } from "../shared/comparison-alignment";
import { monthlyPoints, comparisonInsightSchema } from "../shared/cap-comparison";
import { buildAlignedComparison, defaultAlignment, viewingAlignment } from "../client/src/lib/comparison-experiment";
import { COMPARE_SERIES } from "../client/src/lib/comparison-series";
import { withPurchasingPower } from "../shared/dollar-indicators";
import { withRealInterestRate } from "../shared/real-interest-rate";
import { diff, merge } from "../shared/cap-collaboration";
import { validateEdit } from "../server/cap-collaboration";

const points = (values: number[]) => monthlyPoints(values.map((v, i) => [new Date(Date.UTC(2000, i, 1)).toISOString().slice(0, 10), v]));
const values = Array.from({ length: 24 }, (_, i) => i - 12);
const data = withRealInterestRate(withPurchasingPower(JSON.parse(readFileSync("client/src/data/capitalism-series.json", "utf8"))));
const raw = COMPARE_SERIES.map(def => ({ def, points: monthlyPoints(data[def.id] ?? []) }));

describe("isolated baseline comparison", () => {
  it("defaults to all available history and only restricts explicitly supplied bounds", () => {
    expect(defaultAlignment.from).toBeNull(); expect(defaultAlignment.to).toBeNull();
    const result = buildAlignedComparison(raw, defaultAlignment);
    for (const s of raw) {
      const c = result.alignment.calibrations[s.def.id];
      expect(c.from).toBe(s.points[0].month);
      expect(c.to).toBe(s.points.at(-1)!.month);
      expect(c.samples).toBe(s.points.length);
    }
    expect(calibrate("gold", points(values), null, "2000-12")?.samples).toBe(12);
    expect(calibrate("gold", points(values), "2001-01", null)?.samples).toBe(12);
    const old = { ...defaultAlignment, from: "2000-01", to: "2025-12" };
    expect(viewingAlignment(old, undefined)).toEqual(defaultAlignment);
    expect(viewingAlignment(old, 2)).toEqual(old);
    expect(viewingAlignment({ ...old, from: "1990-01" }, undefined).from).toBe("1990-01");
    expect(alignmentSchema.parse(old)).toEqual(old); // Saved note contexts are not migrated.
  });
  it("aligns meaningful anchors, preserves signs and the underlying observations", () => {
    for (const [id, center] of [["dxy", 100], ["reer", 100], ["gdp_growth", 0], ["real_tb3ms", 0], ["trade_bal", 0], ["net_exports_gdp", 0]] as const) {
      const c = calibrate(id, points(values), "2000-01", "2001-12")!;
      expect(c.center).toBe(center);
      expect(alignedValue(center, c)).toBe(0);
      expect(alignedValue(center - 1, c)).toBeLessThan(0);
      expect(alignedValue(center + 1, c)).toBeGreaterThan(0);
    }
    const result = buildAlignedComparison(raw, defaultAlignment);
    expect(result.unavailable).toEqual([]);
    for (const s of result.series) {
      expect(s.points.map(p => [p.date, p.raw])).toEqual(raw.find(r => r.def.id === s.def.id)!.points.map(p => [p.date, p.raw]));
      expect(s.points.every(p => Number.isFinite(p.value))).toBe(true);
    }
  });
  it("normalizes small and large units identically and resists isolated extremes", () => {
    const small = points(values), big = points(values.map(v => v * 1000000));
    const a = calibrate("gold", small, "2000-01", "2001-12")!, b = calibrate("m2", big, "2000-01", "2001-12")!;
    small.forEach((p, i) => expect(alignedValue(p.raw, a)).toBeCloseTo(alignedValue(big[i].raw, b), 12));
    const outlier = calibrate("gold", points([...values.slice(0, -1), 1e12]), "2000-01", "2001-12")!;
    expect(outlier.center).toBe(a.center); expect(outlier.scale).toBe(a.scale);
    expect(alignedValue(1e12, outlier)).toBeGreaterThan(alignedValue(100, outlier));
  });
  it("uses only the requested reference window; insufficient or flat data never invent a scale", () => {
    const outside = [...points(values), { ...points([1e9])[0], month: "2030-01" }];
    expect(calibrate("gold", outside, "2000-01", "2001-12")).toEqual(calibrate("gold", points(values), "2000-01", "2001-12"));
    expect(calibrate("gold", points(values.slice(0, 11)), "2000-01", "2001-12")).toBeNull();
    expect(calibrate("gold", points(values.map(() => 5)), "2000-01", "2001-12")).toBeNull();
    const plateau = calibrate("fedfunds", points([...Array(23).fill(0), 1]), "2000-01", "2001-12")!;
    expect(plateau.scale).toBe(1);
  });
  it("retains saved calibration through new observations and indicator selection changes", () => {
    const first = buildAlignedComparison(raw, defaultAlignment);
    const changed = raw.map(s => ({ ...s, points: s.points.map(p => ({ ...p, raw: p.raw * 2 })) }));
    const restored = buildAlignedComparison(changed, first.alignment);
    expect(restored.alignment).toEqual(first.alignment);
    const gold = first.series.find(s => s.def.id === "gold")!;
    expect(buildAlignedComparison(raw.filter(s => s.def.id === "gold"), first.alignment).series[0].points).toEqual(gold.points);
  });
  it("round trips experimental insight context atomically and keeps legacy notes valid", () => {
    const note = { title: "기준 비교", date: "2020-01-01", endDate: null, text: "본문", caption: "", sortOrder: 1, context: { ids: ["gold"], spread: null } };
    const alignment = buildAlignedComparison(raw.filter(s => s.def.id === "gold"), defaultAlignment).alignment;
    const next = comparisonInsightSchema.parse({ ...note, context: { ...note.context, alignment } });
    const changes = diff(note, next);
    expect(validateEdit({ id: crypto.randomUUID(), session: crypto.randomUUID(), resource: "note:experiment", editor: "test", changes }).changes).toEqual(changes);
    expect(merge(note, changes).doc).toEqual(next);
    expect(comparisonInsightSchema.parse(note)).toEqual(note);
    expect(alignmentSchema.safeParse({ ...alignment, from: "2026-01", to: "2025-12" }).success).toBe(false);
    expect(alignmentSchema.safeParse({ ...alignment, calibrations: { gold: { ...alignment.calibrations.gold, scale: 0 } } }).success).toBe(false);
  });
});
