import { Fragment, forwardRef, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useInView } from "framer-motion";
import { ArrowUp, ArrowDown, Plus, Trash2, Move, X, Minus } from "lucide-react";
import { CapRichEditor, type CapRichEditorHandle, type CapRichEditorProps } from "./CapRichEditor";
import { collaboration } from "@/lib/cap-collab-client";
import { CapRichText } from "./CapRichText";
import { ComparisonBalance } from "./ComparisonBalance";
import { useComparisonBalanceMotion } from "@/lib/use-comparison-balance-motion";
import { splitInsightScenes, sceneMarker, moveScene, type InsightScene } from "../../../shared/comparison-scenes";
import type { ComparisonInsight } from "../../../shared/cap-comparison";
import type { InsightBalance } from "../../../shared/comparison-balance";

type Props = {
  resourceKey: string;
  note: ComparisonInsight; canEdit: boolean; onJump: (slug: string) => void;
  read: () => ComparisonInsight | null; save: (patch: Partial<ComparisonInsight>) => boolean;
  topSceneId?: string;
};
export function ComparisonInsightBody({ resourceKey, note, canEdit, onJump, read, save, topSceneId }: Props) {
  const editors = useRef(new Map<string, CapRichEditorHandle>());
  const [newId, setNewId] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const [placing, setPlacing] = useState<"new" | string | null>(null);
  const [target, setTarget] = useState<{ after: string | null; x: number; y: number } | null>(null);
  const [placementError, setPlacementError] = useState("");
  useEffect(() => {
    if (!placing || !canEdit) { setTarget(null); return; }
    const locate = () => {
      const selection = window.getSelection();
      if (!selection?.rangeCount || !selection.isCollapsed) { setTarget(null); return; }
      const range = selection.getRangeAt(0);
      const element = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
      const section = element?.closest<HTMLElement>("[data-insight-section]");
      if (!section || !body.current?.contains(section) || !element?.closest("[contenteditable=true]")) { setTarget(null); return; }
      const rect = range.getClientRects()[0] ?? element.getBoundingClientRect();
      const scroller = body.current.closest('[data-testid="comparison-sidebar-scroll"]')?.getBoundingClientRect();
      if (rect.bottom < (scroller?.top ?? 0) || rect.top > (scroller?.bottom ?? window.innerHeight)) { setTarget(null); return; }
      setTarget({ after: section.dataset.insightSection || null, x: Math.min(window.innerWidth - 240, Math.max(8, rect.left)), y: Math.max(8, Math.min(window.innerHeight - 48, rect.bottom + 8)) });
    };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { setPlacing(null); setTarget(null); } };
    locate();
    document.addEventListener("selectionchange", locate);
    window.addEventListener("scroll", locate, true);
    window.addEventListener("resize", locate);
    window.addEventListener("keydown", escape);
    return () => { document.removeEventListener("selectionchange", locate); window.removeEventListener("scroll", locate, true); window.removeEventListener("resize", locate); window.removeEventListener("keydown", escape); };
  }, [placing, canEdit]);
  const parts = splitInsightScenes(note.text);
  const flush = () => { for (const editor of editors.current.values()) editor.blur(); };
  const editText = (after: string | null, text: string) => {
    const current = read(); if (!current) return;
    const part = splitInsightScenes(current.text).find(p => p.after === after);
    if (!part || part.text === text) return;
    save({ text: current.text.slice(0, part.start) + text + current.text.slice(part.end) });
  };
  const insert = (after: string | null) => {
    const editor = editors.current.get(after ?? "lead");
    const split = editor?.splitAtCaret();
    if (!split || !placing) { setPlacementError("넣을 위치에 커서를 놓아 주세요."); return; }
    flush();
    const current = read(); if (!current || (placing === "new" && (current.scenes?.length ?? 0) >= 30)) return;
    const part = splitInsightScenes(current.text).find(p => p.after === after); if (!part) return;
    if (part.text !== split.source) { setPlacementError("글이 변경되었습니다. 위치를 다시 선택해 주세요."); return; }
    if (placing !== "new") {
      if (!current.scenes?.some(s => s.id === placing)) return;
      const marker = sceneMarker(placing);
      const prefix = (current.text.slice(0, part.start) + split.before).replace(marker, "");
      const suffix = (split.after + current.text.slice(part.end)).replace(marker, "");
      if (save({ text: prefix + marker + suffix })) { setPlacing(null); setTarget(null); requestAnimationFrame(() => document.getElementById(`insight-scene-${placing}`)?.scrollIntoView({ block: "nearest" })); }
      return;
    }
    const balance = current.scenes?.find(s => s.id === after)?.balance ?? current.balance ?? { money: 0, goods: 0, outcome: null };
    const scene: InsightScene = { id: crypto.randomUUID(), title: "", balance: { ...balance } };
    const before = split.before, rest = split.after;
    if (save({ text: current.text.slice(0, part.start) + before + sceneMarker(scene.id) + rest + current.text.slice(part.end), scenes: [...(current.scenes ?? []), scene] })) {
      setNewId(scene.id);
      setPlacing(null); setTarget(null);
      requestAnimationFrame(() => document.getElementById(`insight-scene-${scene.id}`)?.scrollIntoView({ block: "nearest" }));
    }
  };
  const remove = (id: string) => {
    setPlacing(null); setTarget(null);
    flush(); const current = read(); if (!current) return false;
    return save({ text: current.text.replace(sceneMarker(id), ""), scenes: current.scenes?.filter(s => s.id !== id) ?? [] });
  };
  const move = (id: string, direction: -1 | 1) => {
    flush(); const current = read(); if (!current) return;
    save({ text: moveScene(current.text, id, direction) });
  };
  const update = (id: string, patch: Partial<InsightScene>) => {
    const current = read(); if (!current?.scenes?.some(s => s.id === id)) return false;
    return save({ scenes: current.scenes.map(s => s.id === id ? { ...s, ...patch } : s) });
  };
  const beginPlacement = (id: string) => { setPlacementError(""); setPlacing(id); };
  return <div ref={body} className="mt-3" data-testid="insight-body">
    {canEdit && placing && <div role="status" className="sticky top-0 z-20 mb-2 flex items-center justify-between gap-2 rounded-md border border-teal-500/20 bg-background px-3 py-2 text-xs text-teal-700 dark:text-teal-300">
      <span>{placementError || "본문의 원하는 위치를 클릭하세요. 문장 중간에도 넣을 수 있습니다."}</span><button aria-label="도표 배치 취소" className="shrink-0 rounded p-1 hover:bg-muted" onClick={() => setPlacing(null)}><X size={14} /></button>
    </div>}
    {canEdit && placing && target && createPortal(<div className="fixed z-[110] flex items-center gap-1 rounded-md border border-teal-500/25 bg-background p-1 shadow-md" style={{ left: target.x, top: target.y }} onPointerDown={e => e.preventDefault()}>
      <button className="rounded bg-teal-600 px-3 py-2 text-xs font-medium text-white hover:bg-teal-700" onClick={() => insert(target.after)}>{placing === "new" ? "여기에 도표 삽입" : "여기로 도표 이동"}</button><button aria-label="도표 배치 취소" className="rounded p-2 text-muted-foreground hover:bg-muted" onClick={() => setPlacing(null)}><X size={14} /></button>
    </div>, document.body)}
    {parts.map((part, index) => {
      // The paired card's empty lead and scene controls would otherwise separate its diagrams.
      if (topSceneId && index === 0 && !part.text.trim()) return null;
      const scene = note.scenes?.find(s => s.id === part.after);
      const preceding = index > 1 ? note.scenes?.find(s => s.id === parts[index - 1].after)?.balance : note.balance;
      return <Fragment key={part.after ?? "lead"}>
        {scene && scene.id !== topSceneId && <div id={`insight-scene-${scene.id}`} className="group my-5" data-testid="insight-scene" data-scene-id={scene.id}>
          <div className="flex items-center gap-2">
            {canEdit ? <input key={scene.title} defaultValue={scene.title} aria-label="도표 전환 제목" placeholder="전환 계기 (선택)" maxLength={100} className="min-w-0 flex-1 rounded bg-transparent px-1 py-1 text-sm font-semibold outline-none focus:ring-1 focus:ring-teal-500/40" onBlur={e => { if (e.target.value !== scene.title && !update(scene.id, { title: e.target.value })) e.target.value = scene.title; }} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} /> : scene.title && <h3 className="flex-1 text-sm font-semibold">{scene.title}</h3>}
            {canEdit && <div className="ml-auto flex gap-1 text-muted-foreground">
              <button className="inline-flex items-center gap-1 rounded p-1 text-xs hover:bg-muted" aria-label="도표 위치 변경" onClick={() => beginPlacement(scene.id)}><Move size={13} />위치 변경</button>
              <button className="rounded p-1 hover:bg-muted disabled:opacity-25" aria-label="도표 위로 이동" disabled={moveScene(note.text, scene.id, -1) === note.text} onClick={() => move(scene.id, -1)}><ArrowUp size={13} /></button>
              <button className="rounded p-1 hover:bg-muted disabled:opacity-25" aria-label="도표 아래로 이동" disabled={moveScene(note.text, scene.id, 1) === note.text} onClick={() => move(scene.id, 1)}><ArrowDown size={13} /></button>
              <button className="rounded p-1 hover:bg-muted hover:text-red-500" aria-label="중간 도표 삭제" onClick={() => remove(scene.id)}><Trash2 size={13} /></button>
            </div>}
          </div>
          <InlineBalance scene={scene} previous={preceding} canEdit={canEdit} initiallyEditing={newId === scene.id} onChange={patch => {
            if (patch === null) return remove(scene.id);
            const current = read()?.scenes?.find(s => s.id === scene.id);
            return !!current && update(scene.id, { balance: { ...current.balance, ...patch } });
          }} />
        </div>}
        {canEdit ? <div className="relative" data-testid="insight-text-section" data-insight-section={part.after ?? ""}>
          <div className="sticky top-0 z-10 flex justify-end bg-background/95 py-1">
            <button type="button" className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted" title="커서 위치에 구분선 삽입 · 빈 줄에서 --- 입력 후 Enter" onPointerDown={e => e.preventDefault()} onClick={() => editors.current.get(part.after ?? "lead")?.insertDivider()}><Minus size={12} />구분선</button>
            <button type="button" className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-teal-700 hover:bg-teal-500/5 dark:text-teal-300 disabled:opacity-30" disabled={(note.scenes?.length ?? 0) >= 30} title="본문에서 원하는 위치를 선택해 도표를 넣습니다." onPointerDown={e => e.preventDefault()} onClick={() => beginPlacement("new")}><Plus size={12} />도표</button>
          </div>
          <BufferedInsightEditor resourceKey={resourceKey} ref={el => { if (el) editors.current.set(part.after ?? "lead", el); else editors.current.delete(part.after ?? "lead"); }} ariaLabel={index ? `인사이트 본문 ${index + 1}` : "인사이트 본문"} value={part.text} onChange={text => editText(part.after, text)} onBlur={text => editText(part.after, text)} commitOnUnmount rows={parts.length === 1 ? (note.tables?.length ? 4 : 12) : 2} align="left" className="rounded-sm border-0 text-sm font-normal leading-[22px] text-foreground focus:ring-sky-500/20" placeholder="흐름과 생각을 적어보세요. 문단 뒤에 도표를 넣어 변화를 이어갈 수 있습니다." />
        </div> : <CapRichText text={part.text || (parts.length === 1 && !note.tables?.length ? "아직 작성된 내용이 없습니다." : "")} onJump={onJump} className="block whitespace-pre-wrap break-words text-sm leading-[22px]" />}
      </Fragment>;
    })}
  </div>;
}

// Keep the collaboration base fixed only while DOM input is buffered. Releasing
// after the synchronous commit also flushes immediately, without a second debounce.
const BufferedInsightEditor = forwardRef<CapRichEditorHandle, CapRichEditorProps & { resourceKey: string }>(function BufferedInsightEditor({ resourceKey, onChange, onBlur, ...props }, ref) {
  const release = useRef<(() => void) | null>(null);
  const finish = () => { const end = release.current; release.current = null; end?.(); };
  useLayoutEffect(() => () => { queueMicrotask(finish); }, [resourceKey]);
  const commit = (text: string) => { onChange(text); finish(); void collaboration.flush(resourceKey); };
  return <CapRichEditor {...props} ref={ref} changeDelayMs={800} allowDivider showClearAll={false}
    onPendingChange={() => { release.current ??= collaboration.beginLocalEdit(resourceKey); }}
    onChange={commit} onBlur={text => { onBlur?.(text); finish(); void collaboration.flush(resourceKey); }} />;
});

export function InlineBalance({ scene, previous, canEdit, initiallyEditing, onChange, compact = false }: {
  scene: InsightScene; previous?: InsightBalance | null; canEdit: boolean; initiallyEditing: boolean; compact?: boolean;
  onChange: (patch: Partial<InsightBalance> | null) => boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useInView(ref, { once: true, amount: .35 });
  const motion = useComparisonBalanceMotion(visible ? scene.balance : null, previous ?? { money: 0, goods: 0, outcome: null });
  return <div ref={ref}><ComparisonBalance compact={compact} value={scene.balance} motionValues={motion} canEdit={canEdit} initiallyEditing={initiallyEditing} onChange={onChange} /></div>;
}
