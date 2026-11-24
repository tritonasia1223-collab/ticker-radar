import { copy, diff, equal, merge, put, read, conflictDetails, type Change, type Conflict, type Document, type EditRequest, type EditResult, type Resource } from "../../../shared/cap-collaboration";
import { mergeValue, syncBlockMirrors, type Resolution } from "../../../shared/cap-text-merge";

export interface Draft {
  id: string; session: string; editor: string; base: Resource; desired: Document; savedAt: number;
  request?: EditRequest; sent?: Document; remote?: Resource; conflicts?: Conflict[]; error?: string;
}
export interface DraftStore { all(): Promise<Draft[]>; put(draft: Draft): Promise<void>; remove(id: string): Promise<void> }
export interface Transport { read(key: string): Promise<Resource>; send(op: EditRequest): Promise<EditResult> }
export class SaveRejected extends Error {}
export class RemoteConflict extends Error { constructor(public current: Resource, public conflicts: Conflict[]) { super("같은 항목의 변경을 확인해 주세요."); } }

// One immutable request in flight per resource. A retry keeps its ID and payload, including after reload.
export class CollaborationEngine {
  readonly confirmed = new Map<string, Resource>();
  readonly drafts = new Map<string, Draft>();
  readonly busy = new Set<string>();
  recoverable: Draft[] = [];
  storageError = "";
  revision = 0;
  private listeners = new Set<() => void>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private storage = Promise.resolve();
  private sending = 0;
  private sendWaiters: (() => void)[] = [];
  private async send(op: EditRequest) {
    if (this.sending >= 2) await new Promise<void>(resolve => this.sendWaiters.push(resolve));
    else this.sending++;
    try { return await this.transport.send(op); }
    finally { const next = this.sendWaiters.shift(); if (next) next(); else this.sending--; }
  }
  private undo: { resource: string; changes: Change[] }[] = [];
  private localEditors = new Map<string, { count: number; done: Promise<void>; finish: () => void }>();
  private remoteReadHolds = new Map<string, number>();
  /** Keep a focused automatic editor stable without delaying its save acknowledgements. */
  holdRemoteReads(key: string) {
    this.remoteReadHolds.set(key, (this.remoteReadHolds.get(key) ?? 0) + 1);
    let held = true;
    return () => { if (!held) return; held = false; const count = this.remoteReadHolds.get(key)! - 1; if (count) this.remoteReadHolds.set(key,count); else this.remoteReadHolds.delete(key); };
  }
  canReceive(key: string) {
    const draft = this.drafts.get(key);
    return !this.remoteReadHolds.has(key) && !this.localEditors.has(key) && !this.busy.has(key) && !draft?.request && !draft?.conflicts?.length;
  }
  // Keep the comparison base stable while a field is buffered in its component.
  // Other windows may keep saving; their changes are compared after our blur commit.
  beginLocalEdit(key: string) {
    let entry = this.localEditors.get(key);
    if (!entry) {
      let finish!: () => void;
      const done = new Promise<void>(resolve => { finish = resolve; });
      entry = { count: 0, done, finish }; this.localEditors.set(key, entry);
    }
    entry.count++;
    let ended = false;
    return () => {
      if (ended) return; ended = true;
      if (--entry.count === 0) { this.localEditors.delete(key); entry.finish(); }
      void this.flush(key);
    };
  }
  private async waitForLocalEdit(key: string) {
    while (this.localEditors.has(key)) await this.localEditors.get(key)!.done;
  }
  constructor(public session: string, public editor: string, private transport: Transport, private store: DraftStore,
    private publish: (resource: Resource) => void, private delay = 600) {}
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  snapshot = () => this.revision;
  notify() { this.revision++; this.listeners.forEach((fn) => fn()); }
  private journal(draft: Draft | string) {
    const value = typeof draft === "string" ? draft : copy(draft);
    this.storage = this.storage.then(() => typeof value === "string" ? this.store.remove(value) : this.store.put(value))
      .catch(() => { this.storageError = "기기 초안을 보관하지 못했습니다. 저장 완료 전 창을 닫지 마세요."; this.notify(); });
  }
  async durable() { await this.storage; }
  async loadDrafts() { try { const stored = await this.store.all(), active = new Set([...this.drafts.values()].map(d => d.id)); this.recoverable = stored.filter(d => !active.has(d.id)); this.notify(); } catch { this.storageError = "기기 초안을 읽지 못했습니다."; this.notify(); } }
  seed(resource: Resource) { if (!this.confirmed.has(resource.key)) this.confirmed.set(resource.key, copy(resource)); }
  get(key: string) { return copy(this.drafts.has(key) ? this.drafts.get(key)!.desired : this.confirmed.get(key)?.doc ?? null); }
  private display(key: string) {
    const draft = this.drafts.get(key), base = this.confirmed.get(key) ?? { key, version: 0, doc: null };
    this.publish({ ...base, doc: draft ? copy(draft.desired) : copy(base.doc) }); this.notify();
  }
  edit(key: string, desired: Document, remember = false) {
    const before = this.get(key);
    if (equal(before, desired)) return;
    if (remember) { this.undo.push({ resource: key, changes: diff(desired, before) }); if (this.undo.length > 50) this.undo.shift(); }
    let draft = this.drafts.get(key);
    if (!draft) {
      draft = { id: crypto.randomUUID(), session: this.session, editor: this.editor, base: copy(this.confirmed.get(key) ?? { key, version: 0, doc: null }), desired: copy(desired), savedAt: Date.now() };
      this.drafts.set(key, draft);
    } else {
      draft.desired = copy(desired); draft.savedAt = Date.now();
      if (draft.remote && draft.conflicts?.length) draft.conflicts = merge(draft.remote.doc, diff(draft.base.doc, draft.desired)).conflicts;
    }
    // Changing a failed draft never changes an uncertain in-flight request. Retry that request first.
    this.journal(draft); this.display(key); this.schedule(key);
  }
  private schedule(key: string) {
    clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(() => { this.timers.delete(key); void this.flush(key); }, this.delay));
  }
  async flush(key: string): Promise<void> {
    clearTimeout(this.timers.get(key)); this.timers.delete(key);
    const draft = this.drafts.get(key);
    if (!draft || this.busy.has(key) || draft.conflicts?.length) return;
    if (!draft.request) {
      const changes = diff(draft.base.doc, draft.desired);
      if (!changes.length) { this.clear(key); return; }
      draft.request = { id: crypto.randomUUID(), resource: key, session: this.session, editor: this.editor, changes, schemaVersion: 2 };
      draft.sent = copy(draft.desired);
      this.journal(draft);
    }
    this.busy.add(key); draft.error = undefined; this.notify();
    // Commit request ID and content locally before attempting the network write.
    await this.durable();
    try {
      const saved = await this.send(copy(draft.request));
      await this.waitForLocalEdit(key);
      const later = diff(draft.sent!, draft.desired);
      this.confirmed.set(key, copy(saved));
      delete draft.request; delete draft.sent;
      const rebased = merge(saved.doc, later);
      if (rebased.conflicts.length) {
        draft.remote = saved; draft.conflicts = rebased.conflicts;
        // Keep the intended later delta for conflict resolution; retain its original before values.
        draft.base = { ...saved, doc: later.reduce((doc, c) => put(doc, c.path, c.before), copy(draft.desired)) };
        this.journal(draft); this.display(key);
      } else {
        draft.base = copy(saved); draft.desired = rebased.doc;
        if (equal(saved.doc, draft.desired)) this.clear(key);
        else { this.journal(draft); this.display(key); this.schedule(key); }
      }
    } catch (e) {
      await this.waitForLocalEdit(key);
      if (e instanceof RemoteConflict) {
        delete draft.request; delete draft.sent;
        const result = merge(e.current.doc, diff(draft.base.doc, draft.desired));
        if (result.conflicts.length) { draft.remote = e.current; draft.conflicts = result.conflicts; }
        else { draft.base = e.current; draft.desired = result.doc; this.confirmed.set(key, copy(e.current)); this.schedule(key); }
      }
      else { draft.error = e instanceof Error ? e.message : "저장 실패"; if (e instanceof SaveRejected) { delete draft.request; delete draft.sent; } }
      this.journal(draft); this.notify();
    } finally { this.busy.delete(key); this.notify(); }
  }
  private clear(key: string) {
    const draft = this.drafts.get(key); if (draft) this.journal(draft.id);
    this.drafts.delete(key); this.display(key);
  }
  async flushAll() { await Promise.all([...this.drafts.keys()].map((key) => this.flush(key))); }
  async receive(resource: Resource) {
    const key = resource.key, draft = this.drafts.get(key);
    if (!this.canReceive(key)) return;
    this.confirmed.set(key, copy(resource));
    if (draft) {
      const rebased = merge(resource.doc, diff(draft.base.doc, draft.desired));
      if (rebased.conflicts.length) { draft.remote = resource; draft.conflicts = rebased.conflicts; }
      else { draft.base = copy(resource); draft.desired = rebased.doc; }
      this.journal(draft);
    }
    this.display(key);
  }
  // Recompute against the latest local intent, then apply only each chosen passage. Independent
  // changes on both sides survive every choice. Network writes still compare the remote before-value.
  resolve(key: string, choices: Record<string, Resolution>, restoreDeleted = false) {
    const draft = this.drafts.get(key); if (!draft?.remote) return;
    const changes = diff(draft.base.doc, draft.desired), remote = draft.remote;
    const currentConflicts = merge(remote.doc, changes).conflicts;
    for (const c of currentConflicts) for (const part of conflictDetails(c)) {
      const choice = choices[part.id] ?? choices[JSON.stringify(c.path)];
      if (!choice) throw new Error("선택이 필요한 문장이 남아 있습니다. 변경된 부분을 확인해 주세요.");
      if (choice !== "remote" && !restoreDeleted && part.before !== null && part.local !== null && (part.remote === null || (!c.path.length && remote.doc?.deletedAt)))
        throw new Error("삭제된 항목의 내 내용을 쓰려면 ‘삭제된 카드·칸의 내 내용 복원’을 선택하세요.");
    }
    let desired = copy(remote.doc);
    const whole = currentConflicts.find(c => c.path.length === 0);
    if (whole) desired = choices["[]"] === "local" ? copy(whole.after) as Document : copy(remote.doc);
    else if (!desired && restoreDeleted) desired = copy(draft.desired);
    else {
      for (const c of changes) {
        const actual = currentConflicts.find(x => equal(x.path, c.path)), conflict = !!actual;
        if (actual?.details) {
          const selections = { ...choices };
          for (const part of actual.details) selections[part.id] ??= choices[JSON.stringify(c.path)];
          const resolved = mergeValue(c.before, c.after, read(remote.doc, c.path), c.path, selections);
          if (resolved.conflicts.length) throw new Error("변경된 문장을 다시 확인해 주세요.");
          desired = put(desired, c.path, resolved.value); continue;
        }
        if (conflict && choices[JSON.stringify(c.path)] !== "local") continue;
        if (c.path.length > 2 && read(desired, c.path.slice(0, -1)) === null) {
          if (!restoreDeleted) throw new Error("삭제된 칸의 내 내용을 쓰려면 ‘삭제된 항목 복원’을 선택하세요.");
          desired = put(desired, c.path.slice(0, -1), read(draft.desired, c.path.slice(0, -1)));
        }
        const result = merge(desired, [{ ...c, before: conflict ? read(desired, c.path) : c.before }]);
        if (result.conflicts.length) throw new Error("변경을 다시 비교해야 합니다.");
        desired = result.doc;
      }
    }
    // A rejected node deletion must remain in order; a restored node needs an order entry.
    if (desired?.nodes && Array.isArray(desired.order)) {
      const nodes = desired.nodes as Record<string, unknown>;
      const order = (desired.order as string[]).filter((id) => nodes[id]);
      for (const id of Object.keys(nodes)) if (!order.includes(id)) {
        const remoteOrder = (remote.doc?.order ?? []) as string[];
        const next = remoteOrder.slice(remoteOrder.indexOf(id) + 1).find((other) => order.includes(other));
        order.splice(next ? order.indexOf(next) : order.length, 0, id);
      }
      desired.order = order;
    }
    if (changes.some(c => c.path.length === 1 && c.path[0] === "blocks")) desired = syncBlockMirrors(desired, remote.doc) as Document;
    draft.base = copy(remote); draft.desired = desired; delete draft.remote; delete draft.conflicts; delete draft.error;
    this.confirmed.set(key, copy(remote)); this.journal(draft); this.display(key); this.schedule(key);
  }
  async recover(id: string) {
    const stored = (await this.store.all()).find((d) => d.id === id);
    if (!stored) { this.recoverable = this.recoverable.filter((d) => d.id !== id); this.notify(); return; }
    const key = stored.base.key;
    if (this.drafts.has(key)) throw new Error("이 카드의 현재 저장을 먼저 마쳐주세요.");
    const draft = copy(stored); draft.session = this.session; draft.editor = this.editor;
    this.drafts.set(key, draft); this.confirmed.set(key, copy(draft.base));
    this.recoverable = this.recoverable.filter((d) => d.id !== id);
    this.display(key);
    if (draft.request) await this.flush(key);
    else { await this.receive(await this.transport.read(key)); this.schedule(key); }
  }
  async discardRecovery(id: string) { await this.store.remove(id); this.recoverable = this.recoverable.filter((d) => d.id !== id); this.notify(); }
  get canUndo() { return this.undo.length > 0; }
  async undoLast() {
    const entry = this.undo.at(-1); if (!entry) return;
    await this.flushAll();
    if (this.drafts.size) throw new Error("저장 또는 충돌 처리를 먼저 마쳐주세요.");
    await this.applyChanges(entry.resource, entry.changes); this.undo.pop(); this.notify();
  }
  async applyChanges(key: string, changes: Change[]) {
    if (this.drafts.has(key)) throw new Error("이 카드의 저장 또는 충돌 처리를 먼저 마쳐주세요.");
    this.stageComparedChanges(await this.transport.read(key), changes);
  }
  /** Stage an explicit delta against a loaded snapshot. The server still compares before-values under lock. */
  stageComparedChanges(remote: Resource, changes: Change[]) {
    const key = remote.key;
    if (this.drafts.has(key)) throw new Error("이 카드의 저장 또는 충돌 처리를 먼저 마쳐주세요.");
    const merged = merge(remote.doc, changes);
    this.confirmed.set(key, copy(remote));
    if (!merged.conflicts.length) { this.edit(key, merged.doc); return; }
    // History reversals have their own expected before values. Preserve them for an explicit choice.
    let base = copy(remote.doc), desired = copy(remote.doc);
    if (!base && changes.every((c) => c.path.length)) throw new Error("카드가 삭제되어 있습니다. 카드 삭제 이력을 먼저 되돌려주세요.");
    for (const c of changes) { base = put(base, c.path, c.before); desired = put(desired, c.path, c.after); }
    const draft: Draft = { id: crypto.randomUUID(), session: this.session, editor: this.editor, base: { ...remote, doc: base }, desired, savedAt: Date.now(), remote, conflicts: merged.conflicts };
    this.drafts.set(key, draft); this.journal(draft); this.display(key);
  }
}

export function indexedDraftStore(): DraftStore {
  let opened: Promise<IDBDatabase> | undefined;
  const open = () => opened ??= new Promise((resolve, reject) => {
    const req = indexedDB.open("fiscus-collaboration", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("drafts", { keyPath: "id" });
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
  async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("drafts", mode), req = action(tx.objectStore("drafts"));
      tx.oncomplete = () => resolve(req.result); tx.onerror = tx.onabort = () => reject(tx.error);
    });
  }
  return { all: () => run("readonly", (s) => s.getAll()), put: async (d) => { await run("readwrite", (s) => s.put(d)); }, remove: async (id) => { await run("readwrite", (s) => s.delete(id)); } };
}
