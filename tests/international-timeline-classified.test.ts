import { describe, it, expect } from "vitest";
import source from "../client/src/data/international-timeline-classified-source.txt?raw";
import { CLASSIFIED_IMPORT, CLASSIFIED_REVISION, mergeClassifiedTimeline } from "../client/src/lib/international-timeline-classified";
import { mergeInsightTimeline } from "../client/src/lib/international-timeline-insights";
import { readTimelineDraft, deleteTimelineEvent } from "../client/src/lib/international-timeline-draft";
import { documentTimeline } from "../client/src/lib/international-timeline";
import { searchTimeline, timelineTypes } from "../client/src/lib/international-timeline-search";

const baseline = () => mergeInsightTimeline(readTimelineDraft(null));

describe("classified user source import", () => {
  it("includes all 139 regional entries and 8 bands, preserving exact source prose and types", () => {
    const text = source.replace(/\r\n/g, "\n");
    const regional = [...text.matchAll(/^\*\*\[(.*?) \| (.*?)\] (.*?) — (.*?)\*\*\n([^\n]*)/gm)];
    const bands = [...text.matchAll(/^- \*\*(\S+) (.*?)\*\*(?: — (.*))?$/gm)];
    expect(regional).toHaveLength(139);
    expect(bands).toHaveLength(8);
    expect(CLASSIFIED_IMPORT).toHaveLength(147);
    regional.forEach((match, i) => {
      const [, country, type, date, title, details] = match;
      expect(CLASSIFIED_IMPORT[i].event).toMatchObject({ country, type, date, title, scope: "regional", body: `${date}\n${title}${details ? `\n${details}` : ""}` });
    });
    bands.forEach((match, i) => {
      const [, date, title, details] = match;
      expect(CLASSIFIED_IMPORT[139 + i].event).toMatchObject({ date, title, scope: "global", body: `${date}\n${title}${details ? `\n${details}` : ""}` });
    });
  });

  it("uses unique reviewed identities, replaces even edited overlaps, and keeps unrelated records", () => {
    const old = baseline();
    const ids = new Set(old.events.map(e => e.id));
    const replaced = CLASSIFIED_IMPORT.flatMap(row => row.replaces);
    expect(new Set(replaced).size).toBe(replaced.length);
    replaced.forEach(id => expect(ids.has(id), id).toBe(true));
    const target = CLASSIFIED_IMPORT.find(row => row.event.title.includes("바르데포트 도입"))!;
    const custom = { ...old.events[0], id: "my-independent-note", title: "내 추가 사건", body: "직접 작성한 별개 기록" };
    old.events = old.events.map(e => e.id === target.event.id ? { ...e, date: "1972.8", month: 8, type: "flow", body: "수정한 구문", labels: ["독일"] } : e).concat(custom);
    const before = JSON.stringify(old);
    const next = mergeClassifiedTimeline(old);
    expect(JSON.stringify(old)).toBe(before);
    expect(next.events.find(e => e.id === target.event.id)).toEqual({ ...target.event, labels: ["독일"] });
    for (const event of old.events.filter(e => !replaced.includes(e.id))) expect(next.events).toContainEqual(event);
    expect(new Set(next.events.map(e => e.id)).size).toBe(next.events.length);
    expect(next.events.filter(e => e.year > 1985)).toEqual(old.events.filter(e => e.year > 1985));
    expect(next.events).toHaveLength(old.events.length - 109 + 147);
    expect(readTimelineDraft(JSON.stringify(next))).toEqual(next);
  });

  it("does not resurrect trash and preserves subsequent edits/deletions after saving and reopening", () => {
    const removed = CLASSIFIED_IMPORT[0].event.id;
    const old = deleteTimelineEvent(baseline(), removed);
    const next = mergeClassifiedTimeline(old);
    expect(next.events.some(e => e.id === removed)).toBe(false);
    expect(next.deleted).toEqual(old.deleted);
    expect(next.imports).toContain(CLASSIFIED_REVISION);
    const edited = { ...next, events: next.events.map(e => ({ ...e, body: "교체 이후 사용자 편집" })) };
    const saved = deleteTimelineEvent(edited, CLASSIFIED_IMPORT[2].event.id);
    expect(mergeClassifiedTimeline(readTimelineDraft(JSON.stringify(saved)))).toEqual(saved);
  });

  it("retains month/day ranges and half-year precision without inventing a month", () => {
    const next = mergeClassifiedTimeline(baseline());
    expect(CLASSIFIED_IMPORT[17].event).toMatchObject({ date: "1971.5.8~9", month: 5, endMonth: 5, endYear: 1971 });
    expect(CLASSIFIED_IMPORT[15].event).toMatchObject({ date: "1971.1~4", month: 1, endMonth: 4 });
    const half = documentTimeline(next.events).find(y => y.year === 1971)!.items.find(i => i.period === "하반기")!;
    expect(half.month).toBeNull();
    expect(half.events.map(e => e.lane).sort()).toEqual(["de", "uk"]);
  });

  it("supports all supplied types, shared European entries and always-visible bands", () => {
    const next = mergeClassifiedTimeline(baseline());
    expect(timelineTypes(next.events)).toEqual(["event", "policy", "stat"]);
    expect(CLASSIFIED_IMPORT.filter(row => row.event.lane === "eu")).toHaveLength(18);
    const bands = next.events.filter(e => e.scope === "global");
    for (const type of timelineTypes(next.events)) {
      const filtered = searchTimeline(next.events, `type:${type}`, ["us", "de", "fr", "uk", "jp"]);
      expect(filtered.filter(e => e.scope === "global")).toEqual(bands);
      expect(filtered.filter(e => e.scope !== "global").every(e => e.type === type)).toBe(true);
    }
  });
});
