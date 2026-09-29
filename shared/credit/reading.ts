// B안의 편집 순서와 해설. 지표 정의·단위·판정 기준은 기존 JSON을 공유한다.
import { config, indicators, type Indicator } from "./schema.js";
import { type LineAnalysis, type Change } from "./signals.js";
import { type scenarios } from "./scenarios.js";

export type CreditOutcome = ReturnType<typeof scenarios>;
export const readingGroups = [
  { id: "credit-bank", title: "은행 대출", question: "은행은 돈을 빌려주고 있나?", intro: "은행의 대출 문턱과 기업의 차입 수요를 먼저 보고, 실제 대출 잔액으로 확인합니다. 대출 감소만으로 공급 위축을 단정하지 않습니다.", ids: ["sloos_ci_standards", "sloos_ci_demand", "h8_ci_loans", "h8_large_vs_small_banks", "h8_loans_to_nondepository"], watch: ["bank_tight", "loan_slow", "demand_weak", "small_bank_divergence", "ndfi_growth", "loan_emergency_warning"], calm: ["bank_ease", "loan_growth"] },
  { id: "credit-bonds", title: "회사채 조달", question: "회사채 시장이 자금을 공급하고 있나?", intro: "스프레드는 국채보다 더 내야 하는 금리입니다. 우량 기업과 신용도가 낮은 기업의 비용을 나눠 보고, 실제 발행이 이어지는지 확인합니다.", ids: ["ig_oas", "hy_oas", "corporate_bond_issuance"], watch: ["ig_wide", "hy_wide", "issuance_collapse"], calm: ["ig_stable", "hy_stable", "issuance_active"] },
  { id: "credit-short", title: "단기 자금", question: "당장 쓸 돈을 구하기 어려워졌나?", intro: "CP는 기업 등이 단기 자금을 조달할 때 쓰는 기업어음입니다. 비용 상승과 잔액 감소가 함께 나타나는지, 은행 한도대출 인출로 이어지는지 봅니다.", ids: ["cp_spread", "cp_outstanding"], watch: ["cp_jump", "cp_fall", "loan_emergency_warning"], calm: [] },
  { id: "credit-fragile", title: "취약 기업·사모대출", question: "취약한 곳에서 먼저 문제가 생기나?", intro: "전체 시장의 평균에 가려진 신호를 확인합니다. CCC는 신용도가 매우 낮은 회사채, BDC는 기업 대출 등에 투자하는 상장 투자회사입니다. 이 지표들이 사모대출 시장 전체를 대표하지는 않습니다.", ids: ["ccc_oas", "bdc_price_to_nav", "bdc_credit_quality", "leveraged_loans"], watch: ["ccc_wide", "bdc_discount", "bdc_crash", "defaults_up", "pik_up", "etf_drop"], calm: ["ccc_stable", "bdc_stable"] },
];

export const readingNotes: Record<string, { question: string; reading: string; together: string }> = {
  sloos_ci_standards: { question: "은행의 대출 문턱은 높아졌나?", reading: "0보다 높으면 기준을 강화한 은행이 더 많다는 뜻입니다. 값이 내려가도 양수라면 완화로 전환했다고 볼 수는 없습니다.", together: "대출수요와 실제 C&I 대출을 같이 봅니다. 공급과 수요가 동시에 약해질 수도 있습니다." },
  sloos_ci_demand: { question: "기업이 돈을 빌리려는 수요는 어떤가?", reading: "0보다 낮으면 수요가 약해졌다고 답한 은행이 더 많습니다. 대출 감소의 원인이 은행의 거절인지, 기업의 차입 축소인지 구분하는 단서입니다.", together: "대출기준이 크게 변하지 않으면서 수요와 대출이 함께 줄면 수요 둔화 해석을 검토합니다." },
  h8_ci_loans: { question: "실제로 기업에 나간 대출은 늘었나?", reading: "기업대출 잔액은 실제 은행 신용의 규모입니다. 증가가 항상 좋은 신호는 아닙니다. 시장 조달이 막히면 기업이 미리 확보한 은행 한도를 인출해 잔액이 급증할 수 있습니다.", together: "CP 비용 급등과 대출 급증이 겹치면 비상 인출 가능성을 먼저 확인합니다. 감소할 때는 대출기준과 수요를 함께 봅니다." },
  h8_large_vs_small_banks: { question: "소형은행만 따로 약해지고 있나?", reading: "은행 규모별 예금과 대출의 방향을 비교합니다. 기준 100은 각 선의 출발점을 맞춘 것으로, 은행 간 실제 잔액 크기를 뜻하지 않습니다.", together: "소형은행의 예금과 대출이 함께 약해지는지 확인합니다. 은행 분류·인수합병에 따른 변화도 있어 괴리만으로 위기를 확정하지 않습니다." },
  h8_loans_to_nondepository: { question: "은행과 비은행의 연결은 커졌나?", reading: "은행이 비은행 금융회사에 빌려준 잔액입니다. 증가 자체가 부실은 아니지만 두 경로 사이의 자금 연결 규모가 커졌다는 뜻입니다.", together: "BDC 가격과 부실 지표가 악화될 때 이 연결을 함께 봅니다. 사모대출 펀드만의 대출액은 아닙니다." },
  ig_oas: { question: "우량 기업의 조달 비용도 오르고 있나?", reading: "투자등급 회사채의 국채 대비 추가 금리입니다. 확대는 상대적인 조달 부담 증가를 뜻합니다. 실제 총 조달금리는 국채 금리에도 영향을 받습니다.", together: "HY와 함께 확대되는지, 회사채 발행량도 줄어드는지 확인해야 전반적인 조달 위축을 판단할 수 있습니다." },
  hy_oas: { question: "신용도가 낮은 기업의 부담은 어떤가?", reading: "투기등급 회사채의 추가 금리입니다. 높은 수준뿐 아니라 몇 주 사이의 확대 속도를 봅니다. 낮은 값만으로 위험이 사라졌다고 판단하지 않습니다.", together: "IG가 안정적인데 HY만 확대되면 선별적 긴장일 수 있습니다. 실제 자금 공급은 발행량으로 확인합니다." },
  corporate_bond_issuance: { question: "비용뿐 아니라 실제 발행도 이어지나?", reading: "회사채 발행은 시장에서 실제로 조달한 금액입니다. 월별 계절성과 차환 일정의 영향이 있어 한 달의 감소만으로 시장이 닫혔다고 볼 수 없습니다.", together: "IG·HY 스프레드와 함께 봅니다. 전체 발행액만 있으면 등급별 발행을 대신하지 않으며, 관련 시나리오 판단은 유보합니다." },
  cp_spread: { question: "단기 운영자금의 가격이 뛰었나?", reading: "A2/P2 비금융 90일 CP 금리에서 3개월 단기국채 할인율을 뺀 대리지표입니다. 확대에는 CP 금리 상승뿐 아니라 안전자산인 단기국채 금리 하락도 영향을 줍니다.", together: "CP 잔액 감소와 C&I 대출 급증이 동반되는지 확인합니다. 비용만 상승한 경우와 시장 조달이 막힌 경우를 구분합니다." },
  cp_outstanding: { question: "기업어음으로 조달한 잔액은 줄었나?", reading: "전체 CP 시장의 잔액입니다. 감소는 공급 위축뿐 아니라 수요 감소나 다른 조달 수단으로의 이동 때문일 수도 있습니다.", together: "CP 스프레드와 같이 봅니다. 전체 시장 잔액과 A2/P2 비금융 CP 금리는 관측 대상이 완전히 같지는 않습니다." },
  ccc_oas: { question: "가장 약한 차주부터 어려워지나?", reading: "CCC 이하 회사채의 추가 금리입니다. HY 평균이 안정적인데 이 지표만 확대되면 취약한 차주에 긴장이 집중될 가능성을 살펴봅니다.", together: "HY·IG의 방향과 비교하고, BDC 가격·부실 공시에서도 유사한 신호가 나오는지 확인합니다." },
  bdc_price_to_nav: { question: "시장은 대출자산의 장부가를 어떻게 평가하나?", reading: "주가를 주당 순자산가치(NAV)로 나눈 값입니다. 1배 미만이면 장부가 대비 할인입니다. 할인은 자산 우려 외에도 금리·배당·회사별 특성에 영향을 받습니다.", together: "주가는 일간, NAV는 분기 자료입니다. 분기말 NAV를 연결한 과거 분석이며 당시 알려진 정보만의 재현은 아닙니다. 부실·PIK 공시로 확인합니다." },
  bdc_credit_quality: { question: "가격의 우려가 실제 부실에도 나타나나?", reading: "부실(non-accrual)은 정상적으로 이자를 인식하지 않는 대출의 비중입니다. PIK는 현금 대신 원금 등에 더해 받는 이자·배당으로, 비중 상승의 배경을 확인해야 합니다.", together: "공정가치·원가 기준과 회사별 PIK 정의가 다릅니다. 같은 회사·같은 기준의 분기 추세를 우선 보고, PIK 증가만으로 부도를 단정하지 않습니다." },
  leveraged_loans: { question: "레버리지론 관련 가격도 약해졌나?", reading: "BKLN·SRLN ETF의 분배금·분할 수정 가격을 대용 지표로 봅니다. 레버리지론 원대출 가격이나 CLO 스프레드의 직접 측정값은 아닙니다.", together: "CCC·HY와 함께 하락 압력이 나타나는지 봅니다. ETF 가격에는 자금 유출입과 유동성의 영향도 섞입니다." },
};

export function groupReading(group: typeof readingGroups[number], outcome: CreditOutcome) {
  const matched = group.watch.filter(k => outcome.signals[k]?.status === true);
  const missing = [...new Set([...group.watch, ...group.calm])].filter(k => outcome.signals[k]?.status == null);
  const calm = group.calm.length > 0 && group.calm.every(k => outcome.signals[k]?.status === true);
  const status = matched.length ? "확인할 신호" : missing.length ? "판단 유보" : calm ? "안정 근거" : group.calm.length ? "혼합 신호" : "급변 조건 미충족";
  const confirmed = [...new Set([...matched, ...group.ids.flatMap(id => indicators.find(i => i.id === id)!.signal_keys)])].filter(k => outcome.signals[k]?.status === true);
  const evidence = confirmed.map(k => config.signalLabels[k]);
  const opening = evidence.length ? `${evidence.join(" · ")} 조건이 관측됐습니다.` : matched.length === 0 && missing.length === 0 ? `${group.watch.map(k => config.signalLabels[k]).join(" · ")} 조건은 관측되지 않았습니다.` : "확인된 조건만으로 방향을 정하기 어렵습니다.";
  const missingLabels = [...new Set(missing.map(k => k.startsWith("issuance_") ? "등급별 회사채 발행량" : config.signalLabels[k]))];
  const text = `${opening}${missing.length ? ` 다만 ${missingLabels.join(" · ")} 판단에 필요한 자료가 부족합니다.` : ""}`;
  return { status, text, matched, missing };
}

export function formatCredit(value: number | null | undefined, unit: string, signed = false) {
  if (value == null || !Number.isFinite(value)) return "—";
  const prefix = signed && value > 0 ? "+" : "";
  const n = (v: number) => v.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
  if (unit === "billions") return `${prefix}${Math.abs(value) >= 1000 ? `${n(value / 1000)}조` : `${n(value * 10)}억`} 달러`;
  return `${prefix}${n(value)}${({ percent: "%", pp: "%p", ratio: "배", usd: "달러" } as Record<string, string>)[unit] ?? ""}`;
}

// 분기·월간 자료는 주차 토글 때문에 같은 관측을 '0 변화'로 오독하지 않게 직전 관측과 비교한다.
export function readingChange(spec: Indicator, line: LineAnalysis, weeks: 4 | 13): { label: string; change: Change | null } {
  const slow = ["monthly", "quarterly"].includes(spec.frequency);
  if (!slow) return { label: `${weeks}주 비교`, change: line.changes[weeks] ?? null };
  const latest = line.latest, previous = latest ? line.points.findLast(p => p.date < latest.date) : null;
  const period = (date: string) => { const d = new Date(date); return spec.frequency === "quarterly" ? d.getUTCFullYear() * 4 + Math.floor(d.getUTCMonth() / 3) : d.getUTCFullYear() * 12 + d.getUTCMonth(); };
  const valid = latest && previous && period(latest.date) - period(previous.date) === 1;
  return { label: spec.frequency === "quarterly" ? "직전 분기 관측 대비" : "직전 월 관측 대비", change: valid ? { from: previous.date, to: latest.date, value: latest.value - previous.value, pct: previous.value > 0 ? (latest.value / previous.value - 1) * 100 : null, unchangedRelease: false } : null };
}

export function indicatorReading(spec: Indicator, line: LineAnalysis, weeks: 4 | 13, outcome: CreditOutcome) {
  const comparison = readingChange(spec, line, weeks), c = comparison.change;
  const known = !!line.latest && !line.stale && !line.errors.length;
  const direction = !c || c.unchangedRelease ? null : c.value > 0 ? "상승" : c.value < 0 ? "하락" : "변화 없음";
  const emergency = spec.id === "h8_ci_loans" && outcome.signals.loan_emergency_warning?.status === true;
  const headline = !line.latest ? "선택 시점에 사용할 자료가 없습니다." : !known ? "관측값은 있지만 현재 상태 판단은 유보합니다." : emergency ? "대출 급증을 확장으로 읽기 전에 비상 인출을 확인해야 합니다." : direction ? `${line.label}: ${comparison.label} ${direction}했습니다.`.replace("변화 없음했습니다", "변화가 없습니다") : "최신 수준은 확인되지만 비교할 관측이 부족합니다.";
  const matched = spec.signal_keys.filter(k => outcome.signals[k]?.status === true).map(k => config.signalLabels[k]);
  let meaning = !known ? "표시된 관측값만으로 선택 시점의 상태를 확정하지 않습니다." : !c || c.unchangedRelease ? "비교 관측이 부족하거나 새 관측이 없어 변화 방향을 해석하지 않습니다." : c.value === 0 ? "비교한 두 관측값은 같습니다. 관측 사이의 움직임과 다른 지표까지 같다는 뜻은 아닙니다." : "이 변화만으로 전체 신용 공급의 상태를 확정하지 않습니다.";
  if (known && c && !c.unchangedRelease && c.value !== 0) {
    const up = c.value > 0;
    if (spec.id === "sloos_ci_standards") meaning = `${line.latest!.value > 0 ? "기준 강화 응답이 우세합니다." : line.latest!.value < 0 ? "기준 완화 응답이 우세합니다." : "기준 강화와 완화의 순응답이 균형입니다."} 직전 분기보다 순강화 비율은 ${up ? "높아졌습니다" : "낮아졌습니다"}.`;
    else if (spec.id === "sloos_ci_demand") meaning = `${line.latest!.value > 0 ? "수요 강화 응답이 우세합니다" : line.latest!.value < 0 ? "수요 약화 응답이 우세합니다" : "수요 강화·약화의 순응답이 균형입니다"}. 직전 분기보다 수요의 순응답은 ${up ? "개선" : "약화"}됐습니다.`;
    else if (["ig_oas", "hy_oas", "ccc_oas", "cp_spread"].includes(spec.id)) meaning = `국채 대비 추가 금리가 ${up ? "벌어져 상대적인 조달 부담이 커지는" : "좁아져 상대적인 조달 부담이 줄어드는"} 방향입니다. 변화의 크기와 발행·잔액을 함께 확인해야 합니다.`;
    else if (spec.id === "h8_ci_loans") meaning = emergency ? "CP 비용 급등과 기업대출 급증 조건이 함께 관측됐습니다. 시장에서 조달하지 못한 자금을 은행 한도에서 인출했을 가능성을 확인합니다." : `실제 은행 기업대출 잔액은 ${up ? "늘었습니다" : "줄었습니다"}. 공급 변화인지 수요 변화인지는 대출기준·수요 조사와 대조해야 합니다.`;
    else if (spec.id === "bdc_price_to_nav") meaning = `선택 회사의 주가/NAV 비율은 ${up ? "높아졌습니다" : "낮아졌습니다"}. 현재 ${line.latest!.value < 1 ? "1배 미만의 할인" : line.latest!.value > 1 ? "1배 초과의 프리미엄" : "1배"} 상태입니다. 분기 NAV 갱신도 이 비율에 영향을 줍니다.`;
    else if (spec.id === "bdc_credit_quality") meaning = `선택한 회사·공시 기준의 비중이 직전 분기보다 ${up ? "높아졌습니다" : "낮아졌습니다"}. ${up ? "부담이 커지는 방향인지 원인을 확인합니다" : "이 항목에서는 비중이 줄었지만 다른 부실 기준도 확인합니다"}.`;
    else if (spec.id === "corporate_bond_issuance") meaning = `선택한 발행 계열의 월간 금액은 ${up ? "늘었습니다" : "줄었습니다"}. 계절성과 차환 수요가 있어 한 달 변화로 시장의 개폐를 판단하지 않습니다.`;
    else if (spec.id === "cp_outstanding") meaning = `CP 시장 잔액은 ${up ? "늘었습니다" : "줄었습니다"}. ${up ? "조달 잔액 증가가 확인되지만 기업별 접근성이 모두 같다는 뜻은 아닙니다" : "자금 공급의 위축인지 수요 감소인지는 CP 비용과 은행 대출을 함께 봐야 합니다"}.`;
    else if (spec.id === "h8_loans_to_nondepository") meaning = `은행의 비은행 금융회사 대출 잔액이 ${up ? "늘어 연결 규모가 커졌습니다" : "줄었습니다"}. 이 수치 자체가 사모대출의 부실 규모를 뜻하지는 않습니다.`;
    else if (spec.id === "h8_large_vs_small_banks") meaning = `선택한 계열의 잔액은 ${up ? "늘었습니다" : "줄었습니다"}. 대형·소형은행의 예금과 대출이 같은 방향인지 네 선을 비교합니다.`;
    else if (spec.id === "leveraged_loans") meaning = `선택한 ETF의 수정 가격이 ${up ? "올랐습니다" : "내렸습니다"}. 공개 대출시장의 대용 신호이며 CLO 스프레드 자체의 변화는 아닙니다.`;
  }
  return { ...comparison, headline, known, matched, meaning };
}

// 편집 목록이 기존 14개 지표를 빠짐없이, 중복 없이 참조하는지 검증한다.
const editorialIds = readingGroups.flatMap(g => g.ids);
if (new Set(editorialIds).size !== editorialIds.length || indicators.some(i => !editorialIds.includes(i.id) || !readingNotes[i.id]) || editorialIds.some(id => !indicators.some(i => i.id === id))) throw new Error("신용 해설 지표 연결을 확인하세요.");
