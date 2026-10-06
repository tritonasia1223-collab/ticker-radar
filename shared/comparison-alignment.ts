import { z } from "zod";

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const calibrationSchema = z.object({
  center: z.number().finite(), scale: z.number().finite().positive(),
  kind: z.enum(["zero", "index", "median"]),
  from: month, to: month, samples: z.number().int().min(12),
  dataRevision: z.string().max(60).optional(),
}).strict();
export const alignmentSchema = z.object({
  method: z.literal("median-iqr-asinh-v1"), from: month.nullable(), to: month.nullable(),
  calibrations: z.record(z.string().regex(/^[a-z0-9_]{1,60}$/), calibrationSchema),
}).strict().refine(p => !p.from || !p.to || p.from <= p.to, "참고 기간의 종료는 시작 이후여야 합니다.");
export type Alignment = z.infer<typeof alignmentSchema>;
export type Calibration = z.infer<typeof calibrationSchema>;
const zeroIds = new Set(["gdp_growth", "inflation", "real_tb3ms", "trade", "trade_bal"]);
export const baselineKind = (id: string): Calibration["kind"] => zeroIds.has(id) ? "zero" : ["dxy", "reer"].includes(id) ? "index" : "median";
export function quantile(sorted: number[], fraction: number) {
  const at = (sorted.length - 1) * fraction, i = Math.floor(at);
  return sorted[i] + (sorted[Math.ceil(at)] - sorted[i]) * (at - i);
}
export function calibrate(id: string, points: { month: string; raw: number }[], from: string | null, to: string | null): Calibration | null {
  const reference = points.filter(p => (!from || p.month >= from) && (!to || p.month <= to) && Number.isFinite(p.raw));
  if (reference.length < 12) return null;
  const values = reference.map(p => p.raw).sort((a, b) => a - b);
  // IQR ignores the magnitude of extreme observations; fallbacks handle long plateaus.
  const scale = quantile(values, .75) - quantile(values, .25) || quantile(values, .9) - quantile(values, .1) || values.at(-1)! - values[0];
  if (!(scale > 0)) return null;
  const kind = baselineKind(id);
  return { center: kind === "zero" ? 0 : kind === "index" ? 100 : quantile(values, .5), scale, kind,
    from: reference[0].month, to: reference.at(-1)!.month, samples: reference.length };
}
// Odd, continuous and monotonic: zero and negatives work, extremes remain visible.
export const alignedValue = (raw: number, c: Calibration) => Math.asinh((raw - c.center) / c.scale);
