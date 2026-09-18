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

// Insights belong to time, never to a selected series or a value-axis coordinate.
export const comparisonInsightSchema = z.object({
  title: z.string().trim().min(1).max(160),
  date, endDate: date.nullable(),
  text: z.string().max(100000), caption: z.string().max(180),
  sortOrder: z.number().finite(),
}).strict().refine(p => !p.endDate || p.endDate >= p.date, "종료일은 시작일 이후여야 합니다.");
export type ComparisonInsight = z.infer<typeof comparisonInsightSchema>;
export type SavedInsight = ComparisonInsight & { id: string };

export function zoomRange(range: [number, number], anchor: number, factor: number, extent: [number, number]): [number, number] {
  const duration = Math.min(extent[1] - extent[0], Math.max(31 * 86400000, (range[1] - range[0]) * factor));
  const ratio = Math.max(0, Math.min(1, (anchor - range[0]) / (range[1] - range[0])));
  const start = Math.max(extent[0], Math.min(extent[1] - duration, anchor - duration * ratio));
  return [start, start + duration];
}

export type Observation = [string, number];
export interface ComparePoint { date: string; month: string; time: number; raw: number; value: number; average?: number }
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
