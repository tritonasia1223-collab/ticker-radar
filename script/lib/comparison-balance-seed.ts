import { createHash } from "node:crypto";
import { comparisonInsightSchema } from "../../shared/cap-comparison.js";
import { insightProse, sceneMarker, type InsightScene } from "../../shared/comparison-scenes.js";
import { insightBalanceSchema } from "../../shared/comparison-balance.js";
import type { Resource, Change } from "../../shared/cap-collaboration.js";

export function planBalanceSeed(resource: Resource, entry: {
  key: string; sourceTextSha256: string; balance: unknown;
  inlineScenes?: (InsightScene & { afterHeading: string })[];
}): { changes: Change[]; reason?: string } {
  if (resource.key !== entry.key || !resource.doc) return { changes: [], reason: "missing-or-deleted" };
  const current = comparisonInsightSchema.parse(resource.doc);
  if (createHash("sha256").update(current.text).digest("hex") !== entry.sourceTextSha256) return { changes: [], reason: "prose-changed" };
  if (current.balance !== undefined || current.scenes !== undefined) return { changes: [], reason: "already-configured" };
  const balance = insightBalanceSchema.parse(entry.balance);
  let text = current.text;
  const scenes: InsightScene[] = [];
  for (const { afterHeading, ...scene } of entry.inlineScenes ?? []) {
    const start = text.indexOf(afterHeading);
    if (start < 0 || text.indexOf(afterHeading, start + afterHeading.length) >= 0) return { changes: [], reason: "ambiguous-heading" };
    const end = text.indexOf("\n", start), at = end < 0 ? text.length : end + 1;
    text = text.slice(0, at) + sceneMarker(scene.id) + text.slice(at);
    scenes.push(scene);
  }
  comparisonInsightSchema.parse({ ...current, balance, text, ...(scenes.length ? { scenes } : {}) });
  if (insightProse(text) !== current.text) throw new Error("Prose preservation failed");
  // Even a top-only seed asserts the reviewed text inside the collaboration lock.
  // Concurrent prose edits conflict; unrelated fields are never sent or replaced.
  return { changes: [
    { path: ["text"], before: current.text, after: text },
    { path: ["balance"], before: null, after: balance },
    ...(scenes.length ? [{ path: ["scenes"], before: null, after: scenes } as Change] : []),
  ] };
}
