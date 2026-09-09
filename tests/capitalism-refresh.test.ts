import { describe, expect, it } from "vitest";
import { annualChange, closedMonthEnds, mergeObservations } from "../shared/capitalism-refresh";
describe("monthly macro refresh", () => {
  it("excludes the current partial month and picks the last dated observation from unsorted input", () => {
    expect(closedMonthEnds([["2026-09-01", 99], ["2026-08-31", 20], ["2026-08-03", 10]], new Date("2026-09-03T00:00:00Z"))).toEqual([["2026-08-01", 20]]);
  });
  it("handles a year boundary", () => {
    expect(closedMonthEnds([["2025-12-31", 1], ["2026-01-02", 2]], new Date("2026-01-03T00:00:00Z"))).toEqual([["2025-12-01", 1]]);
  });
  it("uses calendar years for CPI despite missing months", () => {
    expect(annualChange([["2025-01-01", 100], ["2025-03-01", 105], ["2026-01-01", 110], ["2026-02-01", 120]], 2)).toEqual([["2026-01-01", 10]]);
  });
  it("repairs only the last completed stored month and preserves earlier history", () => {
    const result = mergeObservations([["2026-07-01", 1], ["2026-08-01", 2]], [["2026-07-01", 11], ["2026-08-01", 22], ["2026-09-01", 33]], true);
    expect(result.points).toEqual([["2026-07-01", 1], ["2026-08-01", 22], ["2026-09-01", 33]]); expect(result.added).toBe(1);
  });
  it("ordinary series remain append-only and reruns are idempotent", () => {
    const result = mergeObservations([["2026-07-01", 1]], [["2026-07-01", 9], ["2026-08-01", 2]]);
    expect(result.points).toEqual([["2026-07-01", 1], ["2026-08-01", 2]]);
    expect(mergeObservations(result.points, result.points).added).toBe(0);
  });
});
