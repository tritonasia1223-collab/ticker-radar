// 자본주의 타임라인 — 가벼운 되돌리기(Undo) 스택.
//  - 텍스트 글자 단위 편집은 제외(편집창 내 브라우저 기본 Undo 가 처리).
//  - 대상 동작: 화살표 생성/삭제, 카드(사건) 생성/삭제, 노드 추가/삭제.
//  - 방식: 각 동작 "직전 상태"를 스냅샷으로 쌓고, Undo 시 삭제한 노드만 최신 서버본에 복원한다.
//  - 메모리 전용 스택(새로고침하면 히스토리는 사라짐 — 되돌린 결과 자체는 DB 에 반영됨).
import { apiRequest } from "@/lib/queryClient";
import { toInput, nodeHasContent } from "@/lib/capitalism-flowops";
import type { FlowDTO, FlowNodeDTO, LinkDTO } from "@/lib/capitalism-types";

// 카드/노드 변경 직전, 해당 flow 의 스냅샷(동작 전 그 카드가 없었으면 prev=null → Undo 는 삭제).
export interface FlowSnapshotEntry {
  kind: "flow";
  label: string; // 사용자 안내용 라벨(예: "화살표 추가")
  slug: string;
  removedIds?: string[]; // 이 동작이 삭제한 노드만 복원한다.
  prev: FlowDTO | null; // 동작 전 그 flow 상태(없었으면 null)
}

// 화살표 변경 직전, links 배열 전체 스냅샷.
export interface LinksSnapshotEntry {
  kind: "links";
  label: string;
  prev: LinkDTO[]; // 동작 전 전체 링크 목록
}

export type UndoEntry = FlowSnapshotEntry | LinksSnapshotEntry;

// 깊은 복제(스냅샷이 이후 캐시 변경에 오염되지 않도록).
export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// flow 스냅샷 항목 생성. flows 캐시에서 현재 상태를 찾아 깊은 복제로 보관.
export function makeFlowEntry(label: string, slug: string, flows: FlowDTO[] | undefined, nextNodes?: FlowNodeDTO[]): FlowSnapshotEntry {
  const cur = flows?.find((f) => f.slug === slug) ?? null;
  return { kind: "flow", label, slug, prev: cur ? clone(cur) : null, removedIds: cur && nextNodes ? cur.nodes.filter((n) => !nextNodes.some((next) => next.id === n.id)).map((n) => n.id) : undefined };
}

// links 스냅샷 항목 생성.
export function makeLinksEntry(label: string, links: LinkDTO[] | undefined): LinksSnapshotEntry {
  return { kind: "links", label, prev: clone(links ?? []) };
}

// flow 스냅샷으로 되돌리기: prev 가 있으면 그 상태로 upsert 복원, 없으면(=신규 생성이었음) 삭제.
export function restoreDeletedNodes(entry: FlowSnapshotEntry, current: FlowDTO | undefined): FlowDTO {
  const before = entry.prev!;
  const restored = clone(current ?? before);
  if (!current) return restored;
  const removed = new Set(entry.removedIds ?? before.nodes.filter((n) => !current.nodes.some((c) => c.id === n.id)).map((n) => n.id));
  for (let i = 0; i < before.nodes.length; i++) {
    const node = before.nodes[i];
    if (!removed.has(node.id) || restored.nodes.some((n) => n.id === node.id) || !nodeHasContent(node)) continue;
    const next = before.nodes.slice(i + 1).find((n) => restored.nodes.some((c) => c.id === n.id));
    const at = next ? restored.nodes.findIndex((n) => n.id === next.id) : restored.nodes.length;
    restored.nodes.splice(at, 0, clone(node));
  }
  return restored;
}

async function applyFlowUndo(entry: FlowSnapshotEntry): Promise<FlowDTO | undefined> {
  if (!entry.prev) {
    await apiRequest("DELETE", `/api/capitalism/flows/${encodeURIComponent(entry.slug)}`);
    return;
  }
  // 최신 읽기 실패 시 중단한다. 과거 스냅샷으로 현재 서버 내용을 덮지 않는다.
  const flows: FlowDTO[] = await apiRequest("GET", "/api/capitalism/flows").then((r) => r.json());
  const current = flows.find((f) => f.slug === entry.slug);
  const restored = restoreDeletedNodes(entry, current);
  const response = await apiRequest("POST", "/api/capitalism/flows", {
    ...toInput(restored, restored.nodes), baseVersion: current?.updatedAt ?? 0,
  });
  return response.json();
}

// links 스냅샷으로 되돌리기: 현재 서버 링크와 비교해 추가/삭제로 동기화.
async function applyLinksUndo(entry: LinksSnapshotEntry): Promise<void> {
  // 현재 서버 상태를 다시 읽어 정확히 diff (캐시 임시 id 회피). 실패는 위로 던져 알림(조용한 오동작 금지).
  const cur: LinkDTO[] = await apiRequest("GET", "/api/capitalism/links").then((r) => r.json());

  const sameLink = (a: { fromSlug: string; fromKey: string; toSlug: string; toKey: string }, b: typeof a) =>
    a.fromSlug === b.fromSlug && a.fromKey === b.fromKey && a.toSlug === b.toSlug && a.toKey === b.toKey;

  // 1) 현재엔 있는데 스냅샷엔 없는 링크 → 삭제.
  for (const c of cur) {
    if (!entry.prev.some((p) => sameLink(p, c))) {
      await apiRequest("DELETE", `/api/capitalism/links/${c.id}`);
    }
  }
  // 2) 스냅샷엔 있는데 현재 없는 링크 → 추가.
  for (const p of entry.prev) {
    if (!cur.some((c) => sameLink(c, p))) {
      await apiRequest("POST", "/api/capitalism/links", {
        fromSlug: p.fromSlug, fromKey: p.fromKey, toSlug: p.toSlug, toKey: p.toKey,
      });
    }
  }
}

// 한 항목 되돌리기 실행.
export async function applyUndo(entry: UndoEntry): Promise<FlowDTO | undefined> {
  if (entry.kind === "flow") return applyFlowUndo(entry);
  await applyLinksUndo(entry);
  return undefined;
}
