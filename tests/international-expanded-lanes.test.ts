import { describe, expect, it } from "vitest";
import { EXPANSION_EVENTS } from "../client/src/data/international-timeline-expansion";
import { INSIGHT_EVENTS } from "../client/src/data/international-timeline-insights";
import { COUNTRY_LANES, DEFAULT_TIMELINE_LANES, eventLanes, eventLaneSpan } from "../client/src/lib/international-timeline-lanes";
import { draftResources, resourcesDraft, documentEvent, eventDocument } from "../client/src/lib/international-timeline-storage";
import { readTimelineDraft } from "../client/src/lib/international-timeline-draft";
import { searchTimeline } from "../client/src/lib/international-timeline-search";
import { descriptionView, documentTimeline } from "../client/src/lib/international-timeline";
import { periodEnd } from "../client/src/lib/international-timeline-period";
import { internationalDocumentSchema } from "../shared/international-storage";
import { plainText } from "../client/src/lib/capitalism-richtext";

describe("Soviet and emerging-market lanes through 1992", () => {
  it("adds distinct source-backed records with concise text and no existing-ID replacement", () => {
    const old = new Set(INSIGHT_EVENTS.map(event => event.id));
    expect(new Set(EXPANSION_EVENTS.map(event => event.id)).size).toBe(EXPANSION_EVENTS.length);
    for (const event of EXPANSION_EVENTS) {
      expect(old.has(event.id)).toBe(false);
      expect(event.year).toBeGreaterThanOrEqual(1969);
      expect(event.year).toBeLessThanOrEqual(1992);
      expect(event.body.startsWith(event.date + "\n")).toBe(true);
      expect(descriptionView(event).text.split("\n")).toHaveLength(2);
      expect(plainText(event.title).length).toBeLessThanOrEqual(35);
      expect(event.scope).toBe("regional");
    }
    expect(EXPANSION_EVENTS.filter(event => event.lane === "soviet").length).toBeGreaterThan(30);
    expect(EXPANSION_EVENTS.filter(event => event.lane === "emerging").length).toBeGreaterThan(20);
  });

  it("keeps default ordering, year/month alignment and Europe's existing shared span", () => {
    expect(COUNTRY_LANES.filter(lane => DEFAULT_TIMELINE_LANES.includes(lane.id)).map(lane => lane.id)).toEqual(DEFAULT_TIMELINE_LANES);
    const european = INSIGHT_EVENTS.find(event => event.lane === "eu")!;
    expect(eventLaneSpan(european, DEFAULT_TIMELINE_LANES)).toEqual({ start: 3, span: 3 });
    const years = documentTimeline(EXPANSION_EVENTS);
    const y1991 = years.find(year => year.year === 1991)!;
    expect(y1991.items.some(slice => slice.month === 8 && slice.events.some(e => e.id.endsWith("coup")))).toBe(true);
    const period = EXPANSION_EVENTS.find(e => e.id.endsWith("1991-union"))!;
    expect(periodEnd(period)).toMatchObject({ year: 1991, month: 8 });
  });

  it("round-trips the Soviet lane through the unchanged legacy DB schema", () => {
    const source = EXPANSION_EVENTS.find(event => event.lane === "soviet")!;
    const doc = eventDocument(source);
    expect(internationalDocumentSchema.safeParse(doc).success).toBe(true);
    expect(doc!.position).toMatchObject({ region: "emerging", lane: "emerging" });
    expect(doc!.extra).toMatchObject({ laneHint: "soviet" });
    const resource = { key: `intl:${source.id}`, version: 1, doc };
    const returned = documentEvent(resource).event;
    expect(returned.lane).toBe("soviet");
    expect(eventDocument(returned)).toEqual(doc);
    expect(eventLanes({ ...returned, labels: [], country: "" })).toEqual(["soviet"]);
    expect(readTimelineDraft(JSON.stringify(resourcesDraft([resource]))).events[0].lane).toBe("soviet");
    // An older editor can preserve the metadata while changing only supported fields.
    const legacy = { ...doc!, body: "older editor", labels: [] };
    expect(documentEvent({ ...resource, doc: legacy }).event.lane).toBe("soviet");
  });

  it("keeps new lanes independent in type filters and never filters out major-event bands", () => {
    const band = { ...INSIGHT_EVENTS[0], scope: "global" as const, id: "context-band" };
    const found = searchTimeline([...EXPANSION_EVENTS, band], "type:policy", ["soviet"]);
    expect(found.some(event => event.id === band.id)).toBe(true);
    expect(found.filter(event => event.id !== band.id).every(event => event.lane === "soviet" && event.type === "policy")).toBe(true);
    const stored = draftResources({ schemaVersion: 1, events: EXPANSION_EVENTS, deleted: [] });
    expect(resourcesDraft(stored).events.map(eventLanes)).toEqual(EXPANSION_EVENTS.map(eventLanes));
  });
});
