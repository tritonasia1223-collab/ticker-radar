// 판정은 기존 JSON 신호를 재사용하며, 이 파일은 관측 → 수치 → 해석의 문장만 만든다.
import { indicators } from "./schema.js";
import { creditWarnings, formatCredit, readingGroups, type CreditOutcome } from "./reading.js";
import type { Evidence } from "./scenarios.js";

export interface CreditStory { id: string; headline: string; meaning: string; evidence: { text: string; date: string }[] }
const metricLabels: Record<string, string> = { latest: "최신 수준", delta4: "4주 변화", change4: "4주 증감률", priceChange4: "4주 가격 변화", change13: "13주 증감률", annual13: "13주 증감률(연율)", previousDelta: "직전 관측 대비 변화", issuanceYoy: "최근 3개월 발행액의 전년 동기 대비 변화", percentile: "과거 표본 백분위", speedPercentile: "4주 변화 속도 백분위", speed13Percentile: "13주 변화 속도 백분위" };
const metricOrder = ["delta4", "change4", "priceChange4", "previousDelta", "issuanceYoy", "annual13", "change13", "latest", "percentile", "speedPercentile", "speed13Percentile"];
const plainNames: Record<string, string> = { hy_oas: "신용등급이 낮은 회사채의 추가 금리", ig_oas: "우량 회사채의 추가 금리", ccc_oas: "최하위 신용등급 회사채의 추가 금리", cp_spread: "기업어음(CP)의 국채 대비 추가 금리", h8_ci_loans: "은행 기업대출 잔액", sloos_ci_standards: "은행 대출기준 순강화 비율", sloos_ci_demand: "기업 대출수요 순강화 비율", cp_outstanding: "기업어음(CP) 잔액" };

function evidenceText(e: Evidence) {
  const unit = indicators.find(i => i.id === e.indicator)?.chart.unit ?? "";
  const percentage = ["change4", "priceChange4", "change13", "annual13", "issuanceYoy", "percentile", "speedPercentile", "speed13Percentile"].includes(e.metric);
  const valueUnit = percentage ? "percent" : ["delta4", "previousDelta"].includes(e.metric) && unit === "percent" ? "pp" : unit;
  return { text: `${plainNames[e.indicator] ?? e.line}의 ${metricLabels[e.metric] ?? e.metric}는 ${formatCredit(e.value, valueUnit, e.metric !== "latest" && !e.metric.toLowerCase().includes("percentile"))}입니다.`, date: e.from ? `${e.from} → ${e.date}` : `${e.date} 관측` };
}

export function creditReview(outcome: CreditOutcome) {
  const yes = (key: string) => outcome.signals[key]?.status === true;
  const missing = (key: string) => outcome.signals[key]?.status == null;
  const warnings = creditWarnings(outcome);
  const stories: CreditStory[] = [];
  const used = new Set<string>();
  const add = (id: string, keys: string[], headline: string, meaning: string) => {
    const active = keys.filter(k => yes(k) && !used.has(k));
    if (!active.length) return;
    active.forEach(k => used.add(k));
    const seen = new Set<string>();
    const evidence = active.flatMap(k => outcome.signals[k].evidence)
      .filter(e => e.status === true && e.value !== null && Number.isFinite(e.value) && e.date)
      .sort((a, b) => metricOrder.indexOf(a.metric) - metricOrder.indexOf(b.metric))
      .filter(e => { const key = `${e.indicator}/${e.line}`; if (seen.has(key)) return false; seen.add(key); return true; })
      .map(evidenceText);
    stories.push({ id, headline, meaning, evidence });
  };
  if (yes("loan_emergency_warning")) add("credit-short", ["loan_emergency_warning", "cp_jump", "loan_surge"],
    "기업대출이 늘었지만, 비상 자금 인출일 가능성이 있습니다.",
    "CP의 국채 대비 금리차 확대와 은행 대출 급증이 함께 나타났습니다. 시장에서 돈을 구하기 어려워진 기업들이 기존 은행 대출한도를 사용했을 수 있습니다.");

  if (yes("bank_tight") && yes("loan_slow") && (yes("ig_wide") || yes("hy_wide")) && yes("issuance_collapse")) {
    add("credit-bank", ["bank_tight", "loan_slow", "ig_wide", "hy_wide", "issuance_collapse"],
      "은행과 회사채 시장에서 동시에 자금 조달 부담이 커지고 있습니다.",
      "은행의 대출기준 강화와 대출 증가세 둔화에 더해, 회사채 위험 프리미엄 확대과 발행 감소도 관측됐습니다. 여러 경로에서 신용 공급이 위축됐을 가능성이 있습니다.");
  }
  for (const warning of warnings) {
    const keys = warning.keys.filter(k => !used.has(k));
    if (!keys.length) continue;
    if (warning.id === "credit-bonds") {
      const price = yes("ig_wide") || yes("hy_wide");
      const selective = yes("hy_wide") && yes("ig_stable");
      add(warning.id, keys, price ? "회사채 시장의 위험 프리미엄이 확대됐습니다." : "회사채 발행이 줄어들었습니다.",
        `${selective ? "우량 회사채의 추가 금리는 안정 조건에 있어, 부담이 신용등급이 낮은 기업에 집중된 모습입니다. " : ""}${price && missing("issuance_collapse") ? "등급별 발행량 자료가 부족해, 위험 프리미엄 확대와 함께 실제 조달도 줄었는지는 확인되지 않습니다. 시장금리 상승 여부는 별도 확인이 필요합니다." : price && yes("issuance_collapse") ? "위험 프리미엄 확대와 발행 감소가 겹쳐, 시장에서 자금을 구하기 어려워졌을 가능성이 있습니다." : price ? "추가 금리 상승은 국채 대비 조달 부담 증가를 뜻합니다. 실제 조달 위축 여부는 발행량과도 관련됩니다." : "발행 감소에는 시장 수요뿐 아니라 계절성과 차환 일정도 영향을 줍니다."}`);
    } else if (warning.id === "credit-bank") {
      add(warning.id, keys, yes("small_bank_divergence") ? "소형은행의 자금 사정에서 주의 신호가 나타났습니다." : yes("bank_tight") ? "은행의 대출기준에서 긴축 신호가 나타났습니다." : yes("demand_weak") ? "기업의 대출 수요가 약해졌습니다." : "은행 기업대출의 증가세가 둔화됐습니다.",
        yes("bank_tight") && yes("loan_slow") ? "대출기준 강화와 대출 증가세 둔화가 함께 나타나 공급 위축 가능성이 있습니다. 대출 수요 변화도 잔액에 영향을 줍니다." : yes("demand_weak") && !yes("bank_tight") ? "기업이 빌리려는 돈이 줄어든 신호입니다. 이를 은행의 대출 거절 증가와 동일하게 볼 수는 없습니다." : "은행 대출 잔액에는 공급과 수요가 모두 영향을 줍니다. 이 관측만으로 금융시스템 전체의 위기를 뜻하지는 않습니다.");
    } else if (warning.id === "credit-short") {
      add(warning.id, keys, yes("cp_jump") ? "기업어음의 국채 대비 금리차가 확대됐습니다." : "기업어음(CP) 조달 잔액이 줄었습니다.",
        yes("cp_jump") && yes("cp_fall") ? "CP 금리차 확대와 잔액 감소가 겹쳐 단기 시장 조달이 위축됐을 가능성이 있습니다." : "단기 자금시장의 주의 신호입니다. 조달 비용과 잔액의 관측 대상이 달라, 한 지표만으로 시장이 막혔다고 단정할 수는 없습니다.");
    } else {
      add(warning.id, keys, "취약 기업·사모대출 관련 지표에서 주의 신호가 나타났습니다.",
        "아래 수치는 취약한 차주 또는 상장 BDC·대출 ETF에서 관측된 변화입니다. 사모대출 시장 전체의 손실이나 부도를 직접 측정한 값은 아닙니다.");
    }
  }
  const bankKnown = readingGroups[0].watch.filter(k => k !== "ndfi_growth").every(k => outcome.signals[k]?.status === false);
  const stablePrices = yes("ig_stable") && yes("hy_stable");
  const normal = bankKnown && stablePrices ? "은행 대출에서 뚜렷한 위축 신호는 없고, IG·HY 회사채의 추가 금리도 안정적입니다. 이는 시장금리 수준이 낮다는 뜻은 아닙니다." :
    bankKnown ? "은행 대출에서 뚜렷한 위축 신호는 없습니다. 회사채 조달 상태는 판단을 유보합니다." :
    stablePrices ? "IG·HY 회사채의 추가 금리는 안정적입니다. 이는 시장금리 수준이 낮다는 뜻은 아닙니다. 은행 대출 상태는 판단을 유보합니다." :
    "확인된 자료만으로 은행 대출·회사채 조달 상태를 확정하기 어렵습니다.";
  return { stories, normal, incompleteIssuance: missing("issuance_collapse") };
}
