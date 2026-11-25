// Real transaction/locking tests in a fresh, isolated schema. No public research rows are written.
import "dotenv/config";
import assert from "node:assert/strict";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { applyCollaborativeEdit, getResource, CollaborationConflict, initializeInternational, internationalResources, syncState } from "../server/cap-collaboration.js";
import { diff, flowDocument, copy, merge, conflictDetails, type Document, type EditRequest } from "../shared/cap-collaboration.js";
import { insightForClient, InsightUpgradeRequired } from "../shared/comparison-compat.js";
import { sceneMarker } from "../shared/comparison-scenes.js";
const schema = `cap_collab_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
if (!/^cap_collab_test_\d+_[a-z0-9]+$/.test(schema)) throw new Error("Unsafe test schema");
const client = postgres(process.env.DATABASE_URL!, { prepare: false, max: 3, idle_timeout: 5, connect_timeout: 20 });
const raw = drizzle(client);
const isolated = { transaction: (work: any) => raw.transaction(async (tx) => {
  await tx.execute(sql.raw(`SET LOCAL search_path TO "${schema}"`)); return work(tx);
}) } as typeof raw;
const initial = flowDocument({ title: "Synthetic collaboration test", date: "1971-01-01", category: "경제", layout: "stack", sortOrder: 0, nodes: ["a", "b"].map((id) => ({ id, kind: "effect", text: id })) });
const op = (key: string, before: Document, after: Document): EditRequest => ({ id: crypto.randomUUID(), resource: key, session: crypto.randomUUID(), editor: "Synthetic test", changes: diff(before, after), schemaVersion: 2 });
let created = false;
try {
  console.log("Starting isolated collaboration DB test:", schema);
  await client.unsafe(`CREATE SCHEMA "${schema}"`); created = true;
  console.log("Isolated schema created");
  await raw.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL search_path TO "${schema}"`));
    const definitions = [
      `CREATE TABLE cap_flows (id SERIAL PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, date TEXT NOT NULL, end_date TEXT, year INTEGER NOT NULL, category TEXT NOT NULL, layout TEXT NOT NULL, insight TEXT, sort_order INTEGER NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)`,
      `CREATE TABLE cap_nodes (id SERIAL PRIMARY KEY, flow_id INTEGER NOT NULL REFERENCES cap_flows(id) ON DELETE CASCADE, node_key TEXT NOT NULL, kind TEXT NOT NULL, in_label TEXT, text TEXT NOT NULL, ref TEXT, ref_blue TEXT, col TEXT, table_data TEXT, pos INTEGER NOT NULL, UNIQUE(flow_id,node_key))`,
      `CREATE TABLE cap_edges (id SERIAL PRIMARY KEY, flow_id INTEGER NOT NULL REFERENCES cap_flows(id) ON DELETE CASCADE, from_key TEXT NOT NULL, to_key TEXT NOT NULL)`,
      `CREATE TABLE cap_links (id SERIAL PRIMARY KEY, from_slug TEXT NOT NULL, from_key TEXT NOT NULL, to_slug TEXT NOT NULL, to_key TEXT NOT NULL, created_at BIGINT NOT NULL)`,
      `CREATE TABLE cap_settings (key TEXT PRIMARY KEY, value TEXT, updated_at BIGINT NOT NULL)`,
      `CREATE TABLE cap_edit_operations (id TEXT PRIMARY KEY, resource TEXT NOT NULL, editor TEXT NOT NULL, session TEXT NOT NULL, taken_at BIGINT NOT NULL, changes TEXT NOT NULL, request TEXT NOT NULL)`,
      `CREATE TABLE cap_editors (session TEXT PRIMARY KEY, editor TEXT NOT NULL, resource TEXT, seen_at BIGINT NOT NULL)`,
    ];
    for (const ddl of definitions) await tx.execute(sql.raw(ddl));
  });
  const key = "flow:synthetic";
  console.log("Testing collaborative transactions");
  await applyCollaborativeEdit(op(key, null, initial), isolated);
  const blueBase = (await getResource(key, isolated)).doc!;
  const blue = copy(blueBase)!, yellow = copy(blueBase)!;
  (blue.nodes as any).a.refBlue = "Blue correction"; (yellow.nodes as any).a.ref = "Yellow note";
  await Promise.all([applyCollaborativeEdit(op(key, blueBase, blue), isolated), applyCollaborativeEdit(op(key, blueBase, yellow), isolated)]);
  const blueSaved = (await getResource(key, isolated)).doc!;
  assert.equal((blueSaved.nodes as any).a.refBlue, "Blue correction");
  assert.equal((blueSaved.nodes as any).a.ref, "Yellow note");
  const rival = copy(blueBase)!; (rival.nodes as any).a.refBlue = "Rival blue";
  await assert.rejects(() => applyCollaborativeEdit(op(key, blueBase, rival), isolated), CollaborationConflict);
  const cleared = copy(blueSaved)!; (cleared.nodes as any).a.refBlue = null;
  await applyCollaborativeEdit(op(key, blueSaved, cleared), isolated);
  const afterBlueDelete = (await getResource(key, isolated)).doc!;
  assert.equal((afterBlueDelete.nodes as any).a.refBlue, null);
  assert.equal((afterBlueDelete.nodes as any).a.ref, "Yellow note");
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
  // Text-span composition is performed inside the same locked production transaction path.
  console.log("Testing independent prose, table cells/columns and overlapping passage rollback");
  const proseKey = "meta:prose", proseBase = { ...meta("prose", "Synthetic prose"), text: "기업 운영의 자율성이 확대됐습니다." };
  await applyCollaborativeEdit(op(proseKey, null, proseBase), isolated);
  await Promise.all([
    applyCollaborativeEdit(op(proseKey, proseBase, { ...proseBase, text: "기업 경영의 자율성이 확대됐습니다." }), isolated),
    applyCollaborativeEdit(op(proseKey, proseBase, { ...proseBase, text: "기업 운영의 자율성이 제한적으로 확대됐습니다." }), isolated),
  ]);
  assert.equal((await getResource(proseKey, isolated)).doc!.text, "기업 경영의 자율성이 제한적으로 확대됐습니다.");
  const tableKey = "meta:table", table = { title: "Synthetic situations", widths: [1, 3, 3], cells: [["연도", "미국", "일본"], ["1969", "수요가 소폭 늘었습니다.", "기존 일본"]] };
  const tableBase = { ...meta("table", "Synthetic table"), tables: [table], blocks: [{ type: "table", table }] };
  await applyCollaborativeEdit(op(tableKey, null, tableBase), isolated);
  const column = copy(tableBase), cell = copy(tableBase);
  column.blocks[0].table.widths.push(3); column.blocks[0].table.cells[0].push("소련"); column.blocks[0].table.cells[1].push("소련 내용"); column.tables = [column.blocks[0].table];
  cell.blocks[0].table.cells[1][2] = "편집자의 일본 수정"; cell.tables = [cell.blocks[0].table];
  await Promise.all([applyCollaborativeEdit(op(tableKey, tableBase, column), isolated), applyCollaborativeEdit(op(tableKey, tableBase, cell), isolated)]);
  const joined = await getResource(tableKey, isolated);
  assert.deepEqual((joined.doc!.blocks as any[])[0].table.cells[1], ["1969", "수요가 소폭 늘었습니다.", "편집자의 일본 수정", "소련 내용"]);
  assert.deepEqual(joined.doc!.tables, [(joined.doc!.blocks as any[])[0].table]);
  const mine = copy(joined.doc)!, theirs = copy(joined.doc)!;
  (mine.blocks as any[])[0].table.cells[1][1] = "수요가 크게 늘었습니다."; mine.tables = [(mine.blocks as any[])[0].table];
  (theirs.blocks as any[])[0].table.cells[1][1] = "수요가 제한적으로 늘었습니다."; theirs.tables = [(theirs.blocks as any[])[0].table];
  await applyCollaborativeEdit(op(tableKey, joined.doc, theirs), isolated);
  const overlapping = op(tableKey, joined.doc, mine); overlapping.changes.push({ path: ["title"], before: joined.doc!.title, after: "Must roll back" });
  const beforeConflict = await getResource(tableKey, isolated);
  await assert.rejects(() => applyCollaborativeEdit(overlapping, isolated), CollaborationConflict);
  assert.deepEqual(await getResource(tableKey, isolated), beforeConflict);
  assert.equal((await isolated.transaction(tx => tx.execute(sql`select id from cap_edit_operations where id=${overlapping.id}`))).length, 0);
  console.log("Testing empty-field resolution and repeated-label table cells");
  const emptyKey = "meta:empty-prose", emptyBase = { ...meta("empty-prose", "Synthetic empty prose"), text: "" };
  await applyCollaborativeEdit(op(emptyKey, null, emptyBase), isolated);
  await applyCollaborativeEdit(op(emptyKey, emptyBase, { ...emptyBase, text: "다른 새 문장" }), isolated);
  const emptyRemote = await getResource(emptyKey, isolated), emptyChanges = diff(emptyBase, { ...emptyBase, text: "내 새 문장" });
  const emptyConflict = merge(emptyRemote.doc, emptyChanges);
  const emptyParts = emptyConflict.conflicts.flatMap(conflictDetails);
  assert.equal(emptyParts.length, 1);
  const emptyResolved = merge(emptyRemote.doc, emptyChanges, { [emptyParts[0].id]: "local" });
  await applyCollaborativeEdit(op(emptyKey, emptyRemote.doc, emptyResolved.doc), isolated);
  assert.equal((await getResource(emptyKey, isolated)).doc!.text, "내 새 문장");
  for (const [i, [source, appendMine, appendTheirs]] of [
    ["잔액은 20억입니다.", "잔액은 25억입니다. 수요도 증가했습니다!", "잔액은 30억입니다. 수요는 감소했습니다!"],
    ["앞 문장입니다. 금리는 20억입니다.", "앞 문장입니다.새 수요입니다! 금리는 25억입니다.", "앞 문장입니다.다른 수요입니다! 금리는 30억입니다."],
  ].entries()) {
    const id = `append-prose-${i}`, appendKey = `meta:${id}`, appendBase = { ...meta(id, "Synthetic appended prose"), text: source };
    await applyCollaborativeEdit(op(appendKey, null, appendBase), isolated);
    await applyCollaborativeEdit(op(appendKey, appendBase, { ...appendBase, text: appendTheirs }), isolated);
    const appendRemote = await getResource(appendKey, isolated), appendChanges = diff(appendBase, { ...appendBase, text: appendMine });
    const appendParts = merge(appendRemote.doc, appendChanges).conflicts.flatMap(conflictDetails);
    assert.ok(appendParts.length > 0);
    const appendResolved = merge(appendRemote.doc, appendChanges, Object.fromEntries(appendParts.map(part => [part.id, "local" as const])));
    await applyCollaborativeEdit(op(appendKey, appendRemote.doc, appendResolved.doc), isolated);
    assert.equal((await getResource(appendKey, isolated)).doc!.text, appendMine);
  }
  const repeatedKey = "meta:repeated-label", repeatedTable = { widths: [1, 3], cells: [["항목", "내용"], ["", "A"], ["", "B"]] };
  const repeatedBase = { ...meta("repeated-label", "Synthetic repeated labels"), tables: [repeatedTable], blocks: [{ type: "table", table: repeatedTable }] };
  await applyCollaborativeEdit(op(repeatedKey, null, repeatedBase), isolated);
  const repeatedMine = copy(repeatedBase), repeatedOther = copy(repeatedBase);
  repeatedMine.blocks[0].table.cells[1][0] = "미국"; repeatedMine.tables = [repeatedMine.blocks[0].table];
  repeatedOther.blocks[0].table.cells[2][1] = "수정 B"; repeatedOther.tables = [repeatedOther.blocks[0].table];
  await applyCollaborativeEdit(op(repeatedKey, repeatedBase, repeatedOther), isolated);
  await applyCollaborativeEdit(op(repeatedKey, repeatedBase, repeatedMine), isolated);
  assert.deepEqual(((await getResource(repeatedKey, isolated)).doc!.blocks as any[])[0].table.cells, [["항목", "내용"], ["미국", "A"], ["", "수정 B"]]);
  console.log("Testing overlapping rich wrappers preserve unrelated edits");
  for (const scenario of ["blank-column", "delete-row", "manual-append"]) {
    const id = `review-four-${scenario}`, resourceKey = `meta:${id}`;
    const tb = scenario === "blank-column" ? { widths: [1, 1], cells: [["", ""], ["A", "B"]] } : { widths: [1, 3], cells: [["연도", "내용"], ["1969", "원문"], ["1970", "금리 원문"]] };
    const source = { ...meta(id, "Synthetic boundary regression"), text: "잔액은 20억 달러입니다.", tables: [tb] };
    const own = copy(source), other = copy(source);
    if (scenario === "blank-column") { own.tables[0].widths.push(1); own.tables[0].cells.forEach(row => row.push("")); other.tables[0].cells[1][1] = "B edited"; }
    if (scenario === "delete-row") { own.tables[0].cells.splice(1, 1); other.tables[0].cells[1][1] = "겹친 수정"; other.tables[0].cells[2][1] = "금리 상대 독립 수정"; }
    if (scenario === "manual-append") { own.text = "잔액은 25억 달러입니다."; other.text = "잔액은 30억 달러입니다. 외부 공시를 반영했습니다."; }
    await applyCollaborativeEdit(op(resourceKey, null, source), isolated);
    await applyCollaborativeEdit(op(resourceKey, source, other), isolated);
    const latest = await getResource(resourceKey, isolated), changes = diff(source, own);
    const parts = merge(latest.doc, changes).conflicts.flatMap(conflictDetails);
    assert.equal(parts.length, scenario === "blank-column" ? 0 : 1);
    const resolutions = Object.fromEntries(parts.map(part => [part.id, scenario === "manual-append" ? { text: "잔액은 28억 달러입니다." } : "local" as const]));
    const resolved = merge(latest.doc, changes, resolutions);
    await applyCollaborativeEdit(op(resourceKey, latest.doc, resolved.doc), isolated);
    const stored = (await getResource(resourceKey, isolated)).doc!;
    if (scenario === "blank-column") assert.deepEqual((stored.tables as any[])[0].cells[1], ["A", "B edited", ""]);
    if (scenario === "delete-row") assert.deepEqual((stored.tables as any[])[0].cells, [["연도", "내용"], ["1970", "금리 상대 독립 수정"]]);
    if (scenario === "manual-append") assert.equal(stored.text, "잔액은 28억 달러입니다. 외부 공시를 반영했습니다.");
  }
  for (const choice of ["local", "remote"] as const) {
    const id = `rich-prose-${choice}`, richKey = `meta:${id}`;
    const richBase = { ...meta(id, "Synthetic rich prose"), text: "기업 운영입니다. 잔액은 20억입니다." };
    const richMine = "[[hl-y|기업 운영입니다]]. 잔액은 25억입니다.";
    const richTheirs = "기업 [[c-r|운영입니다]]. 잔액은 20억입니다. 추가 공시입니다.";
    await applyCollaborativeEdit(op(richKey, null, richBase), isolated);
    await applyCollaborativeEdit(op(richKey, richBase, { ...richBase, text: richTheirs }), isolated);
    const richRemote = await getResource(richKey, isolated), richChanges = diff(richBase, { ...richBase, text: richMine });
    const richParts = merge(richRemote.doc, richChanges).conflicts.flatMap(conflictDetails);
    assert.equal(richParts.length, 1);
    const richResolved = merge(richRemote.doc, richChanges, { [richParts[0].id]: choice });
    await applyCollaborativeEdit(op(richKey, richRemote.doc, richResolved.doc), isolated);
    const text = String((await getResource(richKey, isolated)).doc!.text);
    assert.ok(text.includes("25억") && text.includes("추가 공시입니다."));
    assert.ok(text.includes(choice === "local" ? "[[hl-y|기업 운영입니다]]" : "[[c-r|운영입니다]]"));
  }
  // Comparison placements have independent records, preserve source cards, and retain tombstones.
  const plot = { flowSlug: "synthetic", nodeKey: "a", title: "Policy", date: null, endDate: null, sortOrder: 1 };
  await Promise.all([applyCollaborativeEdit(op("plot:one", null, plot), isolated), applyCollaborativeEdit(op("plot:two", null, { ...plot, nodeKey: "b" }), isolated)]);
  await Promise.all([applyCollaborativeEdit(op("plot:one", plot, { ...plot, title: "Policy revised" }), isolated), applyCollaborativeEdit(op("plot:one", plot, { ...plot, date: "2008-09-15" }), isolated)]);
  const plotted = await getResource("plot:one", isolated);
  assert.equal(plotted.doc!.title, "Policy revised"); assert.equal(plotted.doc!.date, "2008-09-15");
  await assert.rejects(() => applyCollaborativeEdit(op("plot:one", plotted.doc, { ...plotted.doc, endDate: "2007-01-01" }), isolated));
  assert.deepEqual((await getResource("plot:one", isolated)).doc, plotted.doc);
  await applyCollaborativeEdit(op("plot:one", plotted.doc, null), isolated);
  const tombstone = await getResource("plot:one", isolated);
  assert.equal(tombstone.doc, null); assert.ok(tombstone.version > plotted.version);
  assert.equal((await getResource("plot:two", isolated)).doc!.nodeKey, "b");
  assert.ok((await getResource(key, isolated)).doc!.nodes);
  assert.equal((await getResource("meta:m1", isolated)).doc!.title, "ONE");
  // Time-only insights are isolated from legacy placements and source cards.
  const note = { title: "Currency comparison", date: "1997-01-01", endDate: "1998-12-31", text: "", caption: "", sortOrder: 1 };
  console.log("Testing insight compatibility and guarded writes");
  await applyCollaborativeEdit(op("note:one", null, note), isolated);
  await Promise.all([
    applyCollaborativeEdit(op("note:one", note, { ...note, text: "Independent prose" }), isolated),
    applyCollaborativeEdit(op("note:one", note, { ...note, date: "1997-06-01" }), isolated),
  ]);
  const written = await getResource("note:one", isolated);
  assert.equal(written.doc!.text, "Independent prose"); assert.equal(written.doc!.date, "1997-06-01");
  await assert.rejects(() => applyCollaborativeEdit(op("note:one", note, { ...note, text: "Conflicting prose" }), isolated), CollaborationConflict);
  await assert.rejects(() => applyCollaborativeEdit(op("note:one", written.doc, { ...written.doc, endDate: "1996-01-01" }), isolated));
  assert.deepEqual((await getResource("note:one", isolated)).doc, written.doc);
  const context = { ids: ["dollar", "fx_jpy"], spread: { a: "gs10", b: "tb3ms" } };
  await Promise.all([
    applyCollaborativeEdit(op("note:one", written.doc, { ...written.doc, context }), isolated),
    applyCollaborativeEdit(op("note:one", written.doc, { ...written.doc, caption: "Period with linked graphs" }), isolated),
  ]);
  const linkedNote = await getResource("note:one", isolated);
  assert.deepEqual(linkedNote.doc!.context, context);
  assert.equal(linkedNote.doc!.caption, "Period with linked graphs");
  await assert.rejects(() => applyCollaborativeEdit(op("note:one", linkedNote.doc, { ...linkedNote.doc, context: { ...context, spread: { a: "gs10", b: "gs10" } } }), isolated));
  assert.deepEqual((await getResource("note:one", isolated)).doc, linkedNote.doc);
  // New diagrams and already-open legacy editors share the same locked resource.
  const balance = { money: 1, goods: -1, outcome: "inflation" };
  await Promise.all([
    applyCollaborativeEdit(op("note:one", linkedNote.doc, { ...linkedNote.doc, balance }), isolated),
    applyCollaborativeEdit(op("note:one", linkedNote.doc, { ...linkedNote.doc, text: "Live author revision" }), isolated, true),
  ]);
  const withBalance = await getResource("note:one", isolated);
  assert.equal(withBalance.doc!.text, "Live author revision");
  assert.deepEqual(withBalance.doc!.balance, balance);
  const legacyView = insightForClient(withBalance, false);
  assert.equal(legacyView.doc!.balance, undefined);
  await applyCollaborativeEdit(op("note:one", legacyView.doc, { ...legacyView.doc, title: "Old window title" }), isolated, true);
  assert.deepEqual((await getResource("note:one", isolated)).doc!.balance, balance);
  const latest = await getResource("note:one", isolated);
  const guarded = { ...op("note:one", latest.doc, { ...latest.doc, balance: { ...balance, money: 2 } }), ifVersion: latest.version - 1 };
  await assert.rejects(() => applyCollaborativeEdit(guarded, isolated), CollaborationConflict);
  assert.deepEqual((await getResource("note:one", isolated)).doc, latest.doc);
  const sceneId = crypto.randomUUID();
  const inline = { ...latest.doc, text: latest.doc!.text + sceneMarker(sceneId), scenes: [{ id: sceneId, title: "Transition", balance }] };
  await applyCollaborativeEdit(op("note:one", latest.doc, inline), isolated);
  await assert.rejects(() => applyCollaborativeEdit(op("note:one", legacyView.doc, { ...legacyView.doc, text: "Old window new prose" }), isolated, true), InsightUpgradeRequired);
  assert.deepEqual((await getResource("note:one", isolated)).doc, inline);
  const staleSeed = op("note:one", latest.doc, { ...latest.doc, balance: { ...balance, money: 2 } });
  staleSeed.changes.push({ path: ["text"], before: latest.doc!.text, after: latest.doc!.text });
  await assert.rejects(() => applyCollaborativeEdit(staleSeed, isolated), CollaborationConflict);
  assert.deepEqual((await getResource("note:one", isolated)).doc, inline);
  const labelled = { ...inline, balance: { ...balance, moneyLabel: "수요 위축", goodsLabel: "재고가 남음" } };
  await applyCollaborativeEdit(op("note:one", inline, labelled), isolated);
  const older = insightForClient(await getResource("note:one", isolated), true, false);
  assert.equal((older.doc!.balance as any).moneyLabel, undefined);
  await applyCollaborativeEdit(op("note:one", older.doc, { ...older.doc, title: "Older editor latest title" }), isolated, false, true);
  const protectedLabels = await getResource("note:one", isolated);
  assert.deepEqual(protectedLabels.doc!.balance, labelled.balance);
  await assert.rejects(() => applyCollaborativeEdit(op("note:one", older.doc, { ...older.doc, balance: { money: 2, goods: 2 } }), isolated, false, true), InsightUpgradeRequired);
  await assert.rejects(() => applyCollaborativeEdit(op("note:one", older.doc, { ...older.doc, scenes: [] }), isolated, false, true), InsightUpgradeRequired);
  assert.deepEqual((await getResource("note:one", isolated)).doc, protectedLabels.doc);
  await applyCollaborativeEdit(op("note:one", protectedLabels.doc, null), isolated);
  const removedNote = await getResource("note:one", isolated);
  assert.equal(removedNote.doc, null); assert.ok(removedNote.version > written.version);
  assert.equal((await getResource("plot:two", isolated)).doc!.nodeKey, "b");
  assert.equal((await getResource("meta:m1", isolated)).doc!.title, "ONE");
  const deleted = await getResource(key, isolated);
  await applyCollaborativeEdit(op(key, deleted.doc, null), isolated);
  await assert.rejects(() => applyCollaborativeEdit(op(key, deleted.doc, { ...deleted.doc, title: "late edit" }), isolated), CollaborationConflict);
  assert.equal((await getResource(key, isolated)).doc, null);
  const intl = { title: "Synthetic international event", body: "Synthetic body", type: "policy", labels: [], timing: { year: 1974, month: 9, date: "1974.9", endY: null, endM: null, endYear: null, endMonth: null }, position: { region: "europe", country: "유럽", lane: "eu", scope: "regional" }, extra: {}, deletedAt: null };
  await Promise.all([
    initializeInternational([{key:"intl:synthetic",doc:intl}],isolated),
    initializeInternational([{key:"intl:synthetic",doc:intl}],isolated),
  ]);
  const intlRead = () => isolated.transaction(tx => internationalResources(tx as any));
  assert.equal((await intlRead()).resources.length,1);
  let i = await getResource("intl:synthetic",isolated);
  await Promise.all([
    applyCollaborativeEdit(op(i.key,i.doc,{...i.doc,body:"Editor A"}),isolated),
    applyCollaborativeEdit(op(i.key,i.doc,{...i.doc,labels:["독일"]}),isolated),
  ]);
  i = await getResource(i.key,isolated); assert.equal(i.doc!.body,"Editor A"); assert.deepEqual(i.doc!.labels,["독일"]);
  const beforeDelete = copy(i.doc), intlTombstone = {...i.doc,deletedAt:"2026-11-20T00:00:00Z"};
  await applyCollaborativeEdit(op(i.key,i.doc,intlTombstone),isolated);
  await assert.rejects(() => applyCollaborativeEdit(op(i.key,beforeDelete,{...beforeDelete,body:"Late edit"}),isolated),CollaborationConflict);
  await initializeInternational([{key:i.key,doc:intl}],isolated);
  assert.equal((await getResource(i.key,isolated)).doc!.deletedAt,intlTombstone.deletedAt);
  await assert.rejects(() => applyCollaborativeEdit(op(i.key,intlTombstone,{...intlTombstone,timing:{...intl.timing,month:13}}),isolated));
  assert.deepEqual((await getResource(i.key,isolated)).doc,intlTombstone);
  await applyCollaborativeEdit(op(i.key,intlTombstone,beforeDelete),isolated);
  assert.equal((await getResource(i.key,isolated)).doc!.deletedAt,null);
  const syncSession = crypto.randomUUID(), sync = () => isolated.transaction(tx => syncState({session:syncSession,editor:"Synthetic",resource:i.key,scopes:["international"]},tx as any));
  const state = await sync() as any;
  assert.deepEqual(state.flows,[]); assert.deepEqual(state.notes,[]); assert.equal(state.international.length,1);
  const heartbeat = await isolated.transaction(tx => tx.execute(sql`select seen_at from cap_editors where session=${syncSession}`));
  await sync();
  const heartbeatAgain = await isolated.transaction(tx => tx.execute(sql`select seen_at from cap_editors where session=${syncSession}`));
  assert.equal(heartbeat[0].seen_at,heartbeatAgain[0].seen_at);
  console.log("PASS: existing collaboration transactions plus international initialization races, field merge, deletion/edit conflict, seed non-resurrection, validation rollback, restore, scoped one-query sync and heartbeat throttling.");
} finally {
  // Only this invocation's verified, freshly-created synthetic schema is removed.
  if (created) await client.unsafe(`DROP SCHEMA "${schema}" CASCADE`);
  await client.end({ timeout: 5 });
}
