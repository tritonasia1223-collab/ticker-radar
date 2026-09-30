import { describe, expect, it } from "vitest";
import { liquidityReview, treasuryReview } from "../shared/liquidity-review";
import { whereFrom, whereTo, type ReadWeek, type WhoBought } from "../shared/liquidity-read";
import { analyze } from "../shared/credit/signals";
import { scenarios, type Evidence } from "../shared/credit/scenarios";
import { creditReview } from "../shared/credit/review";

const base: ReadWeek = { date: "2026-08-26", total: 6000000, tga: 900000, rrp: 400000, reserves: 3000000, currency: 1500000, liabResidual: 200000, treast: 4000000, mbs: 1500000, discount: 0, btfp: 0, repo: 0, swap: 0 };
const change = (delta: number, from = "2026-06-30", to = "2026-08-31") => ({ from: { date: from, value: 10000000 }, to: { date: to, value: 10000000 + delta }, delta, pct: delta / 100000 });
const treasury = (): WhoBought => ({ start: "2026-07-01", end: "2026-09-23", counted: 97, excludeBills: false, totalReported: 7900000, totalAttributed: 7800000, byBidder: { dealer: 2200000, indirect: 4400000, direct: 540700, soma: 511200, noncomp: 159500 }, byBucket: { bills: 6800000, nb: 900000, tips: 100000 }, matrix: {} as WhoBought["matrix"], top: { bidder: "indirect", value: 4400000, share: 0.56 }, majority: true, dealerShare: 0.28, dealerSharePrev: null, dealerJump: false, netIssuance: change(742200), billsNet: change(557400) });
const emptyOutcome = () => scenarios(analyze(null, "2026-09-23", "observation"));
const evidence = (overrides: Partial<Evidence> = {}): Evidence => ({ indicator: "hy_oas", line: "HY OAS", metric: "delta4", value: 0.8, expected: "gte 0.75", date: "2026-09-23", from: "2026-08-26", status: true, ...overrides });

describe("문장형 유동성·국채 리뷰", () => {
  it("회수·자금 사용·자산 증가의 합계를 설명하고 특정 자금 이동은 단정하지 않는다", () => {
    const now = { ...base, date: "2026-09-23", total: base.total + 16800, tga: base.tga - 12100, rrp: base.rrp - 35400, reserves: base.reserves + 53100, currency: base.currency + 11200 };
    const review = liquidityReview(whereFrom(base, now, 0.5), whereTo(base, now, [], [], null));
    expect(review.source).toContain("354억 달러를 순회수");
    expect(review.source).toContain("121억 달러를 시중에");
    expect(review.source).toContain("168억 달러의 유동성 증가");
    expect(review.destination).toContain("+531억 달러");
    expect(review.destination).toContain("112억 달러");
    expect(review.destination).not.toContain("들어갔");
  });
  it("유동성 감소·지준 증가가 겹치면 대부분·나머지라고 잘못 배분하지 않는다", () => {
    const now = { ...base, date: "2026-09-23", total: base.total + 12100, tga: base.tga + 45500, rrp: base.rrp - 15800, reserves: base.reserves + 15500, currency: base.currency - 33100 };
    const review = liquidityReview(whereFrom(base, now, 0.5), whereTo(base, now, [], [], null));
    expect(review.source).toContain("흡수");
    expect(review.source).toContain("상쇄");
    expect(review.destination).toContain("155억 달러 늘었고");
    expect(review.destination).toContain("331억 달러 줄었습니다");
    expect(review.destination).not.toMatch(/대부분|나머지/);
  });
  it("결측과 0을 구분한다", () => {
    expect(liquidityReview(null, null).source).toContain("자료가 없어");
    expect(liquidityReview(whereFrom(base, base, 0.5), whereTo(base, base, [], [], null)).source).toContain("변화가 없습니다");
  });
  it("단기채 순증가 비중은 같은 기간의 순증가끼리 계산한다", () => {
    const input = treasury();
    const review = treasuryReview(input);
    expect(review.billPercent).toBeCloseTo(75.10105);
    expect(review.net).toContain("75.1%");
    expect(review.periodMismatch).toBe(true);
    input.billsNet = change(557400, "2026-05-31");
    expect(treasuryReview(input).billPercent).toBeNull();
    expect(treasuryReview(input).net).not.toContain("단기채");
  });
  it("순감소·0·단기채 순증가가 전체를 초과할 때 구성비를 표시하지 않는다", () => {
    for (const total of [-742200, 0, 100000]) {
      const input = treasury(); input.netIssuance = change(total);
      expect(treasuryReview(input).billPercent).toBeNull();
    }
  });
  it("딜러는 직접 합산액, SOMA는 롤오버로 설명한다", () => {
    const review = treasuryReview(treasury());
    expect(review.allocations).toContain("자기 계정");
    expect(review.allocations).toContain("2.2조");
    expect(review.allocations).toContain("SOMA 롤오버");
    expect(review.difference).toBe(100000);
  });
});

describe("조건별 신용 리뷰", () => {
  it("정상은 좁은 범위로 말하고, 전부 결측이면 정상으로 확정하지 않는다", () => {
    const outcome = emptyOutcome();
    expect(creditReview(outcome).normal).toContain("확정하기 어렵");
    for (const signal of Object.values(outcome.signals)) signal.status = false;
    outcome.signals.ig_stable.status = outcome.signals.hy_stable.status = true;
    outcome.signals.issuance_collapse.status = null;
    const review = creditReview(outcome);
    expect(review.stories).toEqual([]);
    expect(review.normal).toContain("추가 금리도 안정적");
    expect(review.incompleteIssuance).toBe(true);
  });
  it("HY만 확대되면 선별적 부담, 발행 미확인이면 조달 위축을 단정하지 않는다", () => {
    const outcome = emptyOutcome();
    outcome.signals.hy_wide = { status: true, evidence: [evidence(), evidence({ status: null, value: null })] };
    outcome.signals.ig_stable.status = true;
    const [story] = creditReview(outcome).stories;
    expect(story.meaning).toContain("신용등급이 낮은 기업에 집중");
    expect(story.meaning).toContain("자료가 부족");
    expect(story.evidence).toHaveLength(1);
    expect(story.evidence[0].text).toContain("+0.8%p");
    expect(story.evidence[0].date).toContain("2026-08-26 → 2026-09-23");
  });
  it("동시 위축은 가격·수량과 은행 조건이 모두 있을 때만 말한다", () => {
    const outcome = emptyOutcome();
    for (const key of ["bank_tight", "loan_slow", "hy_wide"]) outcome.signals[key].status = true;
    expect(creditReview(outcome).stories.some(s => s.headline.includes("동시에"))).toBe(false);
    outcome.signals.issuance_collapse.status = true;
    expect(creditReview(outcome).stories[0].headline).toContain("동시에");
    expect(creditReview(outcome).stories).toHaveLength(1);
  });
  it("비상 인출은 우선 표시하고 정상 대출 확장으로 설명하지 않는다", () => {
    const outcome = emptyOutcome();
    for (const key of ["loan_emergency_warning", "cp_jump", "loan_surge"]) outcome.signals[key].status = true;
    outcome.signals.loan_emergency_warning.evidence = [evidence({ indicator: "h8_ci_loans", line: "기업대출", metric: "change4", value: 5 }), evidence({ indicator: "cp_spread", line: "CP 비용" })];
    const review = creditReview(outcome);
    expect(review.stories).toHaveLength(1);
    expect(review.stories[0].headline).toContain("비상 자금 인출일 가능성");
    expect(review.stories[0].evidence.some(e => e.text.includes("+5%입니다"))).toBe(true);
  });
});
