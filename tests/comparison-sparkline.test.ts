import { describe, expect, it } from "vitest";
import { monthlyPoints, periodSummary, spreadPoints } from "../shared/cap-comparison";
import { periodSparkline } from "../client/src/lib/comparison-sparkline";

describe("period sparklines", () => {
  it("retains intermediate reversals and agrees with the quoted actual endpoints", () => {
    const points = monthlyPoints([["1999-12-01", 100], ["2000-01-01", 2.2], ["2000-02-01", 3.4], ["2000-03-01", -1.1], ["2000-04-01", 200]]);
    const chart = periodSparkline("real_tb3ms", points, 1, "2000-01-01", "2000-03-31")!;
    const summary = periodSummary(points, "2000-01-01", "2000-03-31")!;
    expect(chart.first.point).toEqual(summary.first);
    expect(chart.last.point).toEqual(summary.last);
    expect(chart.turning).toMatchObject({ kind: "high", point: { raw: 3.4 } });
    expect(chart.zeroY).toBeGreaterThan(22);
    expect(chart.zeroY).toBeLessThan(54);
    expect(chart.segments[0].points.map(p => p.point.raw)).toEqual([2.2, 3.4, -1.1]);
  });
  it("keeps annual guides dashed but does not connect missing observations", () => {
    const points = monthlyPoints([["1945-01-01", 1], ["1946-01-01", 2], ["1947-01-01", 3], ["1947-04-01", 4], ["1947-10-01", 5]]);
    const chart = periodSparkline("real_gdp", points, 3, "1945-01-01", "1947-12-31")!;
    expect(chart.segments.map(g => [g.dashed, g.points.map(p => p.point.date)])).toEqual([
      [true, ["1945-01-01", "1946-01-01", "1947-01-01"]],
      [false, ["1947-01-01", "1947-04-01"]],
      [false, ["1947-10-01"]],
    ]);
  });
  it("does not fabricate a trend from one observation or a constant series", () => {
    const points = monthlyPoints([["2000-01-01", 10], ["2000-02-01", 10]]);
    expect(periodSparkline("cpi_level", points, 1, "2000-01-02", "2000-02-28")).toBeNull();
    const chart = periodSparkline("cpi_level", points, 1, "2000-01-01", "2000-02-28")!;
    expect(chart.first.y).toBe(chart.last.y);
    expect(chart.turning).toBeNull();
    expect(chart.zeroY).toBeNull();
    expect(chart.segments[0].d).not.toMatch(/NaN|Infinity/);
  });
  it("shows a trough without mislabelling monotonic growth as a reversal", () => {
    const falling = monthlyPoints([["2000-01-01", 3], ["2000-02-01", 1], ["2000-03-01", 4]]);
    expect(periodSparkline("dxy", falling, 1, "2000-01-01", "2000-03-31")?.turning).toMatchObject({ kind: "low", point: { raw: 1 } });
    const rising = monthlyPoints([["2000-01-01", 1], ["2000-02-01", 2], ["2000-03-01", 4]]);
    expect(periodSparkline("cpi_level", rising, 1, "2000-01-01", "2000-03-31")?.turning).toBeNull();
  });
  it("excludes a spread observation when either component falls outside the period", () => {
    const a = monthlyPoints([["2000-01-01", 2], ["2000-02-01", 3], ["2000-03-01", 4]]);
    const b = monthlyPoints([["2000-01-20", 1], ["2000-02-20", 1], ["2000-03-20", 1]]);
    const chart = periodSparkline("spread", spreadPoints(a, b), 1, "2000-01-15", "2000-03-31")!;
    expect(chart.first.point.date).toBe("2000-02-20");
    expect(chart.segments[0].points).toHaveLength(2);
  });
});
