import { REVISED_EVENTS, TIMELINE_REVISION } from "@/data/international-timeline-revision";
import { INITIAL_EVENTS, type Region, type TimelineEvent } from "@/data/international-timeline";

const NON_COUNTRIES = new Set(["국제 통화체제", "국제은행", "유럽", "유럽 공동체", "미분류"]);
export function countryTags(country: string): string[] {
  return [...new Set(country.split(/[·,]/).map(value => value.trim()).filter(value => value && !NON_COUNTRIES.has(value)))];
}
export function matchesCountry(event: Pick<TimelineEvent, "country">, selected: string[] | undefined): boolean {
  return selected === undefined || countryTags(event.country).some(tag => selected.includes(tag));
}
/** Add presentation metadata without replacing saved text or stable source IDs. */
export function normalizeEvent(event: TimelineEvent): TimelineEvent {
  const global = [6, 7, 8, 9].some(i => event.id === `source-20261117-${i}`);
  const period = event.endYear === undefined && event.id === "source-20261117-19" && event.year === 1976 && eventMonth(event) === 3
    ? { endYear: 1976, endMonth: 12 } : {};
  return { ...event, ...period, country: event.country === "국제 통화체제" ? "미국" : event.country, scope: event.scope ?? (global ? "global" : "regional"),
    groupId: event.groupId ?? ([7, 8, 9].some(i => event.id === `source-20261117-${i}`) ? "oil-shock-1973" : undefined) };
}
export function globalGroups(events: TimelineEvent[]): TimelineEvent[][] {
  const groups = new Map<string, TimelineEvent[]>();
  for (const event of events.filter(e => e.scope === "global")) {
    const key = `${event.groupId || event.id}:${event.year}:${eventMonth(event)}:${event.endYear ?? ""}:${event.endMonth ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  // The original European entry carries the shared oil-shock title; all source records remain editable.
  return [...groups.values()].map(group => [...group].sort((a, b) => Number(b.id === "source-20261117-8") - Number(a.id === "source-20261117-8")));
}
export function eventMonth(event: Pick<TimelineEvent, "month" | "date">): number | null {
  if (event.month !== undefined) return event.month;
  const match = event.date.trim().match(/^(\d{1,2})월/);
  const month = match ? Number(match[1]) : 0;
  return month >= 1 && month <= 12 ? month : null;
}
export function rangeLabel(event: TimelineEvent): string {
  if (!event.endYear) return "";
  return `${event.year}${eventMonth(event) ? `.${eventMonth(event)}` : ""}–${event.endYear}${event.endMonth ? `.${event.endMonth}` : ""}`;
}
export function validEnd(event: TimelineEvent): boolean {
  return !!event.endYear && event.endYear >= 1800 && event.endYear <= 2100 && Number.isInteger(event.endYear)
    && (event.endMonth == null || Number.isInteger(event.endMonth) && event.endMonth >= 1 && event.endMonth <= 12)
    && event.endYear * 12 + (event.endMonth ?? 12) >= event.year * 12 + (eventMonth(event) ?? 1);
}
export function timelineRows(events: TimelineEvent[]) {
  type Row = { key: string; year: number; month: number | null; endOnly?: boolean; events: TimelineEvent[]; ongoing: TimelineEvent[] };
  const rows = new Map<string, Row>();
  function row(year: number, month: number | null, endOnly = false) {
    const key = `${year}-${endOnly ? "end" : month ?? "unknown"}`;
    if (!rows.has(key)) rows.set(key, { key, year, month, endOnly, events: [], ongoing: [] });
    return rows.get(key)!;
  }
  for (const event of events) {
    row(event.year, eventMonth(event)).events.push(event);
    if (validEnd(event)) row(event.endYear!, event.endMonth ?? null, !event.endMonth);
  }
  const sorted = [...rows.values()].sort((a, b) => a.year - b.year || (a.endOnly ? 13 : a.month ?? 0) - (b.endOnly ? 13 : b.month ?? 0));
  for (const current of sorted) {
    current.ongoing = events.filter(e => validEnd(e) && !current.events.includes(e)
      && (current.month !== null || (current.year > e.year && current.year < e.endYear!) || (current.year === e.endYear && e.endMonth == null))
      && current.year * 12 + (current.month ?? 12) > e.year * 12 + (eventMonth(e) ?? 1)
      && current.year * 12 + (current.month ?? 12) <= e.endYear! * 12 + (e.endMonth ?? 12));
  }
  return sorted;
}


/** Shared time columns, fixed region bands, and separate lanes for overlapping periods. */
export function timelineLayout(events: TimelineEvent[], regions: Region[] = ["us", "europe", "japan"]) {
  const dates = timelineRows(events.filter(e => e.scope === "global" || regions.includes(e.region))).map((date, index) => ({ ...date, column: index + 2 }));
  const blocks = dates.flatMap(date => {
    const starters = [...globalGroups(date.events).map(group => ({ event: group[0], related: group.slice(1) })),
      ...date.events.filter(e => e.scope !== "global").map(event => ({ event, related: [] as TimelineEvent[] }))];
    return starters.map(block => {
      const endpoint = validEnd(block.event) ? dates.find(d => d.key === `${block.event.endYear}-${block.event.endMonth ?? "end"}`) : undefined;
      return { ...block, start: date.column, end: Math.max(date.column, endpoint?.column ?? date.column), lane: 0, row: 0 };
    });
  });
  let nextRow = 3;
  const bandIds = regions;
  const bands = bandIds.map(id => {
    // Keep dated entries above broad multi-year background periods.
    const ordered = blocks.filter(b => (b.event.scope === "global" ? "global" : b.event.region) === id)
      .sort((a, b) => (a.end - a.start) - (b.end - b.start) || a.start - b.start || a.event.id.localeCompare(b.event.id));
    const lanes: { start: number; end: number }[][] = [];
    for (const block of ordered) {
      let lane = lanes.findIndex(items => items.every(item => item.end < block.start || item.start > block.end));
      if (lane < 0) { lane = lanes.length; lanes.push([]); }
      lanes[lane].push(block);
      block.lane = lane;
      block.row = nextRow + lane;
    }
    const rowCount = Math.max(1, lanes.length);
    const band = { id, firstRow: nextRow, rowCount };
    nextRow += rowCount;
    return band;
  });
  const years: { year: number; start: number; end: number }[] = [];
  for (const date of dates) {
    const last = years.at(-1);
    if (last?.year === date.year) last.end = date.column;
    else years.push({ year: date.year, start: date.column, end: date.column });
  }
  return { dates, blocks, bands, years, rowCount: nextRow - 1 };
}

/** Apply the supplied revision once; subsequent local edits take precedence. */
export function mergeTimelineRevision(saved: TimelineEvent[] = []): TimelineEvent[] {
  const byId = new Map([...INITIAL_EVENTS, ...saved].map(event => [event.id, event]));
  for (const id of ["source-20261117-7", "source-20261117-9"]) byId.delete(id);
  for (const event of REVISED_EVENTS) {
    if (byId.get(event.id)?.revision !== TIMELINE_REVISION) byId.set(event.id, event);
  }
  return [...byId.values()].map(event => normalizeEvent(event.descriptionOnly ? event : {
    ...event, descriptionOnly: true,
    body: event.body.startsWith(event.title) ? event.body : [event.title, event.body].filter(Boolean).join("\n\n"),
  }));
}


/** A view adapter only: it never changes the underlying dates, descriptions or IDs. */
export function documentTimeline(events: TimelineEvent[]) {
  type Item = { key: string; year: number; month: number | null; kind: "slice" | "band"; events: TimelineEvent[]; order: number };
  const items: Item[] = globalGroups(events).map(group => ({ key: `global-${group[0].id}`, year: group[0].year, month: eventMonth(group[0]), kind: "band", events: group, order: group[0].year * 100 + (eventMonth(group[0]) ?? 13) - 0.5 }));
  const slices = new Map<string, Item>();
  for (const event of events.filter(e => e.scope !== "global")) {
    const month = eventMonth(event);
    const key = `${event.year}-${month ?? "annual"}`;
    if (!slices.has(key)) slices.set(key, { key, year: event.year, month, kind: "slice", events: [], order: event.year * 100 + (month ?? 13) });
    slices.get(key)!.events.push(event);
  }
  items.push(...slices.values());
  items.sort((a, b) => a.order - b.order);
  const years: { year: number; items: Item[]; count: number }[] = [];
  for (const item of items) {
    if (years.at(-1)?.year !== item.year) years.push({ year: item.year, items: [], count: 0 });
    years.at(-1)!.items.push(item);
    years.at(-1)!.count += item.events.length;
  }
  return years;
}

export function descriptionView(event: TimelineEvent) {
  // Move an exact source date prefix to the small date label; restore it on every edit.
  const prefix = event.date && event.body.startsWith(`${event.date}\n`) ? `${event.date}\n` : "";
  return { prefix, text: event.body.slice(prefix.length) };
}


/** Display/filter aliases only; original country metadata is never rewritten. */
export function europeanLabels(country: string): string[] {
  return [...new Set(countryTags(country).map(tag => tag === "서독" ? "독일" : tag).filter(tag => ["독일", "영국", "프랑스"].includes(tag)))];
}
