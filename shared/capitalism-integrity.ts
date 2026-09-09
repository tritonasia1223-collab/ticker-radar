export interface IntegritySnapshot {
  flows: { id: number; slug: string }[];
  nodes: { flowId: number; nodeKey: string; text: string }[];
}
// 이 검사는 ID 소멸을 검출한다. 사용자가 의도한 삭제인지, 본문이 옳은지는 별도 검토 대상이다.
export function compareIntegrity(backup: IntegritySnapshot | null, current: IntegritySnapshot) {
  const removedCards: string[] = [], removedNodes: string[] = [];
  let editedNodes = 0;
  if (!backup) return { exitCode: 2, removedCards, removedNodes, editedNodes };
  const bySlug = new Map(current.flows.map((f) => [f.slug, f]));
  const byNode = new Map(current.nodes.map((n) => [`${n.flowId}:${n.nodeKey}`, n]));
  for (const old of backup.flows) {
    const now = bySlug.get(old.slug);
    if (!now) { removedCards.push(old.slug); continue; }
    for (const node of backup.nodes.filter((n) => n.flowId === old.id)) {
      const match = byNode.get(`${now.id}:${node.nodeKey}`);
      if (!match) removedNodes.push(`${old.slug}:${node.nodeKey}`);
      else if (match.text !== node.text) editedNodes++;
    }
  }
  return { exitCode: removedCards.length || removedNodes.length ? 1 : 0, removedCards, removedNodes, editedNodes };
}
