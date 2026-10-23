import { createHash } from "node:crypto";
import { comparisonInsightSchema } from "../../shared/cap-comparison.js";
import { insightBalanceSchema, type InsightBalance } from "../../shared/comparison-balance.js";
import { insightProse, sceneMarker, type InsightScene } from "../../shared/comparison-scenes.js";
import { diff, type Resource, type Change } from "../../shared/cap-collaboration.js";

export const documentHash = (doc: unknown) => createHash("sha256").update(JSON.stringify(doc)).digest("hex");
export type NarrativeRevision = {
  key: string; sourceVersion: number; sourceDocHash: string; balance: InsightBalance;
  scenes?: (InsightScene & { before?: string; append?: boolean })[];
};
export function planNarrativeRevision(current: Resource, entry: NarrativeRevision): { changes: Change[]; reason?: string } {
  if (current.key !== entry.key || !current.doc) return { changes: [], reason: "missing-or-deleted" };
  if (current.version !== entry.sourceVersion || documentHash(current.doc) !== entry.sourceDocHash) return { changes: [], reason: "changed-since-review" };
  const doc = comparisonInsightSchema.parse(current.doc);
  let text = doc.text;
  const scenes = [...(doc.scenes ?? [])];
  for (const { before, append, ...scene } of entry.scenes ?? []) {
    if (scenes.some(s => s.id === scene.id)) return { changes: [], reason: "scene-already-present" };
    if (append) text += sceneMarker(scene.id);
    else {
      if (!before) throw new Error("Missing scene anchor");
      const at = text.indexOf(before);
      if (at < 0 || text.indexOf(before, at + 1) !== -1 || (at > 0 && text[at - 1] !== "\n")) return { changes: [], reason: "ambiguous-scene-anchor" };
      text = text.slice(0, at) + sceneMarker(scene.id) + text.slice(at);
    }
    scenes.push(scene);
  }
  const next = comparisonInsightSchema.parse({ ...doc, balance: insightBalanceSchema.parse(entry.balance), text, ...(entry.scenes?.length ? { scenes } : {}) });
  if (insightProse(next.text) !== insightProse(doc.text)) throw new Error("Prose changed");
  const changes = diff(current.doc, next);
  if (changes.some(c => !["text", "balance", "scenes"].includes(c.path[0]))) throw new Error("Unexpected document change");
  return { changes };
}
