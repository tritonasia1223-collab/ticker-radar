import { enrichCreditReport } from "./report.js";
import type { IndicatorAnalysis, LineAnalysis } from "./signals.js";
import { formatCredit, readingChange, type CreditOutcome } from "./reading.js";
import { indicators } from "./schema.js";

export interface ChapterParagraph { kind: "explanation" | "analysis" | "conclusion"; text: string; indicatorId?: string; emphasis?: string[] }
export interface ChapterReading { text: string; details: string[]; paragraphs?: ChapterParagraph[] }
export const BANK_DEFINITIONS = {
  h8: '기업이 은행으로부터 대출을 얼마나 받고 있는지 살펴보려면, 먼저 H.8의 기업대출 잔액을 확인합니다. 기업이 아직 갚지 않고 남겨둔 대출금으로, 신규 차입과 상환 등이 반영됩니다. 연준 H.8 지표는 상업은행들의 대차대조표 통계의 주간 보고서입니다.',
  sloos: '기업 대출 잔액 변화만으로는 은행이 대출을 덜 해준 건지, 기업이 신규 차입을 줄인 건지 구분하기 어렵습니다. 이때 보는 지표가 SLOOS 입니다. SLOOS는 주요 은행과 기업을 대상으로, 대출 심사 기준이 강화됐는지, 완화됐는지 여부와, 기업들이 차입을 늘리려고 하는지, 줄이려 하는지를 조사합니다.',
};
const usable = (line?: LineAnalysis) => !!line?.latest && Number.isFinite(line.latest.value) && !line.stale && !line.errors.length;

// 설명과 관측·결론을 분리해 화면에서 서로 다른 글자 크기로 표시한다.
function bankReport(data: IndicatorAnalysis[], outcome: CreditOutcome, weeks: 4 | 13): ChapterParagraph[] {
  const line = (id: string) => data.find(i => i.id === id)?.lines[0];
  const loans = line("h8_ci_loans"), standards = line("sloos_ci_standards"), demand = line("sloos_ci_demand");
  const c = usable(loans) ? loans!.changes[weeks] : null;
  const hasChange = c && !c.unchangedRelease && Number.isFinite(c.value);
  const s = usable(standards) ? standards!.latest!.value : null, d = usable(demand) ? demand!.latest!.value : null;
  const surveyChange = (id: string, l?: LineAnalysis) => usable(l) ? readingChange(indicators.find(i => i.id === id)!, l!, weeks).change : null;
  const sc = surveyChange("sloos_ci_standards", standards), dc = surveyChange("sloos_ci_demand", demand);
  const amount = (billions: number) => {
    const eok = Math.round(Math.abs(billions) * 10), jo = Math.floor(eok / 10000), rest = eok % 10000;
    return `${jo ? `${jo}조${rest ? " " : ""}` : ""}${rest || !jo ? `${rest.toLocaleString("ko-KR")}억` : ""} 달러`;
  };
  const balance = hasChange
    ? `기업대출 잔액은 ${amount(loans!.latest!.value - c.value)}에서 ${amount(loans!.latest!.value)}로 ${c.value === 0 ? "변하지 않았습니다" : `${amount(c.value)} ${c.value > 0 ? "늘었습니다" : "줄었습니다"}`} (${c.from} → ${c.to}).`
    : "기업대출 잔액의 증감을 비교할 자료가 부족합니다.";
  const standardsText = s == null ? "은행들의 대출 심사 태도는 자료가 부족해 확인하지 못했습니다."
    : s < 0 ? "최근 조사에서는 기업대출 심사 기준을 완화했다고 응답한 은행이 더 많았습니다."
    : sc && sc.value < 0 ? "은행들의 응답을 종합하면, 기업대출 심사 기준을 강화하는 흐름은 이전 조사보다 약해졌습니다."
    : sc && sc.value > 0 ? s === 0 ? "은행들의 심사 완화 흐름은 이전 조사보다 약해졌습니다." : "은행들의 응답을 종합하면, 기업대출 심사 기준을 강화하는 흐름은 이전 조사보다 강해졌습니다."
    : s > 0 ? "최근 조사에서는 기업대출 심사 기준을 강화했다고 응답한 은행이 더 많았습니다."
    : "최근 조사에서는 기업대출 심사 기준을 강화한 은행과 완화한 은행의 비율이 같았습니다.";
  const demandText = d == null ? "기업들의 차입 수요는 조사 자료가 부족해 확인하지 못했습니다."
    : d > 0 ? dc && dc.value > 0 ? "기업들이 은행에서 돈을 빌리려는 수요는 이전 조사보다 강해진 것으로 나타났습니다."
      : dc && dc.value < 0 ? "기업들의 차입 수요는 증가 쪽 응답이 더 많지만, 그 흐름은 이전 조사보다 약해졌습니다."
      : "기업들의 차입 수요가 늘었다고 응답한 은행이 더 많았습니다."
    : d < 0 ? "기업들의 차입 수요가 줄었다고 응답한 은행이 더 많았습니다."
    : "기업들의 차입 수요가 늘었다는 응답과 줄었다는 응답의 비율이 같았습니다.";
  let conclusion = !hasChange || s == null || d == null ? "대출 잔액과 은행의 심사 태도, 기업의 차입 수요를 함께 판단하기에는 자료가 부족합니다."
    : c.value < 0 && s > 0 && d < 0 ? "기업대출 잔액 감소와 함께 은행의 심사 강화, 기업의 차입 수요 약화가 나타났습니다. 기업의 은행 자금 조달이 위축됐을 가능성이 있습니다."
    : c.value < 0 && (s <= 0 || (sc && sc.value < 0)) && d > 0 ? "따라서 대출 잔액이 줄었다는 이유만으로 기업의 은행 자금 조달이 위축됐다고 보기는 어렵습니다."
    : c.value > 0 && s <= 0 && d > 0 ? "기업의 차입 수요와 실제 기업대출 잔액이 함께 늘었습니다. 기업의 은행 자금 조달이 이어지고 있습니다."
    : "대출 잔액과 조사 결과를 함께 보면 공급과 수요의 움직임이 엇갈립니다. 잔액 변화만으로 은행이 대출을 더 해주거나 덜 해줬다고 단정하기는 어렵습니다.";
  return [
    { kind: "explanation", text: BANK_DEFINITIONS.h8 },
    { kind: "analysis", text: balance, indicatorId: "h8_ci_loans" },
    { kind: "explanation", text: BANK_DEFINITIONS.sloos },
    { kind: "analysis", text: standardsText, indicatorId: "sloos_ci_standards" },
    { kind: "analysis", text: demandText, indicatorId: "sloos_ci_demand" },
    { kind: "conclusion", text: conclusion, indicatorId: "sloos_ci_demand" },
    { kind: "explanation", text: `SLOOS는 대·중견기업 대상 분기 조사로, 주간 대출 잔액과 시차가 있습니다.${s != null ? ` 심사 기준 ${standards!.latest!.date}.` : ""}${d != null ? ` 대출 수요 ${demand!.latest!.date}.` : ""}` },
  ];
}

// 운영 해설은 관측값과 변화 방향만 사용한다.
export function creditChapter(id: string, data: IndicatorAnalysis[], outcome: CreditOutcome, weeks: 4 | 13): ChapterReading {
  const base: ChapterReading = { text: "", details: [], paragraphs: id === "credit-bank" ? bankReport(data, outcome, weeks) : [] };
  return enrichCreditReport(id, base, data, outcome, weeks);
}
