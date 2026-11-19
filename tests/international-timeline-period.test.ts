import { describe, expect, it } from "vitest";
import { INITIAL_EVENTS, type TimelineEvent } from "../client/src/data/international-timeline";
import { periodEnd, periodExtent, periodDateLabel } from "../client/src/lib/international-timeline-period";
import { documentTimeline } from "../client/src/lib/international-timeline";
import { parseTimelineDate, withTimelineDate } from "../client/src/lib/international-timeline-date";
import { readTimelineDraft } from "../client/src/lib/international-timeline-draft";
const event = (id: string, year: number, month: number | null, extra: Partial<TimelineEvent> = {}): TimelineEvent => ({ ...INITIAL_EVENTS[0], id, year, month, date: `${year}${month ? `.${month}` : ""}`, lane: "us", scope: "regional", ...extra });
const rows = (events: TimelineEvent[]) => documentTimeline(events).flatMap(year => year.items);

describe("period metadata and rendered extent", () => {
  it("accepts new fields and legacy ends, leaving points unchanged", () => {
    const point = event("point", 1984, 5);
    expect(periodEnd(point)).toBeNull();
    expect(periodDateLabel(point)).toBe("");
    const legacy = { ...point, endYear: 1984, endMonth: 6 };
    const current = { ...point, id: "period", endY: 1984, endM: 6 };
    expect(periodEnd(current)).toEqual(periodEnd(legacy));
    expect(periodDateLabel(current)).toBe("1984.5~1984.6");
    expect(readTimelineDraft(JSON.stringify({ schemaVersion: 1, events: [point, current], deleted: [] })).events).toEqual([point, current]);
    expect(periodEnd({ ...legacy, endY: 1985, endM: 1 })).toEqual({ year: 1985, month: 1 });
    for (const invalid of [{ endY: 1983, endM: 6 }, { endY: 1984, endM: 13 }, { endY: 1984.5, endM: 6 }]) {
      expect(periodEnd({ ...point, ...invalid })).toBeNull();
      expect(() => readTimelineDraft(JSON.stringify({ schemaVersion: 1, events: [{ ...point, ...invalid }], deleted: [] }))).toThrow();
    }
  });
  it("ends at the existing end month without repeating the card", () => {
    const period = event("period", 1984, 5, { endY: 1984, endM: 6 });
    const slices = rows([period, event("june", 1984, 6), event("july", 1984, 7)]);
    expect(periodExtent(period, slices)).toEqual({ first: "1984-5", last: "1984-6", keys: ["1984-5", "1984-6"], missingEnd: false, endLabel: "~1984.6" });
    expect(slices.flatMap(row => row.events).filter(e => e.id === "period")).toHaveLength(1);
  });
  it("stops at the last rendered slice, not the next month or annual summary", () => {
    const period = event("period", 1981, 7, { endY: 1982, endM: 11 });
    const slices = rows([period, event("dec81", 1981, 12), event("oct82", 1982, 10), event("annual82", 1982, null), event("dec82", 1982, 12)]);
    expect(periodExtent(period, slices)).toMatchObject({ first: "1981-7", last: "1982-10", keys: ["1981-7", "1981-12", "1982-10"], missingEnd: true, endLabel: "~1982.11" });
    expect(periodExtent(period, rows([period]))).toMatchObject({ first: "1981-7", last: "1981-7", missingEnd: true });
    expect(periodExtent(period, [])).toBeNull();
  });
  it("recomputes from filtered slices, including a band at the endpoint", () => {
    const period = event("period", 1971, 5, { endY: 1971, endM: 8 });
    const end = event("band", 1971, 8, { scope: "global" });
    expect(periodExtent(period, rows([period, end]))).toMatchObject({ last: "global-band", missingEnd: false });
    expect(periodExtent(period, rows([period]))).toMatchObject({ last: "1971-5", missingEnd: true });
  });
  it("round trips day/month ranges and removes optional ends when changed to a point", () => {
    expect(parseTimelineDate("1971.5.8~9")).toMatchObject({ date: "1971.5.8~1971.5.9", endMonth: 5 });
    expect(parseTimelineDate("1982.8.12~20")).toMatchObject({ endYear: 1982, endMonth: 8 });
    expect(parseTimelineDate("1971.5.8~7")).toBeNull();
    const updated = withTimelineDate(event("period", 1984, 5), parseTimelineDate("1984.5~6")!);
    expect(updated).toMatchObject({ endY: 1984, endM: 6 });
    expect(periodDateLabel({ ...updated, date: "1984.5~6" })).toBe("1984.5~6");
    const point = withTimelineDate(updated, parseTimelineDate("1984.7")!);
    expect(point).not.toHaveProperty("endY");
    expect(point).not.toHaveProperty("endM");
    expect(periodEnd(point)).toBeNull();
  });
});
