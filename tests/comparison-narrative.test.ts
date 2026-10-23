import { describe, it, expect } from "vitest";
import { documentHash, planNarrativeRevision } from "../script/lib/comparison-narrative";
import { diff, merge, type Resource } from "../shared/cap-collaboration";
import { insightProse, sceneMarker } from "../shared/comparison-scenes";
import { insightBalanceSchema } from "../shared/comparison-balance";
import { insightForClient, guardUnlabelledInsightEdit, InsightUpgradeRequired } from "../shared/comparison-compat";

const oldId = crypto.randomUUID();
const balance = { money: -2 as const, goods: 1 as const, moneyLabel: "돈줄 급감", goodsLabel: "재고가 남음", outcome: "deflation" as const };
const source: Resource = { key: "note:reviewed", version: 7, doc: { title: "사용자 제목", date: "1930-01-01", endDate: null, caption: "보존", sortOrder: 0, text: "첫 문단\n정책 전환\n[[hl-y|사용자 본문]]" + sceneMarker(oldId), scenes: [{ id: oldId, title: "기존 도표", balance: { money: 1, goods: 1, outcome: "goldilocks" } }] } };
const entry = { key: source.key, sourceVersion: source.version, sourceDocHash: documentHash(source.doc), balance };
describe("reviewed narrative publication", () => {
  it("rejects concurrent edits, deletions and another card even with matching prose", () => {
    for (const current of [{ ...source, version: 8 }, { ...source, doc: { ...source.doc, title: "최신 제목" } }, { ...source, doc: null }, { ...source, key: "note:other" }]) {
      expect(planNarrativeRevision(current, entry).changes).toEqual([]);
    }
  });
  it("inserts a scene at a reviewed paragraph while preserving rich prose and existing scenes", () => {
    const id = crypto.randomUUID();
    const changes = planNarrativeRevision(source, { ...entry, scenes: [{ id, title: "전환", balance, before: "정책 전환" }] }).changes;
    const result = merge(source.doc, changes);
    expect(result.conflicts).toEqual([]);
    expect(insightProse(result.doc!.text as string)).toBe(insightProse(source.doc!.text as string));
    expect(result.doc!.text).toContain(sceneMarker(id) + "정책 전환");
    expect(result.doc!.scenes).toHaveLength(2);
    expect((result.doc!.scenes as any[])[0]).toEqual((source.doc!.scenes as any[])[0]);
    for (const name of ["title", "date", "endDate", "caption", "sortOrder"]) expect(result.doc![name]).toEqual(source.doc![name]);
  });
  it("rejects ambiguous or non-paragraph anchors and duplicate scene IDs", () => {
    for (const before of ["없음", "문단", "사용자 본문"]) expect(planNarrativeRevision(source, { ...entry, scenes: [{ id: crypto.randomUUID(), title: "", balance, before }] }).reason).toBe("ambiguous-scene-anchor");
    expect(planNarrativeRevision(source, { ...entry, scenes: [{ id: oldId, title: "", balance, append: true }] }).reason).toBe("scene-already-present");
    const duplicate = { ...source, doc: { ...source.doc, text: "전환\n전환" + sceneMarker(oldId) } };
    expect(planNarrativeRevision(duplicate, { ...entry, sourceDocHash: documentHash(duplicate.doc), scenes: [{ id: crypto.randomUUID(), title: "", balance, before: "전환" }] }).reason).toBe("ambiguous-scene-anchor");
  });
  it("appends without changing prose and retains changes under field conflict protection", () => {
    const changes = planNarrativeRevision(source, { ...entry, scenes: [{ id: crypto.randomUUID(), title: "회복", balance, append: true }] }).changes;
    expect(insightProse(merge(source.doc, changes).doc!.text as string)).toBe(insightProse(source.doc!.text as string));
    expect(merge({ ...source.doc, text: "새로 작성한 글" }, changes).conflicts.length).toBeGreaterThan(0);
  });
  it("projects older clients without mutating stored labels and preserves ordinary prose edits", () => {
    const full = { ...source, doc: { ...source.doc, balance, scenes: [{ id: oldId, title: "", balance }] } };
    const old = insightForClient(full, true, false);
    expect(old.doc.balance.moneyLabel).toBeUndefined();
    expect(old.doc.scenes[0].balance.goodsLabel).toBeUndefined();
    expect(full.doc.balance.moneyLabel).toBe("돈줄 급감");
    const op = { id: crypto.randomUUID(), session: crypto.randomUUID(), editor: "older", resource: full.key, changes: diff(old.doc, { ...old.doc, text: "수정" }) };
    expect(() => guardUnlabelledInsightEdit(full.doc, op)).not.toThrow();
    expect(merge(full.doc, op.changes).doc!.balance).toEqual(balance);
    for (const changed of [{ ...old.doc, balance: { money: 2, goods: 1 } }, { ...old.doc, scenes: [] }, null]) expect(() => guardUnlabelledInsightEdit(full.doc, { ...op, changes: diff(old.doc, changed) })).toThrow(InsightUpgradeRequired);
  });
  it("validates custom wording without changing the five level scale", () => {
    expect(insightBalanceSchema.parse(balance)).toEqual(balance);
    expect(insightBalanceSchema.safeParse({ ...balance, goodsLabel: "가".repeat(21) }).success).toBe(false);
    expect(insightBalanceSchema.safeParse({ ...balance, money: 3 }).success).toBe(false);
  });
});


