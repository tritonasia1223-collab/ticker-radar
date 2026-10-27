import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { extendCpiLevels, isHistoricalCpi } from "../shared/cpi-history";
import { mergeObservations, type Point } from "../shared/capitalism-refresh";
import { withPurchasingPower } from "../shared/dollar-indicators";
import { monthlyPoints } from "../shared/cap-comparison";
import { comparisonSegments, isAnnualObservation } from "../client/src/lib/comparison-paths";
import { sourcePeriods } from "../client/src/lib/capitalism-history";

const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const data: Record<string, Point[]> = read("client/src/data/capitalism-series.json");
const annual: Point[] = read("data/cpi-history/measuringworth-1860-1913.json").points;
const audit = read("client/src/data/cpi-history-audit.json");
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

describe("historical CPI level extension", () => {
  it("adds only 53 annual levels, preserves modern CPI and every unrelated series", () => {
    const result = extendCpiLevels(data.cpi_level, annual);
    expect(result.points).toEqual(data.cpi_level);
    expect(result.history).toHaveLength(53);
    expect(result.history[0][0]).toBe("1860-01-01");
    expect(result.history.at(-1)![0]).toBe("1912-01-01");
    expect(result.historicalAnchor).toBe(9.6);
    expect(result.blsAnnualMean).toBeCloseTo(9.883333333333, 10);
    expect(hash(data.cpi_level.filter(([d]) => d >= "1913-01-01"))).toBe(audit.modernSha256);
    for (const [id, sha] of Object.entries(audit.preservedSeriesSha256)) expect(hash(data[id]), id).toBe(sha);
    for (let i = 0; i < result.history.length; i++) expect(result.history[i][1]).toBeCloseTo(annual[i][1] * result.factor, 6);
    // Relative change within history survives scaling; these are not YoY rates.
    expect(result.history[5][1] / result.history[0][1]).toBeCloseTo(15.79 / 8.06, 6);
  });
  it("rejects incomplete annual history or monthly anchor", () => {
    expect(() => extendCpiLevels(data.cpi_level, annual.slice(1))).toThrow();
    expect(() => extendCpiLevels(data.cpi_level.filter(([d]) => d !== "1913-02-01"), annual)).toThrow();
  });
  it("keeps history through monthly refresh and retains sparse purchasing-power observations", () => {
    const refreshed = mergeObservations(data.cpi_level, [["2099-01-01", 500]], false).points;
    expect(refreshed.slice(0, 53)).toEqual(data.cpi_level.slice(0, 53));
    const power = withPurchasingPower(data).usd_purchasing_power;
    expect(power.map(([d]) => d)).toEqual(data.cpi_level.map(([d]) => d));
    expect(power[0][1]).toBe(10000 / data.cpi_level[0][1]);
  });
  it("switches from annual dashes to monthly solid lines at the documented seam", () => {
    for (const id of ["cpi_level", "usd_purchasing_power"]) {
      const points = monthlyPoints(data.cpi_level.filter(([d]) => d >= "1911-01-01" && d <= "1913-02-01"));
      expect(comparisonSegments(points, id, 1).map(g => [g.dashed, g.original.map(p => p.month)])).toEqual([
        [true, ["1911-01", "1912-01", "1913-01"]], [false, ["1913-01", "1913-02"]],
      ]);
      expect(isAnnualObservation(id, "1912-01")).toBe(true);
      expect(isHistoricalCpi(id, "1913-01-01")).toBe(false);
      expect(sourcePeriods(id)[0]).toMatchObject({ from: "1860-01-01", to: "1912-01-01" });
    }
  });
});
