import { describe, it, expect } from "vitest";
import { config, indicators, type Snapshot, type Point } from "../shared/credit/schema";
import { analyze, change, joinNav, joinSpread, percentile } from "../shared/credit/signals";
import { evaluate, scenarios } from "../shared/credit/scenarios";
import { parseFredCsv, parseNav, parsePrices } from "../server/credit/sources";
import { importManualCsv } from "../server/credit/manual";

const asOf = "2026-09-29";
const snap = (key: string, points: Point[]): Snapshot => ({ version: 1, collectedAt: asOf + "T12:00:00.000Z", configHash: "fixture", series: [{ key, points, checkedAt: asOf, transport: "테스트", notes: [] }] });
describe("신용 계열과 날짜 정렬", () => {
  it("14개 카드와 필수 6개를 설정에서 읽는다", () => { expect(indicators).toHaveLength(14); expect(indicators.filter(i => i.essential)).toHaveLength(6); expect(indicators.find(i => i.id === "h8_ci_loans")!.source.series_id).toBe("TOTCI"); });
  it("FRED 결측을 0으로 바꾸지 않고 중복 날짜를 정리한다", () => { expect(parseFredCsv("observation_date,TOTCI\n2026-09-01,.\n2026-09-02,0\n2026-09-03,\n2026-09-02,4")).toEqual([{ date: "2026-09-02", value: 4 }]); });
  it("CP 금리는 같은 날짜끼리만 차감한다", () => { expect(joinSpread([{ date: "2026-09-01", value: 5 }, { date: "2026-09-02", value: 6 }], [{ date: "2026-09-02", value: 4 }, { date: "2026-09-03", value: 3 }])).toEqual([{ date: "2026-09-02", value: 2 }]); });
  it("비교 날짜에 미래 관측을 쓰지 않으며 휴장 이전 날짜를 사용한다", () => { const c = change([{ date: "2026-08-28", value: 100 }, { date: "2026-09-02", value: 200 }, { date: "2026-09-29", value: 110 }], 4, "daily"); expect(c?.from).toBe("2026-08-28"); expect(c?.value).toBe(10); });
  it("허용 간격을 벗어난 관측은 비교에서 제외한다", () => { expect(change([{ date: "2026-08-01", value: 100 }, { date: asOf, value: 110 }], 4, "daily")).toBeNull(); });
  it("발표일이 없는 분기 관측을 주간 변화로 만들지 않는다", () => { expect(change([{ date: "2026-04-01", value: 10 }, { date: "2026-07-01", value: 15 }], 1, "quarterly")).toBeNull(); });
  it("새 분기 발표가 없는 주간은 신규 발표 없음으로 표시한다", () => { expect(change([{ date: "2026-06-30", publishedAt: "2026-08-01", value: 10 }], 1, "quarterly", asOf)?.unchangedRelease).toBe(true); });
  it("동률 백분위는 중간 순위를 사용한다", () => { expect(percentile([1, 2, 2, 3], 2)).toBe(50); expect(percentile([], 2)).toBeNull(); });
  it("3년 자료를 10년 백분위로 표시하지 않는다", () => { const points = Array.from({ length: 600 }, (_, n) => ({ date: new Date(Date.parse(asOf) - (599 - n) * 86400000).toISOString().slice(0, 10), value: 3 + n / 100 })); const result = analyze(snap("BAMLH0A0HYM2", points), asOf).find(i => i.id === "hy_oas")!.lines[0]; expect(result.metrics.percentile).not.toBeNull(); expect(result.tenYearPercentile).toBeNull(); });
});
describe("BDC와 가격의 공시 시점", () => {
  it("분기말 NAV가 공개되기 전 가격에 연결되지 않는다", () => {
    const prices = [{ date: "2026-07-01", value: 18 }, { date: "2026-08-05", value: 18 }, { date: "2026-08-06", value: 18 }];
    const nav = [{ date: "2026-06-30", value: 20, publishedAt: "2026-08-05", effectiveAt: "2026-08-06" }];
    const result = joinNav(prices, nav); expect(result).toHaveLength(1); expect(result[0].date).toBe("2026-08-06"); expect(result[0].value).toBe(0.9);
  });
  it("SEC 회사와 태그를 검증하고 공시 다음 날짜에 적용한다", () => {
    const src = config.sources.find(s => s.key === "nav:ARCC")!;
    const j = { cik: 1287750, facts: { "us-gaap": { NetAssetValuePerShare: { units: { "USD/shares": [{ form: "10-Q", end: "2026-06-30", filed: "2026-08-05", val: 20, accn: "000-123" }] } } } } };
    expect(parseNav(j, src)[0].effectiveAt).toBe("2026-08-06"); expect(() => parseNav({ ...j, cik: 1 }, src)).toThrow();
  });
  it("ETF 분배금 수정 가격을 선택하고 당일 미완료 봉을 제외한다", () => {
    const src = config.sources.find(s => s.key === "price:BKLN")!;
    const j = { chart: { result: [{ meta: { symbol: "BKLN", exchangeTimezoneName: "America/New_York" }, timestamp: [Date.parse("2026-09-28T20:00:00Z") / 1000, Date.parse("2026-09-29T20:00:00Z") / 1000], indicators: { quote: [{ close: [20, 21] }], adjclose: [{ adjclose: [19, 20] }] } }] } };
    expect(parsePrices(j, src, asOf)).toEqual([{ date: "2026-09-28", value: 19 }]);
  });
  it("P/NAV용 가격은 분할 당시 주식수 기준으로 복원한다", () => {
    const src = config.sources.find(s => s.key === "price:ARCC")!;
    const j = { chart: { result: [{ meta: { symbol: "ARCC" }, timestamp: [Date.parse("2026-09-01T20:00:00Z") / 1000], events: { splits: { s: { date: Date.parse("2026-09-10") / 1000, numerator: 2, denominator: 1 } } }, indicators: { quote: [{ close: [10] }] } }] } };
    expect(parsePrices(j, src, asOf)[0].value).toBe(20);
  });
});
describe("시나리오의 결측과 상충", () => {
  it("전체 결측을 정상으로 판정하지 않는다", () => { const r = scenarios(analyze(null, asOf)); expect(r.closest).toEqual([]); expect(r.rows.every(s => s.score === null && s.coverage === 0)).toBe(true); });
  it("필수 발행량이 없으면 경로 이동을 확정하지 않는다", () => { const d = analyze(null, asOf); for (const i of d) for (const l of i.lines) { l.stale = false; l.errors = []; Object.assign(l.metrics, { latest: 20, previousDelta: 0, annual13: -1, percentile: 50, delta4: 0 }); } const issuance = d.find(i => i.id === "corporate_bond_issuance")!; issuance.lines.forEach(l => { l.stale = true; }); const b = scenarios(d).rows.find(s => s.id === "B")!; expect(b.candidate).toBe(false); expect(b.evidence.find(e => e.signal === "issuance_active")!.status).toBeNull(); });
  it("한 회사 값만으로 BDC 3사 묶음을 정상이라고 하지 않는다", () => { const d = analyze(null, asOf); const l = d.find(i => i.id === "bdc_price_to_nav")!.lines[0]; l.stale = false; l.metrics.latest = 1; expect(evaluate({ indicator: "bdc_price_to_nav", metric: "latest", op: "gte", value: 0.9, minimum: 2 }, d).status).toBeNull(); });
  it("BDC 안정은 같은 두 회사가 수준과 변화를 모두 충족해야 한다", () => { const d = analyze(null, asOf); const lines = d.find(i => i.id === "bdc_price_to_nav")!.lines; lines.forEach((l, n) => { l.stale = false; l.metrics.latest = n < 2 ? 1 : 0.5; l.metrics.delta4 = n > 0 ? 0 : -0.1; }); expect(evaluate(config.signals.bdc_stable, d).status).toBe(false); });
  it("CP 가격·대출 급증만으로도 건강한 확장 후보를 차단한다", () => { const d = analyze(null, asOf); const loan = d.find(i => i.id === "h8_ci_loans")!.lines[0], cp = d.find(i => i.id === "cp_spread")!.lines[0]; loan.stale = cp.stale = false; Object.assign(loan.metrics, { change4: 8, speedPercentile: 99 }); Object.assign(cp.metrics, { delta4: 1, latest: 2 }); expect(evaluate(config.signals.loan_emergency_warning, d).status).toBe(true); });
  it("급등 CP와 대출 증가를 비상 인출로 읽는다", () => { const d = analyze(null, asOf); for (const [id, metrics] of [["cp_spread", { delta4: 1, latest: 2 }], ["cp_outstanding", { change4: -10 }], ["h8_ci_loans", { change4: 8, speedPercentile: 99 }]] as const) { const l = d.find(i => i.id === id)!.lines[0]; l.stale = false; Object.assign(l.metrics, metrics); } expect(scenarios(d).rows.find(s => s.id === "E")!.candidate).toBe(true); });
  it("갱신 지연은 조건 계산에서 제외한다", () => { const d = analyze(snap("DRTSCILM", [{ date: "2024-01-01", value: 50 }]), asOf); expect(evaluate(config.signals.bank_tight, d).status).toBeNull(); });
});
describe("수동 CSV", () => {
  const header = "source_key,observation_date,published_at,value,unit,basis,source_url\n";
  it("BOM·인용부호 주소를 처리하고 분모를 보존한다", () => { const r = importManualCsv("\uFEFF" + header + 'manual:ARCC:pik,2026-06-30,2026-08-01,8,percent,pik_income_over_total_investment_income,"https://example.com/a,b"', null, new Date(asOf)); expect(r.series[0].points[0].value).toBe(8); expect(r.series[0].points[0].basis).toBe("pik_income_over_total_investment_income"); });
  it("분모 불일치와 미래 공시를 거부한다", () => { expect(() => importManualCsv(header + 'manual:ARCC:pik,2026-06-30,2026-08-01,8,percent,fair_value,https://example.com', null, new Date(asOf))).toThrow("분모"); expect(() => importManualCsv(header + 'manual:ARCC:pik,2026-06-30,2027-08-01,8,percent,pik_income_over_total_investment_income,https://example.com', null, new Date(asOf))).toThrow("발표일"); });
  it("빈 템플릿을 0으로 저장하지 않는다", () => { expect(() => importManualCsv(header + 'manual:ARCC:pik,,,,percent,pik_income_over_total_investment_income,', null, new Date(asOf))).toThrow("입력된 값"); });
});
