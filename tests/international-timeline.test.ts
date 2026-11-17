import { readFileSync } from "node:fs";
import { REVISED_EVENTS, TIMELINE_REVISION } from "../client/src/data/international-timeline-revision";
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
  it("preserves the complete text of all 80 supplied entries", () => {
    const entries = revisionSource.replace(/\r/g, "").split(/(?=^\*\*\d{4})/m).slice(1);
    expect(REVISED_EVENTS).toHaveLength(80);
    expect(entries).toHaveLength(80);
    entries.forEach((entry, index) => {
      const content = entry.replace(/^\*\*([^*]+)\*\*\s*/, "$1\n").replace(/^##.*$/gm, "").trim();
      expect(REVISED_EVENTS[index].body).toBe(content);
    });
  });
  it("replaces overlapping source events once and retains unrelated notes", () => {
    const custom = { ...INITIAL_EVENTS[3], body: "사용자 추가 메모" };
    const merged = mergeTimelineRevision([custom]);
    expect(merged).toHaveLength(87);
    expect(new Set(merged.map(e => e.id)).size).toBe(87);
    expect(merged.filter(e => e.revision === TIMELINE_REVISION)).toHaveLength(80);
    expect(merged.find(e => e.id === custom.id)?.body).toContain("사용자 추가 메모");
    expect(merged.find(e => e.id === INITIAL_EVENTS[0].id)?.body).toBe(REVISED_EVENTS[0].body);
    expect(merged.some(e => e.id === "source-20261117-7" || e.id === "source-20261117-9")).toBe(false);
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
    expect(items.map(i => i.kind)).toEqual(["band", "slice", "slice"]);
    expect(items[1].events.map(e => e.id)).toEqual(["us", "eu"]);
    expect(items[2].month).toBeNull();
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
    expect(events).toHaveLength(87);
  });
});
