import { Fragment, useRef, useState } from "react";
import { useInView } from "framer-motion";
import { ArrowUp, ArrowDown, Plus, Trash2 } from "lucide-react";
import { CapRichEditor, type CapRichEditorHandle } from "./CapRichEditor";
import { CapRichText } from "./CapRichText";
import { ComparisonBalance } from "./ComparisonBalance";
import { useComparisonBalanceMotion } from "@/lib/use-comparison-balance-motion";
import { splitInsightScenes, sceneMarker, moveScene, type InsightScene } from "../../../shared/comparison-scenes";
import type { ComparisonInsight } from "../../../shared/cap-comparison";
import type { InsightBalance } from "../../../shared/comparison-balance";

type Props = {
  note: ComparisonInsight; canEdit: boolean; onJump: (slug: string) => void;
  read: () => ComparisonInsight | null; save: (patch: Partial<ComparisonInsight>) => boolean;
};
export function ComparisonInsightBody({ note, canEdit, onJump, read, save }: Props) {
  const editors = useRef(new Map<string, CapRichEditorHandle>());
  const [newId, setNewId] = useState<string | null>(null);
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
    const split = editor?.splitAfterParagraph();
    flush();
    const current = read(); if (!current || (current.scenes?.length ?? 0) >= 30) return;
    const part = splitInsightScenes(current.text).find(p => p.after === after); if (!part) return;
    const balance = current.scenes?.find(s => s.id === after)?.balance ?? current.balance ?? { money: 0, goods: 0, outcome: null };
    const scene: InsightScene = { id: crypto.randomUUID(), title: "", balance: { ...balance } };
    const before = split?.before ?? part.text, rest = split?.after ?? "";
    if (save({ text: current.text.slice(0, part.start) + before + sceneMarker(scene.id) + rest + current.text.slice(part.end), scenes: [...(current.scenes ?? []), scene] })) {
      setNewId(scene.id);
      requestAnimationFrame(() => document.getElementById(`insight-scene-${scene.id}`)?.scrollIntoView({ block: "nearest" }));
    }
  };
  const remove = (id: string) => {
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
  return <div className="mt-3" data-testid="insight-body">
    {parts.map((part, index) => {
      const scene = note.scenes?.find(s => s.id === part.after);
      const preceding = index > 1 ? note.scenes?.find(s => s.id === parts[index - 1].after)?.balance : note.balance;
      return <Fragment key={part.after ?? "lead"}>
        {scene && <div id={`insight-scene-${scene.id}`} className="group my-5" data-testid="insight-scene" data-scene-id={scene.id}>
          <div className="flex items-center gap-2">
            {canEdit ? <input key={scene.title} defaultValue={scene.title} aria-label="도표 전환 제목" placeholder="전환 계기 (선택)" maxLength={100} className="min-w-0 flex-1 rounded bg-transparent px-1 py-1 text-sm font-semibold outline-none focus:ring-1 focus:ring-teal-500/40" onBlur={e => { if (e.target.value !== scene.title && !update(scene.id, { title: e.target.value })) e.target.value = scene.title; }} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} /> : scene.title && <h3 className="flex-1 text-sm font-semibold">{scene.title}</h3>}
            {canEdit && <div className="ml-auto flex gap-1 text-muted-foreground">
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
        {canEdit ? <div className="relative" data-testid="insight-text-section">
          <div className="sticky top-0 z-10 flex justify-end bg-background/95 py-1">
            <button type="button" className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-teal-700 hover:bg-teal-500/5 dark:text-teal-300 disabled:opacity-30" disabled={(note.scenes?.length ?? 0) >= 30} title="본문에 커서를 놓으면 해당 문단 뒤에 삽입합니다. 커서가 없으면 이 글 끝에 삽입합니다." onPointerDown={e => e.preventDefault()} onClick={() => insert(part.after)}><Plus size={12} />도표</button>
          </div>
          <CapRichEditor ref={el => { if (el) editors.current.set(part.after ?? "lead", el); else editors.current.delete(part.after ?? "lead"); }} ariaLabel={index ? `인사이트 본문 ${index + 1}` : "인사이트 본문"} value={part.text} onChange={text => editText(part.after, text)} onBlur={text => editText(part.after, text)} commitOnUnmount rows={parts.length === 1 ? (note.tables?.length ? 4 : 12) : 2} align="left" className="rounded-sm border-0 text-sm font-normal leading-[22px] text-foreground focus:ring-sky-500/20" placeholder="흐름과 생각을 적어보세요. 문단 뒤에 도표를 넣어 변화를 이어갈 수 있습니다." />
        </div> : <CapRichText text={part.text || (parts.length === 1 && !note.tables?.length ? "아직 작성된 내용이 없습니다." : "")} onJump={onJump} className="block whitespace-pre-wrap break-words text-sm leading-[22px]" />}
      </Fragment>;
    })}
  </div>;
}

function InlineBalance({ scene, previous, canEdit, initiallyEditing, onChange }: {
  scene: InsightScene; previous?: InsightBalance | null; canEdit: boolean; initiallyEditing: boolean;
  onChange: (patch: Partial<InsightBalance> | null) => boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useInView(ref, { once: true, amount: .35 });
  const motion = useComparisonBalanceMotion(visible ? scene.balance : null, previous ?? { money: 0, goods: 0, outcome: null });
  return <div ref={ref}><ComparisonBalance value={scene.balance} motionValues={motion} canEdit={canEdit} initiallyEditing={initiallyEditing} onChange={onChange} /></div>;
}
