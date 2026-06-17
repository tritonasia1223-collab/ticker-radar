// 자본주의 타임라인 — 공유 타입 (server/capitalism.ts 의 DTO 와 일치).
export interface FlowNodeDTO {
  id: string;
  kind: "cause" | "event" | "effect" | "result" | string;
  inLabel: string | null;
  text: string;
  ref: string | null;
  col?: string | null;
}
export interface FlowEdgeDTO { from: string; to: string }
export interface FlowDTO {
  id: number;
  slug: string;
  date: string;
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
  year: number;
  title: string;
  category: string;
  layout: string;
  sortOrder?: number;
  nodes: { nodeKey: string; kind: string; inLabel?: string | null; text: string; ref?: string | null; col?: string | null }[];
  edges: { from: string; to: string }[];
}
