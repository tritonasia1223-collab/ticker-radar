import type { Point } from './schema.js';

/** 선택한 표시 기간의 고점에서 최신 관측까지의 낙폭. 최대 낙폭(MDD)은 아니다. */
export function currentDrawdown(points: Point[], start: string, asOf: string) {
  const observed = points.filter(p => p.date >= start && p.date <= asOf && Number.isFinite(p.value) && p.value > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (observed.length < 2) return null;
  const latest = observed[observed.length - 1];
  const peak = observed.reduce((best, point) => point.value >= best.value ? point : best);
  return { peak, latest, percent: (latest.value / peak.value - 1) * 100, sampleStart: observed[0].date };
}
