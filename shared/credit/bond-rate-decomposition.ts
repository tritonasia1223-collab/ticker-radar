import { bondGrades } from './bond-dashboard.js';
import { clean, DAY, type IndicatorAnalysis } from './signals.js';

/** OAS 변화와 시장금리 변화의 차이는 국채 금리 몫의 근사치로만 표시한다. */
export function bondRateDecomposition(data: IndicatorAnalysis[], asOf: string, period: 4 | 13 | 'year') {
  const prior = new Date(`${asOf}T00:00:00Z`);
  if (period === 'year') prior.setUTCFullYear(prior.getUTCFullYear() - 1);
  else prior.setUTCDate(prior.getUTCDate() - period * 7);
  const previous = prior.toISOString().slice(0, 10);
  const rows = bondGrades.map(grade => {
    const indicator = data.find(item => item.id === grade.id);
    const spreads = new Map(clean(indicator?.lines[0]?.points ?? []).map(point => [point.date, point.value]));
    const paired = clean(indicator?.comparisonLines?.[0]?.points ?? [])
      .filter(point => point.date <= asOf && spreads.has(point.date))
      .map(point => ({ date: point.date, yield: point.value, oas: spreads.get(point.date)! }));
    const at = (target: string) => {
      const point = paired.findLast(item => item.date <= target);
      return point && Date.parse(target) - Date.parse(point.date) <= 7 * DAY ? point : null;
    };
    const current = at(asOf), before = at(previous);
    if (!current || !before || current.date === before.date) return { ...grade, change: null };
    const total = current.yield - before.yield;
    const premium = current.oas - before.oas;
    const treasury = total - premium;
    return { ...grade, change: { total, premium, treasury, from: before.date, to: current.date, fromYield: before.yield, toYield: current.yield, fromOas: before.oas, toOas: current.oas } };
  });
  // 양수·음수를 서로 다른 쪽에 쌓되 모든 등급은 동일한 축척을 사용한다.
  const negative = Math.min(0, ...rows.map(row => row.change ? Math.min(0, row.change.treasury) + Math.min(0, row.change.premium) : 0));
  const positive = Math.max(0, ...rows.map(row => row.change ? Math.max(0, row.change.treasury) + Math.max(0, row.change.premium) : 0));
  return { rows, previous, domain: negative === positive ? [0, 1] as const : [negative, positive] as const };
}
