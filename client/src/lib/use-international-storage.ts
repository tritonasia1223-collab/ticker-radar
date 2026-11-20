import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Resource } from "../../../shared/cap-collaboration";
import { equal } from "../../../shared/cap-collaboration";
import { collaboration, collabApi, seedCollaboration, focusResource } from "./cap-collab-client";
import { queryClient } from "./queryClient";
import { useCollaborationSync } from "./use-collaboration-sync";
import { draftResources, localImportChanges, resourcesDraft } from "./international-timeline-storage";
import type { TimelineDraft } from "./international-timeline-draft";

const LEGACY = "fiscus-international-timeline-v1", BACKUP = "fiscus-international-timeline-before-db-v1", RECEIPT = "fiscus-international-timeline-db-import-v1", CACHE = "fiscus-international-timeline-db-cache-v1";
type ImportReceipt = { source: string; keys: string[]; complete?: boolean };
export function useInternationalStorage(local: TimelineDraft, baseline: TimelineDraft, locked: boolean) {
  const revision = useSyncExternalStore(collaboration.subscribe, collaboration.snapshot);
  const [ready, setReady] = useState(false), [error, setError] = useState("");
  const importing = useRef(false);
  const query = useQuery<Resource[]>({ queryKey: ["international-timeline-resources"], retry: false, queryFn: async () => {
    const raw = localStorage.getItem(LEGACY);
    if (raw && !localStorage.getItem(BACKUP)) localStorage.setItem(BACKUP, raw);
    let result = await collabApi("international");
    if (!result.initialized) { await collabApi("international/init", draftResources(baseline).map(({key,doc}) => ({ key, doc }))); result = await collabApi("international"); }
    return result.resources;
  } });
  useEffect(() => {
    if (!query.isSuccess || importing.current) return;
    importing.current = true;
    void (async () => {
      try {
        seedCollaboration([], []);
        await collaboration.loadDrafts();
        for (const resource of query.data) {
          if (!collaboration.confirmed.has(resource.key)) collaboration.seed(resource);
          else await collaboration.receive(resource);
        }
        const raw = localStorage.getItem(LEGACY);
        if (raw && !locked) {
          const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)))].map(b => b.toString(16).padStart(2,"0")).join("");
          const previous = JSON.parse(localStorage.getItem(RECEIPT) ?? "null") as ImportReceipt | null;
          const receipt: ImportReceipt = previous?.source === hash ? previous : { source: hash, keys: [] };
          if (!receipt.complete) for (const item of localImportChanges(baseline, local)) {
            if (receipt.keys.includes(item.key)) continue;
            if (collaboration.recoverable.some(d => d.base.key === item.key)) throw new Error("이전 기기 초안을 먼저 ‘서버와 비교해 복구’한 뒤 다시 연결해 주세요. 브라우저 원본은 보존했습니다.");
            if (!collaboration.drafts.has(item.key)) collaboration.stageComparedChanges(collaboration.confirmed.get(item.key) ?? { key: item.key, version: 0, doc: null }, item.changes);
            await collaboration.durable();
            if (collaboration.storageError) throw new Error(collaboration.storageError);
            receipt.keys.push(item.key); localStorage.setItem(RECEIPT, JSON.stringify(receipt));
          }
          receipt.complete = true; localStorage.setItem(RECEIPT, JSON.stringify(receipt));
          void collaboration.flushAll();
        }
        setReady(true);
      } catch (e) { setError(e instanceof Error ? e.message : "기존 편집본을 이관하지 못했습니다. 원본은 보존했습니다."); importing.current = false; }
    })();
  }, [query.isSuccess, query.dataUpdatedAt]);
  // A confirmed DB cache is a safe comparison base for offline drafts; never promote an old local-only collection to one.
  useEffect(() => {
    if (!query.isError || ready || locked) return;
    try {
      const receipt = JSON.parse(localStorage.getItem(RECEIPT) ?? "null");
      if (localStorage.getItem(LEGACY) && !receipt?.complete) return;
      const cached = JSON.parse(localStorage.getItem(CACHE) ?? "null") as Resource[] | null;
      if (!cached?.length) return;
      resourcesDraft(cached); seedCollaboration([], []);
      for (const resource of cached) collaboration.seed(resource);
      setReady(true);
    } catch { /* Keep the original collection read-only if its confirmed cache is invalid. */ }
  }, [query.isError, ready, locked]);
  useCollaborationSync("international", ready);
  const draft = useMemo(() => {
    if (!ready) return local;
    const records = new Map((query.data ?? []).map(r => [r.key,r]));
    for (const [key, confirmed] of collaboration.confirmed) if (key.startsWith("intl:")) records.set(key, { ...confirmed, doc: collaboration.get(key) });
    return resourcesDraft([...records.values()], local.imports);
  }, [ready, query.data, revision, local]);
  useEffect(() => {
    if (!ready) return;
    try {
      // Pending values live in the IndexedDB journal, never masquerade as a confirmed server cache.
      const json = JSON.stringify([...collaboration.confirmed.values()].filter(r => r.key.startsWith("intl:")));
      if (localStorage.getItem(CACHE) !== json) localStorage.setItem(CACHE, json);
    }
    catch { setError("기기 캐시를 보관하지 못했습니다. 서버 저장 상태를 확인하세요."); }
  }, [ready, revision]);
  function save(next: TimelineDraft) {
    if (!ready || locked) return;
    for (const resource of draftResources(next)) {
      if (equal(collaboration.get(resource.key), resource.doc)) continue;
      focusResource(resource.key); collaboration.edit(resource.key, resource.doc);
    }
  }
  const conflicts = [...collaboration.drafts.values()].some(d => d.base.key.startsWith("intl:") && d.conflicts?.length);
  return { draft, save, ready, conflicts, error: error || (query.isError ? "국제 연표를 서버에서 읽지 못했습니다. 기기 원본은 보존했습니다." : ""), retry: () => { setError(""); importing.current = false; void query.refetch(); } };
}
