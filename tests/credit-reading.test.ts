import { describe, expect, it } from "vitest";
import { indicators } from "../shared/credit/schema";
import { analyze } from "../shared/credit/signals";
import { scenarios } from "../shared/credit/scenarios";
import { readingGroups, groupReading, readingChange, indicatorReading, formatCredit } from "../shared/credit/reading";

const asOf = "2026-09-23";
const spec = (id: string) => indicators.find(i => i.id === id)!;
function observed(id: string) {
  const all = analyze(null, asOf, "observation");
  const line = all.find(i => i.id === id)!.lines[0];
  line.latest = { date: "2026-09-23", value: 25 };
  line.stale = false;
  return { all, line };
}

describe("B안 민간 신용 해설", () => {
  it("네 묶음이 기존 지표 14개를 정확히 한 번 포함한다", () => {
    const ids = readingGroups.flatMap(g => g.ids);
    expect(readingGroups.map(g => g.ids.length)).toEqual([5, 3, 2, 4]);
    expect([...ids].sort()).toEqual(indicators.map(i => i.id).sort());
  });
  it("전체 결측을 안정으로 해석하지 않는다", () => {
    const outcome = scenarios(analyze(null, asOf, "observation"));
    for (const group of readingGroups) expect(groupReading(group, outcome).status).toBe("판단 유보");
  });
  it("일부 긴장 신호와 결측이 공존하면 둘 다 알린다", () => {
    const { all, line } = observed("sloos_ci_standards");
    line.metrics.latest = 50;
    const r = groupReading(readingGroups[0], scenarios(all));
    expect(r.matched).toContain("bank_tight");
    expect(r.missing.length).toBeGreaterThan(0);
    expect(r.text).toContain("자료가 부족");
  });
  it("상단 4주·13주 비교에 따라 일간 해설이 바뀐다", () => {
    const { all, line } = observed("hy_oas");
    line.changes[4] = { from: "2026-08-26", to: asOf, value: 1, pct: 20, unchangedRelease: false };
    line.changes[13] = { from: "2026-06-24", to: asOf, value: -1, pct: -20, unchangedRelease: false };
    expect(indicatorReading(spec("hy_oas"), line, 4, scenarios(all)).headline).toContain("상승");
    expect(indicatorReading(spec("hy_oas"), line, 13, scenarios(all)).headline).toContain("하락");
  });
  it("분기 자료는 같은 관측의 0 변화 대신 직전 분기와 비교한다", () => {
    const { line } = observed("sloos_ci_standards");
    line.points = [{ date: "2026-04-01", value: 10 }, { date: "2026-07-01", value: 25 }];
    line.latest = line.points[1];
    line.changes[4] = { from: "2026-07-01", to: "2026-07-01", value: 0, pct: 0, unchangedRelease: true };
    const comparison = readingChange(spec("sloos_ci_standards"), line, 4);
    expect(comparison.label).toBe("직전 분기 관측 대비");
    expect(comparison.change?.value).toBe(15);
  });
  it("중간 분기가 빠졌다면 직전 분기 비교라고 계산하지 않는다", () => {
    const { line } = observed("sloos_ci_standards");
    line.points = [{ date: "2025-01-01", value: 10 }, { date: "2026-07-01", value: 25 }];
    line.latest = line.points[1];
    expect(readingChange(spec("sloos_ci_standards"), line, 4).change).toBeNull();
  });
  it("수집 오류가 있으면 상승·하락 관측을 정상 진단으로 확정하지 않는다", () => {
    const { all, line } = observed("hy_oas");
    line.errors = ["수집 실패"];
    const r = indicatorReading(spec("hy_oas"), line, 4, scenarios(all));
    expect(r.known).toBe(false);
    expect(r.headline).toContain("유보");
  });
  it("CP 급등과 대출 급증을 좋은 확장으로 해석하지 않는다", () => {
    const { all, line } = observed("h8_ci_loans");
    Object.assign(line.metrics, { change4: 8, speedPercentile: 99 });
    const cp = all.find(i => i.id === "cp_spread")!.lines[0];
    cp.stale = false;
    Object.assign(cp.metrics, { delta4: 1, latest: 2 });
    expect(indicatorReading(spec("h8_ci_loans"), line, 4, scenarios(all)).headline).toContain("비상 인출");
  });
  it("0과 결측을 구분하고 잔액 단위를 유지한다", () => {
    expect(formatCredit(0, "pp")).toBe("0%p");
    expect(formatCredit(null, "pp")).toBe("—");
    expect(formatCredit(1000, "billions")).toBe("1조 달러");
  });
});
