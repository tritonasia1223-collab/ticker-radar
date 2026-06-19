// 자본주의 타임라인 — 공유 타입 (server/capitalism.ts 의 DTO 와 일치).

// 노드별 표(메모와 같은 층위). 일반 텍스트 셀 + 열 너비(px).
//   widths.length = 열 수, cells.length = 행 수, 각 cells[r].length = 열 수.
export interface CapTableData {
  widths: number[];      // 열별 너비(px)
  cells: string[][];     // [행][열] 일반 텍스트
}

export interface FlowNodeDTO {
  id: string;
  kind: "cause" | "event" | "effect" | "result" | string;
  inLabel: string | null;
  text: string;
  ref: string | null;
  col?: string | null;
  table?: CapTableData | null; // 노드별 표(없으면 null)
}
export interface FlowEdgeDTO { from: string; to: string }
export interface FlowDTO {
  id: number;
  slug: string;
  date: string;
  endDate?: string | null; // 있으면 기간 이벤트(date~endDate), 없으면 단일 시점
  year: number;
  title: string;
  category: "정치" | "경제" | "사회" | string;
  layout: "stack" | "branch" | string;
  sortOrder: number;
  nodes: FlowNodeDTO[];
  edges: FlowEdgeDTO[];
}

// 보드 전역 화살표(링크) — 카드 내/간 드래그앤드롭 연결
export interface LinkDTO {
  id: number;
  fromSlug: string;
  fromKey: string;
  toSlug: string;
  toKey: string;
}

// 에디터 입력 (POST /api/capitalism/flows)
export interface FlowInputDTO {
  slug: string;
  date: string;
  endDate?: string | null;
  year: number;
  title: string;
  category: string;
  layout: string;
  sortOrder?: number;
  nodes: { nodeKey: string; kind: string; inLabel?: string | null; text: string; ref?: string | null; col?: string | null; table?: CapTableData | null }[];
  edges: { from: string; to: string }[];
}
