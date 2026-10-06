import { enrichCreditReport } from "./report.js";
import type { IndicatorAnalysis, LineAnalysis } from "./signals.js";
import { bondReading } from "./bond-reading.js";
import { formatCredit, readingChange, type CreditOutcome } from "./reading.js";
import { indicators } from "./schema.js";

export interface ChapterParagraph { kind: "explanation" | "analysis" | "conclusion"; text: string }
export interface ChapterReading { text: string; details: string[]; paragraphs?: ChapterParagraph[] }
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
  if (outcome.signals.small_bank_divergence?.status === true) conclusion += " 다만 소형은행에서는 예금과 대출이 함께 약해지는 신호가 있습니다.";
  if (outcome.signals.loan_emergency_warning?.status === true) conclusion = "기업대출 급증과 단기 조달 부담이 겹쳤습니다. 기업이 미리 확보한 은행 대출 한도를 급히 인출했을 가능성이 있어, 대출 증가를 평소의 자금 조달 확대로 읽기 어렵습니다.";
  return [
    { kind: "explanation", text: "기업이 은행으로부터 대출을 얼마나 받고 있는지 살펴보려면, 먼저 H.8의 기업대출 잔액을 확인합니다. 기업이 아직 갚지 않고 남겨둔 대출금으로, 신규 차입과 상환 등이 반영됩니다." },
    { kind: "analysis", text: balance },
    { kind: "explanation", text: "잔액 변화만으로는 은행이 대출을 덜 해준 건지, 기업이 차입을 줄인 건지 구분하기 어렵습니다. SLOOS는 은행의 대출 심사 기준과 기업의 차입 수요를 조사합니다." },
    { kind: "analysis", text: standardsText },
    { kind: "analysis", text: demandText },
    { kind: "conclusion", text: conclusion },
    { kind: "explanation", text: `SLOOS는 대·중견기업 대상 분기 조사로, 주간 대출 잔액과 시차가 있습니다.${s != null ? ` 심사 기준 ${standards!.latest!.date}.` : ""}${d != null ? ` 대출 수요 ${demand!.latest!.date}.` : ""}` },
  ];
}

// 경고 임계값과 관측된 방향을 구분한다. 경고 미충족을 변화 없음으로 번역하지 않는다.
function baseCreditChapter(id: string, data: IndicatorAnalysis[], outcome: CreditOutcome, weeks: 4 | 13): ChapterReading {
  const line = (key: string) => data.find(i => i.id === key)?.lines[0];
  const value = (key: string) => usable(line(key)) ? line(key)!.latest!.value : null;
  const change = (key: string) => {
    const l = line(key), c = l?.changes[weeks];
    return usable(l) && c && !c.unchangedRelease && Number.isFinite(c.value) ? c.value : null;
  };
  const yes = (key: string) => outcome.signals[key]?.status === true;
  const dates = (keys: string[]) => keys.flatMap(key => {
    const l = line(key);
    return usable(l) ? [`${l!.label}: ${l!.latest!.date}`] : [];
  }).join(" · ");
  const direction = (v: number) => v > 0 ? "늘었습니다" : v < 0 ? "줄었습니다" : "변화가 없습니다";

  if (id === "credit-bank") {
    const loans = change("h8_ci_loans"), standards = value("sloos_ci_standards"), demand = value("sloos_ci_demand");
    const opening = yes("loan_emergency_warning")
      ? "대출 급증과 단기 조달 부담이 겹쳐, 비상 한도 인출 가능성이 있습니다."
      : loans == null ? "은행 기업대출의 증감을 확인할 자료가 부족합니다."
      : `은행 기업대출 잔액은 ${weeks}주간 ${direction(loans)}.`;
    let assessment = standards == null ? "대출 문턱의 변화는 최신 조사를 확인해야 합니다."
      : standards > 0 ? "최근 조사에서는 대출 문턱을 높인 은행이 더 많습니다."
      : standards < 0 ? "최근 조사에서는 대출 문턱을 낮춘 은행이 더 많습니다."
      : "최근 조사에서는 대출 문턱을 높인 은행과 낮춘 은행의 비율이 같습니다.";
    if (standards != null && demand != null && demand < 0) assessment = standards > 0
      ? "최근 조사에선 대출 문턱이 높아지고, 기업의 차입 수요도 약해졌습니다."
      : standards < 0 ? "대출 문턱은 낮아졌지만, 기업의 차입 수요는 약해졌습니다."
      : "대출기준의 순변화는 없지만, 기업의 차입 수요는 약해졌습니다.";
    if (yes("small_bank_divergence")) assessment = "다만 소형은행에서는 예금과 대출이 함께 약해지는 신호가 있습니다.";
    if (yes("loan_emergency_warning")) assessment = "대출 증가를 평소의 신용 확장으로 읽기 어렵습니다.";
    const details = [dates(["h8_ci_loans", "sloos_ci_standards", "sloos_ci_demand"]), "대출 잔액은 상단 비교 기간, 대출기준·수요는 최신 분기 조사입니다. 조사는 대·중견기업 대상이며, 잔액 증감만으로 공급과 수요의 영향을 구분하지 않습니다."];
    if (loans != null) details.unshift(`${weeks}주 기업대출 순변화 ${formatCredit(loans, "billions", true)}.`);
    if (yes("ndfi_growth")) details.push("은행의 비은행 금융회사 대출도 늘고 있습니다. 이 연결 규모의 증가 자체가 부실 신호는 아닙니다.");
    return { text: `${opening} ${assessment}`, details: details.filter(Boolean), paragraphs: bankReport(data, outcome, weeks) };
  }
  if (id === "credit-bonds") {
    const bonds = bondReading(data, outcome);
    const issuance = value("corporate_bond_issuance"), ig = change("ig_oas"), hy = change("hy_oas");
    const stressed = ["ig_wide", "hy_wide", "issuance_collapse"].some(yes);
    // '안정' 임계값 밖이어도 발행·가격에서 확인된 사실은 요약한다.
    const opening = stressed ? bonds.opening : issuance != null && issuance > 0 ? "회사채를 통한 자금 조달은 이어지고 있습니다."
      : ig != null && hy != null ? ig > 0 && hy > 0 ? "우량·저신용 회사채 모두 추가 금리 부담이 커졌습니다."
        : ig <= 0 && hy <= 0 ? "회사채의 추가 금리 부담은 커지지 않았습니다." : "신용등급에 따라 회사채의 추가 금리 부담이 엇갈립니다."
      : bonds.opening;
    return { text: `${opening} ${bonds.burden}`, details: bonds.details, paragraphs: [
      { kind: "explanation", text: "기업이 회사채로 자금을 조달하는 여건은 발행액과 금리를 함께 봅니다. IG는 투자등급, HY는 신용등급이 낮은 회사채입니다. 스프레드는 국채 금리보다 추가로 요구하는 금리(프리미엄)를 뜻합니다." },
      { kind: "analysis", text: opening },
      { kind: "conclusion", text: bonds.burden },
    ] };
  }
  if (id === "credit-short") {
    const amount = change("cp_outstanding"), premium = change("cp_spread");
    const opening = yes("cp_jump") && yes("cp_fall") ? "기업어음 조달은 줄고 추가 금리는 급등해, 단기 자금 여건이 나빠지고 있습니다."
      : amount == null ? "기업어음으로 조달한 잔액의 증감은 확인이 필요합니다."
      : `기업어음으로 조달한 잔액은 ${weeks}주간 ${direction(amount)}.`;
    const assessment = premium == null ? "추가 금리 부담의 변화는 자료가 부족합니다."
      : yes("cp_jump") && yes("cp_fall") ? "다른 조달 경로로 부담이 번지는지 주의가 필요합니다."
      : premium > 0 ? "국채보다 더 내야 하는 금리도 높아졌습니다."
      : premium < 0 ? "국채보다 더 내야 하는 금리는 낮아졌습니다."
      : "국채보다 더 내야 하는 금리는 변하지 않았습니다.";
    return { text: `${opening} ${assessment}`, paragraphs: [
      { kind: "explanation", text: "기업어음(CP)은 기업이 단기 운영자금을 빌리는 수단입니다. 조달한 잔액과 국채보다 추가로 내는 금리를 함께 확인합니다." },
      { kind: "analysis", text: opening }, { kind: "conclusion", text: assessment },
    ], details: [dates(["cp_outstanding", "cp_spread"]), "기업어음(CP)은 기업이 단기 운영자금을 빌리는 수단입니다. 잔액은 전체 CP, 추가 금리는 A2/P2 비금융 90일 CP 기준으로 대상이 다릅니다. 추가 금리 하락이 실제 조달금리 하락을 뜻하지는 않습니다."].filter(Boolean) };
  }
  if (id === "credit-fragile") {
    const ccc = change("ccc_oas"), bdcKeys = ["bdc_discount", "bdc_crash", "defaults_up", "pik_up"];
    const bdcConcern = bdcKeys.some(yes), bdcKnown = bdcKeys.every(key => outcome.signals[key]?.status != null);
    const opening = yes("ccc_gap_trend") ? "취약 기업의 추가 금리 부담이 여러 주에 걸쳐 커지고 있습니다."
      : ccc == null ? "취약 기업의 추가 금리 부담은 비교 자료가 부족합니다."
      : ccc > 0 ? `취약 기업의 추가 금리 부담은 ${weeks}주 전보다 커졌습니다.`
      : ccc < 0 ? `취약 기업의 추가 금리 부담은 ${weeks}주 전보다 줄었습니다.`
      : `취약 기업의 추가 금리 부담은 ${weeks}주 전과 같습니다.`;
    const assessment = bdcConcern ? "상장 대출투자회사에서도 주의 신호가 나타납니다."
      : yes("etf_drop") ? "대출 ETF도 약해져 대출시장 부담을 함께 살펴야 합니다."
      : bdcKnown ? "상장 대출투자회사에서 뚜렷한 동반 악화는 포착되지 않았습니다."
      : "상장 대출투자회사의 상태는 일부 자료가 부족합니다.";
    return { text: `${opening} ${assessment}`, paragraphs: [
      { kind: "explanation", text: "신용등급이 매우 낮은 기업의 회사채(CCC 이하)와 상장 대출투자회사(BDC)를 봅니다. 기업이 돈을 빌리는 비용과 대출자산의 부실 징후를 함께 확인합니다." },
      { kind: "analysis", text: opening }, { kind: "conclusion", text: assessment },
      { kind: "explanation", text: "BDC와 대출 ETF는 사모대출 시장 일부를 간접적으로 보여줍니다. 사모대출 전체의 상태를 뜻하지는 않습니다." },
    ], details: [dates(["ccc_oas", "bdc_credit_quality"]), "취약 기업은 CCC 이하 회사채, 대출투자회사는 상장 BDC 지표로 봅니다. BDC·ETF는 사모대출 전체를 대표하지 않으며, 부실·현금 대신 받는 이자(PIK)는 분기 자료입니다.", "작은 금리 변화도 요약에 반영합니다. 급변·연속 확대 경고는 별도 기준이며, 경고가 없다고 악화가 없는 것은 아닙니다."] .filter(Boolean) };
  }
  // 확인된 은행·시장 흐름을 함께 설명한다.
  const first = (text: string) => text.split(/(?<=다\.)\s+/)[0];
  const bank = baseCreditChapter("credit-bank", data, outcome, weeks);
  const bonds = baseCreditChapter("credit-bonds", data, outcome, weeks);
  return { text: `${first(bank.text)} ${first(bonds.text)}`, details: [] };
}

export function creditChapter(id: string, data: IndicatorAnalysis[], outcome: CreditOutcome, weeks: 4 | 13): ChapterReading {
  return enrichCreditReport(id, baseCreditChapter(id, data, outcome, weeks), data, outcome, weeks);
}
