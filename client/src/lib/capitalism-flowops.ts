// 인라인 편집용 플로우 연산 헬퍼.
// 팝업 에디터 없이, 카드 안에서 노드 추가/수정/삭제 → 곧바로 서버 저장(POST upsert).
// 엣지는 레이아웃 규칙으로 자동 재계산한다.
//   - stack: 위→아래 선형 체인
//   - branch: center[0](출발) → left/right 각 컬럼 체인 → center[last](합류)로 합류
import { apiRequest } from "@/lib/queryClient";
import type { FlowDTO, FlowNodeDTO, FlowInputDTO } from "@/lib/capitalism-types";

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

// 플로우의 노드 배열을 통째로 저장. 빈 노드(text 공백)는 저장 시 제외.
// 모든 노드가 비면 플로우 자체를 삭제한다. 반환: "deleted" | "saved".
export async function persistNodes(
  flow: FlowDTO,
  nodes: FlowNodeDTO[]
): Promise<"deleted" | "saved"> {
  const clean = nodes.filter((n) => n.text.trim());
  if (clean.length === 0) {
    await apiRequest("DELETE", `/api/capitalism/flows/${encodeURIComponent(flow.slug)}`);
    return "deleted";
  }
  await apiRequest("POST", "/api/capitalism/flows", toInput(flow, clean));
  return "saved";
}
