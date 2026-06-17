// 자본주의 타임라인 — 가벼운 되돌리기(Undo) 스택.
//  - 텍스트 글자 단위 편집은 제외(편집창 내 브라우저 기본 Undo 가 처리).
//  - 대상 동작: 화살표 생성/삭제, 카드(사건) 생성/삭제, 노드 추가/삭제.
//  - 방식: 각 동작 "직전 상태"를 스냅샷으로 쌓고, Undo 시 그 상태로 서버를 되돌린다.
//  - 메모리 전용 스택(새로고침하면 히스토리는 사라짐 — 되돌린 결과 자체는 DB 에 반영됨).
import { apiRequest } from "@/lib/queryClient";
import { toInput } from "@/lib/capitalism-flowops";
import type { FlowDTO, LinkDTO } from "@/lib/capitalism-types";

// 카드/노드 변경 직전, 해당 flow 의 스냅샷(동작 전 그 카드가 없었으면 prev=null → Undo 는 삭제).
export interface FlowSnapshotEntry {
  kind: "flow";
  label: string; // 사용자 안내용 라벨(예: "화살표 추가")
  slug: string;
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
export function makeFlowEntry(label: string, slug: string, flows: FlowDTO[] | undefined): FlowSnapshotEntry {
  const cur = flows?.find((f) => f.slug === slug) ?? null;
  return { kind: "flow", label, slug, prev: cur ? clone(cur) : null };
}

// links 스냅샷 항목 생성.
export function makeLinksEntry(label: string, links: LinkDTO[] | undefined): LinksSnapshotEntry {
  return { kind: "links", label, prev: clone(links ?? []) };
}

// flow 스냅샷으로 되돌리기: prev 가 있으면 그 상태로 upsert 복원, 없으면(=신규 생성이었음) 삭제.
async function applyFlowUndo(entry: FlowSnapshotEntry): Promise<void> {
  if (!entry.prev) {
    // 동작 전엔 이 카드가 없었음 → 삭제로 되돌림.
    await apiRequest("DELETE", `/api/capitalism/flows/${encodeURIComponent(entry.slug)}`).catch(() => {});
    return;
  }
  // 동작 전 상태로 복원(노드/메타 포함).
  // 빈 텍스트 노드(편집 중이던 빈 칸)는 서버 검증(text 최소 1자)에서 거부되므로 제거.
  const f = entry.prev;
  const cleanNodes = f.nodes.filter((n) => n.text.trim());
  // 모든 노드가 비었던 상태라면 해당 카드는 실질 존재하지 않았던 것 → 삭제로 복원.
  if (cleanNodes.length === 0) {
    await apiRequest("DELETE", `/api/capitalism/flows/${encodeURIComponent(f.slug)}`).catch(() => {});
    return;
  }
  await apiRequest("POST", "/api/capitalism/flows", toInput(f, cleanNodes));
}

// links 스냅샷으로 되돌리기: 현재 서버 링크와 비교해 추가/삭제로 동기화.
async function applyLinksUndo(entry: LinksSnapshotEntry): Promise<void> {
  // 현재 서버 상태를 다시 읽어 정확히 diff (캐시 임시 id 회피).
  const cur: LinkDTO[] = await apiRequest("GET", "/api/capitalism/links")
    .then((r) => r.json())
    .catch(() => [] as LinkDTO[]);

  const sameLink = (a: { fromSlug: string; fromKey: string; toSlug: string; toKey: string }, b: typeof a) =>
    a.fromSlug === b.fromSlug && a.fromKey === b.fromKey && a.toSlug === b.toSlug && a.toKey === b.toKey;

  // 1) 현재엔 있는데 스냅샷엔 없는 링크 → 삭제.
  for (const c of cur) {
    if (!entry.prev.some((p) => sameLink(p, c))) {
      await apiRequest("DELETE", `/api/capitalism/links/${c.id}`).catch(() => {});
    }
  }
  // 2) 스냅샷엔 있는데 현재 없는 링크 → 추가.
  for (const p of entry.prev) {
    if (!cur.some((c) => sameLink(c, p))) {
      await apiRequest("POST", "/api/capitalism/links", {
        fromSlug: p.fromSlug, fromKey: p.fromKey, toSlug: p.toSlug, toKey: p.toKey,
      }).catch(() => {});
    }
  }
}

// 한 항목 되돌리기 실행.
export async function applyUndo(entry: UndoEntry): Promise<void> {
  if (entry.kind === "flow") return applyFlowUndo(entry);
  return applyLinksUndo(entry);
}
