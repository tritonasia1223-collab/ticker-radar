import type { WeeklyGapTrend } from "./schema.js";
import { clean, DAY, type IndicatorAnalysis } from "./signals.js";
import type { Evaluation, Evidence } from "./scenarios.js";

// 선택일 이전에 끝난 금요일 주간만 사용한다. 진행 중인 주는 연속 주수에 넣지 않는다.
export function weeklyGapTrend(rule: WeeklyGapTrend, data: IndicatorAnalysis[]): Evaluation {
  const primary = data.find(i => i.id === rule.indicator)?.lines[0];
  const reference = data.find(i => i.id === rule.referenceIndicator)?.lines[0];
  const label = `${primary?.label ?? rule.indicator} − ${reference?.label ?? rule.referenceIndicator}`;
  const unknown = (reason: string): Evaluation => ({ status: null, evidence: [{ indicator: rule.indicator, line: label, metric: "gapConsecutiveWeeks", value: null, expected: `${rule.weeks}주 연속 확대`, date: null, status: null, reason }] });
  if (!primary?.latest || !reference?.latest || primary.stale || reference.stale || primary.errors.length || reference.errors.length) return unknown("자료 없음·갱신 지연·수집 오류");
  const asOf = primary.asOf ?? reference.asOf ?? [primary.latest.date, reference.latest.date].sort().at(-1)!;
  if (primary.asOf && reference.asOf && primary.asOf !== reference.asOf) return unknown("두 계열의 판단 기준일이 다름");
  const selected = Date.parse(asOf);
  const lastFriday = selected - ((new Date(selected).getUTCDay() + 2) % 7) * DAY;
  const other = new Map(reference.points.filter(p => p.date <= asOf).map(p => [p.date, p.value]));
  // 두 금리가 같은 날짜에 관측된 경우만 차감한다. 서로 다른 날·전일값 보간은 사용하지 않는다.
  const joined = clean(primary.points.filter(p => p.date <= asOf && other.has(p.date)))
    .map(p => ({ date: p.date, primary: p.value, gap: p.value - other.get(p.date)! }));
  const weeks = Array.from({ length: rule.weeks + 1 }, (_, n) => {
    const end = lastFriday - (rule.weeks - n) * 7 * DAY;
    const row = joined.findLast(p => Date.parse(p.date) <= end);
    return row && end - Date.parse(row.date) <= rule.maxLagDays * DAY ? row : null;
  });
  if (weeks.some(p => !p)) return unknown("완료된 주별 공통 관측 부족 · 누락 주는 이어 붙이지 않음");
  const observations = weeks.filter(p => p !== null);
  const first = observations[0], last = observations.at(-1)!;
  let consecutive = 0;
  for (let n = observations.length - 1; n > 0; n--) {
    if (observations[n].gap - observations[n - 1].gap + 1e-9 < rule.minWeeklyIncrease) break;
    consecutive++;
  }
  const gapChange = last.gap - first.gap, primaryChange = last.primary - first.primary;
  const item = (line: string, metric: string, value: number, expected: string, status: boolean): Evidence => ({ indicator: rule.indicator, line, metric, value, expected, status, from: first.date, date: last.date });
  const evidence = [
    item(label, "gapConsecutiveWeeks", consecutive, `${rule.weeks}주 연속 · 주당 ≥ ${rule.minWeeklyIncrease}%p`, consecutive >= rule.weeks),
    item(`${label} 누적 변화`, "gapChange", gapChange, `≥ ${rule.minTotalIncrease}%p`, gapChange + 1e-9 >= rule.minTotalIncrease),
    ...(rule.requirePrimaryRise ? [item(`${primary.label} 자체 변화`, "primaryTrendChange", primaryChange, "> 0%p", primaryChange > 1e-9)] : []),
  ];
  return { status: evidence.every(e => e.status === true), evidence };
}
