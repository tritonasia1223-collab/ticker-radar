import React, { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import "../src/index.css";
import { collaboration as engine, collabApi } from "../src/lib/cap-collab-client";
import { CapCollaboration } from "../src/components/CapCollaboration";
import { CapRichText } from "../src/components/CapRichText";
import { diff, type Resource } from "../../shared/cap-collaboration";

const initial: Resource = await collabApi("resource?key=meta:conflict-preview");
engine.seed(initial);
await engine.loadDrafts();
function Preview() {
  useSyncExternalStore(engine.subscribe, engine.snapshot);
  const [base, setBase] = useState(initial), [mine, setMine] = useState(String(initial.doc!.text)), [other, setOther] = useState(String(initial.doc!.text));
  const [saved, setSaved] = useState(initial), [message, setMessage] = useState("");
  const [title, setTitle] = useState(String(initial.doc!.title));
  const run = async (action: () => Promise<unknown>) => { try { setMessage(""); await action(); } catch (e) { setMessage((e as Error).message); } };
  const refresh = async () => { const next: Resource = await collabApi(`resource?key=${base.key}`); setSaved(next); return next; };
  return <main className="space-y-6" style={{ background: "#f8f7f3", minHeight: "100vh", maxWidth: 960, margin: "0 auto", padding: "32px 24px" }}>
    <header><p className="text-xs text-stone-500">자본주의 경제사 · 협업 저장 미리보기 · 운영 연결 없음</p><h1 className="mt-2 text-2xl font-semibold">겹친 표현만 한 곳씩 확인</h1></header>
    <CapCollaboration resourcePrefix="meta:conflict-preview" />
    <details><summary className="cursor-pointer text-sm">편집 상황 만들기</summary><div className="mt-4 grid sm:grid-cols-2 gap-4">
      <label className="space-y-2 text-sm">내 작성본<textarea aria-label="내 작성본" className="w-full border rounded p-3 min-h-32 bg-white" value={mine} onChange={e => setMine(e.target.value)} /></label>
      <label className="space-y-2 text-sm">다른 편집자 작성본<textarea aria-label="다른 편집자 작성본" className="w-full border rounded p-3 min-h-32 bg-white" value={other} onChange={e => setOther(e.target.value)} /></label>
    </div><div className="my-3 flex flex-wrap gap-3 text-sm">
      <label>카드 제목<input aria-label="카드 제목" className="border bg-white px-2 py-1 ml-2" value={title} onChange={e => setTitle(e.target.value)} /></label>
      <button className="border rounded bg-white px-3 py-2" onClick={() => void run(async () => { engine.edit(base.key, { ...engine.get(base.key), title }); await engine.flushAll(); })}>내 제목 수정</button>
      <button className="border rounded bg-white px-3 py-2" onClick={() => void run(async () => {
        const op = { id: crypto.randomUUID(), session: crypto.randomUUID(), editor: "미리보기 다른 편집자", resource: base.key, schemaVersion: 2, changes: diff(base.doc, { ...base.doc, text: other }) };
        await collabApi("edit", op); await refresh();
      })}>다른 편집자 저장</button>
      <button className="border rounded bg-white px-3 py-2" onClick={() => void run(async () => { engine.edit(base.key, { ...base.doc, text: mine }); await engine.flushAll(); await refresh(); })}>내 수정 저장</button>
      <button className="border rounded bg-white px-3 py-2" onClick={() => void run(async () => { const next = await refresh(); await engine.receive(next); setBase(next); setMine(String(next.doc!.text)); setOther(String(next.doc!.text)); })}>최신본으로 다음 비교 준비</button>
    </div></details>
    {message && <p role="alert">{message}</p>}
    <section className="rounded-xl border bg-white p-5"><div className="mb-3 flex justify-between"><h2 className="font-semibold">저장된 내용</h2><button className="text-xs underline" onClick={() => void run(refresh)}>저장 결과 다시 읽기</button></div><p className="text-sm leading-7" data-testid="saved-content"><CapRichText text={String(saved.doc?.text ?? "")} /></p></section>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
