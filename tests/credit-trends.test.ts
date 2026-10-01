import { describe, expect, it } from "vitest";
import { config, indicators } from "../shared/credit/schema";
import { analyze, DAY } from "../shared/credit/signals";
import { evaluate, scenarios } from "../shared/credit/scenarios";
import { creditWarnings, distributionAdjusted, groupReading, readingGroups } from "../shared/credit/reading";
import { creditReview } from "../shared/credit/review";

const asOf = "2026-09-23", rule = config.signals.ccc_gap_trend;
function fixture(gaps = [6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6]) {
  const data = analyze(null, asOf, "observation");
  const ccc = data.find(i => i.id === "ccc_oas")!.lines[0], hy = data.find(i => i.id === "hy_oas")!.lines[0];
  const dates = gaps.map((_, n) => new Date(Date.parse("2026-08-07") + n * 7 * DAY).toISOString().slice(0, 10));
  for (const [line, values] of [[ccc, gaps.map(v => v + 2)], [hy, gaps.map(() => 2)]] as const) {
    line.points = dates.map((date, n) => ({ date, value: values[n] }));
    line.latest = line.points.at(-1)!; line.stale = false;
    line.metrics.delta4 = 0.4;
  }
  return { data, ccc, hy };
}
describe("취약 기업의 주간 격차 추세", () => {
  it("급변 임계값 아래의 느린 확대도 별도 경고와 근거로 전달한다", () => {
    const { data } = fixture(), outcome = scenarios(data);
    expect(outcome.signals.ccc_wide.status).toBe(false);
    expect(outcome.signals.ccc_gap_trend.status).toBe(true);
    expect(outcome.signals.ccc_gap_trend.evidence.find(e => e.metric === "gapChange")?.value).toBeCloseTo(0.6);
    expect(creditWarnings(outcome).flatMap(w => w.keys)).toContain("ccc_gap_trend");
    const text = groupReading(readingGroups.find(g => g.id === "credit-fragile")!, outcome).text;
    expect(text).toContain("6주 연속"); expect(text).not.toContain("조건은 관측되지 않았습니다");
    const story = creditReview(outcome).stories.find(s => s.id === "credit-fragile")!;
    expect(story.headline).toContain("점차"); expect(story.evidence.map(e => e.text).join(" ")).toContain("+0.6%p");
    expect(outcome.rows.find(r => r.id === "D")!.evidence.find(e => e.signal === "ccc_pressure")?.status).toBe(true);
    expect(outcome.rows.find(r => r.id === "D")!.candidate).toBe(false); // BDC·은행 조건 없이 D를 확정하지 않음
  });
  it("중간 축소와 횡보는 연속 확대를 끊고 작은 누적 변화도 제외한다", () => {
    expect(evaluate(rule, fixture([6, 6.1, 6.2, 6.1, 6.4, 6.5, 6.6]).data).status).toBe(false);
    expect(evaluate(rule, fixture([6, 6.1, 6.2, 6.2, 6.4, 6.5, 6.6]).data).status).toBe(false);
    expect(evaluate(rule, fixture([6, 6.01, 6.02, 6.03, 6.04, 6.05, 6.06]).data).status).toBe(false);
  });
  it("주간 최소 변화와 누적 변화의 경계값을 허용한다", () => {
    expect(evaluate(rule, fixture([6, 6.01, 6.02, 6.03, 6.04, 6.05, 6.25]).data).status).toBe(true);
  });
  it("CCC가 그대로인데 HY만 하락해 생긴 격차는 악화 경고로 쓰지 않는다", () => {
    const { data, ccc, hy } = fixture();
    ccc.points.forEach(p => p.value = 8); hy.points.forEach((p, n) => p.value = 2 - n * 0.1);
    expect(evaluate(rule, data).status).toBe(false);
  });
  it("진행 중인 주와 선택일 이후 관측은 추세를 바꾸지 않는다", () => {
    const { data, ccc, hy } = fixture(), before = evaluate(rule, data);
    ccc.points.push({ date: "2026-09-23", value: 1 }, { date: "2026-09-25", value: 100 });
    hy.points.push({ date: "2026-09-23", value: 1 }, { date: "2026-09-25", value: 1 });
    expect(evaluate(rule, data)).toEqual(before);
  });
  it("한 주가 빠지면 이전 관측을 재사용하지 않고 자료 부족으로 둔다", () => {
    const { data, ccc } = fixture(); ccc.points.splice(3, 1);
    expect(evaluate(rule, data).status).toBeNull();
  });
  it("휴장 주는 같은 날짜의 직전 관측을 사용하고 서로 다른 날짜는 차감하지 않는다", () => {
    const { data, ccc, hy } = fixture();
    ccc.points[3].date = hy.points[3].date = "2026-08-27";
    expect(evaluate(rule, data).status).toBe(true);
    hy.points[3].date = "2026-08-26";
    expect(evaluate(rule, data).status).toBeNull();
  });
  it("금요일 휴장과 오류·오래된 자료를 구분한다", () => {
    const { data, ccc, hy } = fixture();
    ccc.asOf = hy.asOf = "2026-09-18";
    ccc.points.at(-1)!.date = hy.points.at(-1)!.date = "2026-09-17";
    expect(evaluate(rule, data).status).toBe(true);
    ccc.errors.push("원천 조회 실패"); expect(evaluate(rule, data).status).toBeNull();
    ccc.errors = []; hy.stale = true; expect(evaluate(rule, data).status).toBeNull();
  });
  it("추세와 급변이 겹쳐도 취약 경로 경고를 중복하지 않는다", () => {
    const { data, ccc } = fixture(); ccc.metrics.delta4 = 2;
    expect(creditReview(scenarios(data)).stories.filter(s => s.id === "credit-fragile")).toHaveLength(1);
  });
  it("ETF 수정가격을 BDC 원가격·은행 대출과 구분한다", () => {
    expect(distributionAdjusted(indicators.find(i => i.id === "leveraged_loans")!)).toBe(true);
    expect(distributionAdjusted(indicators.find(i => i.id === "bdc_price_to_nav")!)).toBe(false);
    expect(distributionAdjusted(indicators.find(i => i.id === "h8_large_vs_small_banks")!)).toBe(false);
  });
});
