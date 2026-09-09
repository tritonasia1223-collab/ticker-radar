import { useState, useSyncExternalStore } from "react";
import { collaboration as engine, peers, syncError, collabApi, activeResource, previousSession } from "@/lib/cap-collab-client";
import { pathLabel, type Change } from "../../../shared/cap-collaboration";
const show = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value, null, 2);
export function CapCollaboration() {
  useSyncExternalStore(engine.subscribe, engine.snapshot);
  const [message, setMessage] = useState("");
  const [choices, setChoices] = useState<Record<string, "remote" | "local">>({});
  const [restore, setRestore] = useState(false), [historyOpen, setHistoryOpen] = useState(false);
  const [selected, setSelected] = useState(""), [history, setHistory] = useState<any[]>([]), [detail, setDetail] = useState<any>(null);
  const [historyKeys, setHistoryKeys] = useState<string[]>([]);
  const drafts = [...engine.drafts.values()], conflicts = drafts.filter((d) => d.conflicts?.length), failed = drafts.some((d) => d.error);
  const run = async (work: () => void | Promise<void>) => { try { setMessage(""); await work(); } catch (e) { setMessage(String((e as Error).message)); } };
  const label = (key: string) => String(engine.get(key)?.title || engine.confirmed.get(key)?.doc?.title || key.slice(5));
  const loadHistory = async (key: string) => { setSelected(key); setDetail(null); setHistory(await collabApi(`history?resource=${encodeURIComponent(key)}`)); };
  return <div className="shrink-0 mb-2 space-y-2 text-xs" data-testid="cap-collaboration">
    <div className="flex flex-wrap items-center gap-3" role="status">
      <b>{conflicts.length ? `충돌 ${conflicts.length}건 — 내용 선택 필요` : failed ? "저장 실패 — 초안 유지" : drafts.length ? "저장 중…" : "저장 완료"}</b>
      {failed && <button className="underline" onClick={() => void run(() => engine.flushAll())}>저장 다시 시도</button>}
      {peers.length > 0 && <span className="text-muted-foreground">다른 창 {peers.length}개 접속 중</span>}
      <button className="underline" onClick={() => void run(async () => {
        setHistoryOpen(!historyOpen);
        if (!historyOpen) { const keys = (await collabApi("history-resources")).map((r: any) => r.key); setHistoryKeys(keys); const key = activeResource || [...engine.confirmed.keys(), ...keys][0]; if (key) await loadHistory(key); }
      })}>변경 이력</button>
    </div>
    {(syncError || engine.storageError || message) && <p role="alert" className="text-amber-600">{[syncError && "동기화 연결 확인 중 · 내 초안 유지", engine.storageError, message].filter(Boolean).join(" / ")}</p>}
    {engine.recoverable.filter((d) => d.session === previousSession || !peers.some((p) => p.session === d.session)).map((d) => <div key={d.id} className="rounded border border-amber-500 p-2" role="alert">
      남아 있는 기기 초안: {label(d.base.key)} · {d.editor} · {new Date(d.savedAt).toLocaleString()}
      <button className="ml-3 underline" onClick={() => void run(() => engine.recover(d.id))}>서버와 비교해 복구</button>
      <button className="ml-3 underline" onClick={() => { if (window.confirm("이 기기에 남은 초안을 삭제할까요? 서버 내용은 유지됩니다.")) void run(() => engine.discardRecovery(d.id)); }}>초안 삭제</button>
    </div>)}
    {!!conflicts.length && <div className="max-h-[45vh] overflow-auto rounded border border-amber-500 bg-background p-3" role="alert" data-testid="collab-conflicts">
      <p className="mb-2 font-semibold">같은 항목을 함께 수정했습니다. 내 초안을 보관했습니다. 각 항목에서 저장할 내용을 선택하세요.</p>
      {conflicts.map((d) => <section key={d.id} className="mb-4 space-y-2">
        <b>{label(d.base.key)}</b>
        {d.conflicts!.map((c) => { const key = `${d.id}:${JSON.stringify(c.path)}`; return <div key={key} className="rounded border p-2">
          <p>{pathLabel(c.path)}</p>
          <div className="grid grid-cols-2 gap-2">
            {(["remote", "local"] as const).map((which) => <label key={which} className="min-w-0">
              <input type="radio" name={key} checked={choices[key] === which} onChange={() => setChoices({ ...choices, [key]: which })} /> {which === "remote" ? "서버 내용" : "내 내용"}
              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words bg-muted p-2 select-text">{show(which === "remote" ? c.remote : c.after)}</pre>
            </label>)}
          </div>
        </div>; })}
        <label className="block"><input type="checkbox" checked={restore} onChange={(e) => setRestore(e.target.checked)} /> 삭제된 카드·칸을 내 초안으로 복원 (복원을 원하는 경우만)</label>
        <button className="rounded border px-2 py-1 disabled:opacity-40" disabled={d.conflicts!.some((c) => !choices[`${d.id}:${JSON.stringify(c.path)}`])} onClick={() => void run(() => {
          engine.resolve(d.base.key, Object.fromEntries(d.conflicts!.map((c) => [JSON.stringify(c.path), choices[`${d.id}:${JSON.stringify(c.path)}`]])), restore); setRestore(false);
        })}>선택한 내용 반영</button>
      </section>)}
    </div>}
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
