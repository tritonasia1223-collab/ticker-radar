import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { COMPARE_SERIES, activeSeriesIds, viewingSeriesIds, seriesLabel } from "../client/src/lib/comparison-series";
import { PANELS } from "../client/src/lib/capitalism-config";
import { buildAlignedComparison, defaultAlignment } from "../client/src/lib/comparison-experiment";
import { automaticComparisonView, buildComparisonAxes } from "../client/src/lib/comparison-axes";
import { monthlyPoints, comparisonInsightSchema } from "../shared/cap-comparison";
import { withRealInterestRate } from "../shared/real-interest-rate";
import { differenceSeries, type Point } from "../shared/capitalism-refresh";

const data = JSON.parse(readFileSync("client/src/data/capitalism-series.json", "utf8")) as Record<string, Point[]>;
describe("CPI level replaces YoY only in comparison views", () => {
  it("keeps the original YoY series and real-rate calculation while selecting CPIAUCNS", () => {
    expect(COMPARE_SERIES).toHaveLength(16);
    expect(COMPARE_SERIES.some(s => s.id === "inflation")).toBe(false);
    expect(COMPARE_SERIES.find(s => s.id === "cpi_level")).toMatchObject({ unit: "idx", cadence: 1, category: "economy", url: "https://fred.stlouisfed.org/series/CPIAUCNS" });
    expect(PANELS.find(s => s.id === "inflation")?.series).toBe("inflation");
    expect(data.inflation.length).toBeGreaterThan(1000);
    expect(withRealInterestRate(data).real_tb3ms).toEqual(differenceSeries(data.tb3ms, data.inflation, 2));
  });
  it("uses independent raw CPI in the main chart and a median baseline in the experiment", () => {
    const points = monthlyPoints(data.cpi_level);
    const raw = [{ def: COMPARE_SERIES.find(s => s.id === "cpi_level")!, points }];
    const main = buildComparisonAxes(raw, automaticComparisonView(["cpi_level"]));
    expect(main.series[0].axis).toBe("independent:cpi_level");
    expect(main.axes).toEqual([{ side: "left", key: "independent:cpi_level", label: "미국 소비자물가 수준(CPI) · 독립 배율", normalized: false, independent: true }]);
    expect(main.series[0].points).toEqual(points);
    expect(main.series[0].points.map(p => p.raw)).toEqual(points.map(p => p.raw));
    const experiment = buildAlignedComparison(raw, defaultAlignment);
    expect(experiment.alignment.calibrations.cpi_level.kind).toBe("median");
    expect(experiment.alignment.calibrations.cpi_level.center).toBeGreaterThan(0);
    expect(experiment.series[0].points.map(p => p.raw)).toEqual(points.map(p => p.raw));
  });
  it("keeps other series, common base and unit groups unchanged when CPI is toggled", () => {
    const ids = ["dxy", "real_tb3ms"], source = withRealInterestRate(data);
    const raw = [...ids, "cpi_level"].map(id => ({ def: COMPARE_SERIES.find(s => s.id === id)!, points: monthlyPoints(source[id]) }));
    const without = buildComparisonAxes(raw.slice(0, 2), automaticComparisonView(ids));
    const withCpi = buildComparisonAxes(raw, automaticComparisonView([...ids, "cpi_level"]));
    expect(withCpi.series.filter(s => s.def.id !== "cpi_level")).toEqual(without.series);
    expect(withCpi.axes.filter(a => !a.independent)).toEqual(without.axes);
    expect(withCpi.base).toBe(without.base);
    expect(withCpi.groups).toEqual(without.groups);
    expect(withCpi.pending).toEqual(without.pending);
    const oldBase = buildComparisonAxes([raw[2]], { ...automaticComparisonView(["cpi_level"]), base: "2100-01" });
    expect(oldBase.unavailable).toEqual([]);
    expect(oldBase.series[0].points).toEqual(raw[2].points);
  });
  it("migrates viewing selections but preserves what old insight prose referenced", () => {
    expect(viewingSeriesIds(["inflation", "cpi_level", "usd_purchasing_power"])).toEqual(["cpi_level", "usd_purchasing_power"]);
    const note = { title: "YoY 기록", date: "2020-01-01", endDate: null, text: "당시 물가상승률", caption: "", sortOrder: 1, context: { ids: ["inflation"], spread: null } };
    expect(comparisonInsightSchema.parse(note)).toEqual(note);
    expect(activeSeriesIds(note.context.ids)).toEqual([]);
    expect(seriesLabel("inflation")).toContain("YoY");
    expect(seriesLabel("inflation")).toContain("비교에서 제외됨");
  });
});
