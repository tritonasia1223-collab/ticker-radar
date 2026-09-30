import { config, indicators, type Indicator, type Point, type Series, type Snapshot } from "./schema.js";

export const DAY = 86400000;
export type TimeBasis = "publication" | "observation";
export const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export function clean(points: Point[]) { return [...new Map(points.filter(p => Number.isFinite(p.value)).map(p => [p.date, p])).values()].sort((a, b) => a.date.localeCompare(b.date)); }
export function before(points: Point[], date: string) { return points.findLast(p => p.date <= date); }
export function joinSpread(a: Point[], b: Point[]): Point[] {
  const map = new Map(b.map(p => [p.date, p]));
  return clean(a.flatMap(p => { const q = map.get(p.date); return q ? [{ date: p.date, value: p.value - q.value }] : []; }));
}
export function joinNav(prices: Point[], nav: Point[], basis: TimeBasis = "publication"): Point[] {
  const releases = basis === "observation" ? clean(nav) : [...nav].filter(p => p.effectiveAt).sort((a, b) => a.effectiveAt!.localeCompare(b.effectiveAt!) || a.date.localeCompare(b.date));
  return clean(prices.flatMap(p => {
    const n = releases.findLast(n => (basis === "observation" ? n.date : n.effectiveAt!) <= p.date);
    return n && n.value > 0 ? [{ date: p.date, value: p.value / n.value, publishedAt: n.publishedAt, effectiveAt: n.effectiveAt, basis: n.date }] : [];
  }));
}
export function percentile(values: number[], value: number) {
  if (!values.length || !Number.isFinite(value)) return null;
  return 100 * (values.filter(v => v < value).length + values.filter(v => v === value).length / 2) / values.length;
}
export interface Change { value: number; pct: number | null; from: string; to: string; unchangedRelease: boolean }
export function change(points: Point[], weeks: number, frequency: string, referenceDate?: string, basis: TimeBasis = "publication"): Change | null {
  const to = points.at(-1); if (!to) return null;
  const slow = frequency === "monthly" || frequency === "quarterly";
  if (slow && basis === "publication" && !to.publishedAt) return null;
  const byRelease = slow && basis === "publication";
  const anchor = basis === "observation" ? referenceDate ?? to.date : slow ? referenceDate ?? to.publishedAt! : to.date;
  const target = iso(Date.parse(anchor) - weeks * 7 * DAY);
  const from = byRelease ? points.findLast(p => p.publishedAt && p.publishedAt <= target) : before(points, target);
  if (!from || days(byRelease ? from.publishedAt! : from.date, target) > config.settings.toleranceDays[frequency]) return null;
  return { value: to.value - from.value, pct: from.value > 0 ? (to.value / from.value - 1) * 100 : null, from: from.date, to: to.date, unchangedRelease: from.date === to.date };
}
export interface LineAnalysis {
  key: string; label: string; points: Point[]; unit: string; latest: Point | null; changes: Record<string, Change | null>; metrics: Record<string, number | null>;
  stale: boolean; ageDays: number | null; navAgeDays?: number | null; collectionOverdue?: boolean; sampleStart: string | null; sampleEnd: string | null; sampleCount: number; tenYearPercentile: number | null;
  errors: string[]; notes: string[]; sources: { url?: string; label: string; transport: string; checkedAt?: string }[];
}
export interface IndicatorAnalysis { id: string; lines: LineAnalysis[]; comparisonLines?: LineAnalysis[]; status: "ok" | "partial" | "missing" | "manual" }
function issuanceYoy(points: Point[], asOf: string) {
  const complete = points.filter(p => p.date.slice(0, 7) < asOf.slice(0, 7)); const last = complete.at(-1); if (!last) return null;
  const d = new Date(last.date); const month = d.getUTCMonth(), year = d.getUTCFullYear();
  const monthValue = (offset: number) => { const key = new Date(Date.UTC(year, month - offset, 1)).toISOString().slice(0, 7); return complete.findLast(p => p.date.startsWith(key))?.value; };
  const a = [0, 1, 2].map(monthValue), b = [12, 13, 14].map(monthValue);
  if ([...a, ...b].some(v => v === undefined)) return null;
  const sum = (v: (number | undefined)[]) => v.reduce<number>((s, n) => s + n!, 0); return sum(b) > 0 ? (sum(a) / sum(b) - 1) * 100 : null;
}
function analyzeLine(i: Indicator, key: string, label: string, input: Point[], series: Series[], asOf: string, basis: TimeBasis, price?: Point[]): LineAnalysis {
  // 관측 기준은 현재 확보한 수정 자료로 과거를 읽는다. 공시일은 보존하되 날짜 필터로 쓰지 않는다.
  const points = clean(input.filter(p => p.date <= asOf && (basis === "observation" || ((!p.effectiveAt || p.effectiveAt <= asOf) && (!p.publishedAt || p.publishedAt <= asOf))))); const latest = points.at(-1) ?? null;
  const changes = Object.fromEntries([1, 4, 13].map(w => [String(w), change(points, w, i.frequency, asOf, basis)]));
  const slow = ["monthly", "quarterly"].includes(i.frequency);
  const ageDays = latest ? days(basis === "publication" && latest.publishedAt && slow ? latest.publishedAt : latest.date, asOf) : null;
  const navAgeDays = i.chart.kind === "pnav" && latest ? days(basis === "observation" ? latest.basis! : latest.publishedAt!, asOf) : null;
  const collectionOverdue = series.some(s => s.checkedAt && config.sources.find(src => src.key === s.key)?.provider !== "manual" && days(s.checkedAt.slice(0, 10), asOf) > config.settings.collectionStaleDays);
  const stale = collectionOverdue || ageDays === null || ageDays > config.settings.staleDays[i.frequency] || (navAgeDays !== null && navAgeDays > config.settings.staleDays.quarterly);
  const cutoff = iso(Date.parse(asOf) - config.settings.lookbackYears * 365.25 * DAY);
  const sample = points.filter(p => p.date >= cutoff); const enough = sample.length >= config.settings.minimumSamples[i.frequency];
  const p = latest && enough ? percentile(sample.map(p => p.value), latest.value) : null;
  const old = latest ? before(points, iso(Date.parse(latest.date) - 91 * DAY)) : undefined;
  const yoy = latest ? before(points, iso(Date.parse(latest.date) - 365 * DAY)) : undefined;
  const speed = points.flatMap((p, idx) => { if (p.date < cutoff) return []; const c = change(points.slice(0, idx + 1), 4, i.frequency, undefined, basis); return c?.pct != null ? [c.pct] : []; });
  const speed13 = points.flatMap((p, idx) => { if (p.date < cutoff) return []; const c = change(points.slice(0, idx + 1), 13, i.frequency, undefined, basis); return c?.pct != null ? [c.pct] : []; });
  const validOld = old && latest && days(old.date, latest.date) <= 91 + config.settings.toleranceDays[i.frequency];
  const previous = points.at(-2);
  const metrics: Record<string, number | null> = {
    latest: latest?.value ?? null, delta4: changes[4]?.value ?? null, change4: changes[4]?.pct ?? null, change13: changes[13]?.pct ?? null,
    previousDelta: latest && previous && (!slow || days(previous.date, latest.date) <= (i.frequency === "quarterly" ? 110 : 40)) ? latest.value - previous.value : null,
    annual13: latest && validOld && old.value > 0 ? (Math.pow(latest.value / old.value, 365.25 / days(old.date, latest.date)) - 1) * 100 : null,
    yoy: latest && yoy && yoy.value > 0 && days(yoy.date, latest.date) <= 365 + config.settings.toleranceDays[i.frequency] ? (latest.value / yoy.value - 1) * 100 : null,
    percentile: p, speedPercentile: enough && changes[4]?.pct != null ? percentile(speed, changes[4]!.pct!) : null,
    speed13Percentile: enough && changes[13]?.pct != null ? percentile(speed13, changes[13]!.pct!) : null,
    issuanceYoy: i.frequency === "monthly" ? issuanceYoy(points, asOf) : null,
    priceChange4: price ? change(price.filter(p => p.date <= asOf && p.adjustedValue != null).map(p => ({ ...p, value: p.adjustedValue! })), 4, "daily", asOf, basis)?.pct ?? null : null,
    stressPercentile: p === null ? null : i.stress_direction === "higher_is_stress" ? p : ["lower_is_stress", "lower_price_is_stress"].includes(i.stress_direction) ? 100 - p : null,
  };
  const full = enough && points.length > 0 && points[0].date <= iso(Date.parse(cutoff) + config.settings.toleranceDays[i.frequency] * DAY);
  return { key, label, points, unit: i.chart.unit, latest, changes, metrics, stale, ageDays, navAgeDays, collectionOverdue, sampleStart: sample[0]?.date ?? null, sampleEnd: sample.at(-1)?.date ?? null, sampleCount: sample.length, tenYearPercentile: full ? p : null, errors: series.flatMap(s => s.error ? [s.error] : []), notes: [...new Set(series.flatMap(s => s.notes))], sources: series.map(s => { const src = config.sources.find(x => x.key === s.key); return { url: latest?.sourceUrl ?? src?.url, label: src?.label ?? s.key, transport: s.transport, checkedAt: s.checkedAt }; }) };
}
export function analyze(snapshot: Snapshot | null, asOf = new Date().toISOString().slice(0, 10), basis: TimeBasis = "publication"): IndicatorAnalysis[] {
  const byKey = new Map(snapshot?.series.map(s => [s.key, s]) ?? []);
  const source = (key: string): Series => byKey.get(key) ?? { key, points: [], checkedAt: "", transport: "미수집", notes: [] };
  return indicators.map(i => {
    const lines = i.chart.kind === "spread" ? (() => { const a = source(i.chart.lines[0].key), b = source(i.chart.lines[1].key); return [analyzeLine(i, i.id, i.name, joinSpread(a.points, b.points), [a, b], asOf, basis)]; })() : i.chart.lines.map(l => {
      const a = source(l.key); const nav = l.navKey ? source(l.navKey) : null;
      return analyzeLine(i, l.key, l.label, nav ? joinNav(a.points, nav.points, basis) : a.points, nav ? [a, nav] : [a], asOf, basis, nav ? a.points : undefined);
    });
    const present = lines.filter(l => l.latest).length;
    // 참고 금리는 신호 판정용 lines에 섞지 않는다. OAS 규칙과 임계값을 그대로 유지한다.
    const comparison = i.chart.marketYield ? [i.chart.marketYield] : i.chart.kind === "spread" ? i.chart.lines : [];
    const commonDates = i.chart.kind === "spread" ? new Set(lines[0].points.map(p => p.date)) : null;
    const comparisonLines = comparison.map(l => { const s = source(l.key); return analyzeLine({ ...i, chart: { ...i.chart, kind: "series", unit: "percent" } }, l.key, l.label, commonDates ? s.points.filter(p => commonDates.has(p.date)) : s.points, [s], asOf, basis); });
    return { id: i.id, lines, comparisonLines, status: !present ? i.chart.kind === "manual" ? "manual" : "missing" : present < lines.length || lines.some(l => l.errors.length || l.stale) ? "partial" : "ok" };
  });
}
