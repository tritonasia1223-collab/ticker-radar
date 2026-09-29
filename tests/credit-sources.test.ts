import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { config, type Point } from "../shared/credit/schema";
import { quarterlyFact, parseBdcEarnings, parseBdcReport } from "../server/credit/bdc";
import { parseIssuanceWorkbook } from "../server/credit/excel";
import { analyze } from "../shared/credit/signals";
import { scenarios } from "../shared/credit/scenarios";

const date = "2026-06-30", filed = "2026-08-05";
const fact = (start: string, end: string, val: number, publication = filed) => ({ start, end, val, filed: publication, form: "10-Q" });
const facts = (rows: any[]) => ({ facts: { "us-gaap": { Income: { units: { USD: rows } } } } });
describe("공시의 단일 분기 수익", () => {
  it("누적 수익을 차감하고 미래 수정치는 사용하지 않는다", () => {
    const j = facts([fact("2026-01-01", date, 80), fact("2026-01-01", "2026-03-31", 38), fact("2026-01-01", "2026-03-31", 50, "2026-11-01")]);
    expect(quarterlyFact(j, "Income", date, filed)).toBe(42);
  });
  it("직접 공시한 분기 값이 있으면 누적 차감보다 우선한다", () => {
    expect(quarterlyFact(facts([fact("2026-04-01", date, 42), fact("2026-01-01", date, 80)]), "Income", date, filed)).toBe(42);
  });
  it("이전 누적 값이 없으면 상반기 수치를 2분기로 오인하지 않는다", () => {
    expect(quarterlyFact(facts([fact("2026-01-01", date, 80)]), "Income", date, filed)).toBeNull();
  });
  it("연간 수익에서 9개월 누적을 빼 4분기를 계산한다", () => {
    expect(quarterlyFact(facts([fact("2025-01-01", "2025-12-31", 200), fact("2025-01-01", "2025-09-30", 150)]), "Income", "2025-12-31", filed)).toBe(50);
  });
});

describe("BDC 공시 문맥", () => {
  it("실적발표의 전체 포트폴리오 공정가치·원가 순서를 유지한다", () => {
    const html = '<p>As of June 30, 2026, investments on non-accrual status represented 3.8% and 7.1% of the total investment portfolio at fair value and amortized cost, respectively.</p>';
    expect(parseBdcEarnings(html, date)).toEqual({ nonaccrual_fv: 3.8, nonaccrual_cost: 7.1 });
    expect(parseBdcEarnings(html, "2026-03-31")).toBeNull();
    expect(parseBdcEarnings(html.replace("total investment portfolio", "direct originations"), date)).toBeNull();
  });
  it("iXBRL 단위와 분기 문맥으로 현재 전체 비율만 고른다", () => {
    const src = config.sources.find(s => s.key === "manual:ARCC:nonaccrual_fv")!;
    const html = `<ix:nonNumeric name="dei:DocumentPeriodEndDate">June 30, 2026</ix:nonNumeric>
      <xbrli:context id="current"><xbrli:period><xbrli:instant>2026-06-30</xbrli:instant></xbrli:period></xbrli:context>
      <xbrli:context id="old"><xbrli:period><xbrli:instant>2025-12-31</xbrli:instant></xbrli:period></xbrli:context>
      <ix:nonFraction name="arcc:InvestmentOwnedNonAccrualStatusPercentOfFairValue" contextRef="current" scale="-2">1.4</ix:nonFraction>
      <ix:nonFraction name="arcc:InvestmentOwnedNonAccrualStatusPercentOfFairValue" contextRef="old" scale="-2">9.9</ix:nonFraction>`;
    const result = parseBdcReport(html, src, { date, filed, accn: "000-123", doc: "quarter.htm", form: "10-Q" }, { cik: 1287750, facts: {} }, []);
    expect(result.nonaccrual_fv?.value).toBeCloseTo(1.4);
    expect(result.nonaccrual_fv?.publishedAt).toBe(filed);
  });
});

async function issuanceFile(options: { badUnits?: boolean; missing?: boolean; duplicate?: boolean } = {}) {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet("Issuance"), toc = book.addWorksheet("Table of Contents");
  sheet.getCell("B1").value = "US Fixed Income Securities"; sheet.getCell("B2").value = "Issuance"; sheet.getCell("B3").value = options.badUnits ? "$ Million" : "$ Billion";
  sheet.getCell("D8").value = "Corporates"; toc.getCell("C2").value = new Date("2026-09-14");
  sheet.getCell("A9").value = 2025; sheet.getCell("D9").value = 1000;
  sheet.getCell("A10").value = "2Q26"; sheet.getCell("D10").value = 700;
  sheet.getCell("A11").value = new Date("2026-08-01"); sheet.getCell("D11").value = options.missing ? null : 0;
  if (options.duplicate) { sheet.getCell("A12").value = new Date("2026-08-31"); sheet.getCell("D12").value = 10; }
  return Buffer.from(await book.xlsx.writeBuffer());
}
describe("SIFMA 엑셀 검증", () => {
  const src = config.sources.find(s => s.provider === "xlsx")!;
  it("월별 숫자만 읽고 연간·분기 합계 및 발표일 추정을 제외한다", async () => {
    const result = await parseIssuanceWorkbook(await issuanceFile(), src, "2026-09-29");
    expect(result).toHaveLength(1); expect(result[0]).toMatchObject({ date: "2026-08-31", value: 0 }); expect(result[0].publishedAt).toBeUndefined();
  });
  it("단위 변경·결측·동일 월 중복을 거부한다", async () => {
    for (const bad of [{ badUnits: true }, { missing: true }, { duplicate: true }]) await expect(parseIssuanceWorkbook(await issuanceFile(bad), src, "2026-09-29")).rejects.toThrow();
  });
});

describe("갱신 상태와 부분 자료", () => {
  const snapshot = (key: string, points: Point[], checkedAt = "2026-09-29T00:00:00Z") => ({ version: 1 as const, configHash: "test", collectedAt: checkedAt, series: [{ key, points, checkedAt, transport: "테스트", notes: [] }] });
  it("분기 자료가 최근이어도 수집 작업이 멈추면 지연으로 분리한다", () => {
    const result = analyze(snapshot("manual:ARCC:pik", [{ date, publishedAt: filed, value: 10 }], "2026-09-20T00:00:00Z"), "2026-09-29").find(i => i.id === "bdc_credit_quality")!.lines.find(l => l.key.endsWith("ARCC:pik"))!;
    expect(result.collectionOverdue).toBe(true); expect(result.stale).toBe(true);
  });
  it("분기 하나가 빠지면 두 분기 변화를 직전 분기 변화라고 표시하지 않는다", () => {
    const result = analyze(snapshot("manual:ARCC:pik", [{ date: "2025-12-31", publishedAt: "2026-02-01", value: 5 }, { date, publishedAt: filed, value: 10 }]), "2026-09-29").find(i => i.id === "bdc_credit_quality")!.lines.find(l => l.key.endsWith("ARCC:pik"))!;
    expect(result.metrics.previousDelta).toBeNull();
  });
  it("전체 발행액을 IG·HY의 판별 근거로 대체하지 않는다", () => {
    const result = analyze(null, "2026-09-29"); const total = result.find(i => i.id === "corporate_bond_issuance")!.lines[0]; total.stale = false; total.metrics.issuanceYoy = 30;
    expect(scenarios(result).signals.issuance_active.status).toBeNull();
  });
});
