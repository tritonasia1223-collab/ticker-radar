import type { Express } from "express";
import { z } from "zod";
import { sql, eq, asc, desc, gt } from "drizzle-orm";
import { db } from "./storage.js";
import { capFlows, capNodes, capEdges, capLinks, capSettings, capEditOperations, capEditors } from "../shared/schema.js";
import { assemble } from "./capitalism.js";
import { diff, equal, flowDocument, merge, type Document, type EditRequest, type Resource } from "../shared/cap-collaboration.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const requestSchema = z.object({ id: z.string().uuid(), resource: z.string().regex(/^(flow|meta):[^\s]{1,200}$/), editor: z.string().trim().min(1).max(50), session: z.string().uuid(),
  changes: z.array(z.object({ path: z.array(z.string().min(1).max(200)).max(3), before: z.any().refine((v) => v !== undefined), after: z.any().refine((v) => v !== undefined) })).min(1).max(5000) });
const table = z.object({ title: z.string().optional(), widths: z.array(z.number().finite().nonnegative()), cells: z.array(z.array(z.string())) }).nullable();
const chart = z.object({ series: z.string(), from: z.number().finite(), to: z.number().finite() });
const image = z.object({ src: z.string(), alt: z.string().optional() });
const block = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("table"), table: table.unwrap() }),
  z.object({ type: z.literal("image"), image }),
  z.object({ type: z.literal("chart"), chart }),
  z.object({ type: z.literal("html"), html: z.object({ src: z.string(), height: z.number().finite().optional() }) }),
  z.object({ type: z.literal("divider") }),
]);
const insight = z.object({ text: z.string(), charts: z.array(chart), tables: z.array(table.unwrap()).optional(), blocks: z.array(block).optional() }).nullable();
const node = z.object({ text: z.string(), kind: z.string(), inLabel: z.string().nullable(), ref: z.string().nullable(), col: z.string().nullable(), table });
const flowSchema = z.object({ title: z.string().min(1), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), endDate: z.string().nullable(), category: z.string(), layout: z.enum(["stack", "branch"]), sortOrder: z.number().int(), insight, nodes: z.record(node), order: z.array(z.string()) });
const metaSchema = z.object({ id: z.string(), title: z.string(), text: z.string(), tables: z.array(table.unwrap()), images: z.array(image), blocks: z.array(block).nullable() });
export function validateEdit(body: unknown): EditRequest {
  const op = requestSchema.parse(body) as EditRequest;
  const paths = new Set<string>();
  const allowed = op.resource.startsWith("flow:") ? ["title", "date", "endDate", "category", "layout", "sortOrder", "insight", "nodes", "order"] : ["title", "text", "tables", "images", "blocks"];
  for (const change of op.changes) {
    const path = change.path, key = JSON.stringify(path);
    if (path.some((p) => ["__proto__", "constructor", "prototype"].includes(p)) || paths.has(key)) throw new Error("잘못된 변경 경로");
    if (path.length && (!allowed.includes(path[0]) || (path.length > 1 && path[0] !== "nodes") || (path[0] === "nodes" && path.length < 2))) throw new Error("지원하지 않는 변경 경로");
    if (path.length === 3 && !["text", "kind", "inLabel", "ref", "col", "table"].includes(path[2])) throw new Error("지원하지 않는 노드 필드");
    if (op.changes.some((c) => c !== change && c.path.length < path.length && c.path.every((p, i) => p === path[i]))) throw new Error("중첩 변경 경로");
    paths.add(key);
  }
  return op;
}
const lock = (tx: Tx, key: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"cap-collab:" + key}, 0))`);
async function metaCards(tx: Tx) {
  const rows = await tx.select().from(capSettings).where(sql`${capSettings.key} in ('insight_overview_v2','insight_overview')`);
  const v2 = rows.find((r) => r.key === "insight_overview_v2");
  if (v2?.value) { const parsed = JSON.parse(v2.value); if (!Array.isArray(parsed.cards)) throw new Error("메타 카드 형식 오류"); return { cards: parsed.cards, version: Number(v2.updatedAt) }; }
  const legacy = rows.find((r) => r.key === "insight_overview");
  return { cards: legacy?.value?.trim() ? [{ id: "meta-legacy", title: "", text: legacy.value, tables: [], images: [], blocks: null }] : [], version: Number(v2?.updatedAt ?? legacy?.updatedAt ?? 0) };
}
async function readResource(tx: Tx, key: string): Promise<Resource> {
  const id = key.slice(5);
  if (key.startsWith("meta:")) {
    const { cards, version } = await metaCards(tx), card = cards.find((c: any) => c.id === id);
    return { key, version, doc: card ? { id: card.id, title: card.title ?? "", text: card.text ?? "", tables: card.tables ?? [], images: card.images ?? [], blocks: card.blocks ?? null } : null };
  }
  const flow = (await tx.select().from(capFlows).where(eq(capFlows.slug, id)))[0];
  if (!flow) return { key, version: 0, doc: null };
  const nodes = await tx.select().from(capNodes).where(eq(capNodes.flowId, flow.id)).orderBy(asc(capNodes.pos));
  return { key, version: Number(flow.updatedAt), doc: flowDocument(assemble(flow, nodes, [])) };
}
export async function getResource(key: string, database = db): Promise<Resource> {
  return database.transaction(async (tx) => { await lock(tx, key.startsWith("meta:") ? "meta" : key); return readResource(tx, key); });
}
function edgeList(doc: NonNullable<Document>): { from: string; to: string }[] {
  const nodes = doc.nodes as Record<string, any>, order = doc.order as string[];
  const chain = (ids: string[]) => ids.slice(1).map((id, i) => ({ from: ids[i], to: id }));
  if (doc.layout !== "branch") return chain(order);
  const center = order.filter((id) => !nodes[id].col || nodes[id].col === "center"), result: { from: string; to: string }[] = [];
  for (const col of ["left", "right"]) {
    const branch = order.filter((id) => nodes[id].col === col);
    if (!branch.length) continue;
    if (center[0]) result.push({ from: center[0], to: branch[0] });
    result.push(...chain(branch));
    if (center.length > 1) result.push({ from: branch.at(-1)!, to: center.at(-1)! });
  }
  return result;
}
async function writeResource(tx: Tx, current: Resource, doc: Document): Promise<Resource> {
  const key = current.key, id = key.slice(5), version = Math.max(Date.now(), current.version + 1);
  if (key.startsWith("meta:")) {
    const { cards } = await metaCards(tx);
    if (doc) { doc = metaSchema.parse(doc) as Document; if (doc!.id !== id) throw new Error("메타 카드 ID 불일치"); }
    const next = cards.filter((c: any) => c.id !== id);
    if (doc) { const at = cards.findIndex((c: any) => c.id === id); next.splice(at < 0 ? next.length : at, 0, doc); }
    await tx.insert(capSettings).values({ key: "insight_overview_v2", value: JSON.stringify({ cards: next }), updatedAt: version }).onConflictDoUpdate({ target: capSettings.key, set: { value: JSON.stringify({ cards: next }), updatedAt: version } });
  } else if (!doc) {
    await tx.delete(capLinks).where(sql`${capLinks.fromSlug} = ${id} or ${capLinks.toSlug} = ${id}`);
    await tx.delete(capFlows).where(eq(capFlows.slug, id));
  } else {
    doc = flowSchema.parse(doc) as Document;
    const d = doc!, nodes = d.nodes as Record<string, any>, order = d.order as string[];
    if (new Set(order).size !== order.length || order.length !== Object.keys(nodes).length || order.some((key) => !nodes[key])) throw new Error("칸 순서와 목록이 일치하지 않습니다.");
    const set = { title: String(d.title), date: String(d.date), endDate: d.endDate as string | null, year: Number(String(d.date).slice(0, 4)), category: String(d.category), layout: String(d.layout), sortOrder: Number(d.sortOrder), insight: d.insight ? JSON.stringify(d.insight) : null, updatedAt: version };
    const row = (await tx.insert(capFlows).values({ slug: id, createdAt: version, ...set }).onConflictDoUpdate({ target: capFlows.slug, set }).returning())[0];
    const oldNodes = (current.doc?.nodes ?? {}) as Record<string, any>;
    // Only changed/deleted nodes are touched. Unrelated node rows retain their IDs and contents.
    for (const old of Object.keys(oldNodes)) if (!nodes[old]) {
      await tx.delete(capNodes).where(sql`${capNodes.flowId} = ${row.id} and ${capNodes.nodeKey} = ${old}`);
      await tx.delete(capLinks).where(sql`(${capLinks.fromSlug} = ${id} and ${capLinks.fromKey} = ${old}) or (${capLinks.toSlug} = ${id} and ${capLinks.toKey} = ${old})`);
    }
    for (const [pos, nodeKey] of order.entries()) {
      const n = nodes[nodeKey];
      if (equal(n, oldNodes[nodeKey]) && (current.doc?.order as string[] | undefined)?.indexOf(nodeKey) === pos) continue;
      const data = { kind: n.kind, text: n.text, ref: n.ref, inLabel: n.inLabel, col: n.col, tableData: n.table ? JSON.stringify(n.table) : null, pos };
      await tx.insert(capNodes).values({ flowId: row.id, nodeKey, ...data }).onConflictDoUpdate({ target: [capNodes.flowId, capNodes.nodeKey], set: data });
    }
    if (!equal(current.doc?.order, order) || !equal(current.doc?.layout, d.layout) || diff(current.doc, doc).some((c) => c.path[2] === "col")) {
      await tx.delete(capEdges).where(eq(capEdges.flowId, row.id));
      const edges = edgeList(d);
      if (edges.length) await tx.insert(capEdges).values(edges.map((e) => ({ flowId: row.id, fromKey: e.from, toKey: e.to })));
    }
  }
  return readResource(tx, key);
}
export class CollaborationConflict extends Error {
  constructor(public current: Resource, public conflicts: ReturnType<typeof merge>["conflicts"]) { super("동일한 항목이 다른 곳에서 수정되었습니다."); }
}
export async function applyCollaborativeEdit(op: EditRequest, database = db): Promise<Resource & { operation: string }> {
  return database.transaction(async (tx) => {
    await lock(tx, "operation:" + op.id);
    await lock(tx, op.resource.startsWith("meta:") ? "meta" : op.resource);
    const prior = (await tx.select().from(capEditOperations).where(eq(capEditOperations.id, op.id)))[0];
    const current = await readResource(tx, op.resource);
    if (prior) {
      if (prior.resource !== op.resource || !equal(JSON.parse(prior.request), op.changes)) throw new Error("다른 요청에 사용한 저장 ID입니다.");
      return { ...current, operation: op.id }; // Lost response retry: never apply twice; return current authoritative state.
    }
    const merged = merge(current.doc, op.changes);
    if (merged.conflicts.length) throw new CollaborationConflict(current, merged.conflicts);
    const result = equal(current.doc, merged.doc) ? current : await writeResource(tx, current, merged.doc);
    await tx.insert(capEditOperations).values({ id: op.id, resource: op.resource, editor: op.editor, session: op.session, takenAt: Date.now(), changes: JSON.stringify(diff(current.doc, result.doc)), request: JSON.stringify(op.changes) });
    return { ...result, operation: op.id };
  });
}
export function registerCollaborationRoutes(app: Express) {
  app.get("/api/capitalism/collab/resource", async (req, res) => {
    try { const key = z.string().regex(/^(flow|meta):[^\s]{1,200}$/).parse(req.query.key); res.set("Cache-Control", "no-store").json(await getResource(key)); }
    catch (e) { res.status(e instanceof z.ZodError ? 400 : 503).json({ error: "문서를 읽지 못했습니다." }); }
  });
  app.post("/api/capitalism/collab/edit", async (req, res) => {
    try { res.json(await applyCollaborativeEdit(validateEdit(req.body))); }
    catch (e) {
      if (e instanceof CollaborationConflict) { res.status(409).json({ error: e.message, current: e.current, conflicts: e.conflicts }); return; }
      if (e instanceof z.ZodError || (e instanceof Error && /경로|필드|ID|일치|순서/.test(e.message))) { res.status(400).json({ error: String(e) }); return; }
      console.error("[cap-collab]", e); res.status(503).json({ error: "저장에 실패했습니다. 초안을 보관하고 재시도합니다." });
    }
  });
  app.get("/api/capitalism/collab/state", async (_req, res) => {
    try {
      const [flows, metas, peers] = await Promise.all([
        db.select({ key: capFlows.slug, version: capFlows.updatedAt }).from(capFlows),
        db.select({ version: capSettings.updatedAt }).from(capSettings).where(eq(capSettings.key, "insight_overview_v2")),
        db.select().from(capEditors).where(gt(capEditors.seenAt, Date.now() - 45000)),
      ]);
      res.set("Cache-Control", "no-store").json({ flows, metaVersion: Number(metas[0]?.version ?? 0), peers });
    } catch { res.status(503).json({ error: "동기화 상태를 확인하지 못했습니다." }); }
  });
  app.post("/api/capitalism/collab/presence", async (req, res) => {
    try {
      const input = z.object({ session: z.string().uuid(), editor: z.string().trim().min(1).max(50), resource: z.string().max(220).nullable() }).parse(req.body);
      const row = { ...input, seenAt: Date.now() };
      await db.insert(capEditors).values(row).onConflictDoUpdate({ target: capEditors.session, set: row });
      res.json({ ok: true });
    } catch { res.status(503).json({ error: "편집 상태 전달 실패" }); }
  });
  app.get("/api/capitalism/collab/history", async (req, res) => {
    try {
      const resource = z.string().parse(req.query.resource);
      res.json(await db.select({ id: capEditOperations.id, editor: capEditOperations.editor, takenAt: capEditOperations.takenAt }).from(capEditOperations).where(eq(capEditOperations.resource, resource)).orderBy(desc(capEditOperations.takenAt)).limit(30));
    } catch { res.status(503).json({ error: "이력을 읽지 못했습니다." }); }
  });
  app.get("/api/capitalism/collab/history-resources", async (_req, res) => {
    try { res.json(await db.selectDistinct({ key: capEditOperations.resource }).from(capEditOperations)); }
    catch { res.status(503).json({ error: "이력 카드 목록을 읽지 못했습니다." }); }
  });
  app.get("/api/capitalism/collab/history/:id", async (req, res) => {
    const row = (await db.select().from(capEditOperations).where(eq(capEditOperations.id, req.params.id)))[0];
    if (!row) { res.status(404).end(); return; }
    res.json({ ...row, changes: JSON.parse(row.changes) });
  });
}
