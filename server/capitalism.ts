// 자본주의 경제사 타임라인 — 격리된 인과 플로우 CRUD.
// 기존 storage.ts(DatabaseStorage/IStorage) 비침습: 같은 lazy db만 재사용한다.
import { db } from "./storage.js";
import { capFlows, capNodes, capEdges, capLinks, capSettings, capFlowHistory } from "../shared/schema.js";
import type { CapFlow, CapNode, CapEdge, CapLink } from "../shared/schema.js";
import { eq, asc, desc, and, or, lt } from "drizzle-orm";

// ── version-on-write 히스토리 ────────────────────────────────────────────────
// 카드를 덮어쓰기/삭제하기 '직전' 상태를 스냅샷으로 남긴다. 편집(저장) 순간에만 쌓이므로 유휴 시 낭비 0.
// best-effort: 히스토리 실패는 절대 저장을 막지 않는다(로그만). 카드별 최근 HIST_KEEP개만 보관.
const HIST_KEEP = 50;
async function recordHistorySafe(slug: string, reason: string): Promise<void> {
  try {
    const flow = (await db.select().from(capFlows).where(eq(capFlows.slug, slug))).at(0);
    if (!flow) return; // 스냅샷할 이전 상태 없음(신규 생성 등)
    const [nodes, edges] = await Promise.all([
      db.select().from(capNodes).where(eq(capNodes.flowId, flow.id)),
      db.select().from(capEdges).where(eq(capEdges.flowId, flow.id)),
    ]);
    await db.insert(capFlowHistory).values({
      flowSlug: slug, takenAt: Date.now(), reason, snapshot: JSON.stringify({ flow, nodes, edges }),
    });
    // prune: 이 slug 의 최근 HIST_KEEP개만 남기고 오래된 것 삭제.
    const recent = await db.select({ id: capFlowHistory.id }).from(capFlowHistory)
      .where(eq(capFlowHistory.flowSlug, slug)).orderBy(desc(capFlowHistory.id)).limit(HIST_KEEP);
    if (recent.length === HIST_KEEP) {
      await db.delete(capFlowHistory).where(and(eq(capFlowHistory.flowSlug, slug), lt(capFlowHistory.id, recent[HIST_KEEP - 1].id)));
    }
  } catch (e) {
    console.error("[cap-history] 기록 실패(저장은 정상 진행):", (e as Error).message);
  }
}

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
// 사건 인사이트 — 본문 블록(텍스트/표/이미지/그래프 순서 혼합) + 레거시 평면 필드.
export interface CapInsightChart { series: string; from: number; to: number }
export interface CapImageData { src: string; alt?: string }
export interface CapHtmlData { src: string; height?: number }
export type CapBlock =
  | { type: "text"; text: string }
  | { type: "table"; table: CapTableData }
  | { type: "image"; image: CapImageData }
  | { type: "chart"; chart: CapInsightChart }
  | { type: "html"; html: CapHtmlData };
export interface CapInsight { text: string; charts: CapInsightChart[]; tables?: CapTableData[]; blocks?: CapBlock[] }
export interface FlowDTO {
  id: number;
  updatedAt: number; // 낙관적 동시성 버전(저장마다 갱신). 클라가 저장 시 baseVersion 으로 되돌려보냄.
  slug: string;
  date: string;
  endDate: string | null; // 있으면 기간 이벤트(date~endDate), 없으면 단일 시점
  year: number;
  title: string;
  category: string;
  layout: string;
  insight: CapInsight | null; // 사건 인사이트(없으면 null)
  sortOrder: number;
  nodes: FlowNodeDTO[];
  edges: FlowEdgeDTO[];
}

// 저장 충돌(낙관적 동시성): 클라가 보낸 baseVersion 이 DB 현재 updatedAt 과 다르면 —
// 그새 다른 곳에서 이 카드가 먼저 저장됐다는 뜻. 통째 교체(full-replace) 저장이라
// 그대로 진행하면 앞선 저장을 조용히 덮어써 데이터가 소실된다. 이 에러로 저장을 막고,
// 라우트가 409 로 변환 → 클라는 최신본을 다시 불러오고 사용자에게 알린다.
export class FlowConflictError extends Error {
  constructor(public readonly currentVersion: number) {
    super("FLOW_CONFLICT");
    this.name = "FlowConflictError";
  }
}

// 세분화 노드 저장(patchNode)에서 대상 노드가 서버에 없을 때. 라우트가 404 로 변환 →
// 클라는 구조 저장(full POST)으로 pos·col·edges 를 포함해 올바로 반영한다(patch 로 위상을 만들지 않음).
export class NodeNotFoundError extends Error {
  constructor() {
    super("NODE_NOT_FOUND");
    this.name = "NodeNotFoundError";
  }
}

// 입력(에디터에서 저장): id 없는 합본 1건.
export interface FlowInput {
  // 낙관적 동시성: 클라가 이 카드를 불러온 시점의 updatedAt. 생략하면(undo·복원 등) 검사 안 하고 강제 저장.
  baseVersion?: number;
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

// insight(JSON 문자열) → CapInsight. 깨졌거나 형식 불일치면 null 폴백.
function parseInsight(raw: string | null | undefined): CapInsight | null {
  if (!raw) return null;
  try {
    const t = JSON.parse(raw);
    if (!t || typeof t.text !== "string") return null;
    const charts = Array.isArray(t.charts)
      ? t.charts
          .filter((c: any) => c && typeof c.series === "string")
          .map((c: any) => ({ series: String(c.series), from: Number(c.from) || 0, to: Number(c.to) || 0 }))
      : [];
    const tables = Array.isArray(t.tables)
      ? t.tables.map(sanitizeTable).filter((x: CapTableData | null): x is CapTableData => x !== null)
      : [];
    const blocks = Array.isArray(t.blocks)
      ? t.blocks.map(sanitizeBlock).filter((x: CapBlock | null): x is CapBlock => x !== null)
      : undefined;
    // 본문도 그래프도 표도 블록도 없으면 인사이트 없음으로 취급.
    if (!t.text.trim() && charts.length === 0 && tables.length === 0 && !(blocks && blocks.length)) return null;
    return { text: t.text, charts, tables, ...(blocks && blocks.length ? { blocks } : {}) };
  } catch { return null; }
}

// 블록 정규화(텍스트/표/이미지/그래프). 형식 불일치면 null.
function sanitizeBlock(b: any): CapBlock | null {
  if (!b || typeof b.type !== "string") return null;
  if (b.type === "text") return typeof b.text === "string" ? { type: "text", text: b.text } : null;
  if (b.type === "table") { const t = sanitizeTable(b.table); return t ? { type: "table", table: t } : null; }
  if (b.type === "image") return b.image && typeof b.image.src === "string"
    ? { type: "image", image: { src: String(b.image.src), ...(typeof b.image.alt === "string" ? { alt: b.image.alt } : {}) } } : null;
  if (b.type === "chart") return b.chart && typeof b.chart.series === "string"
    ? { type: "chart", chart: { series: String(b.chart.series), from: Number(b.chart.from) || 0, to: Number(b.chart.to) || 0 } } : null;
  if (b.type === "html") return b.html && typeof b.html.src === "string"
    ? { type: "html", html: { src: String(b.html.src), ...(Number(b.html.height) ? { height: Number(b.html.height) } : {}) } } : null;
  return null;
}

// table_data(JSON 문자열) → CapTableData. 깨졌거나 형식 불일치면 null 로 안전 폴백.
// 표 객체 정규화(노드 표 · 인사이트 표 공용). 형식 불일치면 null.
function sanitizeTable(t: any): CapTableData | null {
  if (!t || !Array.isArray(t.widths) || !Array.isArray(t.cells)) return null;
  return {
    title: typeof t.title === "string" ? t.title : "",
    widths: t.widths.map((w: any) => Number(w) || 0),
    cells: t.cells.map((row: any) => (Array.isArray(row) ? row.map((c: any) => String(c ?? "")) : [])),
  };
}
function parseTableData(raw: string | null | undefined): CapTableData | null {
  if (!raw) return null;
  try { return sanitizeTable(JSON.parse(raw)); } catch { return null; }
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
    updatedAt: Number(flow.updatedAt),
    slug: flow.slug,
    date: flow.date,
    endDate: flow.endDate ?? null,
    year: flow.year,
    title: flow.title,
    category: flow.category,
    layout: flow.layout,
    insight: parseInsight(flow.insight),
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
  // 본문도 그래프도 없는 인사이트는 null 로 저장(빈 인사이트 보존 안 함).
  const insightJson = input.insight && (input.insight.text.trim() || input.insight.charts.length || input.insight.tables?.length || input.insight.blocks?.length)
    ? JSON.stringify(input.insight) : null;
  await recordHistorySafe(input.slug, "upsert"); // 덮어쓰기 직전 상태 보관(존재할 때만)
  return await db.transaction(async (tx) => {
    const existing = (await tx.select().from(capFlows).where(eq(capFlows.slug, input.slug))).at(0);

    let flowId: number;
    if (existing) {
      // 낙관적 동시성 가드 + TOCTOU 봉쇄: baseVersion 이 있으면 'updated_at 이 그대로일 때만' 조건부 UPDATE.
      //   SELECT 로 검사만 하면 두 저장이 수십 ms 내 겹칠 때 둘 다 통과해 나중 것이 앞 것을 덮는다(레이스).
      //   조건부 UPDATE 는 READ COMMITTED 에서 앞 트랜잭션 커밋 후 재평가되어 0행 → 충돌로 확정한다.
      const setData = {
        date: input.date, endDate: normEndDate(input.endDate), year: input.year, title: input.title,
        category: input.category, layout: input.layout, insight: insightJson,
        sortOrder: input.sortOrder ?? existing.sortOrder, updatedAt: now,
      };
      if (input.baseVersion != null) {
        const res = await tx.update(capFlows).set(setData)
          .where(and(eq(capFlows.id, existing.id), eq(capFlows.updatedAt, Number(input.baseVersion))))
          .returning({ id: capFlows.id });
        if (res.length === 0) throw new FlowConflictError(Number(existing.updatedAt));
      } else {
        // baseVersion 미지정(undo·복원 등) = 강제 저장.
        await tx.update(capFlows).set(setData).where(eq(capFlows.id, existing.id));
      }
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
        category: input.category, layout: input.layout, insight: insightJson,
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
  await recordHistorySafe(slug, "delete"); // 삭제 직전 상태 보관(되살릴 수 있게)
  await db.transaction(async (tx) => {
    const existing = (await tx.select().from(capFlows).where(eq(capFlows.slug, slug))).at(0);
    if (!existing) return;
    await tx.delete(capFlows).where(eq(capFlows.id, existing.id)); // cascade nodes/edges
    // 고아 링크(카드 간 화살표) 정리 — 이 slug 가 관여한 링크를 한 번에 삭제(원자).
    await tx.delete(capLinks).where(or(eq(capLinks.fromSlug, slug), eq(capLinks.toSlug, slug)));
  });
}

// ── 세분화 저장(실시간 자동저장 경량화) ──────────────────────────────────────
// 기존 upsertFlow 는 '카드 통째 교체'(노드 전량 DELETE→재INSERT + insight 블롭 동봉)라,
// 노드 한 줄 타이핑에도 insight·전체 노드를 매번 실어보내 (1) 느리고(버벅임) (2) 전체목록
// 덮어쓰기로 다른 편집을 스테일 스냅샷으로 소실시켰다. 아래 두 함수는 '바뀐 것 1건'만 건드린다.

// 단일 노드의 '내용'만 갱신(text/ref/inLabel/kind/col/table). 위상(pos·edges)·insight 는 불변.
//   → 서로 다른 노드 편집은 절대 충돌하지 않으므로 버전검사 없음. flow.updatedAt 만 올려
//     클라가 그 값을 되받아 다음 '구조 저장'(POST /flows, 버전가드 A)의 baseVersion 을 최신으로 유지.
export interface NodeContentPatch {
  kind?: string;
  inLabel?: string | null;
  text?: string;
  ref?: string | null;
  col?: string | null;
  table?: CapTableData | null;
}
export async function patchNode(slug: string, nodeKey: string, patch: NodeContentPatch): Promise<{ updatedAt: number }> {
  const now = Date.now();
  await recordHistorySafe(slug, "patch"); // 노드 내용 덮어쓰기 직전 상태 보관
  return await db.transaction(async (tx) => {
    const flow = (await tx.select().from(capFlows).where(eq(capFlows.slug, slug))).at(0);
    if (!flow) throw new Error("존재하지 않는 카드입니다.");
    const set: Partial<typeof capNodes.$inferInsert> = {};
    if (patch.text !== undefined) set.text = patch.text;
    if (patch.ref !== undefined) set.ref = patch.ref ?? null;
    if (patch.inLabel !== undefined) set.inLabel = patch.inLabel ?? null;
    if (patch.kind !== undefined) set.kind = patch.kind;
    if (patch.col !== undefined) set.col = patch.col ?? null;
    if (patch.table !== undefined) set.tableData = patch.table ? JSON.stringify(sanitizeTable(patch.table)) : null;
    const updated = Object.keys(set).length
      ? await tx.update(capNodes).set(set).where(and(eq(capNodes.flowId, flow.id), eq(capNodes.nodeKey, nodeKey))).returning()
      : await tx.select().from(capNodes).where(and(eq(capNodes.flowId, flow.id), eq(capNodes.nodeKey, nodeKey)));
    if (updated.length === 0) {
      // 서버에 없는 노드 → patch 로 만들지 않는다(과거: col=null·pos=맨아래로 삽입돼 우측 열 내용이
      //   맨 아래로 떨어지던 버그의 원인). 404 를 던져 클라가 구조 저장(full POST)으로 올바로 반영하게 한다.
      throw new NodeNotFoundError();
    }
    await tx.update(capFlows).set({ updatedAt: now }).where(eq(capFlows.id, flow.id));
    return { updatedAt: now };
  });
}

// 인사이트 블롭만 갱신(노드·위상 불변). 이미지 등 큰 blocks 는 이 경로로만 오가고, 노드 저장에는 안 실린다.
//   insight 는 라우트의 zod(capInsightSchema)로 이미 정제된 값이 들어온다. 빈 인사이트는 null 로 저장.
export async function setInsight(slug: string, insight: CapInsight | null): Promise<{ updatedAt: number }> {
  const now = Date.now();
  const insightJson = insight && (insight.text.trim() || insight.charts.length || insight.tables?.length || insight.blocks?.length)
    ? JSON.stringify(insight) : null;
  const flow = (await db.select().from(capFlows).where(eq(capFlows.slug, slug))).at(0);
  if (!flow) throw new Error("존재하지 않는 카드입니다.");
  await recordHistorySafe(slug, "insight"); // 인사이트 덮어쓰기 직전 상태 보관
  await db.update(capFlows).set({ insight: insightJson, updatedAt: now }).where(eq(capFlows.id, flow.id));
  return { updatedAt: now };
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

// ============================================================================
// app-level 설정(키-값) — 메타 테제(insight_overview) 등 사건에 안 묶이는 텍스트
// ============================================================================
export async function getSetting(key: string): Promise<string | null> {
  const row = (await db.select().from(capSettings).where(eq(capSettings.key, key))).at(0);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string | null): Promise<void> {
  const now = Date.now();
  const existing = (await db.select().from(capSettings).where(eq(capSettings.key, key))).at(0);
  if (existing) await db.update(capSettings).set({ value, updatedAt: now }).where(eq(capSettings.key, key));
  else await db.insert(capSettings).values({ key, value, updatedAt: now });
}
