import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { planBalanceSeed } from "../script/lib/comparison-balance-seed";
import { insightForClient, guardLegacyInsightEdit, InsightUpgradeRequired } from "../shared/comparison-compat";
import { merge, diff, type Resource } from "../shared/cap-collaboration";
import { sceneMarker, insightProse } from "../shared/comparison-scenes";
const text = "첫 문단\n정책 전환\n[[hl-y|새 본문]]";
const resource: Resource = { key: "note:test", version: 1, doc: { title: "원문", date: "1950-01-01", endDate: null, text, caption: "", sortOrder: 0 } };
const balance = { money: 1, goods: -1, outcome: "inflation" as const };
const entry = { key: resource.key, sourceTextSha256: createHash("sha256").update(text).digest("hex"), balance };
describe("safe diagram publication", () => {
  it("skips changed/deleted notes and explicit removal; cannot seed an unreviewed new note", () => {
    for (const r of [{ ...resource, doc: null }, { ...resource, key: "note:new" }, { ...resource, doc: { ...resource.doc, text: "New user prose" } }, { ...resource, doc: { ...resource.doc, balance: null } }, { ...resource, doc: { ...resource.doc, scenes: [] } }]) expect(planBalanceSeed(r, entry).changes).toEqual([]);
  });
  it("adds only diagrams with a guarded source and preserves all original prose", () => {
    const id = crypto.randomUUID();
    const plan = planBalanceSeed(resource, { ...entry, inlineScenes: [{ id, title: "전환", afterHeading: "정책 전환", balance }] });
    const result = merge({ ...resource.doc, title: "Concurrent title" }, plan.changes);
    expect(result.conflicts).toEqual([]);
    expect(result.doc!.title).toBe("Concurrent title");
    expect(insightProse(result.doc!.text as string)).toBe(text);
    expect(result.doc!.text).toContain("정책 전환\n" + sceneMarker(id));
    expect(merge({ ...resource.doc, text: "Concurrent prose" }, plan.changes).conflicts).toHaveLength(1);
  });
  it("keeps notes visible to old clients without exposing or deleting new fields", () => {
    const full = { ...resource, doc: { ...resource.doc, text: text + sceneMarker(crypto.randomUUID()), balance, scenes: [] } };
    expect(insightForClient(full, false)).toEqual(resource);
    expect(insightForClient(full, true)).toBe(full);
    expect(full.doc.balance).toEqual(balance);
    const legacy = insightForClient(full, false);
    const changed = merge(full.doc, diff(legacy.doc, { ...legacy.doc, title: "Old title edit" }));
    expect(changed.doc!.balance).toEqual(balance);
  });
  it("protects inline positions from legacy prose edits but permits other fields", () => {
    const current = { ...resource.doc, scenes: [{ id: crypto.randomUUID(), title: "", balance }] };
    const op = { id: crypto.randomUUID(), session: crypto.randomUUID(), editor: "old", resource: resource.key, changes: diff(resource.doc, { ...resource.doc, text: "New" }) };
    expect(() => guardLegacyInsightEdit(current, op)).toThrow(InsightUpgradeRequired);
    expect(() => guardLegacyInsightEdit(current, { ...op, changes: diff(resource.doc, { ...resource.doc, title: "New" }) })).not.toThrow();
  });
});
