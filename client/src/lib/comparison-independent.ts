import type { CompareSeriesDef } from "./comparison-series";

// Do not force zero into the range: doing so would flatten small movements of
// positive levels or all-negative balances. Reference lines never change scales.
export function independentDomain(values: number[]): [number, number] {
  const finite = values.filter(Number.isFinite);
  const lo = finite.length ? Math.min(...finite) : 0;
  const hi = finite.length ? Math.max(...finite) : 1;
  const pad = (hi - lo) * .08 || Math.abs(hi) * .05 || 1;
  return [lo - pad, hi + pad];
}

export const referenceValue = (id: string): number | null =>
  ["real_tb3ms", "net_exports_gdp", "trade_bal"].includes(id) ? 0 : ["dxy", "reer"].includes(id) ? 100 : null;

export const tooltipUnit = (unit: string) => unit === "$B" ? "십억 달러" : ["idx", "p"].includes(unit) ? "pt" : unit;

export function referenceLabel(def: CompareSeriesDef, value: number, lo: number, hi: number) {
  const label = `${def.label} · ${value}${value === 0 && def.unit === "%" ? "%" : ""}`;
  return value > hi ? label + " ↑ 표시 범위 위" : value < lo ? label + " ↓ 표시 범위 아래" : label;
}

export function focusedReferenceId(nearby: { id: string; distance: number }[], pinned: string | null): string | null {
  if (pinned) return pinned;
  return nearby.length ? nearby.reduce((a,b) => a.distance <= b.distance ? a : b).id : null;
}
