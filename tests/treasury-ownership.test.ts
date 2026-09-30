import { describe, expect, it } from "vitest";
import dataset from "../shared/treasury-ownership-data.json";
import { ownershipView, atOrBefore, type OwnershipData } from "../shared/treasury-ownership";

describe("국채 보유와 발행사 참고치", () => {
  it("준비자산 구성 합계가 각 공시 총액과 같고 국채와 역레포를 분리한다", () => {
    for (const issuer of dataset.issuers) {
      const { total, components } = issuer.portfolio;
      expect(Object.values(components).every(v => v === undefined || v >= 0)).toBe(true);
      expect(Object.values(components).reduce<number>((s, v) => s + (v ?? 0), 0)).toBeCloseTo(total, 4);
      expect(components.treasuries).toBeCloseTo(issuer.treasuries, 5);
    }
    const v = ownershipView(dataset, "2026-09-23")!;
    const circle = v.issuers[0].holding!.portfolio!;
    expect(circle.total).toBeCloseTo(73344.909176, 5);
    expect(circle.components.overnight_repo).toBe(52527);
    expect(circle.components.treasuries! / circle.total * 100).toBeCloseTo(11.62, 2);
    expect(v.sum).toBeCloseTo(123485.027835, 5);
    const older = ownershipView(dataset, "2025-07-02")!.issuers[1].holding!.portfolio!;
    expect(older.components.mmf).toBeCloseTo(6345.999587, 5);
    expect(v.issuers[1].holding!.portfolio!.components.mmf).toBe(0);
  });
  it("전체 구성 합계에 서클·테더를 중복 가산하지 않는다", () => {
    const v = ownershipView(dataset, "2026-09-23")!;
    expect(v.quarter.date).toBe("2026-06-30");
    expect(v.rows.reduce((sum, r) => sum + r.value, 0)).toBeCloseTo(v.quarter.total, -1);
    expect(v.sum).toBeCloseTo((8524064231 + 114960963604) / 1e6, 5);
    expect(v.share).toBeCloseTo(0.42561132, 5);
  });
  it("서클 최신 월간 값 대신 전체와 같은 분기 값을 쓴다", () => {
    const v = ownershipView(dataset, "2026-09-23")!;
    expect(v.issuers[0].latest?.date).toBe("2026-08-31");
    expect(v.issuers[0].holding?.date).toBe("2026-06-30");
    expect(v.issuers[0].holding?.fund).toBe(8524.064231);
  });
  it("과거 주차로 이동하면 미래 분기 보유액이 나오지 않는다", () => {
    const v = ownershipView(dataset, "2026-05-13")!;
    expect(v.quarter.date).toBe("2026-03-31");
    expect(v.issuers.every(i => !i.holding || i.holding.date <= v.quarter.date)).toBe(true);
    expect(ownershipView(dataset, "2009-12-31")).toBeNull();
  });
  it("공시 전 과거 주차에도 관측 기준일에 맞춰 표시한다", () => {
    expect(ownershipView(dataset, "2026-07-01")?.issuers[1].holding?.publishedAt).toBe("2026-07-31");
  });
  it("분기 말 직전 영업일은 허용하고 오래된 분기는 혼합하지 않는다", () => {
    const v = ownershipView(dataset, "2026-09-23")!;
    const data: OwnershipData = { ...dataset, issuers: [
      { ...v.issuers[0].holding!, date: "2026-06-29" },
      { ...v.issuers[1].holding!, date: "2026-03-31" },
    ] };
    const modified = ownershipView(data, "2026-09-23")!;
    expect(modified.issuers[0].holding).not.toBeNull();
    expect(modified.issuers[1].holding).toBeNull();
    expect(modified.sum).toBeNull();
    expect(modified.share).toBeNull();
  });
  it("수집 전 발행사 결측을 0%로 표시하지 않는다", () => {
    const v = ownershipView(dataset, "2024-12-31")!;
    expect(v.sum).toBeNull();
    expect(v.billShare).toBeNull();
  });
  it("모든 확대 막대가 범위 안에 있고 같은 단위를 사용한다", () => {
    for (const quarter of dataset.ownership) {
      const v = ownershipView(dataset, quarter.date)!;
      expect(v.rows.every(r => r.value >= 0 && Number.isFinite(r.share))).toBe(true);
      for (const issuer of v.issuers) if (issuer.holding) expect(issuer.holding.treasuries).toBeLessThanOrEqual(v.zoomMax);
    }
  });
  it("정렬되지 않은 관측에서도 최신 과거 관측을 고른다", () => {
    expect(atOrBefore([{ date: "2026-03-31" }, { date: "2025-12-31" }], "2026-04-01")?.date).toBe("2026-03-31");
  });
});
