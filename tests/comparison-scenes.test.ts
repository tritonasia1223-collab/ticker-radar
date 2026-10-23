import { describe, it, expect } from "vitest";
import { insightProse, moveScene, sceneMarker, splitInsightScenes } from "../shared/comparison-scenes";
import { comparisonInsightSchema } from "../shared/cap-comparison";
import { diff, merge } from "../shared/cap-collaboration";
import { validateEdit } from "../server/cap-collaboration";
const id = "11111111-1111-4111-8111-111111111111";
const scene = { id, title: "정책 전환", balance: { money: 1, goods: 1, outcome: "goldilocks" as const } };
const note = { title: "회복", date: "1957-08-01", endDate: "1958-06-01", text: "첫 문단\n\n[[hl-y|둘째 문단]]\n\n마지막", caption: "", sortOrder: 0 };
describe("inline insight diagrams", () => {
  it("inserts, moves both ways and deletes diagrams without changing prose or marks", () => {
    const text = note.text.replace("[[hl-y|", sceneMarker(id) + "[[hl-y|");
    for (const moved of [text, moveScene(text, id, -1), moveScene(text, id, 1)]) {
      expect(insightProse(moved)).toBe(note.text);
      expect(splitInsightScenes(moved).map(p => p.text).join("")).toBe(note.text);
      expect(comparisonInsightSchema.parse({ ...note, text: moved, scenes: [scene] }).scenes).toEqual([scene]);
    }
    expect(comparisonInsightSchema.parse({ ...note, text: text.replace(sceneMarker(id), ""), scenes: [] }).text).toBe(note.text);
  });
  it("does not move a diagram inside a multiline highlight", () => {
    const text = "[[hl-y|첫줄\n둘째줄]]\n" + sceneMarker(id) + "끝";
    const moved = moveScene(text, id, -1);
    expect(moved.startsWith(sceneMarker(id))).toBe(true);
    expect(insightProse(moved)).toBe(insightProse(text));
  });
  it("rejects missing, duplicate and orphan diagram metadata", () => {
    const text = note.text + sceneMarker(id);
    expect(comparisonInsightSchema.safeParse({ ...note, text }).success).toBe(false);
    expect(comparisonInsightSchema.safeParse({ ...note, scenes: [scene] }).success).toBe(false);
    expect(comparisonInsightSchema.safeParse({ ...note, text: text + sceneMarker(id), scenes: [scene] }).success).toBe(false);
    expect(comparisonInsightSchema.safeParse({ ...note, text, scenes: [scene, scene] }).success).toBe(false);
    expect(comparisonInsightSchema.parse(note)).toEqual(note);
  });
  it("journals insertion together and preserves independent metadata edits, conflicting on concurrent prose", () => {
    const after = { ...note, text: note.text + sceneMarker(id), scenes: [scene] };
    const changes = diff(note, after);
    validateEdit({ id: crypto.randomUUID(), session: crypto.randomUUID(), resource: "note:scene-test", editor: "test", changes });
    const result = merge({ ...note, title: "다른 창 제목" }, changes);
    expect(result.conflicts).toEqual([]);
    expect(comparisonInsightSchema.parse(result.doc)).toEqual({ ...after, title: "다른 창 제목" });
    expect(merge({ ...note, text: "다른 창 본문" }, changes).conflicts).toHaveLength(1);
    expect(merge(after, diff(note, { ...note, title: "이전 클라이언트 제목" })).doc).toEqual({ ...after, title: "이전 클라이언트 제목" });
  });
});
