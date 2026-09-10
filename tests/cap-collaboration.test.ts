import { afterEach, describe, expect, it, vi } from "vitest";
import { copy, diff, equal, flowDocument, merge, mergeOrder, type Document, type EditRequest, type Resource } from "../shared/cap-collaboration";
import { CollaborationEngine, RemoteConflict, SaveRejected, type Draft, type DraftStore, type Transport } from "../client/src/lib/cap-collab-engine";
import { validateEdit } from "../server/cap-collaboration";
const doc = () => flowDocument({ title: "원본", date: "1971-01-01", category: "경제", layout: "stack", sortOrder: 0, nodes: ["a", "b"].map((id) => ({ id, kind: "effect", text: id })) });
const change = (path: string[], before: any, after: any) => ({ path, before, after });
describe("collaboration merge", () => {
  it("merges different nodes and different fields on one node", () => {
    const base = doc(), remote = merge(base, [change(["nodes", "a", "text"], "a", "서버")]).doc;
    const result = merge(remote, [change(["nodes", "a", "ref"], null, "메모"), change(["nodes", "b", "text"], "b", "내 글")]);
    expect(result.conflicts).toEqual([]); expect((result.doc!.nodes as any).a).toMatchObject({ text: "서버", ref: "메모" });
    expect((result.doc!.nodes as any).b.text).toBe("내 글");
  });
  it("conflicts on same field, node deletion against edit, and edit against deletion", () => {
    const base = doc(), edited = merge(base, [change(["nodes", "a", "text"], "a", "edited")]).doc;
    expect(merge(edited, [change(["nodes", "a", "text"], "a", "mine")]).conflicts).toHaveLength(1);
    expect(merge(edited, [change(["nodes", "a"], (base!.nodes as any).a, null)]).conflicts).toHaveLength(1);
    const deleted = merge(base, [change(["nodes", "a"], (base!.nodes as any).a, null)]).doc;
    expect(merge(deleted, [change(["nodes", "a", "ref"], null, "note")]).conflicts).toHaveLength(1);
    expect(merge(null, [change(["insight"], null, { text: "note" })]).conflicts).toHaveLength(1);
  });
  it("merges independent additions/deletions and rejects conflicting reorder", () => {
    expect(mergeOrder(["a", "b"], ["a", "x", "b"], ["a", "y", "b"])).toEqual(["a", "y", "x", "b"]);
    expect(mergeOrder(["a", "b"], ["b"], ["a", "b", "c"])).toEqual(["b", "c"]);
    expect(mergeOrder(["a", "b", "c"], ["b", "a", "c"], ["a", "c", "b"])).toBeNull();
  });
  it("treats table and rich blocks as atomic fields and equal edits as idempotent", () => {
    const c = change(["nodes", "a", "table"], null, { widths: [1], cells: [["x"]] });
    const saved = merge(doc(), [c]).doc; expect(merge(saved, [c]).conflicts).toEqual([]);
    expect(merge(saved, [{ ...c, after: { widths: [1], cells: [["y"]] } }]).conflicts).toHaveLength(1);
    expect(diff({ blocks: [{ type: "text", text: "a" }] }, { blocks: [{ type: "text", text: "b" }] })[0].path).toEqual(["blocks"]);
  });
  it("rejects invalid paths and overlapping edits before writing", () => {
    const request = { id: crypto.randomUUID(), resource: "flow:f", editor: "A", session: crypto.randomUUID(), changes: [change(["nodes", "a", "text"], "a", "b")] };
    expect(validateEdit(request)).toEqual(request);
    for (const changes of [[change(["nodes"], null, {})], [change(["nodes", "a"], null, {}), ...request.changes], [change(["__proto__"], null, "bad")]]) expect(() => validateEdit({ ...request, changes })).toThrow();
  });
});
function harness(initial: Document = doc()) {
  let current: Resource = { key: "flow:f", doc: copy(initial), version: 1 };
  const ledger = new Map<string, EditRequest>(), stored = new Map<string, Draft>(), published: Resource[] = [];
  const store: DraftStore = { all: async () => copy([...stored.values()]), put: async (d) => { stored.set(d.id, copy(d)); }, remove: async (id) => { stored.delete(id); } };
  const transport: Transport = {
    read: async () => copy(current),
    send: async (op) => {
      if (!ledger.has(op.id)) {
        const result = merge(current.doc, op.changes);
        if (result.conflicts.length) throw new RemoteConflict(copy(current), result.conflicts);
        current = { ...current, version: current.version + 1, doc: result.doc }; ledger.set(op.id, copy(op));
      }
      return { ...copy(current), operation: op.id };
    },
  };
  const engine = new CollaborationEngine(crypto.randomUUID(), "A", transport, store, (r) => published.push(copy(r)), 100000);
  engine.seed(current);
  return { engine, store, transport, ledger, stored, published, remote: (changes: any[]) => { current = { ...current, doc: merge(current.doc, changes).doc, version: current.version + 1 }; }, current: () => copy(current) };
}
afterEach(() => vi.useRealTimers());
describe("durable collaboration queue", () => {
  it("keeps typing local until blur, then detects a concurrent edit of the same field", async () => {
    const h = harness(), end = h.engine.beginLocalEdit("flow:f");
    h.remote([change(["nodes", "a", "text"], "a", "상대방")]);
    await h.engine.receive(h.current());
    await h.engine.flushAll();
    expect(h.ledger.size).toBe(0); expect(h.published).toHaveLength(0);
    expect((h.engine.get("flow:f")!.nodes as any).a.text).toBe("a");
    h.engine.edit("flow:f", merge(h.engine.get("flow:f"), [change(["nodes", "a", "text"], "a", "내 초안")]).doc);
    end();
    await vi.waitFor(() => expect(h.engine.drafts.get("flow:f")?.conflicts).toHaveLength(1));
    expect((h.current().doc!.nodes as any).a.text).toBe("상대방");
    expect((h.engine.get("flow:f")!.nodes as any).a.text).toBe("내 초안");
  });
  it("merges a different node after blur without sending each keystroke", async () => {
    const h = harness(), end = h.engine.beginLocalEdit("flow:f");
    h.remote([change(["nodes", "b", "text"], "b", "상대 노드")]); await h.engine.receive(h.current());
    h.engine.edit("flow:f", merge(h.engine.get("flow:f"), [change(["nodes", "a", "text"], "a", "작성 완료")]).doc); end();
    await vi.waitFor(() => expect(h.engine.drafts.size).toBe(0));
    expect(h.ledger.size).toBe(1);
    expect((h.current().doc!.nodes as any).a.text).toBe("작성 완료");
    expect((h.current().doc!.nodes as any).b.text).toBe("상대 노드");
  });
  it("does not advance the comparison base when an earlier save returns while editing", async () => {
    const h = harness(), send = h.transport.send;
    let release!: () => void;
    h.transport.send = async op => { await new Promise<void>(resolve => { release = resolve; }); return send(op); };
    h.engine.edit("flow:f", { ...h.engine.get("flow:f"), title: "새 제목" });
    const saving = h.engine.flush("flow:f"); await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const end = h.engine.beginLocalEdit("flow:f");
    h.remote([change(["nodes", "a", "text"], "a", "상대방")]); release();
    await vi.waitFor(() => expect(h.ledger.size).toBe(1));
    expect((h.engine.get("flow:f")!.nodes as any).a.text).toBe("a");
    h.engine.edit("flow:f", merge(h.engine.get("flow:f"), [change(["nodes", "a", "text"], "a", "내 초안")]).doc);
    end(); await saving;
    expect(h.engine.drafts.get("flow:f")?.conflicts).toHaveLength(1);
    expect((h.current().doc!.nodes as any).a.text).toBe("상대방");
  });
  it("does not resurrect a card deleted while its field is focused", async () => {
    const h = harness(), end = h.engine.beginLocalEdit("flow:f");
    h.remote([change([], h.current().doc, null)]); await h.engine.receive(h.current());
    h.engine.edit("flow:f", { ...h.engine.get("flow:f"), title: "내 초안" }); end();
    await vi.waitFor(() => expect(h.engine.drafts.get("flow:f")?.conflicts?.length).toBeGreaterThan(0));
    expect(h.current().doc).toBeNull();
  });
  it("keeps typing made during a slow save and merges an unrelated remote field", async () => {
    const h = harness(), send = h.transport.send;
    let release!: () => void;
    h.transport.send = async (op) => { await new Promise<void>((r) => { release = r; }); return send(op); };
    h.engine.edit("flow:f", merge(doc(), [change(["title"], "원본", "first")]).doc);
    const saving = h.engine.flush("flow:f"); await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    h.engine.edit("flow:f", merge(h.engine.get("flow:f"), [change(["title"], "first", "later")]).doc);
    h.remote([change(["nodes", "b", "text"], "b", "remote")]); release(); await saving;
    expect(h.engine.get("flow:f")!.title).toBe("later"); expect((h.engine.get("flow:f")!.nodes as any).b.text).toBe("remote");
    h.transport.send = send; await h.engine.flushAll(); await h.engine.durable();
    expect(h.current().doc!.title).toBe("later"); expect(h.stored.size).toBe(0);
  });
  it("retries a lost response with the exact ID after a reload without reverting a newer remote save", async () => {
    const h = harness(), send = h.transport.send;
    h.transport.send = async (op) => { await send(op); throw new Error("lost response"); };
    h.engine.edit("flow:f", merge(doc(), [change(["title"], "원본", "mine")]).doc);
    await h.engine.flushAll(); await h.engine.durable();
    const request = [...h.stored.values()][0].request!;
    h.remote([change(["title"], "mine", "newer remote")]); h.transport.send = send;
    const reloaded = new CollaborationEngine(crypto.randomUUID(), "A", h.transport, h.store, () => {}, 100000);
    await reloaded.loadDrafts(); await reloaded.recover(reloaded.recoverable[0].id); await reloaded.durable();
    expect(h.ledger.size).toBe(1); expect(h.ledger.has(request.id)).toBe(true); expect(h.current().doc!.title).toBe("newer remote"); expect(reloaded.drafts.size).toBe(0);
  });
  it("preserves conflict draft then resolves only selected fields", async () => {
    const h = harness(); h.engine.edit("flow:f", merge(doc(), [change(["title"], "원본", "mine"), change(["nodes", "a", "ref"], null, "note")]).doc);
    h.remote([change(["title"], "원본", "remote"), change(["nodes", "b", "text"], "b", "theirs")]);
    await h.engine.flushAll(); await h.engine.durable();
    expect([...h.stored.values()][0].conflicts).toHaveLength(1);
    h.engine.resolve("flow:f", { '["title"]': "remote" }); await h.engine.flushAll();
    expect(h.current().doc!.title).toBe("remote"); expect((h.current().doc!.nodes as any).a.ref).toBe("note"); expect((h.current().doc!.nodes as any).b.text).toBe("theirs");
  });
  it("compares recovered drafts with the latest server before saving", async () => {
    const h = harness(); h.engine.edit("flow:f", merge(doc(), [change(["title"], "원본", "unsaved")]).doc); await h.engine.durable();
    h.remote([change(["title"], "원본", "remote")]);
    const next = new CollaborationEngine(crypto.randomUUID(), "A", h.transport, h.store, () => {}, 100000);
    await next.loadDrafts(); await next.recover(next.recoverable[0].id); await next.flushAll();
    expect(next.drafts.get("flow:f")!.conflicts).toHaveLength(1); expect(h.current().doc!.title).toBe("remote");
  });
  it("keeps deletion as null and refuses to undo someone else's edit silently", async () => {
    const h = harness(); h.engine.edit("flow:f", null, true); expect(h.engine.get("flow:f")).toBeNull(); await h.engine.flushAll();
    await h.engine.undoLast(); await h.engine.flushAll(); expect(h.current().doc!.title).toBe("원본");
    await h.engine.applyChanges("flow:f", [change(["title"], "different expected", "old")]);
    expect(h.engine.drafts.get("flow:f")!.conflicts).toHaveLength(1); expect(h.current().doc!.title).toBe("원본");
  });
  it("allows correcting a rejected request without reusing its invalid payload", async () => {
    const h = harness(), send = h.transport.send;
    h.transport.send = async () => { throw new SaveRejected("title required"); };
    h.engine.edit("flow:f", { ...doc(), title: "" }); await h.engine.flushAll();
    expect(h.engine.drafts.get("flow:f")!.request).toBeUndefined();
    h.engine.edit("flow:f", { ...doc(), title: "fixed" }); h.transport.send = send; await h.engine.flushAll(); expect(h.current().doc!.title).toBe("fixed");
  });
});
