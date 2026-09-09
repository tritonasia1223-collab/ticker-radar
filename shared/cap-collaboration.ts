// Browser and server share the same comparison rules. Arrays (rich blocks/tables) are atomic fields;
// node membership and order are explicit, stable-key operations rather than whole-card replacement.
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Document = { [key: string]: Json } | null;
export interface Change { path: string[]; before: Json; after: Json }
export interface Conflict extends Change { remote: Json }
export interface Resource { key: string; version: number; doc: Document }
export interface EditRequest { id: string; resource: string; editor: string; session: string; changes: Change[] }
export interface EditResult extends Resource { operation: string }
export interface Peer { session: string; editor: string; resource: string | null; seenAt: number }
export const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const object = (v: Json): v is { [key: string]: Json } => !!v && typeof v === "object" && !Array.isArray(v);
export function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => equal(x, b[i]));
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
  return Object.keys(x).length === Object.keys(y).length && Object.keys(x).every((k) => Object.hasOwn(y, k) && equal(x[k], y[k]));
}
export function read(doc: Document, path: string[]): Json {
  let value: Json = doc;
  for (const key of path) { if (!object(value) || !Object.hasOwn(value, key)) return null; value = value[key]; }
  return value;
}
export function put(doc: Document, path: string[], value: Json): Document {
  if (!path.length) return copy(value) as Document;
  if (!doc) throw new Error("삭제된 문서에 필드를 쓸 수 없습니다.");
  let at = doc;
  for (const key of path.slice(0, -1)) {
    if (!object(at[key])) throw new Error("삭제된 항목에 필드를 쓸 수 없습니다.");
    at = at[key] as Record<string, Json>;
  }
  if (value === null && path[0] === "nodes" && path.length === 2) delete at[path.at(-1)!];
  else at[path.at(-1)!] = copy(value);
  return doc;
}
export function diff(before: Document, after: Document): Change[] {
  if (equal(before, after)) return [];
  if (!before || !after) return [{ path: [], before, after }];
  const changes: Change[] = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[key] ?? null, b = after[key] ?? null;
    if (equal(a, b)) continue;
    if (key === "nodes" && object(a) && object(b)) {
      for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const old = a[id] ?? null, next = b[id] ?? null;
        if (object(old) && object(next)) {
          for (const field of new Set([...Object.keys(old), ...Object.keys(next)])) {
            if (!equal(old[field] ?? null, next[field] ?? null)) changes.push({ path: [key, id, field], before: old[field] ?? null, after: next[field] ?? null });
          }
        } else if (!equal(old, next)) changes.push({ path: [key, id], before: old, after: next });
      }
    } else changes.push({ path: [key], before: a, after: b });
  }
  return changes;
}

// Independent insert/delete membership can merge. Concurrent reordering of existing nodes conflicts.
export function mergeOrder(base: string[], local: string[], remote: string[]): string[] | null {
  const survivors = base.filter((id) => local.includes(id) && remote.includes(id));
  const ours = local.filter((id) => survivors.includes(id)), theirs = remote.filter((id) => survivors.includes(id));
  if (!equal(ours, survivors) && !equal(theirs, survivors) && !equal(ours, theirs)) return null;
  let result = remote.filter((id) => !base.includes(id) || local.includes(id));
  if (!equal(ours, survivors)) {
    let i = 0; result = result.map((id) => survivors.includes(id) ? ours[i++] : id);
  }
  for (let i = 0; i < local.length; i++) {
    const id = local[i];
    if (base.includes(id) || result.includes(id)) continue;
    const next = local.slice(i + 1).find((key) => result.includes(key));
    result.splice(next ? result.indexOf(next) : result.length, 0, id);
  }
  return result;
}
export function merge(current: Document, changes: Change[]): { doc: Document; conflicts: Conflict[] } {
  let doc = copy(current);
  const conflicts: Conflict[] = [];
  for (const change of changes) {
    const remote = read(current, change.path);
    // A nested write must never resurrect a concurrently deleted node/card, even if a field was null.
    const parentMissing = change.path.length > 0 && (!current || (change.path.length > 2 && read(current, change.path.slice(0, -1)) === null));
    if (!parentMissing && equal(remote, change.after)) continue; // idempotent same edit
    let next = change.after;
    if (!parentMissing && !equal(remote, change.before) && change.path.length === 1 && change.path[0] === "order" && Array.isArray(remote) && Array.isArray(change.before) && Array.isArray(next)) {
      const order = mergeOrder(change.before as string[], next as string[], remote as string[]);
      if (order) { doc = put(doc, change.path, order); continue; }
    }
    if (parentMissing || !equal(remote, change.before)) { conflicts.push({ ...copy(change), remote: copy(remote) }); continue; }
    doc = put(doc, change.path, next);
  }
  return { doc, conflicts };
}

export function flowDocument(flow: any): Document {
  if (!flow) return null;
  const nodes = Object.fromEntries(flow.nodes.map((n: any) => [n.id, { kind: n.kind, inLabel: n.inLabel ?? null, text: n.text, ref: n.ref ?? null, col: n.col ?? null, table: n.table ?? null }]));
  return copy({ title: flow.title, date: flow.date, endDate: flow.endDate ?? null, category: flow.category, layout: flow.layout, sortOrder: flow.sortOrder, insight: flow.insight ?? null, nodes, order: flow.nodes.map((n: any) => n.id) });
}
export function documentFlow(key: string, doc: Document, version: number, id = 0): any {
  if (!doc) return null;
  const nodes = doc.nodes as Record<string, Record<string, Json>>;
  return { ...copy(doc), slug: key.slice(5), id, updatedAt: version, year: Number(String(doc.date).slice(0, 4)),
    nodes: (doc.order as string[]).filter((key) => nodes[key]).map((key) => ({ id: key, ...nodes[key] })), edges: [] };
}
export function metaDocument(card: any): Document {
  return card ? copy({ id: card.id, title: card.title ?? "", text: card.text ?? "", tables: card.tables ?? [], images: card.images ?? [], blocks: card.blocks ?? null }) : null;
}
export const pathLabel = (path: string[]) => path.length ? path.map((s) => ({ nodes: "칸", text: "본문", ref: "메모", table: "표", title: "제목", insight: "인사이트", blocks: "본문 블록", order: "칸 순서", date: "날짜", endDate: "종료일", layout: "배치" }[s] ?? s)).join(" · ") : "카드 전체(생성/삭제)";
