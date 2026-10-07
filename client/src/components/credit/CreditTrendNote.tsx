import type { IndicatorAnalysis } from "@shared/credit/signals";
import { creditGap } from "@shared/credit/observations";

export function CreditTrendNote({ data, weeks }: { data: IndicatorAnalysis[]; weeks: 4 | 13 }) {
  const gap = creditGap(data, weeks);
  return <div className="text-xs leading-[1.75] text-[#5F5C54]" data-testid="credit-gap-trend">
    <p>{gap?.previous && gap.change != null
      ? `최근 ${weeks}주 CCC–HY 프리미엄 격차: ${gap.previous.value.toFixed(2)}%p → ${gap.current.value.toFixed(2)}%p (${gap.change > 0 ? "+" : ""}${gap.change.toFixed(2)}%p). ${gap.previous.date} → ${gap.current.date}.`
      : "CCC–HY 격차: 같은 날짜의 비교 관측이 부족합니다."}</p>
    <details className="mt-1 text-[#918D83]"><summary className="cursor-pointer">격차의 의미</summary>
      <p className="mt-1">CCC는 신용등급이 매우 낮은 기업, HY는 저신용 회사채 전반입니다. 격차 = CCC OAS − HY OAS. HY에도 CCC가 포함되므로 독립된 두 집단의 비교는 아닙니다. 격차가 확대돼도 CCC 자체의 프리미엄이 올랐는지는 따로 확인합니다.</p>
    </details>
  </div>;
}
