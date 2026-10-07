import { commonBase, rebase, type ComparePoint, type ComparisonView } from "../../../shared/cap-comparison";
import { COMPARE_SERIES, type CompareSeriesDef } from "./comparison-series";

export type AxisSide = "left" | "right";
export interface ComparisonAxis { side: AxisSide; key: string; label: string; normalized: boolean; independent?: boolean; includeZero?: boolean }
export interface AxisSeries { def: CompareSeriesDef; points: ComparePoint[]; axis: string }
export interface RawComparisonSeries { def: CompareSeriesDef; points: ComparePoint[] }

const actualValueIds = new Set(["gdp_growth", "inflation", "unrate", "debt_gdp", "fedfunds", "tb3ms", "real_tb3ms", "gs10", "trade", "net_exports_gdp", "trade_bal"]);
export const defaultAxis = (id: string): AxisSide => actualValueIds.has(id) ? "right" : "left";
export const assignedAxis = (id: string, view: ComparisonView): AxisSide => view.assignments[id] ?? defaultAxis(id);
export const usesIndependentScale = (id: string, view: ComparisonView) => view.mode === "mixed" && id === "cpi_level";
export function sameComparisonView(a: ComparisonView | undefined, b: ComparisonView | undefined, ids: string[]) {
  if (!a) return true; // Legacy notes remember indicators only.
  if (!b || a.mode !== b.mode) return false;
  if (a.mode === "raw") return true;
  if (a.base !== b.base) return false;
  return a.mode !== "mixed" || (a.rightUnit === b.rightUnit && ids.every(id => assignedAxis(id, a) === assignedAxis(id, b)));
}
// Real/nominal and annualized/monthly trade values must never share a raw scale.
export const rawUnitKey = (def: CompareSeriesDef) => def.id === "trade" ? "real-net-exports" : def.id === "trade_bal" ? "trade-balance" : def.unit;
export const rawUnitLabel = (key: string) => key === "real-net-exports" ? "실질 순수출 · 십억 2017달러/연율" : key === "trade-balance" ? "무역수지 · 십억 달러/월" : key === "%" ? "% · 금리·비율·증가율" : key === "%p" ? "%p · 증가율 격차" : key;

export function automaticComparisonView(ids: string[], view?: ComparisonView, fallbackBase = "2000-01"): ComparisonView {
  const lastRight = ids.map(id => COMPARE_SERIES.find(s => s.id === id)).filter(s => s && defaultAxis(s.id) === "right").at(-1);
  return { mode: "mixed", base: view?.base ?? fallbackBase, assignments: {}, rightUnit: lastRight ? rawUnitKey(lastRight) : null };
}

export function buildComparisonAxes(raw: RawComparisonSeries[], view: ComparisonView) {
  const axes: ComparisonAxis[] = [], series: AxisSeries[] = [];
  const groups: { key: string; label: string; ids: string[] }[] = [];
  const unavailable: string[] = [];
  let base: string | null = null, rightUnit: string | null = null;
  const independent = raw.filter(s => usesIndependentScale(s.def.id, view));
  raw = raw.filter(s => !usesIndependentScale(s.def.id, view));
  if (view.mode === "raw") {
    raw.slice(0, 2).forEach((s, i) => {
      const key = "raw:" + s.def.id;
      axes.push({ side: i ? "right" : "left", key, label: s.def.label + " · " + s.def.unit, normalized: false });
      series.push({ ...s, axis: key });
    });
    return { axes, series, groups, unavailable, base, rightUnit, pending: [] as string[] };
  }
  const left = raw.filter(s => view.mode === "index" || assignedAxis(s.def.id, view) === "left");
  const eligible = left.filter(s => {
    const ok = s.points.some(p => p.month >= view.base && p.value > 0);
    if (!ok) unavailable.push(s.def.id);
    return ok;
  });
  base = commonBase(eligible.map(s => s.points), view.base);
  if (left.length) axes.push({ side: "left", key: "index", label: "기준월=100", normalized: true });
  if (base) eligible.forEach(s => series.push({ ...s, axis: "index", points: rebase(s.points, base!) }));
  else eligible.forEach(s => unavailable.push(s.def.id));

  const right = view.mode === "mixed" ? raw.filter(s => assignedAxis(s.def.id, view) === "right") : [];
  for (const s of right) {
    const key = rawUnitKey(s.def), group = groups.find(g => g.key === key);
    if (group) group.ids.push(s.def.id);
    else groups.push({ key, label: rawUnitLabel(key), ids: [s.def.id] });
  }
  rightUnit = groups.some(g => g.key === view.rightUnit) ? view.rightUnit : groups[0]?.key ?? null;
  for (const group of groups) {
    const key = "right:" + group.key;
    // Show every selected series. Only the active unit owns the right-hand ticks;
    // incompatible units keep separate scales rather than disappearing or sharing false units.
    axes.push({ side: "right", key, label: group.label, normalized: false, includeZero: true, ...(group.key !== rightUnit ? { independent: true } : {}) });
    right.filter(s => rawUnitKey(s.def) === group.key).forEach(s => series.push({ ...s, axis: key }));
  }
  for (const s of independent) {
    const key = "independent:" + s.def.id;
    axes.push({ side: "left", key, label: s.def.label + " · 독립 배율", normalized: false, independent: true });
    series.push({ ...s, axis: key });
  }
  return { axes, series, groups, unavailable, base, rightUnit, pending: [] as string[] };
}
