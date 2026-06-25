// 자본주의 타임라인 — 공유 타입 (server/capitalism.ts 의 DTO 와 일치).

// 노드별 표(메모와 같은 층위). 일반 텍스트 셀 + 열 너비(px).
//   widths.length = 열 수, cells.length = 행 수, 각 cells[r].length = 열 수.
export interface CapTableData {
  title?: string;        // 표 제목(선택)
  widths: number[];      // 열별 너비(flex 비율)
  cells: string[][];     // [행][열] 일반 텍스트
}

// 사건 인사이트(과거↔현재 연결). 리치텍스트 본문 + 참고 그래프 N개.
export interface CapInsightChart {
  series: string;  // PANELS.series 키
  from: number;    // 소수 연도(시작)
  to: number;      // 소수 연도(끝)
}
// 본문 블록 — 텍스트/표/이미지/그래프를 순서대로 섞어 배치(글 중간 삽입·재배치).
//   blocks 가 있으면 본문의 단일 출처(순서 보존). 없으면 레거시(text+tables+charts/images)에서 파생.
export type CapBlock =
  | { type: "text"; text: string }            // 리치텍스트 마커 문자열
  | { type: "table"; table: CapTableData }
  | { type: "image"; image: CapImageData }
  | { type: "chart"; chart: CapInsightChart };

export interface CapInsight {
  text: string;              // 리치텍스트 마커 문자열(레거시·검색용; blocks 의 텍스트 블록 합본)
  charts: CapInsightChart[]; // 참고 그래프(레거시·역호환)
  tables?: CapTableData[];   // 표(레거시·역호환)
  blocks?: CapBlock[];       // 본문 블록(있으면 순서의 단일 출처)
}

// 메타 인사이트 이미지. src 는 data URL(붙여넣기 시 캔버스로 가로 축소·비율 유지) 또는 URL.
export interface CapImageData {
  src: string;     // data:image/webp;base64,... 또는 https://...
  alt?: string;    // 대체 텍스트(선택)
}

// 전체 관통 메타 인사이트 카드 — 특정 사건에 안 묶이는 app-level 인사이트(여러 장 가능).
// 설정 키 insight_overview_v2 에 { cards: CapMetaCard[] } JSON 으로 저장.
export interface CapMetaCard {
  id: string;                // 안정적 키(클라이언트 생성)
  title?: string;            // 카드 소제목(선택)
  text: string;              // 리치텍스트 본문(레거시·검색용; blocks 텍스트 합본)
  tables?: CapTableData[];   // 표(레거시·역호환)
  images?: CapImageData[];   // 이미지(레거시·역호환)
  blocks?: CapBlock[];       // 본문 블록(있으면 순서의 단일 출처)
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
  insight?: CapInsight | null; // 사건 인사이트(없으면 null)
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
  insight?: CapInsight | null;
  sortOrder?: number;
  nodes: { nodeKey: string; kind: string; inLabel?: string | null; text: string; ref?: string | null; col?: string | null; table?: CapTableData | null }[];
  edges: { from: string; to: string }[];
}
