import { describe, expect, it } from "vitest";
import { m2Composition } from "../shared/m2-composition";
import type { LiquidityContext } from "../shared/liquidity-beta";

// 2026년 8월 H.6 공시값, 백만 달러. 합계의 1억 달러 차이는 공시 반올림.
const total = { date: "2026-08-01", value: 23_342_800 };
function fixture(): LiquidityContext["series"] {
  return Object.fromEntries(Object.entries({ m2Currency: 2_389_700, m2Demand: 7_128_000, m2Liquid: 10_473_500, m2Time: 1_505_600, m2Retail: 3_073_900, m2Retirement: 1_227_900, m2RetirementDeposits: 477_700 }).map(([key, value]) => [key, [{ date: total.date, value }]]));
}
describe("M2 구성비", () => {
  it("기관별 은퇴계좌를 한 번만 차감하고 구성비 합계는 100%", () => {
    const result = m2Composition(fixture(), total)!;
    expect(result.parts.find(p => p.key === "time")?.value).toBe(1_027_900);
    expect(result.parts.find(p => p.key === "retail")?.value).toBe(2_323_700);
    expect(result.parts.reduce((sum, p) => sum + p.share, 0)).toBeCloseTo(100);
    expect(result.total).toBe(total.value);
  });
  it("전월 자료나 미래 자료를 최신 월의 구성비에 섞지 않음", () => {
    for (const date of ["2026-07-01", "2026-09-01"]) {
      const series = fixture();
      series.m2Time![0].date = date;
      expect(m2Composition(series, total)).toBeNull();
    }
  });
  it("차감 자료 누락·음수·합계 불일치를 잔차로 채우지 않음", () => {
    const missing = fixture();
    delete missing.m2Retirement;
    expect(m2Composition(missing, total)).toBeNull();
    const negative = fixture();
    negative.m2Time![0].value = 100;
    expect(m2Composition(negative, total)).toBeNull();
    expect(m2Composition(fixture(), { ...total, value: 24_000_000 })).toBeNull();
    expect(m2Composition(fixture(), null)).toBeNull();
  });
});
