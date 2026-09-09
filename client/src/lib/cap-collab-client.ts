import { queryClient } from "./queryClient";
import { CollaborationEngine, indexedDraftStore, RemoteConflict, SaveRejected } from "./cap-collab-engine";
import { diff, documentFlow, flowDocument, metaDocument, type Resource, type Peer } from "../../../shared/cap-collaboration";
import type { FlowDTO, CapMetaCard } from "./capitalism-types";
import { rebuildEdges } from "./capitalism-flowops";

export async function collabApi(path: string, body?: unknown) {
  const response = await fetch(`/api/capitalism/collab/${path}`, { method: body === undefined ? "GET" : "POST", cache: "no-store", headers: body === undefined ? {} : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const result = await response.json().catch(() => ({ error: `서버 응답 ${response.status}` }));
  if (response.status === 409 && result.current) throw new RemoteConflict(result.current, result.conflicts);
  if ([400, 413, 428].includes(response.status)) throw new SaveRejected(result.error ?? "입력 형식 또는 용량을 확인해 주세요.");
  if (!response.ok) throw new Error(result.error ?? "서버에 연결하지 못했습니다.");
  return result;
}
const flowsKey = ["/api/capitalism/flows"], metaKey = ["/api/capitalism/settings/insight_overview_v2"];
function publish(resource: Resource) {
  if (resource.key.startsWith("flow:")) {
    queryClient.setQueryData<FlowDTO[]>(flowsKey, (prev = []) => {
      const old = prev.find((f) => f.slug === resource.key.slice(5)), next = documentFlow(resource.key, resource.doc, resource.version, old?.id);
      if (next) next.edges = rebuildEdges(next.nodes, next.layout);
      const rest = prev.filter((f) => f.slug !== resource.key.slice(5));
      return (next ? [...rest, next] : rest).sort((a, b) => a.date.localeCompare(b.date) || a.sortOrder - b.sortOrder);
    });
  } else {
    queryClient.setQueryData<{ value: string }>(metaKey, (prev) => {
      const cards: CapMetaCard[] = prev?.value ? JSON.parse(prev.value).cards : [];
      const index = cards.findIndex((c) => c.id === resource.key.slice(5));
      const next = cards.filter((c) => c.id !== resource.key.slice(5));
      if (resource.doc) next.splice(index < 0 ? next.length : index, 0, resource.doc as unknown as CapMetaCard);
      return { value: JSON.stringify({ cards: next }) };
    });
  }
}
const session = crypto.randomUUID();
export let previousSession: string | null = null;
try { previousSession = sessionStorage.getItem("fiscus-tab-session"); sessionStorage.setItem("fiscus-tab-session", session); } catch { /* draft storage has separate error reporting */ }
// Automatic per-window label for history; no name entry or user setup is needed.
const editor = `창-${session.slice(0, 8)}`;
export const collaboration = new CollaborationEngine(session, editor, {
  read: (key) => collabApi(`resource?key=${encodeURIComponent(key)}`), send: (op) => collabApi("edit", op),
}, indexedDraftStore(), publish);
export let peers: Peer[] = [];
export let syncError = "";
export let activeResource: string | null = null;
let started = false, polling = false, metaVersion = -1;
export function focusResource(key: string | null) { if (activeResource === key) return; activeResource = key; collaboration.notify(); void presence(); }
async function presence() {
  try { await collabApi("presence", { session, editor: collaboration.editor, resource: document.visibilityState === "hidden" ? null : activeResource }); } catch { /* poll reports connection health */ }
}
export function seedCollaboration(flows: FlowDTO[], cards: CapMetaCard[]) {
  flows.forEach((f) => collaboration.seed({ key: `flow:${f.slug}`, version: f.updatedAt, doc: flowDocument(f) }));
  cards.forEach((c) => collaboration.seed({ key: `meta:${c.id}`, version: 0, doc: metaDocument(c) }));
  if (started) return; started = true;
  void collaboration.loadDrafts(); void poll(); void presence();
  setInterval(() => void poll(), 5000); setInterval(() => void presence(), 15000);
  window.addEventListener("online", () => { void collaboration.flushAll(); void poll(); });
  window.addEventListener("beforeunload", (e) => { if (collaboration.drafts.size) { e.preventDefault(); e.returnValue = ""; } });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") void collaboration.flushAll(); else void poll(); });
}
export async function poll() {
  if (polling) return; polling = true;
  try {
    const state = await collabApi("state");
    peers = state.peers.filter((p: Peer) => p.session !== session); syncError = "";
    const versions = new Map<string, number>(state.flows.map((f: any) => [`flow:${f.key}`, Number(f.version)]));
    const changed = new Set<string>();
    for (const [key, version] of versions) if (collaboration.confirmed.get(key)?.version !== version) changed.add(key);
    for (const key of collaboration.confirmed.keys()) if (key.startsWith("flow:") && !versions.has(key)) changed.add(key);
    // Fetch in small batches to avoid exhausting the serverless pool on a large initial sync.
    const keys = [...changed];
    for (let i = 0; i < keys.length; i += 4) await Promise.all(keys.slice(i, i + 4).map(async (key) => {
      if (!collaboration.busy.has(key)) await collaboration.receive(await collabApi(`resource?key=${encodeURIComponent(key)}`));
    }));
    if (metaVersion !== Number(state.metaVersion)) {
      const response = await fetch("/api/capitalism/settings/insight_overview_v2", { cache: "no-store", signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error("메타 인사이트를 읽지 못했습니다.");
      const setting = await response.json(), cards: CapMetaCard[] = setting.value ? JSON.parse(setting.value).cards : [];
      // Legacy data stays visible until a v2 setting exists.
      if (setting.value) {
        const all = new Set([...cards.map((c) => `meta:${c.id}`), ...[...collaboration.confirmed.keys()].filter((k) => k.startsWith("meta:"))]);
        for (const key of all) await collaboration.receive({ key, version: Number(state.metaVersion), doc: metaDocument(cards.find((c) => `meta:${c.id}` === key)) });
      }
      metaVersion = Number(state.metaVersion);
    }
  } catch (e) { syncError = e instanceof Error ? e.message : "동기화 연결 실패"; }
  finally { polling = false; collaboration.notify(); }
}
export function saveFlowDraft(slug: string, remember = false) {
  focusResource(`flow:${slug}`);
  collaboration.edit(`flow:${slug}`, flowDocument(queryClient.getQueryData<FlowDTO[]>(flowsKey)?.find((f) => f.slug === slug)), remember);
}
export function saveMetaDrafts(next: CapMetaCard[]) {
  const old = [...collaboration.confirmed.keys(), ...collaboration.drafts.keys()].filter((k) => k.startsWith("meta:"));
  for (const key of new Set([...old, ...next.map((c) => `meta:${c.id}`)])) {
    const doc = metaDocument(next.find((c) => `meta:${c.id}` === key));
    if (diff(collaboration.get(key), doc).length) { focusResource(key); collaboration.edit(key, doc); }
  }
}
