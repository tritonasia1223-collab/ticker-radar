import { describe, expect, it } from "vitest";
import { rateRows, rateNarrative } from "../shared/credit/rate-comparison";
import { analyze, joinSpread } from "../shared/credit/signals";
import { indicators, type Snapshot } from "../shared/credit/schema";
import { scenarios } from "../shared/credit/scenarios";

const from = "2026-08-26", asOf = "2026-09-23";
const points = (a: number, b: number) => [{ date: from, value: a }, { date: asOf, value: b }];
function snapshot(withYield = true): Snapshot {
  return { version: 1, configHash: "test", collectedAt: asOf + "T00:00:00.000Z", series: [
    { key: "BAMLC0A0CM", points: points(1.2, 0.8) },
    { key: "RIFSPPNA2P2D90NB", points: points(5, 6) },
    { key: "DTB3", points: points(3, 4.5) },
    ...(withYield ? [{ key: "BAMLC0A0CMEY", points: [...points(5, 6), { date: "2026-09-24", value: 99 }] }] : []),
  ].map(s => ({ ...s, checkedAt: asOf + "T00:00:00.000Z", transport: "test", notes: [] })) };
}
describe("금리·스프레드 비교", () => {
  it("금리가 오르면서 차이가 좁아지는 경우 두 높이와 간격을 보존한다", () => {
    const rows = rateRows(points(5, 6), points(3, 4.5), from, asOf);
    expect(rows.map(r => r.gap)).toEqual([2, 1.5]);
    expect(rows.at(-1)?.band).toEqual([4.5, 6]);
  });
  it("교차점에서 음영 폭이 0이 되고 음수 차이를 보존한다", () => {
    const rows = rateRows(points(5, 3), points(4, 4), from, asOf);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({ a: 4, b: 4, gap: 0, band: [4, 4] });
    expect(rows[2].gap).toBe(-1);
  });
  it("관측일 불일치는 보간·전일값 대입 없이 음영과 차이를 비운다", () => {
    const a = [...points(5, 6), { date: "2026-09-24", value: 10 }];
    const b = [{ date: from, value: 3 }, { date: "2026-09-22", value: 4 }];
    const rows = rateRows(a, b, from, asOf);
    expect(rows.at(-1)).toMatchObject({ a: 6, b: null, gap: null, band: null });
    expect(rows.every(r => r.time <= Date.parse(asOf))).toBe(true);
    expect(joinSpread(a, b)).toEqual([{ date: from, value: 2 }]);
  });
  it("OAS와 시장금리를 독립 보존하고 미래 관측을 배제한다", () => {
    const result = analyze(snapshot(), asOf, "observation").find(i => i.id === "ig_oas")!;
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].latest?.value).toBe(0.8);
    expect(result.comparisonLines?.[0].latest?.value).toBe(6);
    expect(result.comparisonLines?.[0].unit).toBe("percent");
    expect(rateNarrative(result, 4)).toContain("시장금리는 올랐습니다");
    expect(rateNarrative(result, 4)).toContain("OAS는 축소됐습니다");
    expect(indicators.find(i => i.id === "ig_oas")?.chart.kind).toBe("series");
  });
  it("참고 금리 결측이 기존 OAS 시나리오를 바꾸거나 금리 개선으로 해석되지 않는다", () => {
    const withRates = analyze(snapshot(), asOf, "observation"), missing = analyze(snapshot(false), asOf, "observation");
    expect(scenarios(withRates)).toEqual(scenarios(missing));
    expect(rateNarrative(missing.find(i => i.id === "ig_oas")!, 4)).toContain("유보");
  });
  it("CP 원금리는 % 단위이며 파생 차이는 %p 단위다", () => {
    const result = analyze(snapshot(), asOf, "observation").find(i => i.id === "cp_spread")!;
    expect(result.comparisonLines?.map(l => l.unit)).toEqual(["percent", "percent"]);
    expect(result.lines[0].unit).toBe("pp");
    expect(result.lines[0].latest?.value).toBe(1.5);
  });
  it("CP와 국채의 최신 관측일이 다르면 세 숫자를 마지막 공통 날짜로 맞춘다", () => {
    const input = snapshot();
    input.series.find(s => s.key === "RIFSPPNA2P2D90NB")!.points[1].date = "2026-09-22";
    input.series.find(s => s.key === "DTB3")!.points.push({ date: "2026-09-22", value: 4 });
    const result = analyze(input, asOf, "observation").find(i => i.id === "cp_spread")!;
    expect(result.lines[0].latest).toEqual({ date: "2026-09-22", value: 2 });
    expect(result.comparisonLines?.map(l => l.latest?.date)).toEqual(["2026-09-22", "2026-09-22"]);
    expect(result.comparisonLines?.map(l => l.latest?.value)).toEqual([6, 4]);
  });
  it("관측일 또는 비교일이 다르면 동반 방향을 확정하지 않는다", () => {
    const result = analyze(snapshot(), asOf, "observation").find(i => i.id === "ig_oas")!;
    result.comparisonLines![0].changes[4]!.from = "2026-08-25";
    expect(rateNarrative(result, 4)).toContain("일치하지 않아");
    result.comparisonLines![0].stale = true;
    expect(rateNarrative(result, 4)).toContain("유보");
  });
});
