import { activeSeriesIds } from "@/lib/comparison-series";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ArrowLeft, ArrowUpRight, BookOpen, Plus, Search, Star, Trash2, Focus, MoreHorizontal, ChevronDown } from "lucide-react";
import { CapRichText } from "./CapRichText";
import { CapRichEditor } from "./CapRichEditor";
import { ComparisonInsightContext } from "./ComparisonInsightContext";
import { ComparisonQuoteTables } from "./ComparisonQuoteTables";
import { collaboration } from "@/lib/cap-collab-client";
import { useCapEditScope } from "@/lib/use-cap-edit-scope";
import { restoredComparisonView, sameComparisonView } from "@/lib/comparison-axes";
import { parseRich } from "@/lib/capitalism-richtext";
import type { FlowDTO, FlowNodeDTO } from "@/lib/capitalism-types";
import { comparisonInsightSchema, nearestDatedReference, type ComparisonInsight, type SavedInsight, type InsightContext, type Observation } from "../../../shared/cap-comparison";

const field = "w-full min-w-0 rounded-md border bg-background px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500/30";
const button = "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-40";
const plain = (text: string) => parseRich(text).map(s => s.text).join("");
type Props = {
  notes: SavedInsight[]; selected: SavedInsight | null; onSelect: (id: string) => void; onCloseNote: () => void;
  panel: "insights" | "reference"; onPanel: (panel: "insights" | "reference") => void; canEdit: boolean; loading: boolean;
  onAdd: () => void; onRemove: (id: string) => void; onView: (note: SavedInsight) => void;
  flows: FlowDTO[]; contextIds: string[]; onClearContext: () => void;
  referencesLoading: boolean;
  showHistory: boolean; onHistory: (show: boolean) => void; onJump: (slug: string) => void;
  layoutKey: string;
  currentContext: InsightContext; seriesData: Record<string, Observation[]> | undefined; onRestore: (context: InsightContext, note: SavedInsight) => void;
};

export function ComparisonSidebar(p: Props) {
  const [search, setSearch] = useState("");
  const content = useRef<HTMLDivElement>(null), [panelHeight, setPanelHeight] = useState(600);
  useLayoutEffect(() => {
    const measure = () => { if (content.current) setPanelHeight(window.innerWidth < 1024 ? Math.max(400, window.innerHeight * .75) : Math.max(320, window.innerHeight - content.current.getBoundingClientRect().top - 35)); };
    measure(); window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [p.layoutKey]);
  useLayoutEffect(() => { if (p.panel === "insights" && content.current) content.current.scrollTop = 0; }, [p.panel, p.selected?.id]);
  const relatedIds = activeSeriesIds(p.selected?.context?.ids ?? []);
  const relatedHidden = p.selected?.context && (!!relatedIds.length || !!p.selected.context.spread) && ((p.currentContext.alignment && JSON.stringify(p.selected.context.alignment) !== JSON.stringify(p.currentContext.alignment)) || !sameComparisonView(p.selected.context.view ? restoredComparisonView(relatedIds, p.selected.context.view, p.currentContext.view) : undefined, p.currentContext.view, relatedIds) || relatedIds.some(id => !p.currentContext.ids.includes(id)) || (p.selected.context.spread && JSON.stringify(p.selected.context.spread) !== JSON.stringify(p.currentContext.spread)));
  const filtered = p.notes.filter(n => (n.title + " " + plain(n.text) + " " + n.date).toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date) || b.sortOrder - a.sortOrder || a.id.localeCompare(b.id));
  return <aside className="w-full min-w-0 shrink-0 border-t bg-muted/15 lg:w-[42%] lg:max-w-[640px] lg:border-l lg:border-t-0" aria-label="인사이트와 경제사 참고" data-testid="comparison-sidebar">
    <div className="flex border-b bg-background text-xs">
      <button className={"flex flex-1 items-center justify-center gap-2 border-b-2 py-3 " + (p.panel === "insights" ? "border-red-400 font-semibold" : "border-transparent text-muted-foreground")} onClick={() => p.onPanel("insights")}><Star size={14} className="fill-red-400 text-red-400" />인사이트 <span className="tabular-nums text-muted-foreground">{p.notes.length}</span></button>
      <button className={"flex flex-1 items-center justify-center gap-2 border-b-2 py-3 " + (p.panel === "reference" ? "border-amber-500 text-amber-600 font-semibold" : "border-transparent text-muted-foreground")} onClick={() => p.onPanel("reference")}><BookOpen size={15} />경제사 참고</button>
    </div>
    <div ref={content} style={{ maxHeight: panelHeight }} className="min-h-80 overflow-y-auto overscroll-contain" data-testid="comparison-sidebar-scroll">
      {p.panel === "reference" ? <ReferencePanel {...p} scrollContainer={content} /> : p.selected ? <div className="p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={p.onCloseNote}><ArrowLeft size={14} />모든 기록</button><div className="flex items-center gap-1">{relatedHidden && <button className="rounded px-2 py-1 text-[11px] text-sky-600 hover:bg-muted" title="이 글의 그래프 또는 축 설정으로 돌아갑니다." onClick={() => p.onRestore(p.selected!.context!, p.selected!)}>관련 그래프 보기</button>}<button className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted" onClick={() => p.onView(p.selected!)}><Focus size={13} />이 기간 보기</button></div></div>
        <InsightDocument key={p.selected.id + String(p.canEdit)} {...p} note={p.selected} />
      </div> : <div className="p-4">
        <div className="relative mb-4"><Search size={14} className="absolute left-3 top-3 text-muted-foreground" /><input aria-label="인사이트 검색" placeholder="제목, 내용, 날짜 검색" className={field + " pl-9 text-xs"} value={search} onChange={e => setSearch(e.target.value)} /></div>
        {p.loading ? <p className="py-8 text-center text-xs text-muted-foreground">인사이트 불러오는 중…</p> : !p.notes.length ? <div className="rounded-xl border border-dashed px-5 py-8 text-center"><Star size={25} className="mx-auto mb-3 text-red-400" /><h2 className="text-sm font-medium">발견한 흐름을 남겨보세요</h2><p className="mt-2 text-xs leading-6 text-muted-foreground">날짜나 기간에 생각을 기록하세요.<br />어떤 지표를 보더라도 기록은 그 시간에 남습니다.</p>{p.canEdit && <button className={button + " mt-4"} onClick={p.onAdd}><Plus size={13} />첫 인사이트 작성</button>}</div> : <div className="space-y-2">
          {filtered.map(n => <button key={n.id} className="block w-full rounded-lg border bg-background p-3 text-left transition-colors hover:border-red-400/50" data-testid={"insight-list-" + n.id} onClick={() => p.onSelect(n.id)}><p className="mb-1.5 text-[11px] tabular-nums text-muted-foreground">{n.date}{n.endDate && " ~ " + n.endDate}</p><h3 className="flex items-start gap-1.5 break-words text-sm font-semibold"><Star size={14} className="mt-0.5 shrink-0 fill-red-400 text-red-400" />{n.title}</h3><p className="mt-2 line-clamp-2 whitespace-pre-wrap break-words text-sm leading-[22px] text-muted-foreground">{plain(n.text) || "내용을 작성해 주세요."}</p></button>)}
          {!filtered.length && <p className="py-6 text-center text-xs text-muted-foreground">검색 결과가 없습니다.</p>}
        </div>}
      </div>}
    </div>
  </aside>;
}

function InsightDocument(p: Props & { note: SavedInsight }) {
  const { note } = p, key = "note:" + note.id, scope = useCapEditScope(key);
  const [error, setError] = useState(""), [settings, setSettings] = useState(false), [dates, setDates] = useState(false), [confirmDelete, setConfirmDelete] = useState(false);
  const save = (patch: Partial<ComparisonInsight>) => {
    const current = collaboration.get(key); if (!current) return false;
    const result = comparisonInsightSchema.safeParse({ ...current, ...patch });
    if (!result.success) { setError(result.error.issues[0].message); return false; }
    collaboration.edit(key, { ...result.data }); setError(""); return true;
  };
  return <article {...scope} className="rounded-lg border bg-background p-3" data-testid={p.canEdit ? "insight-editor" : "insight-reader"}>
    <div className="flex items-start justify-between gap-2">
      <button className="flex items-center gap-1 py-1 text-left text-[11px] tabular-nums text-muted-foreground disabled:cursor-default" disabled={!p.canEdit} aria-label="인사이트 날짜 수정" aria-expanded={dates} onClick={() => setDates(!dates)}>{note.date}{note.endDate && " ~ " + note.endDate}{p.canEdit && <ChevronDown size={11} />}</button>
      <button className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="인사이트 설정" aria-expanded={settings} onClick={() => setSettings(!settings)}><MoreHorizontal size={17} /></button>
    </div>
    {dates && p.canEdit && <div className="my-2 space-y-3 rounded-md border bg-muted/20 p-3">
      <div className="flex gap-1 rounded bg-muted p-1" role="group" aria-label="인사이트 기록 범위">{([{ label: "시점", period: false }, { label: "구간", period: true }] as const).map(mode => <button key={mode.label} className={"flex-1 rounded py-1 text-xs " + ((note.endDate !== null) === mode.period ? "bg-background font-semibold shadow-sm" : "text-muted-foreground")} aria-pressed={(note.endDate !== null) === mode.period} onClick={() => save({ endDate: mode.period ? note.endDate ?? note.date : null })}>{mode.label}</button>)}</div>
      <div className="grid grid-cols-2 gap-2"><BufferedInput label="시작일" type="date" value={note.date} save={value => save({ date: value })} />{note.endDate !== null && <BufferedInput label="종료일" type="date" min={note.date} value={note.endDate} save={value => save({ endDate: value || null })} />}</div>
      <button className="text-xs text-muted-foreground" onClick={() => setDates(false)}>접기</button>
    </div>}
    {settings && <div className="my-2 space-y-3 rounded-md border p-3" aria-label="인사이트 상세 설정">
      <ComparisonInsightContext note={note} currentContext={p.currentContext} seriesData={p.seriesData} canEdit={p.canEdit} onRestore={p.onRestore} />
      {p.canEdit && <><label className="block text-xs">차트에 표시할 짧은 설명<textarea aria-label="차트 짧은 설명" className={field + " mt-2 min-h-20 resize-y text-xs leading-5"} placeholder="차트에서 함께 볼 한 줄 요약 (선택)" maxLength={180} value={note.caption} onChange={e => save({ caption: e.target.value })} /></label>
      {confirmDelete ? <div className="space-y-2 text-xs"><p>이 인사이트를 삭제할까요? 변경 이력에서 복원할 수 있습니다.</p><button className={button + " text-red-500"} onClick={() => p.onRemove(note.id)}>삭제하기</button> <button className={button} onClick={() => setConfirmDelete(false)}>취소</button></div> : <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-red-500" onClick={() => setConfirmDelete(true)}><Trash2 size={12} />인사이트 삭제</button>}</>}
    </div>}
    {error && <p role="alert" className="my-2 text-xs text-amber-600">{error} 입력 전 값으로 유지했습니다.</p>}
    <div className="flex items-start gap-1.5 border-b pb-2"><Star size={15} className="mt-1 shrink-0 fill-red-400 text-red-400" />{p.canEdit ? <BufferedInput label="제목" compact value={note.title} maxLength={160} save={value => save({ title: value })} /> : <h2 className="break-words text-sm font-semibold leading-6">{note.title}</h2>}</div>
    {p.canEdit ? <div className="mt-3"><CapRichEditor ariaLabel="인사이트 본문" value={note.text} onChange={text => { save({ text }); }} onBlur={text => { save({ text }); }} commitOnUnmount rows={note.tables?.length ? 4 : 12} align="left" className="rounded-sm border-0 text-sm font-normal leading-[22px] text-foreground focus:ring-sky-500/20" placeholder="이 시기에 발견한 흐름과 생각을 적어보세요. 글자를 드래그하면 색·하이라이트를 넣을 수 있습니다." /></div> : <CapRichText text={note.text || (note.tables?.length ? "" : "아직 작성된 내용이 없습니다.")} onJump={p.onJump} className={"mt-3 block break-words text-sm leading-[22px] " + (note.tables?.length ? "" : "min-h-[280px]")} />}
    {!!note.tables?.length && <div className="mt-4"><ComparisonQuoteTables tables={note.tables} onRemove={p.canEdit ? id => {
      const current = comparisonInsightSchema.safeParse(collaboration.get(key));
      if (current.success) save({ tables: current.data.tables?.filter(table => table.id !== id) ?? [] });
    } : undefined} /></div>}
  </article>;
}

// Metadata commits on blur; prose journals immediately to protect long writing sessions.
function BufferedInput({ label, value, save, type = "text", min, maxLength, compact = false }: { label: string; value: string; save: (value: string) => boolean; type?: string; min?: string; maxLength?: number; compact?: boolean }) {
  const [draft, setDraft] = useState(value);
  const pending = useRef({ draft, value, save }); pending.current = { draft, value, save };
  useLayoutEffect(() => () => { const p = pending.current; if (p.draft !== p.value) p.save(p.draft); }, []);
  useEffect(() => { setDraft(value); }, [value]);
  return <label className="block w-full min-w-0 text-xs font-medium"><span className={compact ? "sr-only" : ""}>{label}</span><input aria-label={"인사이트 " + label} className={compact ? "w-full min-w-0 rounded-sm bg-transparent py-0.5 text-sm font-semibold leading-5 outline-none focus-visible:ring-2 focus-visible:ring-sky-500/20" : field + " mt-2"} type={type} min={min} maxLength={maxLength} value={draft} onChange={e => setDraft(e.target.value)} onBlur={() => { if (draft !== value && !save(draft)) setDraft(value); }} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} /></label>;
}

function ReferencePanel(p: Props & { scrollContainer: RefObject<HTMLDivElement> }) {
  const [search, setSearch] = useState("");
  const controls = useRef<HTMLDivElement>(null), cards = useRef(new Map<string, HTMLDetailsElement>()), positioned = useRef<string | null>(null);
  const matching = p.flows.filter(f => (!p.contextIds.length || p.contextIds.includes(f.slug)) && (plain(f.title) + " " + f.nodes.map(n => plain(n.text)).join(" ")).toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.date.localeCompare(b.date));
  const target = p.selected && !p.contextIds.length ? nearestDatedReference(matching.map(f => ({ key: f.slug, date: f.date, endDate: f.endDate })), p.selected) : null;
  const anchor = p.selected ? [p.selected.id, p.selected.date, p.selected.endDate].join(":") : null;
  const moveToTarget = () => {
    const container = p.scrollContainer.current, card = target && cards.current.get(target.key);
    if (!container || !card) return;
    container.scrollTop += card.getBoundingClientRect().top - container.getBoundingClientRect().top - (controls.current?.offsetHeight ?? 0) - 12;
  };
  useLayoutEffect(() => {
    positioned.current = null;
    if (p.contextIds.length && p.scrollContainer.current) p.scrollContainer.current.scrollTop = 0;
  }, [p.contextIds.join("|")]);
  useLayoutEffect(() => {
    // Do this once when opening a note's references, including delayed loading.
    // Searches, card expansion and background refreshes must not pull the reader back.
    if (!anchor || !target || p.referencesLoading || search.trim() || p.contextIds.length || positioned.current === anchor) return;
    moveToTarget(); positioned.current = anchor;
  }, [anchor, target?.key, search, p.contextIds.join("|"), p.referencesLoading]);
  return <div className="space-y-4 p-4" data-testid="comparison-reference">
    <div ref={controls} className="sticky top-0 z-10 -mx-4 space-y-3 border-b bg-card px-4 pb-3">
      <p className="text-xs leading-5 text-muted-foreground">자본주의 경제사의 카드를 참고합니다. 원문은 원본 카드에서 수정할 수 있습니다.</p>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={p.showHistory} onChange={e => p.onHistory(e.target.checked)} />차트에 참고 사건 표시</label>
      <input aria-label="경제사 참고 검색" className={field + " text-xs"} placeholder="카드 제목이나 본문 검색" value={search} onChange={e => setSearch(e.target.value)} />
      {!!p.contextIds.length ? <button className={button} onClick={p.onClearContext}>모든 참고 자료 보기</button> : p.selected && <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-amber-600"><span>인사이트 시기 · {p.selected.date}{p.selected.endDate && " ~ " + p.selected.endDate}</span>{target && <button className="rounded border px-2 py-1 hover:bg-muted" onClick={moveToTarget}>이 시기로 이동</button>}</div>}
    </div>
    <section><h3 className="mb-2 text-xs font-semibold">경제사 카드 · {matching.length}</h3>{matching.map(f => <details key={f.slug} ref={el => { if (el) cards.current.set(f.slug, el); else cards.current.delete(f.slug); }} data-reference-key={f.slug} data-insight-nearest={target?.key === f.slug || undefined} className={"mb-2 rounded-lg border p-3 " + (target?.key === f.slug ? "border-amber-500/70 bg-amber-500/5" : "")} open={p.contextIds.length === 1 && p.contextIds[0] === f.slug || undefined}><summary className="cursor-pointer break-words text-xs font-medium"><span className="mb-1 block text-[10px] font-normal tabular-nums text-muted-foreground">{f.date}{f.endDate && " ~ " + f.endDate}</span>{plain(f.title)}</summary><div className="mt-4 space-y-4">{f.nodes.map(n => <ReferenceNode key={n.id} node={n} onJump={p.onJump} />)}<button className={button} onClick={() => p.onJump(f.slug)}>원본 카드<ArrowUpRight size={12} /></button></div></details>)}</section>
    {!matching.length && <p className="py-4 text-center text-xs text-muted-foreground">표시할 참고 자료가 없습니다.</p>}
  </div>;
}

function ReferenceNode({ node, onJump }: { node: FlowNodeDTO; onJump: (slug: string) => void }) {
  return <div className="space-y-2 border-l-2 border-amber-500/30 pl-3 text-xs leading-6"><CapRichText text={node.text} onJump={onJump} />{node.ref && <div className="rounded bg-amber-500/10 p-2"><CapRichText text={node.ref} onJump={onJump} /></div>}{node.refBlue && <div className="rounded bg-sky-500/10 p-2"><CapRichText text={node.refBlue} onJump={onJump} /></div>}{node.table && <div className="overflow-auto"><b>{node.table.title}</b><table className="mt-1 border-collapse"><tbody>{node.table.cells.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j} className="whitespace-pre-wrap border p-2">{cell}</td>)}</tr>)}</tbody></table></div>}</div>;
}
