import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { MARK_BY_KEY } from "@/lib/capitalism-richtext";
import { CapRichEditor, type CapRichEditorHandle } from "./CapRichEditor";
import { type Json } from "../../../shared/cap-collaboration";
import { type Passage, type Resolution, type ValueConflict } from "../../../shared/cap-text-merge";
import { passageSignature, restoreConflictProgress, type ConflictProgress } from "@/lib/cap-conflict-progress";

export interface ConflictItem extends ValueConflict { label: string }

// Convert raw marker offsets to visible spans without exposing marker syntax or changing saved text.
export function ConflictPassage({ passage }: { passage: Passage }) {
  const result: ReactNode[] = [];
  const token = /\[\[((?:link:[A-Za-z0-9_-]+)|[a-z-]+)\|([^\]]*)\]\]/g;
  const append = (text: string, offset: number, mark?: string, markerChanged = false) => {
    const cuts = new Set([0, text.length]);
    for (const [a, b] of passage.ranges) { if (a >= offset && a <= offset + text.length) cuts.add(a - offset); if (b >= offset && b <= offset + text.length) cuts.add(b - offset); }
    const points = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i < points.length - 1; i++) {
      const start = offset + points[i], end = offset + points[i + 1];
      const changed = markerChanged || passage.ranges.some(([a, b]) => a < end && b > start);
      const content = text.slice(points[i], points[i + 1]);
      const style = mark ? MARK_BY_KEY[mark]?.style : undefined;
      result.push(changed ? <mark key={`${offset}:${i}`} style={{ ...style, backgroundColor: "#fef08a", color: "#292524", borderRadius: 3, padding: "1px 2px" }}>{content}</mark> : <span key={`${offset}:${i}`} style={style}>{content}</span>);
    }
  };
  let at = 0, match: RegExpExecArray | null;
  while ((match = token.exec(passage.text))) {
    append(passage.text.slice(at, match.index), at);
    const contentStart = match.index + match[0].indexOf("|") + 1;
    const contentEnd = contentStart + match[2].length;
    const markerChanged = passage.ranges.some(([a, b]) => a < match!.index + match![0].length && b > match!.index && (a < contentStart || b > contentEnd));
    append(match[2], contentStart, match[1], markerChanged);
    if (match[1].startsWith("link:")) {
      const target = <span className="ml-1 text-xs">(연결 대상: {match[1].slice(5)})</span>;
      result.push(markerChanged ? <mark key={`link:${match.index}`} className="rounded bg-yellow-200 text-stone-800">{target}</mark> : <span key={`link:${match.index}`}>{target}</span>);
    }
    at = match.index + match[0].length;
  }
  append(passage.text.slice(at), at);
  return <span className="whitespace-pre-wrap break-words">{result.length ? result : <mark className="rounded bg-yellow-100 px-1 text-stone-600">삭제</mark>}</span>;
}
function describe(value: Json): string {
  if (value === null) return "삭제됨";
  if (typeof value === "string") return value || "빈 내용";
  if (Array.isArray(value)) return value.map(describe).join("\n\n") || "빈 내용";
  if (typeof value === "object") {
    if (Array.isArray(value.cells)) return [value.title, ...value.cells.map(row => (row as Json[]).join("　|　"))].filter(Boolean).join("\n");
    if (value.type === "divider") return "구분선";
    if (value.type === "text") return String(value.text);
    if (value.type === "table") return describe(value.table);
    if (Array.isArray(value.blocks)) return describe(value.blocks);
    if (value.text !== undefined) return [value.title, value.text].filter(Boolean).join("\n");
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}
export function CapConflictWizard({ items, title, restoreRequired = false, onResolve, initialProgress, onProgress }: {
  items: ConflictItem[]; title: string; restoreRequired?: boolean;
  initialProgress?: ConflictProgress; onProgress?: (progress: ConflictProgress) => void;
  onResolve: (choices: Record<string, Resolution>, restore: boolean) => void | Promise<void>;
}) {
  const initial = useRef(restoreConflictProgress(items, initialProgress)).current;
  const positionOf = (cursor: string | null) => cursor === null ? items.length : Math.max(0, items.findIndex(item => item.id === cursor));
  const [index, setIndex] = useState(() => positionOf(initial.cursor)), [choices, setChoices] = useState<Record<string, Resolution>>(initial.choices);
  const [manual, setManual] = useState<Record<string, string>>(initial.manual), [expanded, setExpanded] = useState<Record<string, boolean>>(initial.expanded);
  const [restore, setRestore] = useState(false), [error, setError] = useState(""), [saving, setSaving] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null), editor = useRef<CapRichEditorHandle>(null);
  const signature = JSON.stringify(items.map(item => [item.id, passageSignature(item)]));
  const tracked = useRef({ signature, items });
  const inputsChanged = tracked.current.signature !== signature;
  // Updating an unrelated title/field must not remount the wizard. Reconsider
  // only passages whose actual three-way inputs changed, retaining other work.
  useLayoutEffect(() => {
    if (tracked.current.signature === signature) return;
    const previous = tracked.current.items;
    const next = restoreConflictProgress(items, { signatures: Object.fromEntries(previous.map(item => [item.id, passageSignature(item)])), choices, manual, expanded, cursor: previous[index]?.id ?? null });
    setChoices(next.choices); setManual(next.manual); setExpanded(next.expanded);
    setIndex(positionOf(next.cursor)); setRestore(false);
    tracked.current = { signature, items };
  }, [signature]);
  const position = Math.min(index, items.length);
  const item = items[position], complete = position === items.length;
  const progress = JSON.stringify({ signatures: Object.fromEntries(items.map(item => [item.id, passageSignature(item)])), choices, manual, expanded, cursor: item?.id ?? null } satisfies ConflictProgress);
  useEffect(() => {
    // Do not bind selections from the previous render to changed source text.
    if (!inputsChanged) onProgress?.(JSON.parse(progress) as ConflictProgress);
  }, [progress, inputsChanged]);
  const move = (to: number) => { setIndex(to); setError(""); requestAnimationFrame(() => heading.current?.focus({ preventScroll: true })); };
  const choose = (choice: Resolution) => { setChoices(old => ({ ...old, [item.id]: choice })); move(position + 1); };
  const selected = item && choices[item.id];
  return <section className="rounded-xl border border-amber-300 bg-background p-4 sm:p-5 text-sm" data-testid="collab-conflicts" aria-label="겹친 수정 확인">
    <div className="mb-4 flex items-center justify-between gap-3">
      <button type="button" className="rounded border px-3 py-1 disabled:opacity-30" disabled={position === 0 || saving} onClick={() => move(position - 1)}>이전</button>
      <span className="text-xs text-muted-foreground" aria-live="polite">{complete ? `${items.length} / ${items.length} · 선택 완료` : `${position + 1} / ${items.length}`}</span>
      <button type="button" className="rounded border px-3 py-1 disabled:opacity-30" disabled={complete || !selected || saving} onClick={() => move(position + 1)}>다음</button>
    </div>
    <h3 ref={heading} tabIndex={-1} className="mb-1 font-semibold outline-none">{title}</h3>
    {!complete ? <div key={item.id}>
      <p className="mb-4 text-xs text-muted-foreground">{item.label}</p>
      <div className="space-y-3" role="group" aria-label="저장할 표현 선택">
        {(["before", "local", "remote"] as const).map(which => {
          const passage = item.passage?.[which] ?? { text: describe(item[which]), ranges: [] };
          const name = which === "before" ? "수정 전 원문" : which === "local" ? "내 수정" : "다른 편집자 수정";
          const content = <><span className="mb-2 block text-xs text-muted-foreground">{name}</span><ConflictPassage passage={passage} /></>;
          return which === "before" ? <div key={which} className="rounded-lg bg-muted/50 p-3 sm:p-4">{content}</div>
            : <button type="button" key={which} className={`w-full rounded-lg border p-3 sm:p-4 text-left leading-7 hover:border-amber-500 focus-visible:outline-amber-500 ${selected === which ? "border-amber-500 bg-amber-50/40 dark:bg-amber-950/20" : "border-border"}`} aria-pressed={selected === which} onClick={() => choose(which)}>{content}</button>;
        })}
      </div>
      {item.passage && <div className="mt-4">
        <button type="button" className="text-xs underline underline-offset-4" aria-expanded={!!expanded[item.id]} onClick={() => setExpanded(old => ({ ...old, [item.id]: !old[item.id] }))}>직접 표현을 써서 합치기</button>
        {expanded[item.id] && <div className="mt-3 space-y-3">
          <CapRichEditor ref={editor} value={manual[item.id] ?? (typeof selected === "object" ? selected.text : item.local as string)} ariaLabel="직접 합칠 문장" align="left" rows={3}
            onChange={text => setManual(old => ({ ...old, [item.id]: text }))} showClearAll={false} />
          <button type="button" className="rounded border px-3 py-2" onClick={() => choose({ text: editor.current?.getValue() ?? manual[item.id] ?? item.local as string })}>이 문장으로 선택</button>
        </div>}
      </div>}
    </div> : <div className="mt-4 space-y-4">
      <p>모든 구간을 선택했습니다.</p>
      {restoreRequired && <label className="flex items-center gap-2"><input type="checkbox" checked={restore} onChange={e => setRestore(e.target.checked)} /> 삭제된 카드·칸의 내 내용을 복원</label>}
      <button type="button" disabled={saving || items.some(c => !choices[c.id])} className="rounded border border-amber-500 px-4 py-2 disabled:opacity-40" onClick={async () => {
        setSaving(true); setError(""); try { await onResolve(choices, restore); } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
      }}>{saving ? "반영 중…" : "선택한 내용 저장"}</button>
    </div>}
    {error && <p role="alert" className="mt-3 text-red-600">{error}</p>}
  </section>;
}
