// Browser and server share comparison rules. Transport paths remain stable field operations;
// prose and rich fields are compared inside the field without replacing unrelated edits.
import { blockMirrors, mergeValue, syncBlockMirrors, type Resolution, type ValueConflict } from "./cap-text-merge.js";
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Document = { [key: string]: Json } | null;
export interface Change { path: string[]; before: Json; after: Json }
export interface Conflict extends Change { remote: Json; details?: ValueConflict[] }
export interface Resource { key: string; version: number; doc: Document }
export interface EditRequest { id: string; resource: string; editor: string; session: string; changes: Change[]; schemaVersion?: 2; ifVersion?: number }
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
  // Soft deletion/restoration compares the entire record, so it cannot race a field edit.
  if ((Object.hasOwn(before, "deletedAt") || Object.hasOwn(after, "deletedAt")) && !equal(before.deletedAt, after.deletedAt)) return [{ path: [], before, after }];
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
  return withoutMirrors(changes);
}
// Blocks are authoritative. Do not ask twice about the same text through legacy search mirrors.
// Also accepts immutable requests sent by an already-open older client.
function withoutMirrors(changes: Change[]): Change[] {
  const blocks = changes.find(c => c.path.length === 1 && c.path[0] === "blocks");
  if (!blocks) return changes;
  const before = blockMirrors({ blocks: blocks.before }), after = blockMirrors({ blocks: blocks.after });
  return changes.filter(c => !(c.path.length === 1 && before && after && c.path[0] in before && equal(c.before, before[c.path[0]]) && equal(c.after, after[c.path[0]])));
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
export const mergeableField = (path: string[]) => ["title", "text", "body", "caption", "ref", "refBlue", "inLabel", "table", "tables", "blocks", "insight"].includes(path.at(-1) ?? "") && path.length > 0;
export function conflictDetails(c: Conflict): ValueConflict[] {
  return c.details ?? [{ id: JSON.stringify(c.path), location: c.path, before: c.before, local: c.after, remote: c.remote }];
}
export function merge(current: Document, changes: Change[], choices: Record<string, Resolution> = {}): { doc: Document; conflicts: Conflict[] } {
  changes = withoutMirrors(changes);
  if (current?.deletedAt && changes.some(c => c.path.length)) {
    // A delayed field edit must not be accepted inside a soft-deleted record.
    let before = { ...copy(current), deletedAt: null } as Document;
    for (const change of changes) before = put(before, change.path, change.before);
    let after = copy(before);
    for (const change of changes) after = put(after, change.path, change.after);
    return { doc: copy(current), conflicts: [{ path: [], before, after, remote: copy(current) }] };
  }
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
    if (!parentMissing && !equal(remote, change.before) && !equal(change.before, change.after) && mergeableField(change.path)) {
      const result = mergeValue(change.before, change.after, remote, change.path, choices);
      if (result.conflicts.length) conflicts.push({ ...copy(change), remote: copy(remote), details: result.conflicts });
      doc = put(doc, change.path, result.value);
      continue;
    }
    if (parentMissing || !equal(remote, change.before)) { conflicts.push({ ...copy(change), remote: copy(remote) }); continue; }
    doc = put(doc, change.path, next);
  }
  if (changes.some(c => c.path.length === 1 && c.path[0] === "blocks")) doc = syncBlockMirrors(doc, current) as Document;
  return { doc, conflicts };
}

export function flowDocument(flow: any): Document {
  if (!flow) return null;
  const nodes = Object.fromEntries(flow.nodes.map((n: any) => [n.id, { kind: n.kind, inLabel: n.inLabel ?? null, text: n.text, ref: n.ref ?? null, refBlue: n.refBlue ?? null, col: n.col ?? null, table: n.table ?? null }]));
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
export const pathLabel = (path: string[]) => path.length ? path.map((s) => ({ nodes: "칸", body: "본문", timing: "날짜·기간", position: "국가·범위", type: "유형", labels: "라벨", extra: "원본 정보", text: "본문", ref: "메모", refBlue: "파란 첨삭 메모", table: "표", title: "제목", insight: "인사이트", blocks: "본문 블록", order: "칸 순서", date: "날짜", endDate: "종료일", layout: "배치" }[s] ?? s)).join(" · ") : "카드 전체(생성/삭제)";
