// 인라인 편집용 플로우 연산 헬퍼.
// 팝업 에디터 없이, 카드 안에서 노드 추가/수정/삭제 → 곧바로 서버 저장(POST upsert).
// 엣지는 레이아웃 규칙으로 자동 재계산한다.
//   - stack: 위→아래 선형 체인
//   - branch: center[0](출발) → left/right 각 컬럼 체인 → center[last](합류)로 합류
import { apiRequest } from "@/lib/queryClient";
import type { FlowDTO, FlowNodeDTO, FlowInputDTO, NodeContentPatch, CapInsight } from "@/lib/capitalism-types";

export function rebuildEdges(
  nodes: FlowNodeDTO[],
  layout: string
): { from: string; to: string }[] {
  if (layout !== "branch") {
    const e: { from: string; to: string }[] = [];
    for (let i = 1; i < nodes.length; i++) e.push({ from: nodes[i - 1].id, to: nodes[i].id });
    return e;
  }
  const center = nodes.filter((n) => (n.col || "center") === "center");
  const left = nodes.filter((n) => n.col === "left");
  const right = nodes.filter((n) => n.col === "right");
  const source = center[0];
  const merge = center.length > 1 ? center[center.length - 1] : undefined;
  const e: { from: string; to: string }[] = [];
  for (const col of [left, right]) {
    if (source && col[0]) e.push({ from: source.id, to: col[0].id });
    for (let i = 1; i < col.length; i++) e.push({ from: col[i - 1].id, to: col[i].id });
    if (merge && col.length) e.push({ from: col[col.length - 1].id, to: merge.id });
  }
  return e;
}

// FlowDTO + 새 노드 배열 → 서버 입력(FlowInputDTO). 엣지는 재계산.
export function toInput(flow: FlowDTO, nodes: FlowNodeDTO[]): FlowInputDTO {
  return {
    slug: flow.slug,
    title: flow.title,
    date: flow.date,
    endDate: flow.endDate ?? null,
    year: flow.year,
    category: flow.category,
    layout: flow.layout,
    insight: flow.insight ?? null, // 사건 인사이트(있으면 유지)
    sortOrder: flow.sortOrder,
    nodes: nodes.map((n) => ({
      nodeKey: n.id,
      kind: n.kind,
      inLabel: n.inLabel ?? null,
      text: n.text,
      ref: n.ref ?? null,   // 노드 보충 메모(있으면 유지, 없으면 null)
      col: flow.layout === "branch" ? (n.col || "center") : null,
      table: n.table ?? null, // 노드별 표(메모와 같은 층위, 있으면 유지)
    })),
    edges: rebuildEdges(nodes, flow.layout),
  };
}

export function newNodeKey(): string {
  return `k${Date.now().toString(36)}${Math.floor(Math.random() * 100000).toString(36)}`;
}

// ── 저장 안정화 프리미티브 ──────────────────────────────────────────────
// Fix②: 같은 카드(slug)의 저장을 '순차 실행'해 동시 full-replace 로 서로를 덮는 손실을 막는다.
//   runFn 은 반드시 '실행 시점'에 최신 상태를 읽어 보내야 한다(스테일 스냅샷 금지) → 누적 보존.
const saveChains = new Map<string, Promise<unknown>>();
export function enqueueSave<T>(key: string, runFn: () => Promise<T>): Promise<T> {
  const prev = saveChains.get(key) ?? Promise.resolve();
  const run = prev.then(runFn, runFn); // 앞 저장 성패와 무관하게 이어서 실행(직렬화)
  const tracker = run.then(() => {}, () => {}); // 다음 저장이 기다릴 '완료' 신호
  saveChains.set(key, tracker);
  void tracker.finally(() => { if (saveChains.get(key) === tracker) saveChains.delete(key); });
  return run;
}

// Fix③: 일시적 실패(서버리스 콜드스타트·Supabase 풀러 히컵·커넥션 포화) 를 재시도.
//   최종 실패 시 throw → 호출부가 토스트로 사용자에게 알리고 편집을 '유지'한다(조용한 손실 금지).
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) { lastErr = e; if (i < attempts - 1) await new Promise((r) => setTimeout(r, 400 * 2 ** i)); }
  }
  throw lastErr;
}

// 노드가 '내용 있음'(보존 대상)인지 — 텍스트뿐 아니라 표(table)·메모(ref)가 있어도 유지한다.
// (텍스트만 비었다고 버리면 그 노드의 표/메모까지 영구 삭제되는 데이터 손실이 발생했다.)
export function nodeHasContent(n: FlowNodeDTO): boolean {
  return !!(n.text.trim() || n.table || (n.ref && n.ref.trim()));
}

// 플로우의 노드 배열을 통째로 저장. 진짜 빈 노드(텍스트·표·메모 모두 없음)만 제외.
// 모든 노드가 비면 플로우 자체를 삭제한다. 반환: "deleted" | 저장된 최신 FlowDTO(버전 포함).
//   baseVersion(불러온 시점 updatedAt)을 함께 보내 낙관적 동시성 검사를 받는다 — 그새 다른 곳에서
//   먼저 저장됐으면 서버가 409 를 던지고, 여기서는 그 에러가 그대로 위로 전파된다(호출부가 처리).
export async function persistNodes(
  flow: FlowDTO,
  nodes: FlowNodeDTO[]
): Promise<"deleted" | FlowDTO> {
  const clean = nodes.filter(nodeHasContent);
  if (clean.length === 0) {
    await apiRequest("DELETE", `/api/capitalism/flows/${encodeURIComponent(flow.slug)}`);
    return "deleted";
  }
  const body: FlowInputDTO = { ...toInput(flow, clean), baseVersion: flow.updatedAt };
  const res = await apiRequest("POST", "/api/capitalism/flows", body);
  return (await res.json()) as FlowDTO;
}

// ── 세분화 저장(실시간 경량) ────────────────────────────────────────────────
// 단일 노드 '내용'만 저장. insight·다른 노드·위상을 안 실으므로 페이로드가 수 KB로 작고(버벅임↓),
// 서버가 '그 노드 1건'만 적용하므로 전체목록 덮어쓰기(스테일 스냅샷) 소실이 원천 차단된다.
export async function patchNodeContent(slug: string, nodeId: string, patch: NodeContentPatch): Promise<{ updatedAt: number }> {
  // keepalive: 이탈(beforeunload) 중 flush 되는 마지막 PATCH 가 중단되지 않게(작은 페이로드라 안전).
  const res = await apiRequest("PATCH", `/api/capitalism/flows/${encodeURIComponent(slug)}/nodes/${encodeURIComponent(nodeId)}`, patch, { keepalive: true });
  return (await res.json()) as { updatedAt: number };
}

// 인사이트 블롭만 저장(이미지 등 큰 blocks 는 이 경로로만 — 노드 저장에 안 실린다).
export async function putInsight(slug: string, insight: CapInsight | null): Promise<{ updatedAt: number }> {
  const res = await apiRequest("PUT", `/api/capitalism/flows/${encodeURIComponent(slug)}/insight`, { insight });
  return (await res.json()) as { updatedAt: number };
}
