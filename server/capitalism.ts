// 자본주의 경제사 타임라인 — 격리된 인과 플로우 CRUD.
// 기존 storage.ts(DatabaseStorage/IStorage) 비침습: 같은 lazy db만 재사용한다.
import { db } from "./storage.js";
import { capFlows, capNodes, capEdges, capLinks } from "../shared/schema.js";
import type { CapFlow, CapNode, CapEdge, CapLink } from "../shared/schema.js";
import { eq, asc, desc, and, or } from "drizzle-orm";

// 노드별 표(메모와 같은 층위). 일반 텍스트 셀 + 열 너비(px). text 필드의 [[..]] 마커와 독립.
export interface CapTableData {
  title?: string;     // 표 제목(선택)
  widths: number[];   // 열별 너비(flex 비율)
  cells: string[][];  // [행][열] 일반 텍스트
}

// 프론트가 그대로 쓰는 합본 플로우 형태(노드/엣지 임베드).
export interface FlowNodeDTO {
  id: string;        // = node_key (플로우 내 고유)
  kind: string;      // cause | event | effect | result
  inLabel: string | null;
  text: string;
  ref: string | null;
  col?: string | null;
  table: CapTableData | null; // 노드별 표(없으면 null)
}
export interface FlowEdgeDTO { from: string; to: string }
export interface FlowDTO {
  id: number;
  slug: string;
  date: string;
  endDate: string | null; // 있으면 기간 이벤트(date~endDate), 없으면 단일 시점
  year: number;
  title: string;
  category: string;
  layout: string;
  sortOrder: number;
  nodes: FlowNodeDTO[];
  edges: FlowEdgeDTO[];
}

// 입력(에디터에서 저장): id 없는 합본 1건.
export interface FlowInput {
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

// table_data(JSON 문자열) → CapTableData. 깨졌거나 형식 불일치면 null 로 안전 폴백.
function parseTableData(raw: string | null | undefined): CapTableData | null {
  if (!raw) return null;
  try {
    const t = JSON.parse(raw);
    if (!t || !Array.isArray(t.widths) || !Array.isArray(t.cells)) return null;
    return {
      title: typeof t.title === "string" ? t.title : "",
      widths: t.widths.map((w: any) => Number(w) || 0),
      cells: t.cells.map((row: any) => (Array.isArray(row) ? row.map((c: any) => String(c ?? "")) : [])),
    };
  } catch { return null; }
}

// 빈 문자열·공백은 null 로 정규화(기간 해제). 종료일이 시작일보다 빠르면 무시.
function normEndDate(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = v.trim();
  return s.length ? s : null;
}

function assemble(flow: CapFlow, nodes: CapNode[], edges: CapEdge[]): FlowDTO {
  return {
    id: flow.id,
    slug: flow.slug,
    date: flow.date,
    endDate: flow.endDate ?? null,
    year: flow.year,
    title: flow.title,
    category: flow.category,
    layout: flow.layout,
    sortOrder: flow.sortOrder,
    nodes: nodes
      .sort((a, b) => a.pos - b.pos)
      .map((n) => ({ id: n.nodeKey, kind: n.kind, inLabel: n.inLabel, text: n.text, ref: n.ref, col: n.col, table: parseTableData(n.tableData) })),
    edges: edges.map((e) => ({ from: e.fromKey, to: e.toKey })),
  };
}

export async function listFlows(): Promise<FlowDTO[]> {
  // 연대기 타임라인: 날짜 우선 정렬(동일 날짜는 sortOrder로 안정화).
  const flows = await db.select().from(capFlows).orderBy(asc(capFlows.date), asc(capFlows.sortOrder));
  if (flows.length === 0) return [];
  const allNodes = await db.select().from(capNodes);
  const allEdges = await db.select().from(capEdges);
  const nodesByFlow = new Map<number, CapNode[]>();
  const edgesByFlow = new Map<number, CapEdge[]>();
  for (const n of allNodes) (nodesByFlow.get(n.flowId) ?? nodesByFlow.set(n.flowId, []).get(n.flowId)!).push(n);
  for (const e of allEdges) (edgesByFlow.get(e.flowId) ?? edgesByFlow.set(e.flowId, []).get(e.flowId)!).push(e);
  return flows.map((f) => assemble(f, nodesByFlow.get(f.id) ?? [], edgesByFlow.get(f.id) ?? []));
}

// upsert by slug: 같은 slug면 통째로 교체(노드/엣지 삭제 후 재삽입). 에디터 저장용.
// ⚠️ delete→reinsert 를 '트랜잭션'으로 감싼다 — 중간(재삽입) 실패 시 전부 롤백되어
//    기존 노드가 통째로 사라지는 데이터 손실을 막는다(원자성).
export async function upsertFlow(input: FlowInput): Promise<FlowDTO> {
  const now = Date.now();
  return await db.transaction(async (tx) => {
    const existing = (await tx.select().from(capFlows).where(eq(capFlows.slug, input.slug))).at(0);

    let flowId: number;
    if (existing) {
      await tx.update(capFlows).set({
        date: input.date, endDate: normEndDate(input.endDate), year: input.year, title: input.title,
        category: input.category, layout: input.layout,
        sortOrder: input.sortOrder ?? existing.sortOrder, updatedAt: now,
      }).where(eq(capFlows.id, existing.id));
      flowId = existing.id;
      await tx.delete(capNodes).where(eq(capNodes.flowId, flowId));
      await tx.delete(capEdges).where(eq(capEdges.flowId, flowId));
    } else {
      // sortOrder 미지정 시 기존 최대값+1로 자동 부여(새 항목이 뒤로).
      let nextOrder = input.sortOrder;
      if (nextOrder === undefined) {
        const top = (await tx.select().from(capFlows).orderBy(desc(capFlows.sortOrder)).limit(1)).at(0);
        nextOrder = top ? top.sortOrder + 1 : 0;
      }
      const inserted = await tx.insert(capFlows).values({
        slug: input.slug, date: input.date, endDate: normEndDate(input.endDate), year: input.year, title: input.title,
        category: input.category, layout: input.layout,
        sortOrder: nextOrder, createdAt: now, updatedAt: now,
      }).returning();
      flowId = inserted[0].id;
    }

    if (input.nodes.length) {
      await tx.insert(capNodes).values(input.nodes.map((n, i) => ({
        flowId, nodeKey: n.nodeKey, kind: n.kind,
        inLabel: n.inLabel ?? null, text: n.text, ref: n.ref ?? null,
        col: n.col ?? null, tableData: n.table ? JSON.stringify(n.table) : null, pos: i,
      })));
    }
    if (input.edges.length) {
      await tx.insert(capEdges).values(input.edges.map((e) => ({ flowId, fromKey: e.from, toKey: e.to })));
    }

    const flow = (await tx.select().from(capFlows).where(eq(capFlows.id, flowId)))[0];
    const nodes = await tx.select().from(capNodes).where(eq(capNodes.flowId, flowId));
    const edges = await tx.select().from(capEdges).where(eq(capEdges.flowId, flowId));
    return assemble(flow, nodes, edges);
  });
}

export async function deleteFlow(slug: string): Promise<void> {
  await db.transaction(async (tx) => {
    const existing = (await tx.select().from(capFlows).where(eq(capFlows.slug, slug))).at(0);
    if (!existing) return;
    await tx.delete(capFlows).where(eq(capFlows.id, existing.id)); // cascade nodes/edges
    // 고아 링크(카드 간 화살표) 정리 — 이 slug 가 관여한 링크를 한 번에 삭제(원자).
    await tx.delete(capLinks).where(or(eq(capLinks.fromSlug, slug), eq(capLinks.toSlug, slug)));
  });
}

// ============================================================================
// 보드 전역 화살표(링크) — 카드 내/간 드래그앤드롭 연결
// ============================================================================
export interface LinkDTO {
  id: number;
  fromSlug: string;
  fromKey: string;
  toSlug: string;
  toKey: string;
}

function assembleLink(l: CapLink): LinkDTO {
  return { id: l.id, fromSlug: l.fromSlug, fromKey: l.fromKey, toSlug: l.toSlug, toKey: l.toKey };
}

export async function listLinks(): Promise<LinkDTO[]> {
  const rows = await db.select().from(capLinks).orderBy(asc(capLinks.id));
  return rows.map(assembleLink);
}

export async function addLink(input: { fromSlug: string; fromKey: string; toSlug: string; toKey: string }): Promise<LinkDTO> {
  // 자기 자신 연결 금지.
  if (input.fromSlug === input.toSlug && input.fromKey === input.toKey) {
    throw new Error("같은 노드끼리는 연결할 수 없습니다.");
  }
  // 이미 존재하는 연결이면 그대로 반환(멱등).
  const dup = (await db.select().from(capLinks).where(and(
    eq(capLinks.fromSlug, input.fromSlug),
    eq(capLinks.fromKey, input.fromKey),
    eq(capLinks.toSlug, input.toSlug),
    eq(capLinks.toKey, input.toKey),
  ))).at(0);
  if (dup) return assembleLink(dup);
  // 역방향 연결이 있으면 제거(방향 변경 = 역방향으로 다시 드래그).
  const reverse = (await db.select().from(capLinks).where(and(
    eq(capLinks.fromSlug, input.toSlug),
    eq(capLinks.fromKey, input.toKey),
    eq(capLinks.toSlug, input.fromSlug),
    eq(capLinks.toKey, input.fromKey),
  ))).at(0);
  if (reverse) await db.delete(capLinks).where(eq(capLinks.id, reverse.id));

  const inserted = await db.insert(capLinks).values({
    fromSlug: input.fromSlug, fromKey: input.fromKey,
    toSlug: input.toSlug, toKey: input.toKey, createdAt: Date.now(),
  }).returning();
  return assembleLink(inserted[0]);
}

export async function deleteLink(id: number): Promise<void> {
  await db.delete(capLinks).where(eq(capLinks.id, id));
}
