import React, { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import "../src/index.css";
import { collaboration as engine, collabApi } from "../src/lib/cap-collab-client";
import { CapCollaboration } from "../src/components/CapCollaboration";
import { CapRichText } from "../src/components/CapRichText";
import { diff, type Resource } from "../../shared/cap-collaboration";
import { metaCardToBlocks, blocksToMetaFields, BlockStack } from "../src/components/CapBlocks";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const previewQueries = new QueryClient({ defaultOptions: { queries: { enabled: false } } });

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
  const tableScenario = async (deletion: boolean) => {
    const latest = await refresh();
    const table = deletion ? { title: "연도별 상황표", widths: [1, 3], cells: [["연도", "내용"], ["1969", "원문"], ["1970", "금리 원문"]] } : { title: "빈 머리글", widths: [1, 1], cells: [["", ""], ["A", "B"]] };
    const source = { ...latest.doc, text: "표 검증", tables: [table], blocks: null };
    const send = (before: Resource["doc"], after: Resource["doc"]) => collabApi("edit", { id: crypto.randomUUID(), session: crypto.randomUUID(), editor: "합성 표 검증", resource: base.key, schemaVersion: 2, changes: diff(before, after) });
    await send(latest.doc, source); const start = await refresh(); await engine.receive(start);
    const own = structuredClone(source), other = structuredClone(source);
    if (deletion) { own.tables[0].cells.splice(1, 1); other.tables[0].cells[1][1] = "겹친 수정"; other.tables[0].cells[2][1] = "금리 상대 독립 수정"; }
    else { own.tables[0].widths.push(1); own.tables[0].cells.forEach(row => row.push("")); other.tables[0].cells[1][1] = "B edited"; }
    await send(source, other); engine.edit(base.key, own); await engine.flushAll(); await refresh();
  };
  const firstBlockScenario = async () => {
    const latest = await refresh();
    const source = { ...latest.doc, text: "기업 운영의 자율성이 확대됐습니다.", tables: [], images: [], blocks: null };
    const send = (before: Resource["doc"], after: Resource["doc"]) => collabApi("edit", { id: crypto.randomUUID(), session: crypto.randomUUID(), editor: "합성 변환 검증", resource: base.key, schemaVersion: 2, changes: diff(before, after) });
    await send(latest.doc, source); const start = await refresh(); await engine.receive(start);
    const converted = (text: string) => ({ ...source, ...blocksToMetaFields(metaCardToBlocks({ ...source, text } as any)) });
    await send(source, converted("기업 운영의 자율성이 제한적으로 확대됐습니다."));
    engine.edit(base.key, converted("기업 경영의 자율성이 확대됐습니다.")); await engine.flushAll(); await refresh();
  };
  const mixedScenario = async (conflict: boolean) => {
    const latest = await refresh(), source = { ...latest.doc, text: "기업 운영은 소폭 늘었습니다.", tables: [], images: [], blocks: null };
    const send = (before: Resource["doc"], after: Resource["doc"]) => collabApi("edit", { id: crypto.randomUUID(), session: crypto.randomUUID(), editor: "합성 형식 호환 검증", resource: base.key, schemaVersion: 2, changes: diff(before, after) });
    await send(latest.doc, source); const start = await refresh(); await engine.receive(start);
    const converted = (text: string) => ({ ...source, ...blocksToMetaFields(metaCardToBlocks({ ...source, text } as any)) });
    if (conflict) {
      await send(source, { ...source, text: "기업 운영은 조금 늘었습니다." });
      engine.edit(base.key, converted("기업 경영은 크게 늘었습니다.")); await engine.flushAll();
    } else {
      await send(source, converted("기업 운영은 크게 늘었습니다."));
      await send(source, { ...source, text: "기업 경영은 소폭 늘었습니다." });
    }
    const saved = await refresh(); if (!conflict) await engine.receive(saved);
  };
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
      <button onClick={() => void run(() => tableScenario(false))}>빈 머리글 표 검증</button>
      <button onClick={() => void run(() => tableScenario(true))}>행 삭제 충돌 검증</button>
      <button onClick={() => void run(firstBlockScenario)}>최초 블록 전환 검증</button>
      <button onClick={() => void run(() => mixedScenario(true))}>평문·블록 충돌 검증</button>
      <button onClick={() => void run(() => mixedScenario(false))}>이전 평문 요청 검증</button>
    </div></details>
    {message && <p role="alert">{message}</p>}
    <section className="rounded-xl border bg-white p-5"><div className="mb-3 flex justify-between"><h2 className="font-semibold">저장된 내용</h2><button className="text-xs underline" onClick={() => void run(refresh)}>저장 결과 다시 읽기</button></div><p className="text-sm leading-7" data-testid="saved-content"><CapRichText text={String(saved.doc?.text ?? "")} /></p><pre data-testid="saved-tables">{JSON.stringify(saved.doc?.tables, null, 2)}</pre></section>
    <section className="rounded-xl border bg-white p-5" data-testid="rendered-blocks"><h2>실제 블록 화면</h2><BlockStack blocks={metaCardToBlocks(saved.doc as any)} editing={false} allow={{ text: true, table: true }} onChange={() => {}} /></section>
  </main>;
}
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={previewQueries}><Preview /></QueryClientProvider>);
