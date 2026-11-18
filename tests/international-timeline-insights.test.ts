import { describe, it, expect } from "vitest";
import { INSIGHT_EVENTS, INSIGHT_TIMELINE_REVISION } from "../client/src/data/international-timeline-insights";
import { mergeInsightTimeline } from "../client/src/lib/international-timeline-insights";
import { COUNTRY_LANES, eventLanes, eventLaneSpan } from "../client/src/lib/international-timeline-lanes";
import { readTimelineDraft, deleteTimelineEvent, restoreTimelineEvent } from "../client/src/lib/international-timeline-draft";
import { mergeTimelineRevision, descriptionView, documentTimeline } from "../client/src/lib/international-timeline";
import { parseTimelineDate } from "../client/src/lib/international-timeline-date";

describe("insight table import", () => {
  it("covers every country and source year with compact, valid records and explicit old IDs", () => {
    const baseline = new Set(mergeTimelineRevision().map(e => e.id));
    expect(new Set(INSIGHT_EVENTS.map(e => e.id)).size).toBe(INSIGHT_EVENTS.length);
    for (const e of INSIGHT_EVENTS) {
      expect(parseTimelineDate(e.date)).not.toBeNull();
      expect(e.title.length).toBeLessThanOrEqual(35);
      expect(descriptionView(e).text.split("\n")).toHaveLength(2);
      if (!e.id.startsWith("insight-")) expect(baseline.has(e.id), e.id).toBe(true);
    }
    for (let year = 1969; year <= 1992; year++) {
      for (const lane of COUNTRY_LANES.slice(0, 5)) expect(INSIGHT_EVENTS.some(e => e.year === year && e.lane === lane.id), `${year} ${lane.name}`).toBe(true);
    }
  });

  it("updates only untouched source fields, preserves additions and never mutates the input", () => {
    const draft = readTimelineDraft(null);
    const base = draft.events.find(e => e.id.endsWith("-03"))!;
    const edited = { ...base, body: `${base.date}\n[[c-r|내 제목]]\n내 설명`, labels: [] };
    const custom = { ...base, id: "my-event", body: "나만의 기록" };
    const saved = { ...draft, events: draft.events.map(e => e.id === base.id ? edited : e).concat(custom) };
    const before = JSON.stringify(saved);
    const next = mergeInsightTimeline(saved);
    expect(JSON.stringify(saved)).toBe(before);
    expect(next.events.find(e => e.id === base.id)).toMatchObject({ body: edited.body, date: edited.date, labels: [] });
    expect(next.events.find(e => e.id === custom.id)).toEqual(custom);
    expect(next.events.find(e => e.id === "mark-revision-20261118-00")?.title).toBe("대형 CD 금리 상한 정지");
    expect(new Set(next.events.map(e => e.id)).size).toBe(next.events.length);
  });

  it("keeps an edited date while enriching untouched text and honors deleted IDs", () => {
    let draft = readTimelineDraft(null);
    const id = "mark-revision-20261118-03";
    draft = { ...draft, events: draft.events.map(e => e.id === id ? { ...e, year: 1972, month: 6, date: "1972.6" } : e) };
    draft = deleteTimelineEvent(draft, "mark-revision-20261118-09");
    const next = mergeInsightTimeline(draft);
    expect(next.events.find(e => e.id === id)).toMatchObject({ year: 1972, month: 6, date: "1972.6", body: expect.stringMatching(/^1972\.6\n/) });
    expect(next.events.some(e => e.id === "mark-revision-20261118-09")).toBe(false);
    expect(next.deleted).toEqual(draft.deleted);
    const restored = restoreTimelineEvent(next, "mark-revision-20261118-09");
    expect(restored.events.find(e => e.id.endsWith("-09"))).toEqual(draft.deleted[0].event);
  });

  it("runs once across reloads and does not reinsert deleted new entries or empty collections", () => {
    const next = mergeInsightTimeline(readTimelineDraft(null));
    expect(next.imports).toContain(INSIGHT_TIMELINE_REVISION);
    expect(mergeInsightTimeline(readTimelineDraft(JSON.stringify(next)))).toEqual(next);
    const deleted = deleteTimelineEvent(next, INSIGHT_EVENTS[0].id);
    expect(mergeInsightTimeline(readTimelineDraft(JSON.stringify(deleted)))).toEqual(deleted);
    const empty = { ...next, events: [] };
    expect(mergeInsightTimeline(empty)).toEqual(empty);
    expect(mergeInsightTimeline({ schemaVersion: 1, events: [], deleted: [] }).events).toEqual([]);
  });
});

describe("country columns", () => {
  it("places historical countries independently of label overrides", () => {
    const base = readTimelineDraft(null).events[0];
    expect(eventLanes({ ...base, region: "europe", country: "서독", labels: ["영국"] })).toEqual(["de"]);
    expect(eventLanes({ ...base, region: "europe", country: "프랑스", labels: [] })).toEqual(["fr"]);
    expect(eventLanes({ ...base, region: "europe", country: "독일 · 프랑스" })).toEqual(["de", "fr"]);
    expect(eventLanes({ ...base, region: "europe", country: "이탈리아" })).toEqual(["de", "fr", "uk"]);
    expect(eventLanes({ ...base, region: "europe", country: "", lane: "uk", labels: [] })).toEqual(["uk"]);
  });
  it("spans shared events once, reflows filtered columns and retains monthly alignment", () => {
    const snake = INSIGHT_EVENTS.find(e => e.id === "mark-revision-20261118-05")!;
    expect(eventLaneSpan(snake, ["us", "de", "fr", "uk", "jp"])).toEqual({ start: 3, span: 3 });
    expect(eventLaneSpan(snake, ["us", "fr", "jp"])).toEqual({ start: 3, span: 1 });
    expect(eventLaneSpan(snake, ["us", "jp"])).toBeNull();
    const next = mergeInsightTimeline(readTimelineDraft(null));
    const year = documentTimeline(next.events).find(y => y.year === 1971)!;
    const may = year.items.find(i => i.kind === "slice" && i.month === 5)!;
    expect(may.events.some(e => e.lane === "de")).toBe(true);
    expect(may.events.some(e => e.lane === "fr")).toBe(true);
    expect(may.events.some(e => e.lane === "jp")).toBe(true);
  });
});
