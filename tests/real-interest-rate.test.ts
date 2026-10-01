import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { withRealInterestRate } from "../shared/real-interest-rate";
import type { Point } from "../shared/capitalism-refresh";
import { COMPARE_SERIES } from "../client/src/lib/comparison-series";
import { automaticComparisonView, buildComparisonAxes } from "../client/src/lib/comparison-axes";
import { historyOf, sourcePeriods } from "../client/src/lib/capitalism-history";
import { monthlyPoints } from "../shared/cap-comparison";

const raw = JSON.parse(readFileSync("client/src/data/capitalism-series.json", "utf8")) as Record<string, Point[]>;
const data = withRealInterestRate(raw);

describe("derived real interest rate", () => {
  it("subtracts same-month YoY, preserving zero/negative rates and gaps without mutating inputs", () => {
    const input: Record<string, Point[]> = {
      tb3ms: [["2020-03-01", 1], ["2020-01-01", 2], ["2020-02-01", 3], ["2020-04-01", NaN]],
      inflation: [["2020-01-01", 4], ["2020-02-01", 3], ["2020-04-01", 2], ["2020-05-01", 1]],
    };
    const before = structuredClone(input);
    expect(withRealInterestRate(input).real_tb3ms).toEqual([["2020-01-01", -2], ["2020-02-01", 0]]);
    expect(input).toEqual(before);
    expect(withRealInterestRate({}).real_tb3ms).toEqual([]);
  });

  it("covers exactly the available intersection and recalculates on source updates", () => {
    const cpi = new Map(raw.inflation);
    const expected = raw.tb3ms.filter(([d]) => cpi.has(d));
    expect(data.real_tb3ms.length).toBe(expected.length);
    expect(data.real_tb3ms[0][0]).toBe("1914-01-01");
    for (const [d, v] of data.real_tb3ms) expect(v).toBeCloseTo(new Map(raw.tb3ms).get(d)! - cpi.get(d)!, 2);
    const next = { ...raw, tb3ms: [...raw.tb3ms, ["2099-01-01", 4] as Point], inflation: [...raw.inflation, ["2099-01-01", 5] as Point] };
    expect(withRealInterestRate(next).real_tb3ms.at(-1)).toEqual(["2099-01-01", -1]);
    expect(raw.real_tb3ms).toBeUndefined();
  });

  it("documents proxy and CPI source changes without overlaps or uncovered observations", () => {
    const periods = sourcePeriods("real_tb3ms"), dates = data.real_tb3ms.map(([d]) => d);
    expect(periods.map(p => p.from)).toEqual(["1914-01-01", "1934-01-01", "1948-01-01"]);
    expect(periods[0].source).toContain("대용");
    for (const p of periods) {
      expect(dates).toContain(p.from);
      if (p.to) expect(dates).toContain(p.to);
    }
    for (const d of dates) expect(periods.filter(p => p.from <= d && (!p.to || d <= p.to))).toHaveLength(1);
    expect(historyOf("real_tb3ms")?.segments.map(s => s.proxy)).toEqual([true, false]);
  });

  it("uses the requested label and plots actual signed rates alongside nominal rates and inflation", () => {
    const ids = ["dxy", "tb3ms", "inflation", "real_tb3ms"];
    const rawSeries = ids.map(id => ({ def: COMPARE_SERIES.find(s => s.id === id)!, points: monthlyPoints(data[id]) }));
    const result = buildComparisonAxes(rawSeries, automaticComparisonView(ids));
    const real = result.series.find(s => s.def.id === "real_tb3ms")!;
    expect(real.def.label).toBe("실질금리 (명목금리 − 물가)");
    expect(real.def.unit).toBe("%");
    expect(real.axis).toBe("right:%");
    expect(real.points).toEqual(rawSeries.at(-1)!.points);
    expect(real.points.some(p => p.value < 0)).toBe(true);
    expect(result.pending).toEqual([]);
    expect(result.series.find(s => s.def.id === "tb3ms")?.axis).toBe(real.axis);
  });
});
