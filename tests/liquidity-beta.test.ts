import { describe, expect, it } from "vitest";
import {
  atOrBefore, nearest, changeFrom, yoyMonthly, yoyWeekly, taxDatesWithin, stockChangeBetween, latestCommon, roundAdditive,
  liquidityBand, netLiquidity, maturityOf, auctionAmount, aggregateAuctions, sankeyData,
  spreadBand, spreadBp, loansBand, nfciBand, MATURITIES, BIDDERS, type AuctionRow, type BandWeek, type Obs,
} from "../shared/liquidity-beta";
import { auctionWindow } from "../server/liquidity-beta";

const obs = (pairs: [string, number][]): Obs[] => pairs.map(([date, value]) => ({ date, value }));

describe("유동성 베타 — 시점·변화", () => {
  const monthly = obs([["2025-06-01", 21000], ["2025-07-01", 21100], ["2025-08-01", 21200], ["2026-06-01", 22900], ["2026-07-01", 23218]]);

  it("date 이하 마지막 관측을 찾고 없으면 null", () => {
    expect(atOrBefore(monthly, "2026-09-09")?.date).toBe("2026-07-01");
    expect(atOrBefore(monthly, "2025-05-31")).toBeNull();
  });

  it("허용 범위 밖이면 nearest 는 null — 행 수가 아니라 날짜", () => {
    expect(nearest(monthly, "2026-07-03", 4)?.date).toBe("2026-07-01");
    expect(nearest(monthly, "2025-12-15", 16)).toBeNull(); // 2025-12 관측 없음 → 인접 행으로 대체하지 않는다
  });

  it("월간 전년비는 같은 달을 찾고, 그 달이 없으면 null", () => {
    const y = yoyMonthly(monthly, "2026-09-09");
    expect(y?.to.date).toBe("2026-07-01");
    expect(y?.from.date).toBe("2025-07-01");
    expect(y?.pct).toBeCloseTo((23218 / 21100 - 1) * 100, 6);
    const gap = obs([["2025-05-01", 1], ["2026-07-01", 2]]);
    expect(yoyMonthly(gap, "2026-07-01")).toBeNull();
  });

  it("주간 전년비는 52주(364일) 전 같은 요일을 쓴다", () => {
    const weekly = obs([["2025-09-10", 100], ["2025-09-17", 101], ["2026-09-09", 110]]);
    const y = yoyWeekly(weekly, "2026-09-09");
    expect(y?.from.date).toBe("2025-09-10");
    expect(y?.delta).toBe(10);
  });

  it("기간 변화는 to 시점 기준으로 days 전 근처를 찾는다", () => {
    const daily = obs([["2026-06-10", 1.00], ["2026-06-11", 1.02], ["2026-09-09", 1.30]]);
    const c = changeFrom(daily, "2026-09-11", 90, 4);
    expect(c?.to.date).toBe("2026-09-09");
    expect(c?.from.date).toBe("2026-06-11");
    expect(c?.delta).toBeCloseTo(0.28, 10);
  });

  it("두 시점 잔액 변화는 띠의 구간에 맞추고, 허용 범위 밖·같은 관측이면 결측", () => {
    const weekly = obs([["2026-08-05", 100], ["2026-08-12", 102], ["2026-09-02", 110], ["2026-09-09", 111]]);
    const c = stockChangeBetween(weekly, "2026-08-12", "2026-09-09", 7);
    expect(c?.from.date).toBe("2026-08-12"); expect(c?.to.date).toBe("2026-09-09"); expect(c?.delta).toBe(9);
    // 최신 관측이 9/02 뿐이고 목표가 9/16 이면 14일 차 → 허용 7일 초과 → 결측(최신 관측에서 기간을 다시 재지 않는다)
    expect(stockChangeBetween(weekly.slice(0, 3), "2026-08-19", "2026-09-16", 7)).toBeNull();
    // 월간: 4주 구간이 한 달 안에 들면 같은 관측 → 결측
    const monthly = obs([["2026-07-31", 6000], ["2026-08-31", 6100]]);
    expect(stockChangeBetween(monthly, "2026-09-02", "2026-09-23", 35)).toBeNull();
    expect(stockChangeBetween(monthly, "2026-08-12", "2026-09-09", 35)?.delta).toBe(100);
  });

  it("발표 시차가 있는 두 시리즈는 최신 공통 관측일에서만 짝짓는다", () => {
    const sofr = obs([["2026-09-12", 3.63], ["2026-09-15", 3.64]]);
    const iorb = obs([["2026-09-12", 3.65], ["2026-09-15", 3.65], ["2026-09-17", 3.90]]);
    const p = latestCommon(sofr, iorb);
    expect(p?.date).toBe("2026-09-15"); expect(p?.b.value).toBe(3.65);
    expect(Math.round((p!.a.value - p!.b.value) * 100)).toBe(-1); // −26bp 가 아니라 −1bp
    expect(latestCommon(sofr, obs([["2026-09-17", 3.9]]))).toBeNull();
  });

  it("표시 반올림은 합이 총액과 같아지도록 드리프트를 최대 항목에 흡수한다", () => {
    expect(roundAdditive([149, 149, 149], 447, 10)).toEqual({ parts: [150, 150, 150], total: 450 });
    const r = roundAdditive([145, 145, 145], 435, 10);
    expect(r.total).toBe(440); expect(r.parts.reduce((s, v) => s + v, 0)).toBe(440);
    const skew = roundAdditive([1004, 3, 3], 1010, 10); // 최대 항목이 흡수
    expect(skew.parts).toEqual([1000, 0, 0].map((v, i) => (i === 0 ? 1010 : v)));
    expect(roundAdditive([NaN, 5], 5, 10).parts[0]).toBeNaN(); // 결측이면 흡수 안 함
  });

  it("세금일이 구간에 있으면 날짜를 돌려주고 없으면 빈 배열", () => {
    expect(taxDatesWithin("2026-08-12", "2026-09-09")).toEqual([]);
    expect(taxDatesWithin("2026-09-02", "2026-09-30")).toEqual(["2026-09-15"]);
    expect(taxDatesWithin("2025-12-01", "2026-04-20")).toEqual(["2025-12-15", "2026-04-15"]);
  });
});

describe("유동성 베타 — 띠 항등식", () => {
  // 부채 잔차 = 총자산 − 준비금 − 역레포 − TGA − 현금통화 (server/fed.ts buildWeekly 와 같은 정의)
  const week = (date: string, total: number, tga: number, rrp: number, reserves: number, currency: number): BandWeek =>
    ({ date, total, tga, rrp, reserves, currency, liabResidual: total - reserves - rrp - tga - currency });
  const prev = week("2026-08-12", 6_980_000, 730_000, 292_000, 3_430_000, 2_352_000);
  const now = week("2026-09-09", 6_940_000, 790_000, 310_000, 3_320_000, 2_360_000);
  const band = liquidityBand(prev, now);

  it("순유동성 = 총자산 − TGA − 역레포", () => {
    expect(netLiquidity(prev)).toBe(5_958_000);
    expect(netLiquidity(now)).toBe(5_840_000);
    expect(band.dNetLiq).toBe(-118_000);
  });

  it("어디서 세 항목의 효과 합 == 순유동성 변화", () => {
    expect(band.steps.map((s) => s.effect)).toEqual([-40_000, -60_000, -18_000]);
    expect(band.steps.reduce((s, x) => s + x.effect, 0)).toBe(band.dNetLiq);
    expect(band.steps[1].own).toBe(60_000); // TGA 자체는 늘었고(own), 순유동성에는 흡수(effect −)
  });

  it("지급준비금 변화 + 현금통화·기타 변화 == 순유동성 변화 (bridge)", () => {
    expect(band.dReserves).toBe(-110_000);
    expect(band.bridge).toBe(-8_000);
    expect(band.dCurrency + band.dOther).toBe(band.bridge);
  });

  it("세금일 포함 구간은 표기만 하고 숫자는 보정하지 않는다", () => {
    expect(band.taxDates).toEqual([]);
    const sep = liquidityBand(week("2026-09-02", 6_960_000, 700_000, 300_000, 3_400_000, 2_356_000), week("2026-09-30", 6_950_000, 900_000, 280_000, 3_210_000, 2_358_000));
    expect(sep.taxDates).toEqual(["2026-09-15"]);
    expect(sep.dNetLiq).toBe((6_950_000 - 900_000 - 280_000) - (6_960_000 - 700_000 - 300_000)); // 보정 없음
  });
});

describe("유동성 베타 — 입찰 집계", () => {
  const row = (o: Partial<AuctionRow>): AuctionRow => ({
    security_type: "Bill", issue_date: "2026-08-20",
    total_accepted: "1000000000", primary_dealer_accepted: "300000000", direct_bidder_accepted: "100000000",
    indirect_bidder_accepted: "500000000", noncomp_accepted: "50000000", soma_accepted: "50000000", ...o,
  });

  it("문자열 null·빈값·비수치는 결측(NaN)이고 0 이 아니다", () => {
    for (const v of [null, undefined, "", "null", "NULL", "abc"]) expect(Number.isNaN(auctionAmount(v))).toBe(true);
    expect(auctionAmount("1500000000")).toBe(1.5e9);
    expect(auctionAmount(0)).toBe(0);
  });

  it("만기 매핑 — TIPS·FRN 은 플래그로 가르고, CMB 는 단기채, 모르는 값은 null", () => {
    expect(maturityOf("Bill")).toBe("bills"); expect(maturityOf("CMB")).toBe("bills");
    expect(maturityOf("Note")).toBe("notes"); expect(maturityOf("Bond")).toBe("bonds");
    expect(maturityOf("Note", { tips: "Yes" })).toBe("tips"); expect(maturityOf("Bond", { tips: "Yes" })).toBe("tips");
    expect(maturityOf("Note", { frn: "Yes" })).toBe("frn");
    expect(maturityOf("Note", { tips: "No", frn: "No" })).toBe("notes");
    expect(maturityOf("Weird")).toBeNull();
  });

  it("집계는 플래그 필드를 읽어 TIPS·FRN 을 분리한다", () => {
    const agg = aggregateAuctions([row({ security_type: "Note", inflation_index_security: "Yes" }), row({ security_type: "Note", floating_rate: "Yes" }), row({ security_type: "Note" })], "2026-07-01", "2026-09-30");
    expect(agg.attributed.tips).toBe(1000); expect(agg.attributed.frn).toBe(1000); expect(agg.attributed.notes).toBe(1000);
  });

  it("결과 미공표 행은 통째로 제외되고 건수로 보고된다", () => {
    const agg = aggregateAuctions([row({}), row({ total_accepted: "null", issue_date: "2026-09-22" })], "2026-07-01", "2026-09-30");
    expect(agg.counted).toBe(1); expect(agg.skipped).toBe(1);
    expect(agg.attributed.bills).toBe(1000);
    expect(agg.countedByMaturity.bills).toBe(1); expect(agg.countedByMaturity.notes).toBe(0);
  });

  it("전부 미공표면 집계 0건·제외 건수만 남고 금액은 0 으로 만들어지지 않는다", () => {
    const agg = aggregateAuctions([row({ total_accepted: "null" }), row({ total_accepted: null, security_type: "Note" })], "2026-07-01", "2026-09-30");
    expect(agg.counted).toBe(0); expect(agg.skipped).toBe(2);
    expect(MATURITIES.every((m) => agg.countedByMaturity[m] === 0)).toBe(true);
    expect(sankeyData(agg).links).toHaveLength(0);
  });

  it("귀속 항목 하나만 결측이어도 행 전체 제외 — 부분합 금지", () => {
    const agg = aggregateAuctions([row({ soma_accepted: null })], "2026-07-01", "2026-09-30");
    expect(agg.counted).toBe(0); expect(agg.skipped).toBe(1);
    expect(MATURITIES.every((m) => agg.attributed[m] === 0)).toBe(true);
  });

  it("창 밖 issue_date 는 무시(제외 건수 아님), 모르는 security_type 은 보고", () => {
    const agg = aggregateAuctions([row({ issue_date: "2026-06-30" }), row({ security_type: "Weird" })], "2026-07-01", "2026-09-30");
    expect(agg.counted).toBe(0); expect(agg.skipped).toBe(0);
    expect(agg.unknownTypes).toEqual(["Weird"]);
  });

  it("금액은 달러→million USD 이고 만기별 귀속 합 == 링크 합 == 보고 총액", () => {
    const rows = [row({}), row({ security_type: "Note", total_accepted: "2000000000", primary_dealer_accepted: "800000000", direct_bidder_accepted: "200000000", indirect_bidder_accepted: "900000000", noncomp_accepted: "20000000", soma_accepted: "80000000" })];
    const agg = aggregateAuctions(rows, "2026-07-01", "2026-09-30");
    expect(agg.matrix.bills).toEqual({ soma: 50, dealer: 300, direct: 100, indirect: 500, noncomp: 50 });
    expect(agg.attributed.notes).toBe(2000); expect(agg.reported.notes).toBe(2000);
    const { nodes, links } = sankeyData(agg);
    for (const m of ["bills", "notes"] as const) {
      const i = nodes.findIndex((n) => n.key === m);
      expect(links.filter((l) => l.source === i).reduce((s, l) => s + l.value, 0)).toBeCloseTo(agg.attributed[m], 9);
    }
  });

  it("생키는 값 0 노드·링크를 그리지 않는다", () => {
    const agg = aggregateAuctions([row({ direct_bidder_accepted: "0", total_accepted: "900000000" })], "2026-07-01", "2026-09-30");
    const { nodes, links } = sankeyData(agg);
    expect(nodes.map((n) => n.key)).toEqual(["bills", "soma", "dealer", "indirect", "noncomp"]); // direct·다른 만기 없음
    expect(links.every((l) => l.value > 0)).toBe(true);
    expect(links).toHaveLength(4);
    expect(BIDDERS.length).toBe(5);
  });

  it("결제월 창: months=3 은 두 달 전 1일부터 오늘까지", () => {
    expect(auctionWindow(3, new Date("2026-09-17T12:00:00Z"))).toEqual({ start: "2026-07-01", end: "2026-09-17" });
    expect(auctionWindow(1, new Date("2026-09-17T12:00:00Z"))).toEqual({ start: "2026-09-01", end: "2026-09-17" });
    expect(auctionWindow(3, new Date("2026-01-10T12:00:00Z"))).toEqual({ start: "2025-11-01", end: "2026-01-10" }); // 연도 경계
  });
});

describe("유동성 베타 — 맥락 판정", () => {
  it("SOFR−IORB 임계 +10/+25bp, 결측은 자료 부족", () => {
    expect(spreadBand(3)).toBe("평상시"); expect(spreadBand(12)).toBe("경계"); expect(spreadBand(30)).toBe("위기");
    expect(spreadBand(NaN)).toBe("자료 부족");
  });
  it("bp 는 출처 정밀도(0.01%p)로 정규화해 표시와 판정이 같은 값을 쓴다", () => {
    expect((4.35 - 4.25) * 100).not.toBe(10); // 부동소수: 9.999…
    expect(spreadBp(4.35, 4.25)).toBe(10); expect(spreadBand(spreadBp(4.35, 4.25))).toBe("경계");
    expect(spreadBp(4.10, 3.85)).toBe(25); expect(spreadBand(spreadBp(4.10, 3.85))).toBe("위기");
    expect(spreadBp(3.64, 3.65)).toBe(-1);
    expect(Number.isNaN(spreadBp(NaN, 3.9))).toBe(true);
  });

  it("긴급대출은 기존 /fed 위기감지기 임계($500억/$2,000억)와 같다", () => {
    expect(loansBand(4_000)).toBe("평상시"); expect(loansBand(50_000)).toBe("경계"); expect(loansBand(200_000)).toBe("위기");
  });
  it("NFCI 는 0 기준(지수 정의), +0.5 위기", () => {
    expect(nfciBand(-0.4)).toBe("평상시"); expect(nfciBand(0.1)).toBe("경계"); expect(nfciBand(0.6)).toBe("위기");
  });
});
