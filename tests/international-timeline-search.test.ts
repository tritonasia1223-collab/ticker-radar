import { describe, expect, it } from "vitest";
import { INITIAL_EVENTS, type TimelineEvent } from "../client/src/data/international-timeline";
import { INSIGHT_EVENTS } from "../client/src/data/international-timeline-insights";
import { SOURCE_REVISION_EVENTS } from "../client/src/data/international-timeline-revision";
import { US_SOURCE_EVENTS } from "../client/src/data/international-timeline-us";
import { readTimelineDraft, deleteTimelineEvent, restoreTimelineEvent } from "../client/src/lib/international-timeline-draft";
import { mergeInsightTimeline } from "../client/src/lib/international-timeline-insights";
import { searchTimeline, timelineTypes } from "../client/src/lib/international-timeline-search";

const make = (id: string, type: string, extra: Partial<TimelineEvent> = {}): TimelineEvent => ({ ...INITIAL_EVENTS[0], id, type, lane: "us", body: "금리 인하", ...extra });
const events = [make("event", "event"), make("policy", "policy"), make("stat", "stat"), make("flow", "flow"), make("german", "policy", { lane: "de" }), make("band", "event", { scope: "global", body: "세계 대사건" })];
const ids = (query: string) => searchTimeline(events, query, ["us"]).map(e => e.id);

describe("timeline type metadata and search", () => {
  it("defaults all shipped records to event without classifying their content", () => {
    for (const event of [...INITIAL_EVENTS, ...INSIGHT_EVENTS, ...SOURCE_REVISION_EVENTS, ...US_SOURCE_EVENTS]) expect(event.type).toBe("event");
  });
  it("backfills legacy live and deleted records and preserves custom types on round trips", () => {
    const { type, ...legacy } = make("legacy", "event");
    const draft = readTimelineDraft(JSON.stringify({ schemaVersion: 1, events: [legacy, make("future", "flow")], deleted: [{ event: { ...legacy, id: "deleted" }, deletedAt: "2026-11-19" }] }));
    expect(draft.events.map(e => e.type)).toEqual(["event", "flow"]);
    expect(draft.deleted[0].event.type).toBe("event");
    const restored = restoreTimelineEvent(readTimelineDraft(JSON.stringify(deleteTimelineEvent(draft, "future"))), "future");
    expect(restored.events.find(e => e.id === "future")?.type).toBe("flow");
  });
  it("rejects arrays without restricting valid strings to known types", () => {
    expect(() => readTimelineDraft(JSON.stringify({ schemaVersion: 1, events: [{ ...events[0], type: ["event", "policy"] }], deleted: [] }))).toThrow();
    expect(timelineTypes(events)).toEqual(["event", "flow", "policy", "stat"]);
  });
  it("combines text and country filters, always retaining major bands", () => {
    expect(ids("금리 type:policy")).toEqual(["policy", "band"]);
    expect(ids("type:stat")).toEqual(["stat", "band"]);
    expect(ids("type:event")).toEqual(["event", "band"]);
    expect(ids("type:policy 없는검색어")).toEqual(["band"]);
    expect(searchTimeline(events, "type:flow", []).map(e => e.id)).toEqual(["band"]);
  });
  it("supports future types and multiple type tokens without hardcoded checks", () => {
    expect(ids("type:flow")).toEqual(["flow", "band"]);
    expect(ids("TYPE:POLICY type:flow")).toEqual(["policy", "flow", "band"]);
    expect(ids("type:unknown")).toEqual(["band"]);
  });
  it("keeps explicit types through the existing insight import", () => {
    const draft = readTimelineDraft(null);
    draft.events = draft.events.map(e => ({ ...e, type: "flow" }));
    const merged = mergeInsightTimeline(draft);
    for (const event of draft.events) expect(merged.events.find(e => e.id === event.id)?.type).toBe("flow");
  });
});
