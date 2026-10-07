import type { IndicatorAnalysis } from "./signals.js";
import { DAY } from "./signals.js";

// 같은 날의 관측만 연결한다. 격차와 증감은 관측치이며 위험 판정이 아니다.
export function creditGap(data: IndicatorAnalysis[], weeks: 4 | 13) {
  const c = data.find(i => i.id === "ccc_oas")?.lines[0];
  const h = data.find(i => i.id === "hy_oas")?.lines[0];
  if (!c?.latest || !h?.latest || c.stale || h.stale || c.errors.length || h.errors.length) return null;
  const end = c.latest.date < h.latest.date ? c.latest.date : h.latest.date;
  const hy = new Map(h.points.filter(p => p.date <= end).map(p => [p.date, p.value]));
  const points = c.points.filter(p => p.date <= end && hy.has(p.date) && Number.isFinite(p.value) && Number.isFinite(hy.get(p.date)))
    .map(p => ({date: p.date, value: p.value - hy.get(p.date)!})).sort((a,b) => a.date.localeCompare(b.date));
  const current = points.at(-1);
  if (!current || Date.parse(end) - Date.parse(current.date) > 4 * DAY) return null;
  const target = Date.parse(current.date) - weeks * 7 * DAY;
  const old = points.findLast(p => Date.parse(p.date) <= target);
  const previous = old && target - Date.parse(old.date) <= 4 * DAY ? old : null;
  return {current, previous, change: previous ? current.value - previous.value : null};
}
