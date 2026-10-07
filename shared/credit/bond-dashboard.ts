import { clean, DAY, type IndicatorAnalysis } from './signals.js';
import type { Point } from './schema.js';

export const bondGrades = [
  { id: 'ig_oas', name: 'IG', label: 'IG (투자등급)', color: '#54897D' },
  { id: 'hy_oas', name: 'HY', label: 'HY (투기등급)', color: '#B39A65' },
  { id: 'ccc_oas', name: 'CCC 이하', label: 'CCC 이하', color: '#377DC3' },
] as const;
export type BondMode = 'yield' | 'oas';

/** 휴장일은 직전 관측을 사용하되 7일을 넘는 결측은 빈 값으로 남긴다. */
function observation(points: Point[], target: string) {
  const point = points.filter(p => p.date <= target).at(-1);
  return point && Date.parse(target) - Date.parse(point.date) <= 7 * DAY ? point : null;
}

export function bondDashboard(data: IndicatorAnalysis[], asOf: string, weeks: 4 | 13, mode: BondMode) {
  const year = (offset: number) => { const d = new Date(asOf); d.setUTCFullYear(d.getUTCFullYear() - offset); return d.toISOString().slice(0, 10); };
  const start = year(3), previous = new Date(Date.parse(asOf) - weeks * 7 * DAY).toISOString().slice(0, 10), annual = year(1);
  const series = bondGrades.map(grade => {
    const indicator = data.find(i => i.id === grade.id);
    const line = mode === 'yield' ? indicator?.comparisonLines?.[0] : indicator?.lines[0];
    const points = clean(line?.points ?? []).filter(p => p.date >= start && p.date <= asOf);
    return { ...grade, points, current: observation(points, asOf), previous: observation(points, previous), annual: observation(points, annual) };
  });
  const rows = new Map<string, { date: string; ig_oas: number | null; hy_oas: number | null; ccc_oas: number | null }>();
  series.forEach(s => s.points.forEach(p => {
    const row = rows.get(p.date) ?? { date: p.date, ig_oas: null, hy_oas: null, ccc_oas: null };
    row[s.id] = p.value; rows.set(p.date, row);
  }));
  return { series, rows: [...rows.values()].sort((a, b) => a.date.localeCompare(b.date)), start, previous, annual };
}
