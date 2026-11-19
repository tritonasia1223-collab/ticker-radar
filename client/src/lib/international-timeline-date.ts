import type { TimelineEvent } from "@/data/international-timeline";

type DatePart = { year: number; month: number | null; day: number | null };
function part(year: number, month: number | null, day: number | null): DatePart | null {
  if (!Number.isInteger(year) || year < 1800 || year > 2100 || month !== null && (month < 1 || month > 12)
    || day !== null && (!month || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate())) return null;
  return { year, month, day };
}
const label = ({ year, month, day }: DatePart) => `${year}${month ? `.${month}` : ""}${day ? `.${day}` : ""}`;

export function parseTimelineDate(input: string): Pick<TimelineEvent, "year" | "month" | "date" | "endYear" | "endMonth"> | null {
  const normalized = input.trim().replace(/\s/g, "").replace(/[～–—]/g, "~");
  const match = normalized.match(/^(\d{4})(?:\.(\d{1,2})(?:\.(\d{1,2}))?)?(?:~(\d{1,4})(?:\.(\d{1,2})(?:\.(\d{1,2}))?)?)?$/);
  if (!match) return null;
  const start = part(Number(match[1]), match[2] ? Number(match[2]) : null, match[3] ? Number(match[3]) : null);
  if (!start) return null;
  let end: DatePart | null = null;
  if (match[4]) {
    const n = Number(match[4]);
    const dayOnly = start.day !== null && !match[5] && match[4].length <= 2;
    const monthOnly = !dayOnly && match[4].length <= 2 && n <= 12 && start.month !== null && !match[5];
    const endYear = dayOnly || monthOnly ? start.year : match[4].length === 4 ? n : match[4].length === 2 ? Math.floor(start.year / 100) * 100 + n : 0;
    end = part(endYear, dayOnly ? start.month : monthOnly ? n : match[5] ? Number(match[5]) : null, dayOnly ? n : match[6] ? Number(match[6]) : null);
    if (!end || Date.UTC(end.year, (end.month ?? 12) - 1, end.day ?? new Date(Date.UTC(end.year, end.month ?? 12, 0)).getUTCDate()) < Date.UTC(start.year, (start.month ?? 1) - 1, start.day ?? 1)) return null;
  }
  return { year: start.year, month: start.month, date: `${label(start)}${end ? `~${label(end)}` : ""}`, endYear: end?.year ?? null, endMonth: end?.month ?? null };
}

/** Only replace the hidden source date prefix; never rewrite the user's explanation. */
export function withTimelineDate(event: TimelineEvent, date: NonNullable<ReturnType<typeof parseTimelineDate>>): TimelineEvent {
  const { endY, endM, ...rest } = event;
  return { ...rest, ...date, ...(date.endYear ? { endY: date.endYear, ...(date.endMonth ? { endM: date.endMonth } : {}) } : {}), body: event.date && event.body.startsWith(`${event.date}\n`) ? `${date.date}\n${event.body.slice(event.date.length + 1)}` : event.body };
}
