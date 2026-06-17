// 자본주의 경제사 타임라인 — 격리된 인과 플로우 CRUD.
// 기존 storage.ts(DatabaseStorage/IStorage) 비침습: 같은 lazy db만 재사용한다.
import { db } from "./storage.js";
import { capFlows, capNodes, capEdges } from "../shared/schema.js";
import type { CapFlow, CapNode, CapEdge } from "../shared/schema.js";
import { eq, asc, desc } from "drizzle-orm";

// 프론트가 그대로 쓰는 합본 플로우 형태(노드/엣지 임베드).
export interface FlowNodeDTO {
  id: string;        // = node_key (플로우 내 고유)
  kind: string;      // cause | event | effect | result
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
  year: number;
  title: string;
  category: string;
  layout: string;
  sortOrder?: number;
  nodes: { nodeKey: string; kind: string; inLabel?: string | null; text: string; ref?: string | null; col?: string | null }[];
  edges: { from: string; to: string }[];
}

function assemble(flow: CapFlow, nodes: CapNode[], edges: CapEdge[]): FlowDTO {
  return {
    id: flow.id,
    slug: flow.slug,
    date: flow.date,
    year: flow.year,
    title: flow.title,
    category: flow.category,
    layout: flow.layout,
    sortOrder: flow.sortOrder,
    nodes: nodes
      .sort((a, b) => a.pos - b.pos)
      .map((n) => ({ id: n.nodeKey, kind: n.kind, inLabel: n.inLabel, text: n.text, ref: n.ref, col: n.col })),
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
export async function upsertFlow(input: FlowInput): Promise<FlowDTO> {
  const now = Date.now();
  const existing = (await db.select().from(capFlows).where(eq(capFlows.slug, input.slug))).at(0);

  let flowId: number;
  if (existing) {
    await db.update(capFlows).set({
      date: input.date, year: input.year, title: input.title,
      category: input.category, layout: input.layout,
      sortOrder: input.sortOrder ?? existing.sortOrder, updatedAt: now,
    }).where(eq(capFlows.id, existing.id));
    flowId = existing.id;
    await db.delete(capNodes).where(eq(capNodes.flowId, flowId));
    await db.delete(capEdges).where(eq(capEdges.flowId, flowId));
  } else {
    // sortOrder 미지정 시 기존 최대값+1로 자동 부여(새 항목이 뒤로).
    let nextOrder = input.sortOrder;
    if (nextOrder === undefined) {
      const top = (await db.select().from(capFlows).orderBy(desc(capFlows.sortOrder)).limit(1)).at(0);
      nextOrder = top ? top.sortOrder + 1 : 0;
    }
    const inserted = await db.insert(capFlows).values({
      slug: input.slug, date: input.date, year: input.year, title: input.title,
      category: input.category, layout: input.layout,
      sortOrder: nextOrder, createdAt: now, updatedAt: now,
    }).returning();
    flowId = inserted[0].id;
  }

  if (input.nodes.length) {
    await db.insert(capNodes).values(input.nodes.map((n, i) => ({
      flowId, nodeKey: n.nodeKey, kind: n.kind,
      inLabel: n.inLabel ?? null, text: n.text, ref: n.ref ?? null,
      col: n.col ?? null, pos: i,
    })));
  }
  if (input.edges.length) {
    await db.insert(capEdges).values(input.edges.map((e) => ({ flowId, fromKey: e.from, toKey: e.to })));
  }

  const flow = (await db.select().from(capFlows).where(eq(capFlows.id, flowId)))[0];
  const nodes = await db.select().from(capNodes).where(eq(capNodes.flowId, flowId));
  const edges = await db.select().from(capEdges).where(eq(capEdges.flowId, flowId));
  return assemble(flow, nodes, edges);
}

export async function deleteFlow(slug: string): Promise<void> {
  const existing = (await db.select().from(capFlows).where(eq(capFlows.slug, slug))).at(0);
  if (!existing) return;
  await db.delete(capFlows).where(eq(capFlows.id, existing.id)); // cascade nodes/edges
}
