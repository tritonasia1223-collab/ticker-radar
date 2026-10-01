import { config } from "@shared/credit/schema";
import { formatCredit, type CreditOutcome } from "@shared/credit/reading";

export function CreditTrendNote({ signals }: { signals: CreditOutcome["signals"] }) {
  const rule = config.signals.ccc_gap_trend;
  if (!("weeklyGapTrend" in rule)) return null;
  const settings = rule.weeklyGapTrend, result = signals.ccc_gap_trend;
  const find = (metric: string) => result?.evidence.find(e => e.metric === metric);
  const gap = find("gapChange"), streak = find("gapConsecutiveWeeks"), primary = find("primaryTrendChange");
  return <div className="text-xs leading-[1.75] text-[#5F5C54]" data-testid="credit-gap-trend">
    <p>{result?.status === null || !gap ? "CCC–HY 격차 추세: 주별 공통 관측이 부족하거나 자료 갱신 확인이 필요합니다." : <>최근 {settings.weeks}주간 CCC–HY 추가 금리 격차 {formatCredit(gap.value, "pp", true)} · 최근 {streak?.value ?? 0}주 연속 확대{primary ? ` · CCC 자체 ${formatCredit(primary.value, "pp", true)}` : ""}<br />{result?.status === true ? "취약 기업의 부담이 누적되는 추세 주의 조건을 충족했습니다." : "설정한 추세 주의 조건은 충족하지 않았습니다."}</>}</p>
    <details className="mt-1 text-[#918D83]"><summary className="cursor-pointer">추세 기준</summary>
      <p className="mt-1">CCC는 신용등급이 매우 낮은 기업, HY는 저신용 회사채 전반을 뜻합니다. 격차 = CCC OAS − HY OAS. HY에도 CCC가 포함되므로 독립된 두 집단의 비교는 아닙니다.</p>
      <p>종료된 {settings.weeks}주 동안 매주 {settings.minWeeklyIncrease}%p 이상 확대 + 누적 {settings.minTotalIncrease}%p 이상 확대{settings.requirePrimaryRise ? " + CCC 자체 상승" : ""}. 초기 참고 기준이며 설정에서 조정할 수 있습니다.</p>
      <p>금요일까지 두 지표가 함께 관측된 마지막 값을 사용합니다. 같은 주 {settings.maxLagDays}일 이내 휴장 시차만 허용하고 누락 주·진행 중인 주는 연결하지 않습니다. 상단 4주·13주 비교와 별도의 고정 추세 기준입니다.</p>
      {gap?.from && <p>사용한 관측: {gap.from} → {gap.date}</p>}
    </details>
  </div>;
}
