import { indicators } from "./schema.js";
import { DAY, type IndicatorAnalysis, type LineAnalysis } from "./signals.js";
import type { CreditOutcome } from "./reading.js";
import rules from "./reading-rules.json";

const usable = (line?: LineAnalysis) => !!line?.latest && !line.stale && !line.errors.length;
export function bondReading(data: IndicatorAnalysis[], outcome: CreditOutcome) {
  const yes = (key: string) => outcome.signals[key]?.status === true;
  const missing = (key: string) => outcome.signals[key]?.status == null;
  const stable = yes("ig_stable") && yes("hy_stable");
  const issuanceSpec = indicators.find(i => i.id === "corporate_bond_issuance")!;
  const issuance = data.find(i => i.id === issuanceSpec.id)?.lines.find(l => l.key === issuanceSpec.chart.lines[0].key);
  const issuanceKnown = usable(issuance) && issuance!.latest!.value > 0;
  const wide = yes("ig_wide") || yes("hy_wide"), collapse = yes("issuance_collapse");
  const opening = wide || collapse ? (wide && collapse ? "회사채 시장에서 조달 여건이 나빠지는 신호가 포착됐습니다." : wide ? "회사채 시장에서 투자자가 요구하는 위험 프리미엄이 커지고 있습니다." : "회사채 발행이 위축되는 신호가 포착됐습니다.") : stable && issuanceKnown ? "회사채 시장에 큰 문제는 포착되지 않았습니다." : stable ? "회사채 스프레드에서 큰 문제는 포착되지 않았습니다." : "회사채 시장의 상태를 판단할 자료가 충분하지 않습니다.";
  const rates = ["ig_oas", "hy_oas"].map(id => {
    const spec = indicators.find(i => i.id === id)!;
    return data.find(i => i.id === id)?.comparisonLines?.find(l => l.key === spec.chart.marketYield?.key);
  });
  const enough = rates.map(line => usable(line) && line!.metrics.percentile != null && line!.sampleCount >= rules.bondYield.minimumSamples && line!.sampleStart && line!.sampleEnd && (Date.parse(line!.sampleEnd) - Date.parse(line!.sampleStart)) / DAY >= rules.bondYield.minimumSpanDays);
  const high = rates.map((line, n) => !!enough[n] && line!.metrics.percentile! >= rules.bondYield.highPercentile);
  const burden = high.every(Boolean) ? "다만 금리 수준은 여전히 높아, 빚을 새로 내거나 갈아타야 하는 기업에는 이자 부담이 큽니다." : high.some(Boolean) ? `${high[0] ? "우량 기업" : "신용등급이 낮은 기업"}의 시장금리는 높은 편이어서, 신규 차입이나 차환에는 부담입니다.` : enough.every(Boolean) ? "금리 수준에서도 두 등급 모두 높은 부담이 나타나는 조건은 충족하지 않았습니다." : "금리 부담의 높고 낮음을 판단할 비교 자료는 충분하지 않습니다.";
  const details = [
    rates.flatMap((l, n) => l?.latest ? [`${n === 0 ? "IG" : "HY"} ${l.latest.value.toFixed(2)}% (${l.latest.date}) · 비교 표본 ${l.sampleStart ?? "—"}~${l.sampleEnd ?? "—"}`] : []).join(" / "),
    `높은 금리: 각 계열의 확보 기간 백분위 ${rules.bondYield.highPercentile} 이상, 최소 ${rules.bondYield.minimumSpanDays}일·${rules.bondYield.minimumSamples}개 관측 기준. 현재 시장금리이며 기존 부채의 평균 지급이자는 아닙니다.`,
    missing("issuance_active") || missing("issuance_collapse") ? "등급별 회사채 발행량은 미확보 또는 갱신 지연으로 판단에서 제외했습니다." : "등급별 발행 판단은 최근 3개월 발행액의 전년 동기 대비 변화 기준입니다.",
    issuanceKnown ? `전체 회사채 발행은 ${issuance!.latest!.date} 기준 확인됩니다. 전체 발행만으로 등급별 조달 상황을 확정하지 않습니다.` : "전체 회사채 발행도 선택 시점에 확인되지 않았습니다.",
  ].filter(Boolean);
  const overview = stable && issuanceKnown && !wide && !collapse && high.every(Boolean)
    ? "회사채 시장은 안정적이지만, 높은 금리는 여전히 부담입니다."
    : `${opening} ${burden}`;
  return { overview, text: `${opening}\n${burden}\n스프레드는 국채 금리보다 추가로 요구하는 금리(프리미엄)를 뜻합니다.`, details };
}
