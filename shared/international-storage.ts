import { z } from "zod";
export const INTERNATIONAL_PREFIX = "international_event:";
export const INTERNATIONAL_SEED = "international_seed_v1";
export const isInternationalKey = (key: string) => /^intl:[^\s]{1,200}$/.test(key);
const year = z.number().int().min(1800).max(2100);
const month = z.number().int().min(1).max(12).nullable();
export const internationalDocumentSchema = z.object({
  title: z.string(), body: z.string(), type: z.string().min(1), labels: z.array(z.string()),
  timing: z.object({ year, month, date: z.string(), endY: year.nullable(), endM: month, endYear: year.nullable(), endMonth: month }),
  position: z.object({ region: z.enum(["us", "europe", "japan", "emerging", "oil"]), country: z.string(), lane: z.enum(["us", "de", "fr", "uk", "jp", "eu", "emerging", "oil"]).nullable(), scope: z.enum(["global", "regional"]) }),
  extra: z.record(z.unknown()), deletedAt: z.string().nullable(),
}).superRefine((doc, ctx) => {
  const t = doc.timing, end = t.endY ?? t.endYear, endMonth = t.endY != null ? t.endM : t.endMonth;
  if ((end == null && (t.endM != null || t.endMonth != null)) || end != null && end * 12 + (endMonth ?? 12) < t.year * 12 + (t.month ?? 1)) ctx.addIssue({ code: "custom", message: "잘못된 종료 시점" });
});
