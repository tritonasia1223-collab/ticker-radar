import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowLeft, ArrowUpRight, BookOpen, Plus, Search, StickyNote, Trash2, Focus } from "lucide-react";
import { CapRichText } from "./CapRichText";
import { ComparisonInsightContext } from "./ComparisonInsightContext";
import { collaboration } from "@/lib/cap-collab-client";
import { useCapEditScope } from "@/lib/use-cap-edit-scope";
import { parseRich } from "@/lib/capitalism-richtext";
import type { FlowDTO, FlowNodeDTO } from "@/lib/capitalism-types";
import { comparisonInsightSchema, nearestDatedReference, type ComparisonInsight, type SavedInsight, type PlacedNode, type InsightContext, type Observation } from "../../../shared/cap-comparison";

const field = "w-full min-w-0 rounded-md border bg-background px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500/30";
const button = "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-40";
const plain = (text: string) => parseRich(text).map(s => s.text).join("");
type Props = {
  notes: SavedInsight[]; selected: SavedInsight | null; onSelect: (id: string) => void; onCloseNote: () => void;
  panel: "insights" | "reference"; onPanel: (panel: "insights" | "reference") => void; canEdit: boolean; loading: boolean;
  onAdd: () => void; onRemove: (id: string) => void; onView: (note: SavedInsight) => void;
  flows: FlowDTO[]; nodes: PlacedNode[]; contextIds: string[]; onClearContext: () => void;
  referencesLoading: boolean;
  showHistory: boolean; onHistory: (show: boolean) => void; onJump: (slug: string) => void;
  layoutKey: string;
  currentContext: InsightContext; seriesData: Record<string, Observation[]> | undefined; onRestore: (context: InsightContext, note: SavedInsight) => void;
};

export function ComparisonSidebar(p: Props) {
  const [search, setSearch] = useState(""), [confirmDelete, setConfirmDelete] = useState(false);
  const content = useRef<HTMLDivElement>(null), [panelHeight, setPanelHeight] = useState(600);
  useLayoutEffect(() => {
    const measure = () => { if (content.current) setPanelHeight(Math.max(320, window.innerHeight - content.current.getBoundingClientRect().top - 35)); };
    measure(); window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [p.layoutKey]);
  useEffect(() => { setConfirmDelete(false); }, [p.selected?.id]);
  const filtered = p.notes.filter(n => (n.title + " " + n.text + " " + n.date).toLowerCase().includes(search.toLowerCase()));
  const details = (children: ReactNode) => p.selected && <ComparisonInsightContext note={p.selected} currentContext={p.currentContext} seriesData={p.seriesData} canEdit={p.canEdit} onRestore={p.onRestore}>{children}</ComparisonInsightContext>;
  return <aside className="w-full shrink-0 border-t bg-card lg:w-[340px] lg:border-l lg:border-t-0 xl:w-[380px] 2xl:w-[410px]" aria-label="인사이트와 경제사 참고" data-testid="comparison-sidebar">
    <div className="flex border-b text-xs">
      <button className={"flex flex-1 items-center justify-center gap-2 border-b-2 py-3 " + (p.panel === "insights" ? "border-sky-500 text-sky-600 font-semibold" : "border-transparent text-muted-foreground")} onClick={() => p.onPanel("insights")}><StickyNote size={15} />인사이트 <span className="tabular-nums">{p.notes.length}</span></button>
      <button className={"flex flex-1 items-center justify-center gap-2 border-b-2 py-3 " + (p.panel === "reference" ? "border-amber-500 text-amber-600 font-semibold" : "border-transparent text-muted-foreground")} onClick={() => p.onPanel("reference")}><BookOpen size={15} />경제사 참고</button>
    </div>
    <div ref={content} style={{ maxHeight: panelHeight }} className="min-h-80 overflow-y-auto overscroll-contain" data-testid="comparison-sidebar-scroll">
      {p.panel === "reference" ? <ReferencePanel {...p} scrollContainer={content} /> : p.selected ? <div className="p-4">
        <div className="mb-4 flex items-center justify-between"><button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={p.onCloseNote}><ArrowLeft size={14} />인사이트 목록</button><button className={button} onClick={() => p.onView(p.selected!)}><Focus size={13} />이 기간 보기</button></div>
        {p.canEdit ? <InsightEditor key={p.selected.id} note={p.selected} details={details} /> : <article data-testid="insight-reader"><h2 className="break-words text-lg font-semibold">{p.selected.title}</h2><p className="mt-2 text-xs text-muted-foreground">{p.selected.date}{p.selected.endDate && " ~ " + p.selected.endDate}</p><div className="mt-4">{details(<><div className="whitespace-pre-wrap break-words text-sm leading-7">{p.selected.text || "아직 작성된 내용이 없습니다."}</div>{p.selected.caption && <div className="rounded-lg bg-sky-500/10 p-3 text-xs">{p.selected.caption}</div>}</>)}</div></article>}
        {p.canEdit && <div className="mt-6 border-t pt-4">{confirmDelete ? <div className="space-y-2 text-xs"><p>이 인사이트를 삭제할까요? 변경 이력에서 복원할 수 있습니다.</p><div className="flex gap-2"><button className={button + " text-red-500"} onClick={() => p.onRemove(p.selected!.id)}>삭제하기</button><button className={button} onClick={() => setConfirmDelete(false)}>취소</button></div></div> : <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-red-500" onClick={() => setConfirmDelete(true)}><Trash2 size={12} />인사이트 삭제</button>}</div>}
      </div> : <div className="p-4">
        <div className="relative mb-4"><Search size={14} className="absolute left-3 top-3 text-muted-foreground" /><input aria-label="인사이트 검색" placeholder="제목, 내용, 날짜 검색" className={field + " pl-9 text-xs"} value={search} onChange={e => setSearch(e.target.value)} /></div>
        {p.loading ? <p className="py-8 text-center text-xs text-muted-foreground">인사이트 불러오는 중…</p> : !p.notes.length ? <div className="rounded-xl border border-dashed px-5 py-8 text-center"><StickyNote size={25} className="mx-auto mb-3 text-sky-500/70" /><h2 className="text-sm font-medium">발견한 흐름을 남겨보세요</h2><p className="mt-2 text-xs leading-6 text-muted-foreground">날짜나 기간에 생각을 기록하세요.<br />어떤 지표를 보더라도 기록은 그 시간에 남습니다.</p>{p.canEdit && <button className={button + " mt-4"} onClick={p.onAdd}><Plus size={13} />첫 인사이트 작성</button>}</div> : <div className="space-y-2">
          {filtered.map(n => <button key={n.id} className="block w-full rounded-lg border p-3 text-left transition-colors hover:border-sky-500/50 hover:bg-sky-500/5" data-testid={"insight-list-" + n.id} onClick={() => p.onSelect(n.id)}><p className="mb-1.5 text-[10px] tabular-nums text-muted-foreground">{n.date}{n.endDate && " ~ " + n.endDate}</p><h3 className="break-words text-sm font-semibold">{n.title}</h3><p className="mt-2 line-clamp-2 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{n.text || "내용을 작성해 주세요."}</p></button>)}
          {!filtered.length && <p className="py-6 text-center text-xs text-muted-foreground">검색 결과가 없습니다.</p>}
        </div>}
      </div>}
    </div>
  </aside>;
}

function InsightEditor({ note, details }: { note: SavedInsight; details: (children: ReactNode) => ReactNode }) {
  const key = "note:" + note.id, scope = useCapEditScope(key);
  const [error, setError] = useState("");
  const save = (patch: Partial<ComparisonInsight>) => {
    const current = collaboration.get(key);
    if (!current) return false;
    const result = comparisonInsightSchema.safeParse({ ...current, ...patch });
    if (!result.success) { setError(result.error.issues[0].message); return false; }
    collaboration.edit(key, { ...result.data }); setError(""); return true;
  };
  return <div {...scope} className="space-y-4" data-testid="insight-editor">
    <BufferedInput label="제목" value={note.title} maxLength={160} save={value => save({ title: value })} />
    <div className="flex gap-1 rounded-lg bg-muted/50 p-1" role="group" aria-label="인사이트 기록 범위">{([{ label: "시점", period: false }, { label: "구간", period: true }] as const).map(mode => <button key={mode.label} className={"flex-1 rounded-md py-1.5 text-xs " + ((note.endDate !== null) === mode.period ? "bg-background font-semibold text-sky-600 shadow-sm" : "text-muted-foreground")} aria-pressed={(note.endDate !== null) === mode.period} onClick={() => save({ endDate: mode.period ? note.endDate ?? note.date : null })}>{mode.label}</button>)}</div>
    <div className="grid grid-cols-2 gap-2">
      <BufferedInput label="시작일" type="date" value={note.date} save={value => save({ date: value })} />
      {note.endDate !== null && <BufferedInput label="종료일" type="date" min={note.date} value={note.endDate} save={value => save({ endDate: value || null })} />}
    </div>
    {error && <p role="alert" className="text-xs text-amber-600">{error} 입력 전 값으로 유지했습니다.</p>}
    {details(<>
    <label className="block text-xs font-medium">내 인사이트<textarea aria-label="인사이트 본문" className={field + " mt-2 min-h-[310px] resize-y border-transparent bg-muted/20 text-sm leading-7 focus:border-sky-500/30"} placeholder="이 시기에 무엇을 발견했나요? 비교한 지표와 생각을 자유롭게 적어보세요." maxLength={100000} value={note.text} onChange={e => save({ text: e.target.value })} /></label>
    <label className="block text-xs font-medium">차트에 표시할 짧은 설명 <span className="font-normal text-muted-foreground">(선택)</span><textarea aria-label="차트 짧은 설명" className={field + " mt-2 min-h-20 resize-y text-xs leading-5"} placeholder="예: 원화와 엔화의 움직임이 갈라지는 구간" maxLength={180} value={note.caption} onChange={e => save({ caption: e.target.value })} /></label>
    </>)}
    <p className="text-[11px] leading-5 text-muted-foreground">글은 자동 저장됩니다. 배지를 선택하면 날짜·기간과 짧은 설명이 차트에 나타납니다.</p>
  </div>;
}

// Metadata commits on blur; prose journals immediately to protect long writing sessions.
// An invalid metadata edit restores only that field, never the user's prose.
function BufferedInput({ label, value, save, type = "text", min, maxLength }: { label: string; value: string; save: (value: string) => boolean; type?: string; min?: string; maxLength?: number }) {
  const [draft, setDraft] = useState(value);
  const pending = useRef({ draft, value, save });
  pending.current = { draft, value, save };
  useLayoutEffect(() => () => { const p = pending.current; if (p.draft !== p.value) p.save(p.draft); }, []);
  useEffect(() => { setDraft(value); }, [value]);
  return <label className="block min-w-0 text-xs font-medium">{label}<input aria-label={"인사이트 " + label} className={field + " mt-2"} type={type} min={min} maxLength={maxLength} value={draft} onChange={e => setDraft(e.target.value)} onBlur={() => { if (draft !== value && !save(draft)) setDraft(value); }} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} /></label>;
}

function ReferencePanel(p: Props & { scrollContainer: RefObject<HTMLDivElement> }) {
  const [search, setSearch] = useState("");
  const controls = useRef<HTMLDivElement>(null), cards = useRef(new Map<string, HTMLDetailsElement>()), positioned = useRef<string | null>(null);
  const matching = p.flows.filter(f => (!p.contextIds.length || p.contextIds.includes(f.slug)) && (plain(f.title) + " " + f.nodes.map(n => plain(n.text)).join(" ")).toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.date.localeCompare(b.date));
  const saved = p.nodes.filter(n => (!p.contextIds.length || p.contextIds.includes("plot:" + n.id)) && (n.title + " " + (p.flows.find(f => f.slug === n.flowSlug)?.title ?? "")).toLowerCase().includes(search.toLowerCase())).sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
  const target = p.selected && !p.contextIds.length ? nearestDatedReference([...matching.map(f => ({ key: f.slug, date: f.date, endDate: f.endDate })), ...saved.map(n => ({ key: "plot:" + n.id, date: n.date, endDate: n.endDate }))], p.selected) : null;
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
      <p className="text-xs leading-5 text-muted-foreground">자본주의 경제사의 카드와 기존에 가져온 사건을 참고합니다. 원문은 원본 카드에서 수정할 수 있습니다.</p>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={p.showHistory} onChange={e => p.onHistory(e.target.checked)} />차트에 참고 사건 표시</label>
      <input aria-label="경제사 참고 검색" className={field + " text-xs"} placeholder="카드 제목이나 본문 검색" value={search} onChange={e => setSearch(e.target.value)} />
      {!!p.contextIds.length ? <button className={button} onClick={p.onClearContext}>모든 참고 자료 보기</button> : p.selected && <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-amber-600"><span>인사이트 시기 · {p.selected.date}{p.selected.endDate && " ~ " + p.selected.endDate}</span>{target && <button className="rounded border px-2 py-1 hover:bg-muted" onClick={moveToTarget}>이 시기로 이동</button>}</div>}
    </div>
    {!!saved.length && <section><h3 className="mb-2 text-xs font-semibold">기존에 가져온 사건 · {saved.length}</h3>{saved.map(n => {
      const flow = p.flows.find(f => f.slug === n.flowSlug), source = flow?.nodes.find(s => s.id === n.nodeKey);
      return <details key={n.id} ref={el => { if (el) cards.current.set("plot:" + n.id, el); else cards.current.delete("plot:" + n.id); }} data-reference-key={"plot:" + n.id} data-insight-nearest={target?.key === "plot:" + n.id || undefined} className={"mb-2 rounded-lg border p-3 " + (target?.key === "plot:" + n.id ? "border-amber-500/70 bg-amber-500/5" : "border-amber-500/20")}><summary className="cursor-pointer break-words text-xs font-medium">{n.title}<span className="mt-1 block text-[10px] font-normal text-muted-foreground">{n.date ?? "날짜 미지정"}{n.endDate && " ~ " + n.endDate}</span></summary><div className="mt-3">{source ? <ReferenceNode node={source} onJump={p.onJump} /> : <p className="text-xs text-muted-foreground">원본 없음 · 기존 제목과 날짜는 보관되어 있습니다.</p>}{flow && <button className={button + " mt-3"} onClick={() => p.onJump(flow.slug)}>원본 카드<ArrowUpRight size={12} /></button>}</div></details>;
    })}</section>}
    <section><h3 className="mb-2 text-xs font-semibold">경제사 카드 · {matching.length}</h3>{matching.map(f => <details key={f.slug} ref={el => { if (el) cards.current.set(f.slug, el); else cards.current.delete(f.slug); }} data-reference-key={f.slug} data-insight-nearest={target?.key === f.slug || undefined} className={"mb-2 rounded-lg border p-3 " + (target?.key === f.slug ? "border-amber-500/70 bg-amber-500/5" : "")} open={p.contextIds.length === 1 && p.contextIds[0] === f.slug || undefined}><summary className="cursor-pointer break-words text-xs font-medium"><span className="mb-1 block text-[10px] font-normal tabular-nums text-muted-foreground">{f.date}{f.endDate && " ~ " + f.endDate}</span>{plain(f.title)}</summary><div className="mt-4 space-y-4">{f.nodes.map(n => <ReferenceNode key={n.id} node={n} onJump={p.onJump} />)}<button className={button} onClick={() => p.onJump(f.slug)}>원본 카드<ArrowUpRight size={12} /></button></div></details>)}</section>
    {!matching.length && !saved.length && <p className="py-4 text-center text-xs text-muted-foreground">표시할 참고 자료가 없습니다.</p>}
  </div>;
}

function ReferenceNode({ node, onJump }: { node: FlowNodeDTO; onJump: (slug: string) => void }) {
  return <div className="space-y-2 border-l-2 border-amber-500/30 pl-3 text-xs leading-6"><CapRichText text={node.text} onJump={onJump} />{node.ref && <div className="rounded bg-amber-500/10 p-2"><CapRichText text={node.ref} onJump={onJump} /></div>}{node.refBlue && <div className="rounded bg-sky-500/10 p-2"><CapRichText text={node.refBlue} onJump={onJump} /></div>}{node.table && <div className="overflow-auto"><b>{node.table.title}</b><table className="mt-1 border-collapse"><tbody>{node.table.cells.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j} className="whitespace-pre-wrap border p-2">{cell}</td>)}</tr>)}</tbody></table></div>}</div>;
}
