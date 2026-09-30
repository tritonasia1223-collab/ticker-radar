import { describe, expect, it } from "vitest";
import { reservesGdp } from "../shared/reserves-gdp";

const gdp = [{ date: "2026-01-01", value: 30_000_000 }, { date: "2026-04-01", value: 32_000_000 }];
describe("지급준비금 / 명목 GDP", () => {
  it("분기 시작일이 지나도 분기 전체가 끝나기 전에는 이전 분모 사용", () => {
    expect(reservesGdp(3_000_000, "2026-06-17", gdp)).toMatchObject({ pct: 10, quarter: "2026년 1분기", periodEnd: "2026-03-31" });
    expect(reservesGdp(3_200_000, "2026-09-23", gdp)).toMatchObject({ pct: 10, quarter: "2026년 2분기", periodEnd: "2026-06-30" });
  });
  it("금액 단위를 맞추고 연율 GDP에 다시 4를 곱하지 않는다", () => {
    expect(reservesGdp(2_880_000, "2026-09-23", [...gdp].reverse())?.pct).toBe(9);
  });
  it("분모 미확보·0·오래된 자료는 비율을 만들지 않는다", () => {
    expect(reservesGdp(3_000_000, "2025-12-31", gdp)).toBeNull();
    expect(reservesGdp(3_000_000, "2026-09-23", [{ date: "2026-04-01", value: 0 }])).toBeNull();
    expect(reservesGdp(3_000_000, "2027-02-01", gdp)).toBeNull();
    expect(reservesGdp(NaN, "2026-09-23", gdp)).toBeNull();
  });
});
