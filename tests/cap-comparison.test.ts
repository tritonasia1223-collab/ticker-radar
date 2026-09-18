import { describe, expect, it } from "vitest";
import { commonBase, isPlotKey, isNoteKey, comparisonInsightSchema, zoomRange, lineSegments, monthlyPoints, movingAverage, simplifyExtrema, trendSections, moveRange, placementSchema, rebase } from "../shared/cap-comparison";
import { diff, merge } from "../shared/cap-collaboration";
import { validateEdit } from "../server/cap-collaboration";

const placement = { flowSlug: "crisis", nodeKey: "policy", title: "정책 발표", date: "2008-09-15", endDate: null, sortOrder: 1 };
describe("time-based comparison insights", () => {
  const note = { title: "환율 비교", date: "1997-01-01", endDate: "1998-12-31", text: "나의 해석", caption: "회복 구간", sortOrder: 1 };
  it("accepts date and period notes without a series binding and rejects invalid dates or ranges", () => {
    expect(comparisonInsightSchema.parse(note)).toEqual(note);
    expect(comparisonInsightSchema.safeParse({ ...note, endDate: null }).success).toBe(true);
    for (const patch of [{ date: "1997-02-30" }, { endDate: "1996-01-01" }, { title: " " }, { series: ["dollar"] }, { caption: "x".repeat(181) }]) {
      expect(comparisonInsightSchema.safeParse({ ...note, ...patch }).success).toBe(false);
    }
  });
  it("allows insight prose edits, isolates placement fields, and validates resource keys", () => {
    const op = { id: crypto.randomUUID(), session: crypto.randomUUID(), resource: "note:abc-123", editor: "창", changes: diff(note, { ...note, text: "새 분석" }) };
    expect(validateEdit(op).changes[0].path).toEqual(["text"]);
    expect(isNoteKey("note:../../meta")).toBe(false);
    expect(() => validateEdit({ ...op, resource: "note:bad key" })).toThrow();
    expect(() => validateEdit({ ...op, changes: [{ path: ["flowSlug"], before: null, after: "crisis" }] })).toThrow();
    expect(() => validateEdit({ ...op, resource: "plot:abc-123" })).toThrow();
  });
  it("merges prose and dates independently, but protects concurrent prose and deleted notes", () => {
    const remote = { ...note, text: "다른 창의 분석" };
    expect(merge(remote, diff(note, { ...note, date: "1997-06-01" })).doc).toEqual({ ...remote, date: "1997-06-01" });
    expect(merge(remote, diff(note, { ...note, text: "내 분석" })).conflicts).toHaveLength(1);
    expect(merge(null, diff(note, { ...note, caption: "구간 메모" })).conflicts).toHaveLength(1);
  });
  it("zooms around the cursor, clamps to extent and enforces the minimum duration", () => {
    const day = 86400000;
    expect(zoomRange([100 * day, 300 * day], 150 * day, .5, [0, 500 * day])).toEqual([125 * day, 225 * day]);
    expect(zoomRange([0, 100 * day], 0, 20, [0, 500 * day])).toEqual([0, 500 * day]);
    const tiny = zoomRange([100 * day, 200 * day], 150 * day, .001, [0, 500 * day]);
    expect(tiny[1] - tiny[0]).toBe(31 * day);
    const edge = zoomRange([400 * day, 500 * day], 499 * day, 2, [0, 500 * day]);
    expect(edge).toEqual([300 * day, 500 * day]);
  });
});
describe("comparison dates and observations", () => {
  it("rejects impossible dates and reversed periods; keeps undated selections", () => {
    expect(placementSchema.safeParse({ ...placement, date: "2008-02-30" }).success).toBe(false);
    expect(placementSchema.safeParse({ ...placement, endDate: "2007-01-01" }).success).toBe(false);
    expect(placementSchema.safeParse({ ...placement, date: null }).success).toBe(true);
    expect(placementSchema.safeParse({ ...placement, date: null, endDate: "2008-10-01" }).success).toBe(false);
  });
  it("retains the actual final monthly observation without filling missing months", () => {
    const p = monthlyPoints([["2000-01-02", 2], ["2000-03-02", 8], ["2000-01-30", 4], ["2000-01-01", 1], ["2000-04-01", NaN]]);
    expect(p.map(x => [x.date, x.raw])).toEqual([["2000-01-30", 4], ["2000-03-02", 8]]);
    expect(lineSegments(p, 1)).toHaveLength(2);
  });
  it("aligns month-end and month-average dates by a shared positive reference month", () => {
    const a = monthlyPoints([["2000-01-31", 10], ["2000-02-29", 20]]), b = monthlyPoints([["2000-02-01", 100], ["2000-03-01", 200]]);
    expect(commonBase([a, b], "2000-01")).toBe("2000-02");
    expect(rebase(a, "2000-02").map(p => p.value)).toEqual([50, 100]);
    expect(rebase(b, "2000-02")[0].date).toBe("2000-02-01");
    expect(commonBase([a, b], "2000-03")).toBeNull();
    expect(commonBase([a, []], "2000-01")).toBeNull();
    expect(rebase(monthlyPoints([["2000-01-01", 0]]), "2000-01")).toEqual([]);
  });
  it("does not bridge missing quarters", () => {
    const p = monthlyPoints([["2000-01-01", 1], ["2000-04-01", 2], ["2000-10-01", 3]]);
    expect(lineSegments(p, 3).map(s => s.length)).toEqual([2, 1]);
  });
  it("preserves zoom span when panning against either boundary", () => {
    expect(moveRange([20, 40], -100, [0, 100])).toEqual([0, 20]);
    expect(moveRange([20, 40], 100, [0, 100])).toEqual([80, 100]);
  });
});
describe("comparison trend view", () => {
  const observations = (values: number[], cadence = 1) => monthlyPoints(values.map((v, i) => [new Date(Date.UTC(2000, i * cadence, 1)).toISOString().slice(0, 10), v]));
  it("simplifies by selecting actual extrema, retaining their dates and values", () => {
    const raw = observations([100, 110, 105, 180, 120, 90, 95, 80, 100, 98, 105, 100]);
    const indexed = rebase(raw, "2000-01");
    const simple = simplifyExtrema(indexed, 12);
    expect(simple.map(p => [p.month, p.value])).toEqual([["2000-01", 100], ["2000-04", 180], ["2000-08", 80], ["2000-12", 100]]);
    expect(simple.every(p => indexed.includes(p))).toBe(true);
    expect(Math.max(...simple.map(p => p.value))).toBe(Math.max(...indexed.map(p => p.value)));
    expect(Math.min(...simple.map(p => p.value))).toBe(Math.min(...indexed.map(p => p.value)));
  });
  it("retains every calendar bucket's extrema, negative values and repeated peak endpoints", () => {
    const raw = observations([-2, -1, -4, -4, -3, -1, 0, 5, 5, 5, 2, 3]);
    const simple = simplifyExtrema(raw, 6);
    expect(simple.map(p => p.month)).toEqual(["2000-01", "2000-02", "2000-03", "2000-04", "2000-06", "2000-07", "2000-08", "2000-10", "2000-12"]);
    expect(simplifyExtrema(raw, 1)).toBe(raw);
  });
  it("keeps zoom-edge extrema and gap boundaries without inventing intermediate observations", () => {
    const raw = observations([1, 2, 7, 4, 5, 9, 3, 2, 6, 8, 10, 4]);
    const visible = raw.slice(2, 10).filter(p => p.month !== "2000-06");
    const segments = lineSegments(visible, 1).map(g => simplifyExtrema(g, 12));
    expect(segments).toHaveLength(2);
    expect(segments[0][0]).toBe(raw[2]);
    expect(segments[0].at(-1)).toBe(raw[4]);
    expect(segments[1][0]).toBe(raw[6]);
    expect(segments[1].at(-1)).toBe(raw[9]);
  });
  it("uses trailing means, preserves raw values, and normalizes the displayed mean", () => {
    const raw = observations([10, 20, 60, 100]);
    const smooth = movingAverage(raw, 3, 1);
    expect(smooth.map(p => p.average)).toEqual([30, 60]);
    expect(smooth.map(p => p.raw)).toEqual([60, 100]);
    expect(rebase(smooth, "2000-03").map(p => p.value)).toEqual([100, 200]);
    expect(movingAverage(raw.slice(0, 3), 3, 1)).toEqual(smooth.slice(0, 1));
    expect(raw.map(p => p.value)).toEqual([10, 20, 60, 100]);
  });
  it("restarts warmup after gaps and respects quarterly cadence", () => {
    const points = observations([1, 2, 3, 4, 5, 6, 7]).filter((_, i) => i !== 3);
    expect(movingAverage(points, 3, 1).map(p => p.month)).toEqual(["2000-03", "2000-07"]);
    expect(movingAverage(observations([1, 3, 5, 7], 3), 6, 3).map(p => p.value)).toEqual([2, 4, 6]);
    expect(commonBase([movingAverage(observations([-20, -10, 1]), 3, 1)], "2000-01")).toBeNull();
  });
  it("finds broad up/down tendencies and leaves a flat series unclassified", () => {
    const rising = observations(Array.from({ length: 40 }, (_, i) => 100 + i * 5));
    expect(trendSections(rising, 1).map(p => p.direction)).toEqual(["up"]);
    expect(trendSections(observations(Array.from({ length: 40 }, (_, i) => 300 - i * 5)), 1).map(p => p.direction)).toEqual(["down"]);
    expect(trendSections(observations(Array(40).fill(0)), 1).map(p => p.direction)).toEqual(["flat"]);
    expect(trendSections(rising.slice(0, 17), 1)).toEqual([]);
  });
  it("does not bridge missing periods or rewrite old section starts using future data", () => {
    const raw = observations(Array.from({ length: 90 }, (_, i) => i < 40 ? 100 + i * 5 : 500 - i * 4));
    const early = trendSections(raw.slice(0, 35), 1);
    const full = trendSections(raw, 1);
    expect(full[0].from).toBe(early[0].from);
    expect(full.map(p => p.direction)).toEqual(["up", "down"]);
    const gap = trendSections(raw.filter((_, i) => i < 30 || i > 40), 1);
    expect(gap[0].to).toBe(raw[29].time);
    expect(gap[1].from).toBeGreaterThan(raw[41].time);
  });
});
describe("comparison resource isolation and concurrency", () => {
  it("allows per-placement edits, rejects flow-only fields and unsafe resource keys", () => {
    const op = { id: crypto.randomUUID(), session: crypto.randomUUID(), resource: "plot:abc-123", editor: "창", changes: diff(placement, { ...placement, title: "새 제목" }) };
    expect(validateEdit(op).changes[0].path).toEqual(["title"]);
    expect(() => validateEdit({ ...op, changes: [{ path: ["nodes", "x", "text"], before: "", after: "x" }] })).toThrow();
    expect(isPlotKey("plot:../../meta")).toBe(false);
    expect(() => validateEdit({ ...op, resource: "plot:bad key" })).toThrow();
  });
  it("merges independent fields and detects same-field edits or deleted placements", () => {
    const changed = { ...placement, title: "다른 창" };
    const ours = diff(placement, { ...placement, date: "2008-09-20" });
    expect(merge(changed, ours)).toEqual({ doc: { ...changed, date: "2008-09-20" }, conflicts: [] });
    expect(merge(changed, diff(placement, { ...placement, title: "내 제목" })).conflicts).toHaveLength(1);
    expect(merge(null, ours).conflicts).toHaveLength(1);
    expect(merge(changed, diff(placement, null)).conflicts).toHaveLength(1);
  });
});
