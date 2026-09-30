import { describe, expect, it } from "vitest";
import { debtWindow } from "../shared/treasury-flow";
import { debtBusinessDate, parseTreasuryFlow } from "../server/treasury-flow";

function snapshot(date: string, issues: number, redemption: number, inflation: number) {
  return [
    ["Issues", "Bills", "Regular Series", issues], ["Issues", "Bills", "Cash Management Series", 5],
    ["Issues", "Notes", "null", 0], ["Issues", "Bonds", "null", 0],
    ["Issues", "Inflation-Protected Securities Increment", "null", inflation],
    ["Redemptions", "Bills", "null", redemption], ["Redemptions", "Notes", "null", 0], ["Redemptions", "Bonds", "null", 0],
    ["Issues", "Federal Financing Bank", "null", 9000],
  ].map(([transaction_type, security_type, security_type_desc, value]) => ({ record_date: date, security_market: "Marketable", transaction_type, security_type, security_type_desc, transaction_fytd_amt: String(value), record_fiscal_year: String(Number(date.slice(0, 4)) + (date.slice(5, 7) >= "10" ? 1 : 0)) }));
}
describe("상단 주차와 국채 일일 집계", () => {
  it("4주·13주와 직전 창을 겹치지 않는 결제일 구간으로 만든다", () => {
    expect(debtWindow("2026-09-23", 4)).toEqual({ from: "2026-08-26", start: "2026-08-27", end: "2026-09-23", weeks: 4 });
    expect(debtWindow("2026-09-23", 13).start).toBe("2026-06-25");
    expect(debtWindow("2026-09-23", 4, 1).end).toBe("2026-08-26");
  });
  it("연누계 차감으로 일별 누락·반올림 영향을 피하고 FFB를 제외한다", () => {
    const flow = parseTreasuryFlow([...snapshot("2026-08-26", 1000, 900, 10), ...snapshot("2026-09-23", 1500, 1400, 8)], "2026-09-23", 4);
    expect(flow).toMatchObject({ issues: 500, redemptions: 500, inflation: -2, net: -2, billsNet: 0 });
  });
  it("회계연도 전환 시 전년도 말 누계를 더한다", () => {
    const flow = parseTreasuryFlow([...snapshot("2025-09-17", 1000, 900, 10), ...snapshot("2025-09-30", 1400, 1150, 12), ...snapshot("2025-10-15", 300, 200, 1)], "2025-10-15", 4);
    expect(flow).toMatchObject({ issues: 705, redemptions: 450, inflation: 3, net: 258 });
  });
  it("주말·연방 공휴일만 직전 영업일을 사용한다", () => {
    expect(debtBusinessDate("2024-12-25")).toBe("2024-12-24");
    expect(debtBusinessDate("2026-07-04")).toBe("2026-07-02");
    expect(debtBusinessDate("2026-09-23")).toBe("2026-09-23");
  });
  it("아직 발표되지 않은 기준일을 오래된 자료로 채우지 않는다", () => {
    expect(() => parseTreasuryFlow([...snapshot("2026-08-26", 1000, 900, 10), ...snapshot("2026-09-22", 1500, 1400, 8)], "2026-09-23", 4)).toThrow("미공표");
  });
  it("결측·중복·알 수 없는 분류·부분 응답은 거부한다", () => {
    const rows = [...snapshot("2026-08-26", 1000, 900, 10), ...snapshot("2026-09-23", 1500, 1400, 8)];
    expect(() => parseTreasuryFlow([...rows, rows[0]], "2026-09-23", 4)).toThrow("중복");
    expect(() => parseTreasuryFlow(rows.filter(r => r.security_type !== "Notes"), "2026-09-23", 4)).toThrow("필수");
    expect(() => parseTreasuryFlow(rows.filter(r => r.security_type_desc !== "Cash Management Series"), "2026-09-23", 4)).toThrow("분류 누락");
    expect(() => parseTreasuryFlow(rows.map((r, n) => n === 0 ? { ...r, transaction_fytd_amt: "null" } : r), "2026-09-23", 4)).toThrow("금액 누락");
  });
});
