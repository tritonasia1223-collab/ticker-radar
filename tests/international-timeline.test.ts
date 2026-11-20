import { mergeUsTimeline } from "../client/src/lib/international-timeline-us";
import { readTimelineDraft, deleteTimelineEvent, restoreTimelineEvent } from "../client/src/lib/international-timeline-draft";
import { eventLabels } from "../client/src/lib/international-timeline";
import { bandText } from "../client/src/lib/international-timeline";
import { parseTimelineDate, withTimelineDate } from "../client/src/lib/international-timeline-date";
import { US_SOURCE_EVENTS, US_TIMELINE_REVISION } from "../client/src/data/international-timeline-us";
import { applyPointEventRevision, POINT_EVENT_REVISION } from "../client/src/lib/international-timeline-point-events";
import { formatTimelineSource } from "../client/src/lib/international-timeline-format";
import { readFileSync } from "node:fs";
import { REVISED_EVENTS, SOURCE_REVISION_EVENTS, TIMELINE_REVISION } from "../client/src/data/international-timeline-revision";
import { mergeTimelineRevision, documentTimeline, descriptionView, europeanLabels } from "../client/src/lib/international-timeline";
const revisionSource = readFileSync(new URL("../client/src/data/international-timeline-mark-revision.txt", import.meta.url), "utf8");
import { describe, expect, it } from "vitest";
import { INITIAL_EVENTS } from "../client/src/data/international-timeline";
import { countryTags, matchesCountry, eventMonth, timelineRows, normalizeEvent, globalGroups, validEnd, rangeLabel, timelineLayout } from "../client/src/lib/international-timeline";

describe("country event filters", () => {
  it("shows French and shared Franco-German events but excludes British events", () => {
    const events = INITIAL_EVENTS.filter(e => e.region === "europe" && matchesCountry(e, ["프랑스"]));
    expect(events.map(e => e.title)).toEqual(["노동자 모집 중단에서 가족 정착으로", "스네이크 이탈"]);
    expect(matchesCountry({ country: "영국" }, ["프랑스"])).toBe(false);
    expect(matchesCountry({ country: "유럽" }, ["프랑스"])).toBe(false);
  });
  it("supports all, none, multiple countries, and uncategorized events", () => {
    expect(matchesCountry({ country: "영국" }, undefined)).toBe(true);
    expect(matchesCountry({ country: "영국" }, [])).toBe(false);
    expect(matchesCountry({ country: "영국" }, ["프랑스", "영국"])).toBe(true);
    expect(countryTags("서독 · 프랑스")).toEqual(["서독", "프랑스"]);
    expect(countryTags("서독 · 국제은행 · 유럽")).toEqual(["서독"]);
    expect(countryTags("국제 통화체제")).toEqual([]);
  });
});

describe("international timeline month alignment", () => {
  it("groups the three October 1973 oil-shock entries on one shared row", () => {
    const row = timelineRows(INITIAL_EVENTS).find(r => r.key === "1973-10")!;
    expect(row.events.map(e => e.region)).toEqual(["us", "europe", "japan"]);
    expect(row.events.every(e => e.title.includes("오일쇼크"))).toBe(true);
  });
  it("keeps unknown dates separate and preserves period start semantics", () => {
    expect(eventMonth({ date: "연중" })).toBeNull();
    expect(eventMonth({ date: "이후" })).toBeNull();
    expect(eventMonth({ date: "13월" })).toBeNull();
    expect(eventMonth({ date: "4월 · 7월" })).toBe(4);
    expect(eventMonth({ date: "9월 → 1977년" })).toBe(9);
    expect(eventMonth({ date: "10월", month: null })).toBeNull();
    expect(eventMonth({ date: "10월", month: 6 })).toBe(6);
  });
  it("omits empty months, orders dates, and keeps every source event exactly once", () => {
    const rows = timelineRows([...INITIAL_EVENTS].reverse());
    expect(rows.slice(0, 2).map(r => r.key)).toEqual(["1970-6", "1970-7"]);
    expect(rows.some(r => r.key === "1970-1")).toBe(false);
    const ids = rows.flatMap(r => r.events.map(e => e.id));
    expect(new Set(ids).size).toBe(INITIAL_EVENTS.length);
    expect(ids.length).toBe(INITIAL_EVENTS.length);
  });
});


describe("global events and calendar periods", () => {
  it("merges oil-shock presentation without losing any saved text or source IDs", () => {
    const originals = INITIAL_EVENTS.slice(7, 10).map(e => ({ ...e, body: `사용자 수정 ${e.id}` }));
    const events = originals.map(normalizeEvent);
    const groups = globalGroups(events);
    expect(groups).toHaveLength(1);
    expect(groups[0][0].title).toBe("1차 오일쇼크");
    expect(new Set(groups.flat().map(e => e.id))).toEqual(new Set(originals.map(e => e.id)));
    expect(groups.flat().every(e => e.body === `사용자 수정 ${e.id}`)).toBe(true);
    expect(normalizeEvent({ ...events[0], scope: "regional" }).scope).toBe("regional");
    expect(globalGroups([events[0], { ...events[1], month: 9 }])).toHaveLength(2);
  });
  it("adds an endpoint and tracks overlap without duplicating source events", () => {
    const event = { ...INITIAL_EVENTS[19], endYear: 1977, endMonth: 2 };
    const other = { ...INITIAL_EVENTS[0], year: 1976, month: 6 };
    const rows = timelineRows([event, other]);
    expect(rows.map(r => r.key)).toEqual(["1976-3", "1976-6", "1977-2"]);
    expect(rows[0].ongoing).toHaveLength(0);
    expect(rows[1].ongoing).toEqual([event]);
    expect(rows[2].ongoing).toEqual([event]);
    expect(rows.flatMap(r => r.events)).toHaveLength(2);
    expect(rangeLabel(event)).toBe("1976.3–1977.2");
    expect(validEnd({ ...event, endYear: 1975 })).toBe(false);
    expect(validEnd({ ...event, endMonth: 13 })).toBe(false);
  });
  it("does not infer an exact month or overwrite a cleared period", () => {
    expect(normalizeEvent(INITIAL_EVENTS[19]).endMonth).toBe(12);
    expect(normalizeEvent({ ...INITIAL_EVENTS[19], endYear: null }).endYear).toBeNull();
    const event = { ...INITIAL_EVENTS[19], endYear: 1977, endMonth: null };
    expect(rangeLabel(event)).toBe("1976.3–1977");
    expect(timelineRows([event]).at(-1)?.key).toBe("1977-end");
    const unknown = { ...INITIAL_EVENTS[0], year: 1976, month: null };
    expect(timelineRows([event, unknown]).find(r => r.key === "1976-unknown")?.ongoing).toEqual([]);
  });
});


describe("calendar block layout", () => {
  it("uses one horizontal span across years and stacks overlapping events", () => {
    const period = { ...INITIAL_EVENTS[19], endYear: 1977, endMonth: 12 };
    const point = INITIAL_EVENTS[21];
    const board = timelineLayout([period, point]);
    const range = board.blocks.find(b => b.event.id === period.id)!;
    const single = board.blocks.find(b => b.event.id === point.id)!;
    expect(range.end).toBe(single.start);
    expect(range.start).toBeLessThan(board.dates.find(d => d.year === 1977)!.column);
    expect(range.lane).not.toBe(single.lane);
    expect(range.row).not.toBe(single.row);
    expect(board.bands.find(b => b.id === "europe")?.rowCount).toBe(2);
    expect(board.blocks).toHaveLength(2);
  });
  it("aligns regions on the same month column and reuses a row for non-overlapping events", () => {
    const events = [INITIAL_EVENTS[0], { ...INITIAL_EVENTS[1], month: 6 }, INITIAL_EVENTS[2]];
    const blocks = timelineLayout(events).blocks;
    expect(blocks[0].start).toBe(blocks[1].start);
    expect(blocks[0].row).not.toBe(blocks[1].row);
    expect(blocks[1].row).toBe(blocks[2].row);
  });
  it("places an unknown end month after known months in the end year", () => {
    const period = { ...INITIAL_EVENTS[19], endYear: 1976, endMonth: null };
    const board = timelineLayout([period]);
    expect(board.dates.map(d => d.key)).toEqual(["1976-3", "1976-end"]);
    expect(board.blocks[0].end).toBeGreaterThan(board.blocks[0].start);
    expect(rangeLabel(period)).toBe("1976.3–1976");
  });
  it("keeps international events out of regional lanes without losing grouped descriptions", () => {
    const events = INITIAL_EVENTS.slice(6, 10).map(e => normalizeEvent({ ...e, endYear: 1974, endMonth: 1 }));
    const blocks = timelineLayout(events).blocks;
    expect(blocks).toHaveLength(2);
    expect(blocks.every(block => block.row === 0)).toBe(true);
    expect(timelineLayout(events).bands.map(band => band.id)).toEqual(["us", "europe", "japan"]);
    expect(blocks.reduce((count, b) => count + 1 + b.related.length, 0)).toBe(4);
  });
});


it("groups year headers and preserves requested region row order", () => {
  const board = timelineLayout(INITIAL_EVENTS.filter(e => ["japan", "us", "europe"].includes(e.region)).map(normalizeEvent), ["japan", "us", "europe"]);
  expect(board.bands.map(b => b.id)).toEqual(["japan", "us", "europe"]);
  expect(board.years[0]).toEqual({ year: 1970, start: 2, end: 3 });
  for (const block of board.blocks) {
    const band = board.bands.find(b => b.id === (block.event.scope === "global" ? "global" : block.event.region));
    if (band) expect(block.row >= band.firstRow && block.row < band.firstRow + band.rowCount).toBe(true);
  }
});


it("does not allocate a common row as visible regions increase", () => {
  const events = INITIAL_EVENTS.map(normalizeEvent);
  const three = timelineLayout(events);
  const five = timelineLayout(events, ["us", "europe", "japan", "emerging", "oil"]);
  expect(three.bands).toHaveLength(3);
  expect(five.bands).toHaveLength(5);
  expect(three.rowCount).toBe(5); // Two axis rows and three region rows.
  expect(five.rowCount).toBe(7);
  expect(three.blocks.filter(block => block.event.scope === "global")).toHaveLength(2);
});


describe("supplied 1970–1990 revision", () => {
  it("imports exactly the 80 replacement entries, retaining all wording in headings and details", () => {
    const entries = [...revisionSource.matchAll(/^\*\*([^*]+)\*\*\s*(.+)$/gm)];
    expect(REVISED_EVENTS).toHaveLength(80);
    expect(entries).toHaveLength(80);
    entries.forEach((entry, index) => {
      const date = entry[1].replace(" (일본)", "");
      const body = entry[2].trim();
      expect(SOURCE_REVISION_EVENTS[index].body).toBe(`${date}\n${formatTimelineSource(body)}`);
      // Moving annotations may change order/spacing, never lose words or numeric data.
      const characters = (text: string) => [...text.replace(/[\s*—ㅡ]/g, "")].sort().join("");
      expect(characters(descriptionView(SOURCE_REVISION_EVENTS[index]).text)).toBe(characters(body));
      if (entry[1].includes("(일본)")) expect(REVISED_EVENTS[index].region).toBe("japan");
    });
  });
  it("replaces the entire previous collection once, including old-only and custom notes", () => {
    const saved = [...INITIAL_EVENTS, { ...INITIAL_EVENTS[0], id: "old-custom", body: "이전 사용자 메모" }];
    const original = JSON.stringify(saved);
    const merged = mergeTimelineRevision(saved);
    expect(merged).toEqual(mergeUsTimeline(REVISED_EVENTS));
    expect(merged).toHaveLength(98);
    expect(new Set(merged.map(e => e.id)).size).toBe(98);
    expect(merged.every(e => e.revision === TIMELINE_REVISION)).toBe(true);
    expect(JSON.stringify(saved)).toBe(original); // Still available for browser backup.
    expect(merged.some(e => e.id.startsWith("source-") || e.id === "old-custom")).toBe(false);
  });
  it("preserves new additions and subsequent deletions after applying the replacement", () => {
    const current = mergeTimelineRevision().slice(1);
    current.push({ ...INITIAL_EVENTS[0], id: "new-custom", body: "새 메모" });
    expect(mergeTimelineRevision(current)).toEqual(current);
  });
  it("keeps subsequent inline edits intact on reload", () => {
    const edited = mergeTimelineRevision().map((e, index) => index === 0 ? { ...e, body: "직접 수정한 설명" } : e);
    expect(mergeTimelineRevision(edited)).toEqual(edited);
  });
});

it("keeps dated entries above long periods without overlapping blocks in a lane", () => {
  const board = timelineLayout(mergeTimelineRevision());
  const europe = board.blocks.filter(b => b.event.region === "europe" && b.event.scope !== "global");
  for (const block of europe) {
    expect(europe.filter(other => other !== block && other.lane === block.lane && other.start <= block.end && other.end >= block.start)).toHaveLength(0);
  }
  const point = europe.find(b => b.event.date === "1986.3");
  expect(point?.lane).toBe(0);
});


describe("document timeline adapter", () => {
  it("retains every record once, without importing sample events or changing source text", () => {
    const events = mergeTimelineRevision();
    const original = JSON.stringify(events);
    const years = documentTimeline(events);
    const shown = years.flatMap(y => y.items.flatMap(i => i.events));
    expect(shown).toHaveLength(events.length);
    expect(new Set(shown.map(e => e.id)).size).toBe(events.length);
    expect(JSON.stringify(events)).toBe(original);
    expect(years.map(y => y.year)).toEqual(Array.from({ length: 21 }, (_, i) => i + 1970));
  });
  it("aligns same-month countries and places a global band before that month", () => {
    const base = INITIAL_EVENTS[0];
    const items = documentTimeline([
      { ...base, id: "us", month: 6, scope: "regional" },
      { ...base, id: "eu", month: 6, region: "europe", scope: "regional" },
      { ...base, id: "global", month: 6, scope: "global" },
      { ...base, id: "annual", month: null, scope: "regional" },
    ])[0].items;
    expect(items.map(i => i.kind)).toEqual(["slice", "band", "slice"]);
    expect(items[2].events.map(e => e.id)).toEqual(["us", "eu"]);
    expect(items[0].month).toBeNull();
  });
  it("moves only the exact date prefix into the view, preserving rich text on round trip", () => {
    for (const event of mergeTimelineRevision()) {
      const view = descriptionView(event);
      expect(view.prefix + view.text).toBe(event.body);
    }
    const edited = { ...REVISED_EVENTS[0], body: "[[c-r|사용자 수정]]\n다른 설명" };
    expect(descriptionView(edited)).toEqual({ prefix: "", text: edited.body });
  });
});


describe("European display labels", () => {
  it("keeps only Germany, Britain and France, treating West Germany as Germany", () => {
    expect(europeanLabels("서독 · 프랑스 · 이탈리아")).toEqual(["독일", "프랑스"]);
    expect(europeanLabels("독일 · 서독 · 영국")).toEqual(["독일", "영국"]);
    expect(europeanLabels("EC 공동 · 유럽 · 통계")).toEqual([]);
  });
  it("does not rewrite the metadata or drop unlabelled European events", () => {
    const events = mergeTimelineRevision();
    const before = JSON.stringify(events);
    events.forEach(e => europeanLabels(e.country));
    expect(JSON.stringify(events)).toBe(before);
    expect(events).toHaveLength(98);
  });
});


describe("source title and small-print formatting", () => {
  it("moves dash explanations below the headline and keeps arrows in the headline", () => {
    expect(formatTimelineSource("정책 전환 → 효과 ㅡ 부연 설명")).toBe("정책 전환 → 효과\n부연 설명");
    expect(formatTimelineSource("핫머니 유입 — 달러 매입(마르크 공급) → 인플레")).toBe("핫머니 유입\n달러 매입(마르크 공급) → 인플레");
  });
  it("moves heading parentheses below without breaking the rest of the sentence", () => {
    expect(formatTimelineSource("외국인 쿠폰세(25%) 폐지")).toBe("외국인 쿠폰세 폐지\n(25%)");
    expect(formatTimelineSource("바르데포트 도입(40%) — 무이자 예치")).toBe("바르데포트 도입\n(40%)\n무이자 예치");
  });
  it("preserves nested parentheses, internal dashes, and uncertainty notes", () => {
    expect(formatTimelineSource("생산 정점 (266만 배럴 — 수출 2할)")).toBe("생산 정점\n(266만 배럴 — 수출 2할)");
    expect(formatTimelineSource("정책(범위(세부)) 전환 *(출전 확인 필요)*")).toBe("정책 전환\n(범위(세부))\n(출전 확인 필요)");
    expect(formatTimelineSource("열린 괄호(확인 필요")).toBe("열린 괄호(확인 필요");
  });
  it("keeps unspecified months unspecified and retains exact source ranges", () => {
    expect(REVISED_EVENTS.find(e => e.date === "1980말~81초")?.month).toBeNull();
    expect(REVISED_EVENTS.find(e => e.date === "1973 하반기")?.month).toBeNull();
    expect(REVISED_EVENTS.find(e => e.date === "1986.10.27")?.month).toBe(10);
    expect(REVISED_EVENTS.filter(e => e.scope === "global")).toHaveLength(6);
  });
});


describe("dated major events", () => {
  it("anchors the two broad periods to documented decisions, retaining later effects as details", () => {
    const oil = REVISED_EVENTS.find(e => e.sourceIndex === 12)!;
    const volcker = REVISED_EVENTS.find(e => e.sourceIndex === 29)!;
    expect([oil.date, volcker.date]).toEqual(["1973.10.17", "1979.10.6"]);
    expect([oil.title, volcker.title]).toEqual(["1차 오일쇼크 · OAPEC 감산 결정", "볼커 긴축 전환"]);
    for (const event of [oil, volcker]) {
      expect(event.month).toBe(10);
      expect(event.endYear).toBeNull();
      expect(event.endMonth).toBeNull();
      expect(event.pointRevision).toBe(POINT_EVENT_REVISION);
    }
    expect(oil.body).toContain("이후 영향 (1973~75)");
    expect(volcker.body).toContain("이후 유럽 3국의 상황 (1979~82)");
    expect(REVISED_EVENTS.filter(e => e.scope === "global" && e.endYear != null)).toHaveLength(0);
  });
  it("migrates only these two saved entries without losing edited details or unrelated edits", () => {
    const old = SOURCE_REVISION_EVENTS.map(e => ({ ...e, body: e.body + "\n[[c-r|직접 추가한 메모]]" }));
    const before = JSON.stringify(old);
    const migrated = old.map(applyPointEventRevision);
    expect(migrated).toHaveLength(old.length);
    expect(migrated.filter((e, i) => JSON.stringify(e) !== JSON.stringify(old[i]))).toHaveLength(2);
    expect(migrated.every(e => e.body.includes("[[c-r|직접 추가한 메모]]"))).toBe(true);
    expect(JSON.stringify(old)).toBe(before);
    const edited = migrated.map(e => ({ ...e, body: e.body + "\n후속 편집" }));
    expect(edited.map(applyPointEventRevision)).toEqual(edited);
    expect(applyPointEventRevision(edited[12])).toEqual(edited[12]);
  });
  it("places the oil shock after June and the Fed decision in October", () => {
    const years = documentTimeline(REVISED_EVENTS);
    const items = years.find(y => y.year === 1973)!.items;
    expect(items.findIndex(i => i.month === 10)).toBeGreaterThan(items.findIndex(i => i.month === 6));
    const volcker = years.find(y => y.year === 1979)!.items.find(i => i.events.some(e => e.sourceIndex === 29))!;
    expect(volcker.month).toBe(10);
    expect(volcker.kind).toBe("band");
  });
});

it("preserves formatting that spans the old heading and explanatory text", () => {
  const old = { ...SOURCE_REVISION_EVENTS[12], body: "1973~75\n[[c-r|오일쇼크 여파\n직접 표시한 설명]]" };
  const next = applyPointEventRevision(old);
  expect(next.body).toContain("[[c-r|직접 표시한 설명]]");
  expect(next.body).not.toContain("오일쇼크 여파");
});

describe("incremental US source import", () => {
  it("keeps all 25 supplied entries, splitting Black Monday into a dated band", () => {
    const source = readFileSync(new URL("../client/src/data/international-timeline-us-source.txt", import.meta.url), "utf8");
    const entries = [...source.matchAll(/^\*\*([^*]+)\*\*\s*(.+)$/gm)];
    expect(entries).toHaveLength(25);
    expect(US_SOURCE_EVENTS).toHaveLength(26);
    entries.forEach((entry, index) => {
      const events = index === 23 ? US_SOURCE_EVENTS.slice(23, 25) : [US_SOURCE_EVENTS[index > 23 ? index + 1 : index]];
      const original = entry[2].replace(/🔴\s*/g, "").replace(/\s*\(대사건\)/g, "").replace(/\(대사건, G5\)/g, "(G5)").replace(" → 10.19 ", "");
      const characters = (value: string) => [...value.replace(/[\s—ㅡ]/g, "")].sort().join("");
      expect(characters(events.map(e => descriptionView(e).text).join(""))).toBe(characters(original));
    });
    const merged = mergeTimelineRevision();
    expect(merged).toHaveLength(98);
    expect(new Set(merged.map(e => e.id)).size).toBe(98);
    expect(merged.filter(e => e.scope === "global")).toHaveLength(9);
    expect(merged.filter(e => e.region === "us" && e.scope !== "global")).toHaveLength(18);
    expect(merged.filter(e => e.region === "japan")).toHaveLength(19);
    for (const [date, title] of [["1971.8.15", "닉슨 쇼크"], ["1980.9.22", "이란-이라크 전쟁 발발"], ["1987.10.19", "블랙 먼데이"]]) {
      expect(merged.filter(e => e.scope === "global" && e.date === date)).toHaveLength(1);
      expect(merged.find(e => e.date === date)?.title).toBe(title);
    }
    expect(merged.find(e => e.id.endsWith("-49"))?.date).toBe("1985.9.22");
    expect(merged.find(e => e.id.endsWith("-57"))?.date).toBe("1987.2.22");
    expect(merged.filter(e => e.title.includes("엔달러위원회"))).toHaveLength(1);
    expect(merged.find(e => e.title.includes("엔달러위원회"))?.region).toBe("japan");
  });

  it("preserves existing rich edits, custom records and deleted entries during migration", () => {
    const saved = REVISED_EVENTS.filter(e => e.sourceIndex !== 23).map(e => ({ ...e, body: `${e.body}\n[[c-r|직접 수정\n여러 줄]]` }));
    saved.push({ ...saved[0], id: "custom", body: "사용자 추가 사건" });
    const before = JSON.stringify(saved);
    const merged = mergeTimelineRevision(saved);
    for (const event of saved) {
      const updated = merged.find(e => e.id === event.id)!;
      expect(updated.body).toContain(descriptionView(event).text);
      if (event.region === "europe" && event.scope !== "global") expect(updated.body).toBe(event.body);
      if (event.region === "japan" && event.sourceIndex !== 42) expect(updated.body).toBe(event.body);
    }
    expect(merged.some(e => e.sourceIndex === 23)).toBe(false);
    expect(JSON.stringify(saved)).toBe(before);
    const later = merged.filter(e => e.id !== "us-source-20261118-2").map(e => ({ ...e, body: e.body + "\n후속 수정" }));
    expect(mergeTimelineRevision(later)).toEqual(later);
    expect(later.every(e => e.usRevision === US_TIMELINE_REVISION)).toBe(true);
  });

  it("retains user dates and source ranges without inventing months or altering 401(k)", () => {
    const changed = REVISED_EVENTS.map(e => e.sourceIndex === 49 ? { ...e, date: "1985.9.23", body: "사용자가 날짜와 본문 수정" } : e);
    expect(mergeUsTimeline(changed).find(e => e.sourceIndex === 49)?.date).toBe("1985.9.23");
    expect(formatTimelineSource("401(k) 조항 신설 (1978) — 설명")).toBe("401(k) 조항 신설\n(1978)\n설명");
    const range = US_SOURCE_EVENTS.find(e => e.date === "1981.7~82.11")!;
    expect([range.year, range.month, range.endYear, range.endMonth]).toEqual([1981, 7, 1982, 11]);
    expect(US_SOURCE_EVENTS.find(e => e.title.includes("MMF"))?.month).toBeNull();
    expect(US_SOURCE_EVENTS.find(e => e.title.includes("401(k)"))?.month).toBeNull();
  });
});

describe("editable labels and recoverable deletion", () => {
  it("keeps label overrides separate from source metadata, including explicitly no labels", () => {
    const event = { ...REVISED_EVENTS[5], labels: ["프랑스"] };
    expect(eventLabels(event)).toEqual(["프랑스"]);
    expect(eventLabels({ ...event, labels: [] })).toEqual([]);
    expect(eventLabels(REVISED_EVENTS[5])).toEqual(["독일", "프랑스"]);
    const draft = { ...readTimelineDraft(null), events: [event] };
    const reloaded = readTimelineDraft(JSON.stringify(draft));
    expect(reloaded.events[0]).toEqual(event);
    expect(reloaded.events[0].country).toBe(REVISED_EVENTS[5].country);
  });
  it("migrates old array drafts without losing edits and keeps deleted entries across reload", () => {
    const old = mergeTimelineRevision().map(e => ({ ...e, body: e.body + "\n[[c-r|내 메모]]" }));
    const draft = readTimelineDraft(JSON.stringify(old));
    expect(draft.events).toEqual(old);
    const first = draft.events[0];
    const removed = deleteTimelineEvent(draft, first.id);
    const reloaded = readTimelineDraft(JSON.stringify(removed));
    expect(reloaded.events.some(e => e.id === first.id)).toBe(false);
    expect(reloaded.deleted[0].event).toEqual(first);
    const restored = restoreTimelineEvent(reloaded, first.id);
    expect(restored.events.find(e => e.id === first.id)).toEqual(first);
    expect(restored.deleted).toHaveLength(0);
    expect(restoreTimelineEvent(restored, first.id)).toEqual(restored);
    expect(draft.events).toEqual(old);
  });
  it("does not reset an empty collection and restores a major event without altering newer edits", () => {
    const event = mergeTimelineRevision().find(e => e.scope === "global")!;
    const one = { ...readTimelineDraft(null), events: [event] };
    const empty = deleteTimelineEvent(one, event.id);
    expect(readTimelineDraft(JSON.stringify(empty)).events).toEqual([]);
    const custom = { ...REVISED_EVENTS[0], id: "custom-after-delete", body: "새 사건" };
    const restored = restoreTimelineEvent({ ...empty, events: [custom] }, event.id);
    expect(restored.events).toEqual([custom, event]);
    expect(readTimelineDraft(JSON.stringify(restored))).toEqual(restored);
  });
  it("rejects malformed drafts instead of silently replacing saved work", () => {
    expect(() => readTimelineDraft('{broken')).toThrow();
    expect(() => readTimelineDraft(JSON.stringify({ schemaVersion: 1, events: [], deleted: [{ event: null }] }))).toThrow();
    expect(() => readTimelineDraft(JSON.stringify({ schemaVersion: 1, events: [{ ...REVISED_EVENTS[0], labels: [7] }], deleted: [] }))).toThrow();
  });
});

describe("timeline date editing", () => {
  it("accepts annual, monthly and exact dates, including valid leap days", () => {
    expect(parseTimelineDate("1971")).toMatchObject({ year: 1971, month: null, date: "1971", endYear: null });
    expect(parseTimelineDate(" 1971.08.15 ")).toMatchObject({ year: 1971, month: 8, date: "1971.8.15" });
    expect(parseTimelineDate("1980.2.29")?.date).toBe("1980.2.29");
    for (const date of ["1971.2.29", "1980.13", "1980.0", "1980.4.31", "1799", "2101", "1980.1.0", "날짜 없음"]) expect(parseTimelineDate(date)).toBeNull();
  });
  it("supports short and full range endpoints and rejects backwards periods", () => {
    expect(parseTimelineDate("1981.7~82.11")).toMatchObject({ date: "1981.7~1982.11", endYear: 1982, endMonth: 11 });
    expect(parseTimelineDate("1980.3~7")).toMatchObject({ date: "1980.3~1980.7", endYear: 1980, endMonth: 7 });
    expect(parseTimelineDate("1970.12~71")).toMatchObject({ endYear: 1971, endMonth: null });
    expect(parseTimelineDate("1976~78")).toMatchObject({ year: 1976, month: null, endYear: 1978 });
    expect(parseTimelineDate("1999~2001")?.endYear).toBe(2001);
    for (const date of ["1981.7~6", "1981~80", "1980.3.1~1980.2", "1980.3.2~1980.3.1", "1980.1~1980.13"]) expect(parseTimelineDate(date)).toBeNull();
  });
  it("moves a record to its new year/month and preserves rich text and dates inside the body", () => {
    const original = { ...REVISED_EVENTS[2], body: "1971.1~5\n[[c-r|제목\n1971.1은 본문 메모]]" };
    const changed = withTimelineDate(original, parseTimelineDate("1982.8.12")!);
    expect(changed.body).toBe("1982.8.12\n[[c-r|제목\n1971.1은 본문 메모]]");
    expect(changed.endYear).toBeNull();
    expect(documentTimeline([changed])[0]).toMatchObject({ year: 1982, items: [{ month: 8 }] });
    const custom = { ...original, date: "", body: "사용자가 직접 쓴 내용" };
    expect(withTimelineDate(custom, parseTimelineDate("1982")!).body).toBe(custom.body);
    expect(readTimelineDraft(JSON.stringify({ schemaVersion: 1, events: [changed], deleted: [] })).events[0]).toEqual(changed);
  });
});

it("separates a band heading and details without losing marks spanning the newline", () => {
  const event = { ...REVISED_EVENTS[9], body: "1973.3\n[[c-r|브레턴우즈 종료\n직접 강조한 설명]]\n추가 설명" };
  expect(bandText(event)).toEqual({ prefix: "1973.3\n", title: "[[c-r|브레턴우즈 종료]]", details: "[[c-r|직접 강조한 설명]]\n추가 설명" });
  expect(bandText({ ...event, body: "제목만" })).toEqual({ prefix: "", title: "제목만", details: "" });
  expect(bandText({ ...event, body: "" })).toEqual({ prefix: "", title: "", details: "" });
});


it("leads each year with annual context while preserving monthly and half-year order and source data", () => {
  const base = { ...INITIAL_EVENTS[0], year: 1984, scope: "regional" as const };
  const annual = { ...base, id: "annual", date: "1984", month: null, body: "연간 원문" };
  const june = { ...base, id: "june", date: "1984.6", month: 6 };
  const half = { ...base, id: "half", date: "1984 상반기", month: null };
  const january = { ...base, id: "january", date: "1984.1", month: 1 };
  const input = [june, annual, half, january];
  const before = JSON.stringify(input);
  expect(documentTimeline(input)[0].items.map(row => row.events[0].id)).toEqual(["annual", "january", "june", "half"]);
  expect(JSON.stringify(input)).toBe(before);
});
