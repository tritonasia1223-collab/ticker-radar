import { describe, it, expect } from "vitest";
import { DATE_AUDIT, DATE_AUDIT_REVISION, mergeDateAuditTimeline } from "../client/src/lib/international-timeline-date-audit";
import { mergeSupplementTimeline } from "../client/src/lib/international-timeline-supplement";
import { mergeClassifiedTimeline } from "../client/src/lib/international-timeline-classified";
import { mergeInsightTimeline } from "../client/src/lib/international-timeline-insights";
import { readTimelineDraft, deleteTimelineEvent } from "../client/src/lib/international-timeline-draft";
import { sharedEventGroups } from "../client/src/lib/international-timeline-lanes";
const baseline = () => mergeSupplementTimeline(mergeClassifiedTimeline(mergeInsightTimeline(readTimelineDraft(null))));

describe("reviewed date separation", () => {
  it("applies all reviewed changes once and keeps unrelated events and global bands", () => {
    const old = baseline(), raw = JSON.stringify(old), next = mergeDateAuditTimeline(old);
    expect(JSON.stringify(old)).toBe(raw);
    expect(next.events).toHaveLength(old.events.length + 43);
    expect(readTimelineDraft(JSON.stringify(next))).toEqual(next);
    expect(next.imports).toContain(DATE_AUDIT_REVISION);
    expect(mergeDateAuditTimeline(next)).toBe(next);
    for (const rule of DATE_AUDIT) {
      expect(old.events.find(e => e.id === rule.id)).toEqual(rule.before);
      expect(next.events.find(e => e.id === rule.id)).toMatchObject(rule.patch);
      for (const child of rule.additions) expect(next.events).toContainEqual(child);
      for (const id of rule.existing) expect(next.events.find(e => e.id === id)).toEqual(old.events.find(e => e.id === id));
    }
    for (const event of old.events.filter(e => !DATE_AUDIT.some(r => r.id === e.id))) expect(next.events).toContainEqual(event);
  });
  it.each(["title", "body", "date", "year", "month", "lane", "country", "endY", "scope"] as const)("preserves a user-edited %s and does not spawn children from it", field => {
    const rule = DATE_AUDIT[0], old = baseline();
    const value = { title: "내 제목", body: "[[c-r|내 수정]]", date: "1975.1", year: 1975, month: 12, lane: "us", country: "미국", endY: 1980, scope: "global" }[field];
    old.events = old.events.map(e => e.id === rule.id ? { ...e, [field]: value } : e);
    const next = mergeDateAuditTimeline(old);
    expect(next.events.find(e => e.id === rule.id)).toEqual(old.events.find(e => e.id === rule.id));
    for (const child of rule.additions) expect(next.events.some(e => e.id === child.id)).toBe(false);
  });
  it("retains custom types and labels while separating untouched prose", () => {
    const old = baseline(), rule = DATE_AUDIT[0];
    old.events = old.events.map(e => e.id === rule.id ? { ...e, type: "flow", labels: ["내 라벨"] } : e);
    const next = mergeDateAuditTimeline(old);
    expect(next.events.find(e => e.id === rule.id)).toMatchObject({ type: "flow", labels: ["내 라벨"] });
    expect(next.events.find(e => e.id === rule.additions[0].id)?.labels).toEqual(["내 라벨"]);
    expect(next.events.find(e => e.id === "date-audit-20261120-ems-july-1985")).toMatchObject({ lane: "eu", country: "유럽", labels: [] });
  });
  it("does not resurrect deleted parents or children, duplicate existing children, or fill custom/empty collections", () => {
    const [a,b,c] = DATE_AUDIT;
    const old = deleteTimelineEvent(baseline(), a.id);
    old.deleted.push({ event: b.additions[0], deletedAt: "2026-11-20" });
    const customChild = { ...c.additions[0], title: "이미 편집한 자식" };
    old.events.push(customChild);
    const next = mergeDateAuditTimeline(old);
    expect(next.deleted).toEqual(old.deleted);
    for (const id of [a.id, ...a.additions.map(e => e.id), b.additions[0].id]) expect(next.events.some(e => e.id === id)).toBe(false);
    expect(next.events.filter(e => e.id === customChild.id)).toEqual([customChild]);
    for (const events of [[], [{ ...customChild, id: "custom" }]]) {
      const draft = { ...old, events };
      expect(mergeDateAuditTimeline(draft)).toBe(draft);
    }
  });
  it("retains numerical rich text and uses actual months for the example", () => {
    const events = mergeDateAuditTimeline(baseline()).events;
    expect(events.find(e => e.id === "supplement-20261119-fr-hours")?.body).toContain("[[c-b|39시간]]");
    expect(events.find(e => e.id === "date-audit-20261120-basel-liquidity")).toMatchObject({ year: 1974, month: 9 });
    expect(events.find(e => e.id === "classified-20261119-event-52")?.body).not.toContain("9월");
    expect(events.find(e => e.id === "date-audit-20261120-eu-market-1974")?.month).toBeNull();
  });
});

describe("independent shared entries", () => {
  it("groups the same participating lanes but keeps partial participation separate", () => {
    const base = DATE_AUDIT[0].before;
    const entries = [{ ...base, id: "one", lane: "eu" as const }, { ...base, id: "two", lane: "eu" as const }, { ...base, id: "pair", lane: undefined, country: "독일 프랑스" }];
    const groups = sharedEventGroups(entries, ["us", "de", "fr", "uk", "jp"]);
    expect(groups.map(g => g.events.map(e => e.id))).toEqual([["one", "two"], ["pair"]]);
    expect(groups[0]).toMatchObject({ start: 3, span: 3 });
    expect(sharedEventGroups(entries, ["us", "jp"])).toEqual([]);
    expect(sharedEventGroups(entries, ["de"])).toHaveLength(2);
  });
});
