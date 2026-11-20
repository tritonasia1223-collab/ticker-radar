import type { TimelineEvent } from "@/data/international-timeline";

/** New short field names take precedence; legacy saved drafts remain readable. */
export function periodEnd(event: TimelineEvent) {
  const year = event.endY !== undefined ? event.endY : event.endYear;
  const month = event.endY !== undefined ? event.endM : event.endMonth;
  if (!Number.isInteger(year) || year! < 1800 || year! > 2100
    || month != null && (!Number.isInteger(month) || month < 1 || month > 12)
    || year! * 12 + (month ?? 12) < event.year * 12 + (event.month ?? 1)) return null;
  return { year: year!, month: month ?? null };
}

export function periodDateLabel(event: TimelineEvent) {
  const end = periodEnd(event);
  if (!end) return "";
  if (/[~～–]/.test(event.date)) return event.date;
  return `${event.date || `${event.year}${event.month ? `.${event.month}` : ""}`}~${end.year}${end.month ? `.${end.month}` : ""}`;
}

export type PeriodSlice = { key: string; year: number; month: number | null; period?: string; events: TimelineEvent[] };
/** Work from rendered rows only. No placeholder row or repeated card is inserted. */
export function periodExtent(event: TimelineEvent, slices: PeriodSlice[]) {
  const end = periodEnd(event);
  if (!end) return null;
  const startIndex = slices.findIndex(row => row.events.some(e => e.id === event.id));
  if (startIndex < 0) return null;
  const endTime = end.year * 12 + (end.month ?? 12);
  const time = (row: PeriodSlice) => row.year * 12 + (row.month ?? (row.period === "상반기" ? 6 : row.period === "하반기" ? 12 : 1));
  const included = slices.slice(startIndex).filter(row => time(row) <= endTime
    // A year/half-year summary is not a known monthly endpoint.
    && (row.month !== null || row.key === slices[startIndex].key || row.year < end.year || end.month === null));
  if (!included.length) included.push(slices[startIndex]);
  const exact = included.some(row => row.year === end.year && row.month === end.month && !row.period);
  return { first: slices[startIndex].key, last: included.at(-1)!.key, keys: included.map(row => row.key), missingEnd: !exact,
    endLabel: `~${end.year}${end.month ? `.${end.month}` : ""}` };
}
