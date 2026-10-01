import { calibrate, alignedValue, alignmentSchema, type Alignment, type Calibration } from "../../../shared/comparison-alignment";
import type { RawComparisonSeries, AxisSeries, ComparisonAxis } from "./comparison-axes";

export const defaultAlignment: Alignment = { method: "median-iqr-asinh-v1", from: null, to: null, calibrations: {} };
// Only migrate viewing preferences; saved insights retain their original context.
export function viewingAlignment(value: unknown, version: unknown): Alignment {
  const parsed = alignmentSchema.safeParse(value);
  if (!parsed.success || (version !== 2 && parsed.data.from === "2000-01" && parsed.data.to === "2025-12")) return defaultAlignment;
  return parsed.data;
}
export function buildAlignedComparison(raw: RawComparisonSeries[], alignment: Alignment) {
  const calibrations: Record<string, Calibration> = {}, series: AxisSeries[] = [], unavailable: string[] = [];
  for (const s of raw) {
    const c = alignment.calibrations[s.def.id] ?? calibrate(s.def.id, s.points, alignment.from, alignment.to);
    if (!c) { unavailable.push(s.def.id); continue; }
    calibrations[s.def.id] = c;
    series.push({ def: s.def, axis: "aligned", points: s.points.map(p => ({ ...p, value: alignedValue(p.raw, c) })) });
  }
  const axes: ComparisonAxis[] = [{ side: "left", key: "aligned", label: "각 지표의 기준 대비 상대 위치", normalized: false }];
  return { series, axes, unavailable, alignment: { ...alignment, calibrations } };
}
export const baselineLabel = (c: Calibration | undefined) => !c ? "참고 자료 부족" : (c.kind === "median" ? "중앙값 " : "기준 ") + c.center.toLocaleString("ko", { maximumFractionDigits: 2 });
