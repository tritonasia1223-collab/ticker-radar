import { z } from "zod";

export const PLOT_PREFIX = "comparison_node:";
export const NOTE_PREFIX = "comparison_insight:";
export const isNoteKey = (key: string) => /^note:[a-zA-Z0-9-]{1,100}$/.test(key);
export const isPlotKey = (key: string) => /^plot:[a-zA-Z0-9-]{1,100}$/.test(key);
export const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const date = z.string().refine(validDate, "유효한 날짜를 입력하세요.");
export const placementSchema = z.object({
  flowSlug: z.string().min(1).max(200), nodeKey: z.string().min(1).max(200),
  title: z.string().min(1).max(160), date: date.nullable(), endDate: date.nullable(),
  sortOrder: z.number().finite(),
}).strict().refine(p => !p.endDate || (!!p.date && p.endDate >= p.date), "종료일은 시작일 이후여야 합니다.");
export type Placement = z.infer<typeof placementSchema>;
export type PlacedNode = Placement & { id: string };

// Rate spreads use original percentage values, not rebased chart values.
export const RATE_SPREAD_IDS = ["fedfunds", "tb3ms", "gs10"] as const;
export const spreadSchema = z.object({ a: z.enum(RATE_SPREAD_IDS), b: z.enum(RATE_SPREAD_IDS) }).strict().refine(s => s.a !== s.b, "서로 다른 금리를 선택하세요.");
export type SpreadSpec = z.infer<typeof spreadSchema>;
export const insightContextSchema = z.object({
  ids: z.array(z.string().regex(/^[a-z0-9_]{1,60}$/)).max(4).refine(ids => new Set(ids).size === ids.length, "중복 지표"),
  spread: spreadSchema.nullable(),
}).strict();
export type InsightContext = z.infer<typeof insightContextSchema>;
// Time anchors remain independent; context remembers which graphs the prose references.
export const comparisonInsightSchema = z.object({
  title: z.string().trim().min(1).max(160),
  date, endDate: date.nullable(),
  text: z.string().max(100000), caption: z.string().max(180),
  sortOrder: z.number().finite(),
  context: insightContextSchema.nullable().optional(),
}).strict().refine(p => !p.endDate || p.endDate >= p.date, "종료일은 시작일 이후여야 합니다.");
export type ComparisonInsight = z.infer<typeof comparisonInsightSchema>;
export type SavedInsight = ComparisonInsight & { id: string };

// Prefer an overlapping reference; otherwise use the closest interval boundary.
// Ties favor a start date near the insight's start, preserving input order last.
export function nearestDatedReference<T extends { date: string | null; endDate?: string | null }>(items: T[], period: { date: string; endDate?: string | null }): T | null {
  const start = Date.parse(period.date), end = Date.parse(period.endDate ?? period.date);
  let best: T | null = null, distance = Infinity, startDistance = Infinity;
  for (const item of items) {
    if (!item.date || !validDate(item.date)) continue;
    const a = Date.parse(item.date), b = item.endDate && validDate(item.endDate) ? Math.max(a, Date.parse(item.endDate)) : a;
    const gap = Math.max(0, a - end, start - b), offset = Math.abs(a - start);
    if (gap < distance || (gap === distance && offset < startDistance)) { best = item; distance = gap; startDistance = offset; }
  }
  return best;
}

export function zoomRange(range: [number, number], anchor: number, factor: number, extent: [number, number]): [number, number] {
  const duration = Math.min(extent[1] - extent[0], Math.max(31 * 86400000, (range[1] - range[0]) * factor));
  const ratio = Math.max(0, Math.min(1, (anchor - range[0]) / (range[1] - range[0])));
  const start = Math.max(extent[0], Math.min(extent[1] - duration, anchor - duration * ratio));
  return [start, start + duration];
}

export function centerRange(center: number, duration: number, extent: [number, number]): [number, number] {
  const span = Math.min(extent[1] - extent[0], Math.max(31 * 86400000, duration));
  const start = Math.max(extent[0], Math.min(extent[1] - span, center - span / 2));
  return [start, start + span];
}
export function presetRange(range: [number, number], mode: "month" | "year", extent: [number, number]): [number, number] {
  const center = (range[0] + range[1]) / 2;
  const a = new Date(center), b = new Date(center), months = mode === "month" ? 12 : 120;
  a.setUTCMonth(a.getUTCMonth() - months); b.setUTCMonth(b.getUTCMonth() + months);
  return centerRange(center, b.getTime() - a.getTime(), extent);
}
export function calendarTicks(range: [number, number], width: number) {
  const months = (range[1] - range[0]) / (30.4375 * 86400000), count = Math.max(2, Math.floor(width / 80));
  const step = [1, 2, 3, 6, 12, 24, 60, 120, 240, 600].find(n => n >= months / count) ?? 1200;
  const start = new Date(range[0]);
  let index = start.getUTCFullYear() * 12 + start.getUTCMonth();
  index = Math.ceil(index / step) * step;
  const ticks: { time: number; label: string }[] = [];
  for (let i = 0; i < 100; i++, index += step) {
    const time = Date.UTC(Math.floor(index / 12), index % 12, 1);
    if (time > range[1]) break;
    if (time >= range[0]) ticks.push({ time, label: new Date(time).toISOString().slice(0, step >= 12 ? 4 : 7) });
  }
  return ticks;
}

export type Observation = [string, number];
export interface ComparePoint { date: string; month: string; time: number; raw: number; value: number; average?: number }
export interface SpreadPoint extends ComparePoint { a: number; b: number; aDate: string; bDate: string }
export function spreadPoints(a: ComparePoint[], b: ComparePoint[]): SpreadPoint[] {
  const byMonth = new Map(b.map(p => [p.month, p]));
  return a.flatMap(p => {
    const q = byMonth.get(p.month);
    if (!q) return [];
    const value = p.raw - q.raw;
    return [{ ...p, date: p.date > q.date ? p.date : q.date, raw: value, value, a: p.raw, b: q.raw, aDate: p.date, bDate: q.date }];
  });
}
// Use only actual observations inside the requested interval. Expose effective
// dates rather than silently presenting nearby values as exact boundary values.
export function periodSummary(points: (ComparePoint | SpreadPoint)[], from: string, to: string) {
  const visible = points.filter(p => p.date >= from && p.date <= to && (!("aDate" in p) || (p.aDate >= from && p.aDate <= to && p.bDate >= from && p.bDate <= to)));
  if (visible.length < 2) return null;
  const first = visible[0], last = visible.at(-1)!;
  return { first, last, change: last.raw - first.raw, percent: first.raw > 0 ? (last.raw / first.raw - 1) * 100 : null,
    low: visible.reduce((a, b) => a.raw <= b.raw ? a : b), high: visible.reduce((a, b) => a.raw >= b.raw ? a : b) };
}
export const monthTime = (month: string) => Date.parse(`${month.slice(0, 7)}-01T00:00:00Z`);
// Monthly sources retain their published monthly values; higher-frequency sources
// use the final observation in each month. No forward-filling/interpolation.
export function monthlyPoints(points: Observation[]): ComparePoint[] {
  const months = new Map<string, ComparePoint>();
  for (const [date, raw] of points) {
    if (!validDate(date) || !Number.isFinite(raw)) continue;
    const month = date.slice(0, 7), old = months.get(month);
    if (!old || date > old.date) months.set(month, { date, month, time: monthTime(month), raw, value: raw });
  }
  return [...months.values()].sort((a, b) => a.time - b.time);
}
export function commonBase(series: ComparePoint[][], requested: string): string | null {
  if (!series.length || series.some(s => !s.length)) return null;
  const sets = series.map(s => new Set(s.filter(p => p.value > 0).map(p => p.month)));
  return series[0].find(p => p.month >= requested.slice(0, 7) && sets.every(s => s.has(p.month)))?.month ?? null;
}
export function rebase(points: ComparePoint[], base: string): ComparePoint[] {
  const value = points.find(p => p.month === base)?.value;
  if (value === undefined || value <= 0) return [];
  return points.map(p => ({ ...p, value: p.value / value * 100 }));
}
export function monthDistance(a: string, b: string) {
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
}
export function lineSegments(points: ComparePoint[], cadence: number): ComparePoint[][] {
  const groups: ComparePoint[][] = [];
  for (const p of points) {
    const last = groups.at(-1);
    if (!last || monthDistance(last.at(-1)!.month, p.month) > cadence) groups.push([p]);
    else last.push(p);
  }
  return groups;
}

// Simplify one continuous segment by retaining original observations, never
// averaging/moving them. Calendar buckets are anchored independently of zoom.
// Each bucket's min/max and the segment endpoints survive (including ties).
export function simplifyExtrema(points: ComparePoint[], months: number): ComparePoint[] {
  if (months <= 1 || points.length <= 2) return points;
  const buckets = new Map<number, ComparePoint[]>();
  for (const p of points) {
    const index = Number(p.month.slice(0, 4)) * 12 + Number(p.month.slice(5, 7)) - 1;
    const bucket = Math.floor(index / months);
    const group = buckets.get(bucket) ?? []; group.push(p); buckets.set(bucket, group);
  }
  const keep = new Set([points[0], points.at(-1)!]);
  for (const group of buckets.values()) {
    const values = group.map(p => p.value), lo = Math.min(...values), hi = Math.max(...values);
    for (const extremum of [lo, hi]) {
      const matches = group.filter(p => p.value === extremum);
      keep.add(matches[0]); keep.add(matches.at(-1)!);
    }
  }
  return points.filter(p => keep.has(p));
}

// Trailing calendar window: require all expected observations, reset after gaps,
// and retain the original observation for the tooltip. Never look ahead.
export function movingAverage(points: ComparePoint[], months: number, cadence: number): ComparePoint[] {
  if (months <= 1) return points;
  const count = Math.max(1, Math.ceil(months / cadence));
  return lineSegments(points, cadence).flatMap(group => group.flatMap((p, i) => {
    if (i < count - 1) return [];
    const window = group.slice(i - count + 1, i + 1);
    if (monthDistance(window[0].month, p.month) !== (count - 1) * cadence) return [];
    const average = window.reduce((sum, v) => sum + v.raw, 0) / count;
    return [{ ...p, value: average, average }];
  }));
}

export type TrendDirection = "up" | "down" | "flat";
export interface TrendSection { from: number; to: number; direction: TrendDirection }
// Broad retrospective tendency, independent of zoom and chart normalization.
// A 12-month mean compared with six months earlier; within 1% retain the prior
// direction to avoid splitting every small pause into another regime.
export function trendSections(points: ComparePoint[], cadence: number): TrendSection[] {
  const result: TrendSection[] = [];
  for (const group of lineSegments(movingAverage(points, 12, cadence), cadence)) {
    let direction: TrendDirection = "flat", active: TrendSection | undefined;
    const byMonth = new Map(group.map(p => [p.month, p]));
    for (const p of group) {
      const previousMonth = new Date(p.time); previousMonth.setUTCMonth(previousMonth.getUTCMonth() - 6);
      const previous = byMonth.get(previousMonth.toISOString().slice(0, 7));
      if (!previous) continue;
      const change = p.value - previous.value;
      const tolerance = Math.max(Math.abs(previous.value), Math.abs(p.value)) * .01;
      if (change > tolerance) direction = "up";
      else if (change < -tolerance) direction = "down";
      if (!active || direction !== active.direction) {
        if (active) active.to = p.time;
        active = { from: p.time, to: p.time, direction }; result.push(active);
      }
      active.to = p.time;
    }
  }
  return result;
}
export function moveRange(range: [number, number], delta: number, extent: [number, number]): [number, number] {
  const shift = Math.max(extent[0] - range[0], Math.min(extent[1] - range[1], delta));
  return [range[0] + shift, range[1] + shift];
}
