import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { COMPARE_SERIES, activeSeriesIds, deltaUnit, shortSeriesLabel } from "../client/src/lib/comparison-series";
import { sourcePeriods } from "../client/src/lib/capitalism-history";
import { comparisonInsightSchema, monthlyPoints, periodSummary, type Observation } from "../shared/cap-comparison";

const data: Record<string, Observation[]> = JSON.parse(readFileSync("client/src/data/capitalism-series.json", "utf8"));

describe("German mark / dollar history", () => {
  it("contains complete original monthly observations before the euro conversion period", () => {
    const points = data.fx_dem;
    expect(points).toHaveLength(336);
    expect(points[0]).toEqual(["1971-01-01", 3.637]);
    expect(points.at(-1)).toEqual(["1998-12-01", 1.6698]);
    points.forEach(([date, value], i) => {
      expect(date).toBe(new Date(Date.UTC(1971, i, 1)).toISOString().slice(0, 10));
      expect(Number.isFinite(value) && value > 0).toBe(true);
    });
    expect(data.fx_eur[0][0]).toBe("1999-01-01");
    expect(periodSummary(monthlyPoints(points), "1999-01-01", "2001-12-31")).toBeNull();
  });
  it("is a separate selectable foreign-exchange series with the correct quote direction and source period", () => {
    expect(COMPARE_SERIES.find(s => s.id === "fx_dem")).toMatchObject({ category: "dollar", unit: "마르크 / 1달러", cadence: 1, url: "https://fred.stlouisfed.org/series/EXGEUS" });
    expect(activeSeriesIds(["fx_jpy", "fx_dem", "fx_eur"])).toEqual(["fx_jpy", "fx_dem", "fx_eur"]);
    expect(shortSeriesLabel("fx_dem")).toBe("마르크/달러");
    expect(deltaUnit("마르크 / 1달러")).toBe("마르크");
    expect(sourcePeriods("fx_dem")).toMatchObject([{ from: "1971-01-01", to: "1998-12-01", id: "EXGEUS" }]);
  });
  it("can be attached to an insight and summarized across the Plaza Accord period", () => {
    const note = comparisonInsightSchema.parse({ title: "플라자 합의", date: "1985-09-01", endDate: "1987-12-31", text: "기존 본문", caption: "", sortOrder: 1, context: { ids: ["fx_dem", "fx_jpy"], spread: null } });
    expect(note.context?.ids).toContain("fx_dem");
    const result = periodSummary(monthlyPoints(data.fx_dem), note.date, note.endDate!)!;
    expect(result.change).toBeLessThan(0);
    expect(result.first.date).toBe("1985-09-01");
    expect(result.last.date).toBe("1987-12-01");
  });
});
