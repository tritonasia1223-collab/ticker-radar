// Real transaction/locking tests in a fresh, isolated schema. No public research rows are written.
import "dotenv/config";
import assert from "node:assert/strict";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { applyCollaborativeEdit, getResource, CollaborationConflict } from "../server/cap-collaboration.js";
import { diff, flowDocument, copy, type Document, type EditRequest } from "../shared/cap-collaboration.js";
const schema = `cap_collab_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
if (!/^cap_collab_test_\d+_[a-z0-9]+$/.test(schema)) throw new Error("Unsafe test schema");
const client = postgres(process.env.DATABASE_URL!, { prepare: false, max: 3, idle_timeout: 5, connect_timeout: 20 });
const raw = drizzle(client);
const isolated = { transaction: (work: any) => raw.transaction(async (tx) => {
  await tx.execute(sql.raw(`SET LOCAL search_path TO "${schema}"`)); return work(tx);
}) } as typeof raw;
const initial = flowDocument({ title: "Synthetic collaboration test", date: "1971-01-01", category: "경제", layout: "stack", sortOrder: 0, nodes: ["a", "b"].map((id) => ({ id, kind: "effect", text: id })) });
const op = (key: string, before: Document, after: Document): EditRequest => ({ id: crypto.randomUUID(), resource: key, session: crypto.randomUUID(), editor: "Synthetic test", changes: diff(before, after) });
let created = false;
try {
  await client.unsafe(`CREATE SCHEMA "${schema}"`); created = true;
  await raw.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL search_path TO "${schema}"`));
    const definitions = [
      `CREATE TABLE cap_flows (id SERIAL PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, date TEXT NOT NULL, end_date TEXT, year INTEGER NOT NULL, category TEXT NOT NULL, layout TEXT NOT NULL, insight TEXT, sort_order INTEGER NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)`,
      `CREATE TABLE cap_nodes (id SERIAL PRIMARY KEY, flow_id INTEGER NOT NULL REFERENCES cap_flows(id) ON DELETE CASCADE, node_key TEXT NOT NULL, kind TEXT NOT NULL, in_label TEXT, text TEXT NOT NULL, ref TEXT, col TEXT, table_data TEXT, pos INTEGER NOT NULL, UNIQUE(flow_id,node_key))`,
      `CREATE TABLE cap_edges (id SERIAL PRIMARY KEY, flow_id INTEGER NOT NULL REFERENCES cap_flows(id) ON DELETE CASCADE, from_key TEXT NOT NULL, to_key TEXT NOT NULL)`,
      `CREATE TABLE cap_links (id SERIAL PRIMARY KEY, from_slug TEXT NOT NULL, from_key TEXT NOT NULL, to_slug TEXT NOT NULL, to_key TEXT NOT NULL, created_at BIGINT NOT NULL)`,
      `CREATE TABLE cap_settings (key TEXT PRIMARY KEY, value TEXT, updated_at BIGINT NOT NULL)`,
      `CREATE TABLE cap_edit_operations (id TEXT PRIMARY KEY, resource TEXT NOT NULL, editor TEXT NOT NULL, session TEXT NOT NULL, taken_at BIGINT NOT NULL, changes TEXT NOT NULL, request TEXT NOT NULL)`,
    ];
    for (const ddl of definitions) await tx.execute(sql.raw(ddl));
  });
  const key = "flow:synthetic";
  await applyCollaborativeEdit(op(key, null, initial), isolated);
  const a = copy(initial)!, b = copy(initial)!; (a.nodes as any).a.text = "editor A"; (b.nodes as any).b.text = "editor B";
  await Promise.all([applyCollaborativeEdit(op(key, initial, a), isolated), applyCollaborativeEdit(op(key, initial, b), isolated)]);
  let saved = await getResource(key, isolated);
  assert.equal((saved.doc!.nodes as any).a.text, "editor A"); assert.equal((saved.doc!.nodes as any).b.text, "editor B");
  const sameA = { ...saved.doc, title: "A title" }, sameB = { ...saved.doc, title: "B title" };
  const raced = await Promise.allSettled([applyCollaborativeEdit(op(key, saved.doc, sameA), isolated), applyCollaborativeEdit(op(key, saved.doc, sameB), isolated)]);
  assert.equal(raced.filter((r) => r.status === "fulfilled").length, 1);
  assert.ok(raced.some((r) => r.status === "rejected" && r.reason instanceof CollaborationConflict));
  saved = await getResource(key, isolated);
  const retry = op(key, saved.doc, { ...saved.doc, title: "retry" });
  await Promise.all([applyCollaborativeEdit(retry, isolated), applyCollaborativeEdit(retry, isolated)]);
  const afterRetry = await getResource(key, isolated);
  await applyCollaborativeEdit(op(key, afterRetry.doc, { ...afterRetry.doc, title: "newer" }), isolated);
  assert.equal((await applyCollaborativeEdit(retry, isolated)).doc!.title, "newer");
  const old = await getResource(key, isolated), invalid = copy(old.doc)!; invalid.order = ["nonexistent"];
  await assert.rejects(() => applyCollaborativeEdit(op(key, old.doc, invalid), isolated));
  assert.deepEqual((await getResource(key, isolated)).doc, old.doc);
  // Shared meta storage is locked across different cards, preserving independent additions and edits.
  const meta = (id: string, title: string) => ({ id, title, text: "", tables: [], images: [], blocks: null });
  await Promise.all([applyCollaborativeEdit(op("meta:m1", null, meta("m1", "one")), isolated), applyCollaborativeEdit(op("meta:m2", null, meta("m2", "two")), isolated)]);
  await Promise.all([applyCollaborativeEdit(op("meta:m1", meta("m1", "one"), meta("m1", "ONE")), isolated), applyCollaborativeEdit(op("meta:m2", meta("m2", "two"), meta("m2", "TWO")), isolated)]);
  assert.equal((await getResource("meta:m1", isolated)).doc!.title, "ONE"); assert.equal((await getResource("meta:m2", isolated)).doc!.title, "TWO");
  const deleted = await getResource(key, isolated);
  await applyCollaborativeEdit(op(key, deleted.doc, null), isolated);
  await assert.rejects(() => applyCollaborativeEdit(op(key, deleted.doc, { ...deleted.doc, title: "late edit" }), isolated), CollaborationConflict);
  assert.equal((await getResource(key, isolated)).doc, null);
  console.log("PASS: concurrent field merge, same-field conflict, duplicate/lost-response retry, rollback, shared-meta isolation, deletion/edit conflict.");
} finally {
  // Only this invocation's verified, freshly-created synthetic schema is removed.
  if (created) await client.unsafe(`DROP SCHEMA "${schema}" CASCADE`);
  await client.end();
}
