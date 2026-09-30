import { change, clean, DAY, type IndicatorAnalysis, type LineAnalysis } from "./signals.js";
import type { Point } from "./schema.js";

export type RateLine = Pick<LineAnalysis, "key" | "label" | "points" | "latest" | "changes" | "stale" | "errors">;
export type RateRow = { time: number; a: number | null; b: number | null; gap: number | null; band: [number, number] | null };

/** 같은 날짜의 관측만 차감한다. 결측에는 음영을 만들지 않고 교차점에서 음영 폭을 0으로 잇는다. */
export function rateRows(a: Point[], b: Point[], start: string, asOf: string): RateRow[] {
  const rows = new Map<string, { a: number | null; b: number | null }>();
  [a, b].forEach((points, index) => clean(points).filter(p => p.date >= start && p.date <= asOf).forEach(p => {
    const row = rows.get(p.date) ?? { a: null, b: null }; row[index === 0 ? "a" : "b"] = p.value; rows.set(p.date, row);
  }));
  const result: RateRow[] = [];
  for (const [date, pair] of [...rows].sort(([a], [b]) => a.localeCompare(b))) {
    const time = Date.parse(date), gap = pair.a !== null && pair.b !== null ? pair.a - pair.b : null;
    const previous = result.at(-1);
    if (previous?.gap != null && gap !== null && previous.gap * gap < 0) {
      const t = previous.gap / (previous.gap - gap), value = previous.a! + t * (pair.a! - previous.a!);
      result.push({ time: previous.time + (time - previous.time) * t, a: value, b: value, gap: 0, band: [value, value] });
    }
    result.push({ time, ...pair, gap, band: gap === null ? null : [Math.min(pair.a!, pair.b!), Math.max(pair.a!, pair.b!)] });
  }
  return result;
}

export function observedRate(key: string, label: string, input: Point[], asOf: string): RateLine {
  const points = clean(input.filter(p => p.date <= asOf)), latest = points.at(-1) ?? null;
  return { key, label, points, latest, changes: Object.fromEntries([1, 4, 13].map(w => [w, change(points, w, "daily", asOf, "observation")])),
    stale: !latest || Date.parse(asOf) - Date.parse(latest.date) > 7 * DAY, errors: [] };
}

const healthy = (line?: RateLine) => !!line?.latest && !line.stale && !line.errors.length;
export function rateNarrative(result: IndicatorAnalysis, weeks: 4 | 13) {
  const rate = result.comparisonLines?.[0], spread = result.lines[0];
  if (!healthy(rate) || !healthy(spread)) return "시장금리 또는 스프레드 자료가 부족하거나 갱신이 지연돼 두 지표의 동반 해석은 유보합니다.";
  const a = rate!.changes[weeks], b = spread.changes[weeks];
  if (!a || !b || a.unchangedRelease || b.unchangedRelease || a.from !== b.from || a.to !== b.to) return "금리와 스프레드의 비교 관측이 일치하지 않아 방향을 함께 판단하지 않습니다. 각 기준일을 확인하세요.";
  const rateText = a.value > 0 ? "올랐습니다" : a.value < 0 ? "내렸습니다" : "변화가 없습니다";
  const spreadText = b.value > 0 ? "확대됐습니다" : b.value < 0 ? "축소됐습니다" : "변화가 없습니다";
  return `${weeks}주간 ${rate!.label}는 ${rateText}. ${spread.label}는 ${spreadText}.`;
}
