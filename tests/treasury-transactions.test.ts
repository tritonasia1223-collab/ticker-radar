import { describe, expect, it, vi, afterEach } from "vitest";
import { holdingSegments, waterfallBars, treasuryWaterfall, fedWaterfall, type TreasuryTransactions } from "../shared/treasury-transactions";
import { amount, maturityWindows, parseMaturities, parseBuybacks, parseDts, parseFedOperations, treasuryTransactions } from "../server/treasury-transactions";

afterEach(() => vi.unstubAllGlobals());
const fixture = (): TreasuryTransactions => ({ month: "2026-07", fetchedAt: "2026-09-10", errors: {},
  treasury: { asOf: "2026-07-31", issues: 1200, redemptions: 1000, inflation: 5 },
  buybacks: { cashManagement: 4, liquiditySupport: 6, other: 0, total: 10, count: 2 },
  fed: { purchases: 45, sales: 5, rollovers: 80, maturities: 95, operations: 3 },
});

describe("국채 잔액 증감 분해", () => {
  it("연준 증가분과 연준 외 증가분이 공급과 일치한다", () => {
    const result = holdingSegments(200, 30)!;
    expect(result.segments.map(s => [s.start, s.end])).toEqual([[0, 30], [30, 200]]);
  });
  it("QT와 순상환을 음수로 표시하고 100% 구성비로 왜곡하지 않는다", () => {
    expect(holdingSegments(240, -30)!.segments.map(s => [s.start, s.end])).toEqual([[0, -30], [0, 270]]);
    expect(holdingSegments(-40, 10)!.segments.map(s => [s.start, s.end])).toEqual([[0, 10], [0, -50]]);
    expect(holdingSegments(0, 0)!.segments.every(s => s.value === 0)).toBe(true);
    expect(holdingSegments(NaN, 1)).toBeNull();
  });
  it("바이백을 상환에서 한 번만 분리하고 물가보정·대조차이를 구분한다", () => {
    const items = treasuryWaterfall(fixture(), 208)!;
    expect(items.find(i => i.label === "만기·기타 상환")!.value).toBe(-990);
    expect(items.find(i => i.label === "바이백 소각")!.value).toBe(-10);
    expect(items.find(i => i.label === "자료 간 차이")!.value).toBe(3);
    const bars = waterfallBars(items);
    expect(bars.at(-2)!.end).toBe(208);
    expect(bars.at(-1)).toMatchObject({ start: 0, end: 208, total: true });
  });
  it("만기도래 추정과 보유 관측 차이를 매입액으로 위장하지 않는다", () => {
    const items = fedWaterfall(fixture(), 30)!;
    expect(items.find(i => i.label === "만기도래 추정")).toMatchObject({ value: -95, estimated: true });
    expect(items.find(i => i.label === "관측일·기타 차이")).toMatchObject({ value: 5, estimated: true });
    expect(waterfallBars(items).at(-2)!.end).toBe(30);
  });
  it("결측이나 불가능한 상환 분해를 0으로 만들지 않는다", () => {
    const data = fixture(); data.buybacks = null;
    expect(treasuryWaterfall(data, 200)).toBeNull();
    data.fed = null; expect(fedWaterfall(data, 20)).toBeNull();
    expect(() => waterfallBars([{ label: "missing", value: NaN }])).toThrow();
  });
});

describe("공식 거래 자료의 단위·날짜·누락", () => {
  it.each([null, undefined, "", "null", "NA"])("미공표 값 %s를 거부한다", value => expect(() => amount(value)).toThrow());
  it("바이백의 한도가 아닌 낙찰액을 결제월로 합산한다", () => {
    const data = parseBuybacks([
      { settlement_date: "2026-07-01", operation_type: "Cash Management", total_par_amt_accepted: "4000000", max_par_amt_redeemed: "100000000" },
      { settlement_date: "2026-08-01", operation_type: "Liquidity Support", total_par_amt_accepted: "9000000" },
    ], "2026-07-01", "2026-07-31");
    expect(data).toMatchObject({ cashManagement: 4, total: 4, count: 1 });
    expect(() => parseBuybacks([{ settlement_date: "2026-07-01", total_par_amt_accepted: "null" }], "2026-07-01", "2026-07-31")).toThrow();
  });
  it("월말 직전 체결·다음 달 결제 거래를 제외하고 백만 달러로 변환한다", () => {
    expect(parseFedOperations([
      { settlementDate: "2026-07-01", operationDirection: "P", totalParAmtAccepted: "5000000" },
      { settlementDate: "2026-07-02", operationDirection: "S", totalParAmtAccepted: "1000000" },
      { settlementDate: "2026-08-01", operationDirection: "P", totalParAmtAccepted: "99000000" },
    ], "2026-07-01", "2026-07-31")).toEqual({ purchases: 5, sales: 1, operations: 2 });
  });
  it("DTS 월누적은 최신 일자만 사용하고 중복 일자를 더하지 않는다", () => {
    const rows = ["2026-07-30", "2026-07-31"].flatMap(record_date => ["Issues", "Redemptions"].flatMap(transaction_type =>
      ["Bills", "Notes", "Bonds"].map(security_type => ({ record_date, transaction_type, security_type, security_market: "Marketable", transaction_mtd_amt: transaction_type === "Issues" ? "100" : "80" }))));
    const extras = ["2026-07-30", "2026-07-31"].map(record_date => ({ record_date, transaction_type: "Issues", security_type: "Inflation-Protected Securities Increment", security_market: "Marketable", transaction_mtd_amt: "5" }));
    expect(parseDts([...rows, ...extras])).toEqual({ asOf: "2026-07-31", issues: 300, inflation: 5, redemptions: 240 });
    expect(() => parseDts(rows)).toThrow("물가보정");
  });
  it("수요일에 시작·종료하는 달도 만기를 정확히 한 번씩 포함한다", () => {
    for (const month of ["2026-07", "2026-09"]) {
      const end = month === "2026-07" ? "2026-07-31" : "2026-09-30";
      const windows = maturityWindows(`${month}-01`, end);
      for (let day = 1; day <= Number(end.slice(8)); day++) {
        const date = `${month}-${String(day).padStart(2, "0")}`;
        expect(windows.filter(w => date >= w.from && date <= w.through)).toHaveLength(1);
      }
    }
    const w = maturityWindows("2026-07-01", "2026-07-31")[0];
    expect(parseMaturities([{ asOfDate: w.asOf, maturityDate: "2026-07-01", cusip: "A", parValue: "123000000" }], w)).toBe(123);
    expect(() => parseMaturities([{ asOfDate: "wrong" }], w)).toThrow();
  });
  it("입력 월을 검증하고 실패한 공식 요청을 재시도할 수 있다", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("network")); vi.stubGlobal("fetch", fetch);
    await expect(treasuryTransactions("2026-13")).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
    const first = await treasuryTransactions("2024-01");
    expect(first.treasury).toBeNull(); expect(Object.keys(first.errors)).toHaveLength(3);
    const count = fetch.mock.calls.length;
    await treasuryTransactions("2024-01"); expect(fetch.mock.calls.length).toBeGreaterThan(count);
  });
});
