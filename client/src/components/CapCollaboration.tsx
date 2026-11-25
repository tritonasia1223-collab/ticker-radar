import { useState, useSyncExternalStore } from "react";
import { collaboration as engine, peers, collabApi, activeResource, previousSession, syncError } from "@/lib/cap-collab-client";
import { pathLabel, conflictDetails, read, type Change } from "../../../shared/cap-collaboration";
import { CapConflictWizard } from "./CapConflictWizard";
import { conflictContext } from "@/lib/cap-conflict-context";
const show = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value, null, 2);
export function CapCollaboration({ resourcePrefix = "", loading = false }: { resourcePrefix?: string; loading?: boolean } = {}) {
  useSyncExternalStore(engine.subscribe, engine.snapshot);
  const [message, setMessage] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selected, setSelected] = useState(""), [history, setHistory] = useState<any[]>([]), [detail, setDetail] = useState<any>(null);
  const [historyKeys, setHistoryKeys] = useState<string[]>([]);
  const drafts = [...engine.drafts.values()].filter(d => d.base.key.startsWith(resourcePrefix)), conflicts = drafts.filter((d) => d.conflicts?.length), failed = drafts.some((d) => d.error);
  const conflictCount = conflicts.reduce((n, d) => n + d.conflicts!.flatMap(conflictDetails).length, 0);
  const run = async (work: () => void | Promise<void>) => { try { setMessage(""); await work(); } catch (e) { setMessage(String((e as Error).message)); } };
  const label = (key: string) => String(engine.get(key)?.title || engine.confirmed.get(key)?.doc?.title || key.slice(5));
  const loadHistory = async (key: string) => { setSelected(key); setDetail(null); setHistory(await collabApi(`history?resource=${encodeURIComponent(key)}`)); };
  return <div className="shrink-0 mb-2 space-y-2 text-xs" data-testid="cap-collaboration">
    <div className="flex flex-wrap items-center gap-3" role="status">
      <b>{conflictCount ? `충돌 ${conflictCount}곳 — 내용 선택 필요` : !navigator.onLine ? drafts.length ? "오프라인 — 기기 초안 보관 중" : "오프라인 — 마지막 저장본" : failed ? "저장 실패 — 초안 유지" : drafts.length ? "저장 중…" : loading ? "서버 연표 확인 중…" : "저장 완료"}</b>
      {failed && <button className="underline" onClick={() => void run(() => engine.flushAll())}>저장 다시 시도</button>}
      {peers.length > 0 && <span className="text-muted-foreground">다른 창 {peers.length}개 접속 중</span>}
      <button className="underline" onClick={() => void run(async () => {
        setHistoryOpen(!historyOpen);
        if (!historyOpen) { const keys = (await collabApi("history-resources")).map((r: any) => r.key).filter((key: string) => key.startsWith(resourcePrefix)); setHistoryKeys(keys); const key = (activeResource?.startsWith(resourcePrefix) ? activeResource : null) || [...engine.confirmed.keys(), ...keys].find(k => k.startsWith(resourcePrefix)); if (key) await loadHistory(key); }
      })}>변경 이력</button>
    </div>
    {(engine.storageError || message) && <p role="alert" className="text-amber-600">{[engine.storageError, message].filter(Boolean).join(" / ")}</p>}
    {syncError && <p role="status" className="text-amber-600">동기화 연결 확인 중 · {syncError}</p>}
    {engine.recoverable.filter(d => d.base.key.startsWith(resourcePrefix)).filter((d) => d.session === previousSession || !peers.some((p) => p.session === d.session)).map((d) => <div key={d.id} className="rounded border border-amber-500 p-2" role="alert">
      남아 있는 기기 초안: {label(d.base.key)} · {d.editor} · {new Date(d.savedAt).toLocaleString()}
      <button className="ml-3 underline" onClick={() => void run(() => engine.recover(d.id))}>서버와 비교해 복구</button>
      <button className="ml-3 underline" onClick={() => { if (window.confirm("이 기기에 남은 초안을 삭제할까요? 서버 내용은 유지됩니다.")) void run(() => engine.discardRecovery(d.id)); }}>초안 삭제</button>
    </div>)}
    {!!conflicts.length && (() => {
      // Resolve one card, one passage at a time. Other drafts stay safely journalled.
      const d = conflicts[0];
      const items = d.conflicts!.flatMap(c => conflictDetails(c).map(part => ({ ...part, label: conflictContext(c, part) })));
      const restoring = d.conflicts!.some(c => conflictDetails(c).some(part => part.before !== null && part.local !== null && part.remote === null) || (!c.path.length && !!d.remote?.doc?.deletedAt) || (c.path.length > 2 && read(d.remote!.doc, c.path.slice(0, -1)) === null));
      return <CapConflictWizard key={d.id} title={label(d.base.key)} items={items} restoreRequired={restoring} onResolve={(choices, restore) => engine.resolve(d.base.key, choices, restore)} />;
    })()}
    {historyOpen && <div className="max-h-[45vh] overflow-auto rounded border bg-background p-3" data-testid="collab-history">
      <div className="flex gap-2"><select aria-label="이력 카드" value={selected} className="max-w-[70%] bg-background border" onChange={(e) => void run(() => loadHistory(e.target.value))}>
        {[...new Set([...engine.confirmed.keys(), ...historyKeys])].map((key) => <option key={key} value={key}>{label(key)}</option>)}
      </select><button className="underline" onClick={() => void run(() => loadHistory(selected))}>새로고침</button><button onClick={() => setHistoryOpen(false)}>닫기</button></div>
      {!history.length && <p className="my-2">협업 업데이트 이후 저장된 이력이 없습니다.</p>}
      {history.map((h) => <button key={h.id} className="block my-1 underline" onClick={() => void run(async () => setDetail(await collabApi(`history/${h.id}`)))}>{new Date(h.takenAt).toLocaleString()} · {h.editor}</button>)}
      {detail && <div className="border-t mt-2 pt-2">{detail.changes.map((c: Change, i: number) => <div key={i}><b>{pathLabel(c.path)}</b><div className="grid grid-cols-2 gap-2"><pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words">이전: {show(c.before)}</pre><pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words">이후: {show(c.after)}</pre></div></div>)}
        <button className="mt-2 rounded border px-2 py-1" onClick={() => void run(async () => { await engine.applyChanges(detail.resource, detail.changes.map((c: Change) => ({ path: c.path, before: c.after, after: c.before }))); setHistoryOpen(false); })}>이 변경만 되돌리기</button>
      </div>}
    </div>}
  </div>;
}
