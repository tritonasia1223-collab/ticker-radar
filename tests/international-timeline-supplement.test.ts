import { describe, it, expect } from "vitest";
import { mergeSupplementTimeline, SUPPLEMENT, SUPPLEMENT_REVISION } from "../client/src/lib/international-timeline-supplement";
import { mergeClassifiedTimeline } from "../client/src/lib/international-timeline-classified";
import { mergeInsightTimeline } from "../client/src/lib/international-timeline-insights";
import { readTimelineDraft, deleteTimelineEvent } from "../client/src/lib/international-timeline-draft";
import { plainText, parseRich } from "../client/src/lib/capitalism-richtext";
const baseline = () => mergeClassifiedTimeline(mergeInsightTimeline(readTimelineDraft(null)));

describe("reviewed insight supplement", () => {
  it("adds missing events once, validates dates and retains unrelated records", () => {
    const old = baseline(), original = JSON.stringify(old);
    const next = mergeSupplementTimeline(old);
    expect(next.events.length).toBe(old.events.length + SUPPLEMENT.additions.length);
    expect(JSON.stringify(old)).toBe(original);
    expect(readTimelineDraft(JSON.stringify(next))).toEqual(next);
    expect(new Set(next.events.map(e => e.id)).size).toBe(next.events.length);
    expect(next.imports).toContain(SUPPLEMENT_REVISION);
    expect(mergeSupplementTimeline(next)).toBe(next);
    for (const patch of SUPPLEMENT.amendments) {
      expect(old.events.find(e => e.id === patch.id)).toMatchObject({ title: patch.expectedTitle, body: patch.expectedBody });
      expect(next.events.find(e => e.id === patch.id)).toMatchObject({ title: patch.title, body: patch.body });
    }
    for (const event of old.events.filter(e => !SUPPLEMENT.amendments.some(p => p.id === e.id))) expect(next.events).toContainEqual(event);
  });
  it("preserves rich text, titles, custom records, dates, labels and arbitrary types", () => {
    const old = baseline(), [a,b,c] = SUPPLEMENT.amendments;
    old.events = old.events.map(e => e.id === a.id ? { ...e, body: e.body + '\n[[c-r|사용자 메모]]' }
      : e.id === b.id ? { ...e, title: '직접 바꾼 제목' }
      : e.id === c.id ? { ...e, labels: ['내 라벨'], type: 'flow', month: 8, date: '1979.8' } : e);
    const custom = { ...old.events[0], id: 'custom', body: '내 기록' };
    old.events.push(custom);
    const next = mergeSupplementTimeline(old);
    for (const id of [a.id,b.id,'custom']) expect(next.events.find(e=>e.id===id)).toEqual(old.events.find(e=>e.id===id));
    expect(next.events.find(e=>e.id===c.id)).toMatchObject({ labels:['내 라벨'],type:'flow',month:8,date:'1979.8' });
    expect(mergeSupplementTimeline({ ...next, events: next.events.map(e=>({...e,body:'이관 후 수정'})) }).events.every(e=>e.body==='이관 후 수정')).toBe(true);
  });
  it("never resurrects deleted entries or fills empty/custom collections", () => {
    const addition = SUPPLEMENT.additions[0].event;
    const old = deleteTimelineEvent(baseline(), SUPPLEMENT.amendments[0].id);
    old.deleted.push({ event: addition, deletedAt:'2026-11-19T00:00:00Z' });
    const next = mergeSupplementTimeline(old);
    expect(next.deleted).toEqual(old.deleted);
    for (const d of old.deleted) expect(next.events.some(e=>e.id===d.event.id)).toBe(false);
    const removed = deleteTimelineEvent(next, SUPPLEMENT.additions[1].event.id);
    expect(mergeSupplementTimeline(readTimelineDraft(JSON.stringify(removed)))).toEqual(removed);
    for (const events of [[],[{...addition,id:'custom'}]]) {
      const draft = { ...old, events };
      expect(mergeSupplementTimeline(draft)).toBe(draft);
    }
  });
  it("uses red increases and blue decreases without coloring dates or causal arrows", () => {
    const next = mergeSupplementTimeline(baseline());
    const event = (id:string) => next.events.find(e=>e.id===id)!;
    expect(event('mark-revision-20261118-10').body).toContain('5% → [[c-r|7%]]');
    expect(event('mark-revision-20261118-21').body).toContain('3.5% → [[c-b|3%]]');
    expect(event('insight-20261118-158').body).toContain('3.25% → [[c-b|3%]]');
    expect(event('mark-revision-20261118-36').body).not.toContain('주35시간');
    expect(event('supplement-20261119-fr-hours').body).toContain('40시간 → [[c-b|39시간]]');
    expect(plainText(event('mark-revision-20261118-10').body)).not.toContain('[[');
    expect(parseRich(event('mark-revision-20261118-10').body).find(s=>s.mark==='c-r')?.text).toBe('7%');
    for (const row of SUPPLEMENT.additions) expect(row.sources.length).toBeGreaterThan(0);
  });
});
