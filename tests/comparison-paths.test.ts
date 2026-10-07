import { describe, expect, it } from "vitest";
import { monthlyPoints } from "../shared/cap-comparison";
import { comparisonSegments, comparisonPaths, visiblePathPoints } from "../client/src/lib/comparison-paths";
import { nearbyObservation } from "../client/src/lib/comparison-hover";

describe("annual comparison guides", () => {
  it("joins annual observations with dashes and switches to solid quarterly lines", () => {
    const points = monthlyPoints([["1964-01-01", 46.18], ["1965-01-01", 43.42], ["1966-01-01", 40.34], ["1966-04-01", 39.27]]);
    const paths = comparisonSegments(points, "debt_gdp", 3);
    expect(paths.map(g => [g.dashed, g.original.map(p => p.month)])).toEqual([
      [true, ["1964-01", "1965-01", "1966-01"]], [false, ["1966-01", "1966-04"]],
    ]);
  });
  it("does not bridge missing years or missing monthly observations", () => {
    const points = monthlyPoints([["1960-01-01", 1], ["1961-01-01", 2], ["1963-01-01", 3]]);
    expect(comparisonSegments(points, "trade_bal", 1).map(g => g.original.length)).toEqual([2, 1]);
    expect(comparisonSegments(points, "cpi_level", 1).map(g => g.original.length)).toEqual([1, 1, 1]);
    const growth = monthlyPoints([["1945-01-01", -1], ["1946-01-01", 2], ["1947-04-01", 3]]);
    expect(comparisonSegments(growth, "gdp_growth", 3).map(g => g.original.length)).toEqual([2, 1]);
  });
  it("keeps annual guides and raw values unchanged by smoothing, with estimated zero crossings", () => {
    const points = monthlyPoints([["1930-01-01", 2], ["1931-01-01", -2], ["1932-01-01", 4]]);
    const result = comparisonPaths(points, "trade", 3, 12);
    expect(result).toHaveLength(1);
    expect(result[0].rendered).toEqual(points);
    expect(result[0].crossings).toHaveLength(2);
    expect(result[0].crossings.every(p => p.estimated)).toBe(true);
    const from = Date.parse("1930-05-01"), to = Date.parse("1930-08-01");
    expect(visiblePathPoints(points, from, to)).toEqual(points.slice(0, 2));
    const pointer = { x: from, y: 2 + (from - points[0].time) / (points[1].time - points[0].time) * -4 };
    const hit = nearbyObservation([{ points, rendered: points }], pointer, n => n, n => n);
    expect(hit?.point).toBe(points[0]);
    expect(hit?.point.raw).toBe(2);
  });
});
