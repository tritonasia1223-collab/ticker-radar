import { insightProse } from "./comparison-scenes.js";
import type { Resource, EditRequest, Document } from "./cap-collaboration.js";

export const DIAGRAM_HEADER = "X-Fiscus-Insight-Diagrams";
// Already-open clients use a strict pre-diagram schema. Project responses only;
// never strip fields from the stored document or from the authoritative merge.
export function insightForClient<T extends Resource>(resource: T, diagrams: boolean): T {
  if (diagrams || !resource.key.startsWith("note:") || !resource.doc) return resource;
  const { balance: _balance, scenes: _scenes, ...doc } = resource.doc;
  if (typeof doc.text === "string") doc.text = insightProse(doc.text);
  return { ...resource, doc };
}
export class InsightUpgradeRequired extends Error {
  constructor() { super("이 글에 중간 도표가 추가되었습니다. 작성 중인 글은 초안에 보관됩니다. 내용을 별도로 복사한 뒤 새로고침하여 서버와 비교해 복구해 주세요."); }
}
export function guardLegacyInsightEdit(current: Document, op: EditRequest) {
  if (!op.resource.startsWith("note:")) return;
  if (op.changes.some(c => c.path[0] === "balance" || c.path[0] === "scenes")) throw new InsightUpgradeRequired();
  // A legacy text editor cannot place inline markers safely. Preserve its draft
  // instead of guessing positions or silently erasing the newly inserted scenes.
  if (Array.isArray(current?.scenes) && current.scenes.length && op.changes.some(c => !c.path.length || c.path[0] === "text")) throw new InsightUpgradeRequired();
}
