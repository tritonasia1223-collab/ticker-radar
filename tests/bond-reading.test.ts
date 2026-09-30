import { describe, expect, it } from "vitest";
import { bondReading } from "../shared/credit/bond-reading";
import { analyze } from "../shared/credit/signals";
import { scenarios } from "../shared/credit/scenarios";
import { indicators } from "../shared/credit/schema";

function sample() {
  const data = analyze(null, "2026-09-23", "observation"), outcome = scenarios(data);
  for (const key of ["ig_stable", "hy_stable"]) outcome.signals[key].status = true;
  for (const id of ["ig_oas", "hy_oas"]) {
    const result = data.find(i => i.id === id)!;
    result.comparisonLines = [{ ...result.lines[0], key: indicators.find(i => i.id === id)!.chart.marketYield!.key, latest: { date: "2026-09-23", value: 6 }, stale: false, errors: [], metrics: { percentile: 90 }, sampleCount: 700, sampleStart: "2023-09-30", sampleEnd: "2026-09-23" }];
  }
  Object.assign(data.find(i => i.id === "corporate_bond_issuance")!.lines[0], { latest: { date: "2026-08-31", value: 200 }, stale: false, errors: [] });
  return { data, outcome };
}
describe("회사채 본문과 세부 기준 분리", () => {
  it("발행 세부 결측은 보조로 내리고 안정 신호·높은 시장금리는 본문으로 설명한다", () => {
    const { data, outcome } = sample(), result = bondReading(data, outcome);
    expect(result.text).toContain("회사채 시장에 큰 문제는 포착되지 않았습니다");
    expect(result.text).toContain("이자 부담이 큽니다");
    expect(result.text).toContain("금리(프리미엄)를 뜻합니다");
    expect(result.text).not.toContain("판단 유보");
    expect(result.overview).toContain("돈줄이 막힌 위기는 아니지만");
    expect(result.details.join(" ")).toContain("등급별 회사채 발행량은 미확보");
  });
  it("긴장·발행 급감이 있으면 정상 문장을 쓰지 않는다", () => {
    const { data, outcome } = sample(); outcome.signals.hy_wide.status = true; outcome.signals.issuance_collapse.status = true;
    expect(bondReading(data, outcome).text).toContain("나빠지는 신호");
    expect(bondReading(data, outcome).text).not.toContain("큰 문제는 포착되지");
    expect(bondReading(data, outcome).overview).not.toContain("위기는 아니지만");
  });
  it("금리가 낮거나 표본이 부족한 과거에는 높은 부담으로 고정하지 않는다", () => {
    const { data, outcome } = sample();
    for (const result of data) for (const line of result.comparisonLines ?? []) line.metrics.percentile = 20;
    expect(bondReading(data, outcome).text).not.toContain("이자 부담이 큽니다");
    expect(bondReading(data, outcome).overview).not.toContain("매우 비싸서");
    for (const result of data) for (const line of result.comparisonLines ?? []) line.stale = true;
    expect(bondReading(data, outcome).text).toContain("비교 자료는 충분하지");
  });
  it("자료가 전혀 없으면 시장 정상으로 확정하지 않는다", () => {
    const data = analyze(null, "2026-09-23", "observation");
    expect(bondReading(data, scenarios(data)).text).not.toContain("큰 문제는 포착되지");
    expect(bondReading(data, scenarios(data)).overview).not.toContain("위기는 아니지만");
  });
});
