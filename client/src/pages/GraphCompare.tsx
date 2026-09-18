import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Plus, ChevronDown, Layers, MousePointer2, CalendarPlus, ScanLine, BookOpen, PanelRightClose, PanelRightOpen, Settings2, StickyNote, RotateCcw, ArrowLeftRight } from "lucide-react";
import { CompareChart, iso, type ChartTool } from "@/components/CompareChart";
import { ComparisonSidebar } from "@/components/ComparisonSidebar";
import { CapCollaboration } from "@/components/CapCollaboration";
import { useEditMode } from "@/components/EditModeProvider";
import { useCapSeries } from "@/lib/capitalism-series";
import { COMPARE_SERIES, COMPARE_CATEGORIES, makeSpread } from "@/lib/comparison-series";
import { SpreadControls } from "@/components/SpreadControls";
import { collaboration, collabApi, seedCollaboration, focusResource } from "@/lib/cap-collab-client";
import { parseRich } from "@/lib/capitalism-richtext";
import type { FlowDTO } from "@/lib/capitalism-types";
import type { Resource } from "../../../shared/cap-collaboration";
import { monthlyPoints, trendSections, commonBase, rebase, placementSchema, comparisonInsightSchema, validDate, spreadSchema, type SpreadSpec, type InsightContext, type SavedInsight, type PlacedNode } from "../../../shared/cap-comparison";

const EMPTY_FLOWS: FlowDTO[] = [];
const DAY = 86400000;
const inputClass = "rounded-md border border-border bg-background px-2 py-1.5 text-xs min-w-0";
const buttonClass = "inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed";
const plain = (text: string) => parseRich(text).map(s => s.text).join("").trim();
type Preferences = { ids: string[]; indexed: boolean; base: string; from: number; to: number; smooth: boolean; months: number; phases: boolean; reference: string; history: boolean; badges: boolean; spread: SpreadSpec | null };
const defaults: Preferences = { ids: ["dollar", "fx_krw", "fx_jpy"], indexed: true, base: "2000-01", from: Date.UTC(1990, 0, 1), to: Date.now(), smooth: false, months: 12, phases: false, reference: "dollar", history: false, badges: true, spread: null };
function readPreferences(): Preferences {
  try {
    const current = localStorage.getItem("comparison-view-v2");
    const v = JSON.parse(current ?? localStorage.getItem("comparison-view-v1") ?? "null");
    if (v && Array.isArray(v.ids) && typeof v.indexed === "boolean" && validDate(v.base + "-01") && Number.isFinite(v.from) && Number.isFinite(v.to) && v.to > v.from && Math.abs(v.from) < 1e14 && Math.abs(v.to) < 1e14) {
      return { ...defaults, ids: [...new Set<string>(v.ids.filter((id: string) => COMPARE_SERIES.some(s => s.id === id)))].slice(0, v.indexed ? 4 : 2), indexed: v.indexed, base: v.base, from: v.from, to: v.to, smooth: v.smooth === true, months: [3, 6, 12, 24].includes(v.months) ? v.months : 12, phases: current ? v.phases === true : false, history: current ? v.history === true : false, badges: v.badges !== false, reference: typeof v.reference === "string" ? v.reference : "dollar", spread: spreadSchema.safeParse(v.spread).success ? spreadSchema.parse(v.spread) : null };
    }
  } catch { /* Viewing preferences are optional. */ }
  return defaults;
}

export default function GraphCompare() {
  const [, navigate] = useLocation();
  const revision = useSyncExternalStore(collaboration.subscribe, collaboration.snapshot);
  const { editable } = useEditMode();
  const flowQuery = useQuery<FlowDTO[]>({ queryKey: ["/api/capitalism/flows"] });
  const boardQuery = useQuery<Resource[]>({ queryKey: ["comparison-board"], queryFn: () => collabApi("comparison"), staleTime: Infinity, refetchOnWindowFocus: false });
  const noteQuery = useQuery<Resource[]>({ queryKey: ["comparison-insights"], queryFn: () => collabApi("insights"), staleTime: Infinity, refetchOnWindowFocus: false });
  const seriesQuery = useCapSeries();
  const flows = flowQuery.data ?? EMPTY_FLOWS;
  const [prefs, setPrefs] = useState(readPreferences);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<"insights" | "reference">("insights");
  const [sidebar, setSidebar] = useState(true), [options, setOptions] = useState(false);
  const [indicators, setIndicators] = useState(true);
  const [spreadOptions, setSpreadOptions] = useState(false);
  const [tool, setTool] = useState<ChartTool>("move"), [resetAxes, setResetAxes] = useState(0);
  const [contextIds, setContextIds] = useState<string[]>([]);
  useEffect(() => { const previous = document.title; document.title = "그래프 비교 · 인사이트 — 피스쿠스"; return () => { document.title = previous; }; }, []);
  useEffect(() => {
    if (!noteQuery.isSuccess) return;
    noteQuery.data.forEach(r => collaboration.seed(r));
    seedCollaboration([], []); setReady(true);
  }, [noteQuery.isSuccess, noteQuery.data]);
  useEffect(() => { boardQuery.data?.forEach(r => collaboration.seed(r)); }, [boardQuery.data]);
  useEffect(() => { if (flowQuery.isSuccess) seedCollaboration(flows, []); }, [flowQuery.isSuccess, flows]);
  useEffect(() => { try { localStorage.setItem("comparison-view-v2", JSON.stringify(prefs)); } catch { /* Optional preferences. */ } }, [prefs]);
  useEffect(() => { if (!editable) setTool("move"); }, [editable]);
  const notes = useMemo<SavedInsight[]>(() => {
    const keys = new Set([...(noteQuery.data ?? []).map(r => r.key), ...collaboration.confirmed.keys(), ...collaboration.drafts.keys()]);
    return [...keys].filter(k => k.startsWith("note:")).flatMap(key => {
      const doc = collaboration.confirmed.has(key) || collaboration.drafts.has(key) ? collaboration.get(key) : noteQuery.data?.find(r => r.key === key)?.doc;
      const p = comparisonInsightSchema.safeParse(doc); return p.success ? [{ id: key.slice(5), ...p.data }] : [];
    }).sort((a, b) => a.date.localeCompare(b.date) || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  }, [revision, noteQuery.data]);
  const nodes = useMemo<PlacedNode[]>(() => {
    const keys = new Set([...(boardQuery.data ?? []).map(r => r.key), ...collaboration.confirmed.keys(), ...collaboration.drafts.keys()]);
    return [...keys].filter(k => k.startsWith("plot:")).flatMap(key => {
      const doc = collaboration.confirmed.has(key) || collaboration.drafts.has(key) ? collaboration.get(key) : boardQuery.data?.find(r => r.key === key)?.doc;
      const p = placementSchema.safeParse(doc); return p.success ? [{ id: key.slice(5), ...p.data }] : [];
    }).sort((a, b) => a.sortOrder - b.sortOrder);
  }, [revision, boardQuery.data]);
  const rawSeries = useMemo(() => prefs.ids.flatMap(id => {
    const def = COMPARE_SERIES.find(s => s.id === id);
    return def ? [{ def, points: monthlyPoints(seriesQuery.data?.[id] ?? []) }] : [];
  }), [prefs.ids, seriesQuery.data]);
  const base = useMemo(() => commonBase(rawSeries.map(s => s.points), prefs.base), [rawSeries, prefs.base]);
  const series = useMemo(() => rawSeries.map(s => ({ ...s, points: prefs.indexed ? (base ? rebase(s.points, base) : []) : s.points })), [rawSeries, prefs.indexed, base]);
  const chartSpread = useMemo(() => makeSpread(prefs.spread, seriesQuery.data), [prefs.spread, seriesQuery.data]);
  const reference = rawSeries.find(s => s.def.id === prefs.reference) ?? rawSeries[0];
  const phases = useMemo(() => prefs.phases && reference ? trendSections(reference.points, reference.def.cadence) : [], [prefs.phases, reference]);
  const history = useMemo(() => prefs.history ? [
    ...flows.filter(f => validDate(f.date)).map(f => ({ id: f.slug, date: f.date, title: plain(f.title) })),
    ...nodes.filter(n => n.date).map(n => ({ id: "plot:" + n.id, date: n.date!, title: n.title })),
  ] : [], [prefs.history, flows, nodes]);
  const extent = useMemo<[number, number]>(() => {
    const times = rawSeries.flatMap(s => s.points.length ? [s.points[0].time, s.points.at(-1)!.time] : []);
    if (chartSpread?.points.length) times.push(chartSpread.points[0].time, chartSpread.points.at(-1)!.time);
    for (const n of [...notes, ...nodes]) if (n.date) { times.push(Date.parse(n.date)); if (n.endDate) times.push(Date.parse(n.endDate)); }
    const lo = times.length ? Math.min(...times) : Date.UTC(1970, 0, 1), hi = times.length ? Math.max(...times) : Date.now();
    return [lo, Math.max(lo + 31 * DAY, hi)];
  }, [rawSeries, chartSpread, notes, nodes]);
  const range = useMemo<[number, number]>(() => {
    const a = Math.max(extent[0], Math.min(extent[1] - 31 * DAY, prefs.from));
    return [a, Math.min(extent[1], Math.max(a + 31 * DAY, prefs.to))];
  }, [prefs.from, prefs.to, extent]);
  const setRange = (r: [number, number]) => setPrefs(p => ({ ...p, from: r[0], to: r[1] }));
  const canEdit = ready && editable && ![...collaboration.drafts.values()].some(d => d.conflicts?.length);
  const chosen = notes.find(n => n.id === selected) ?? null;
  const openNote = (id: string) => { setSelected(id); setPanel("insights"); setSidebar(true); focusResource("note:" + id); };
  const addNote = (date: string, endDate: string | null) => {
    if (!canEdit) return;
    const id = crypto.randomUUID();
    collaboration.edit("note:" + id, { title: "새 인사이트", date, endDate, text: "", caption: "", sortOrder: Date.now(), context: { ids: [...prefs.ids], spread: prefs.spread ? { ...prefs.spread } : null } });
    setPrefs(p => ({ ...p, badges: true })); openNote(id); setTool("move");
  };
  const restoreContext = (context: InsightContext, note: SavedInsight) => {
    const ids = context.ids.filter(id => COMPARE_SERIES.some(s => s.id === id));
    const start = Date.parse(note.date), end = Date.parse(note.endDate ?? note.date), pad = Math.max(365 * DAY, (end - start) * .25);
    setPrefs(p => ({ ...p, ids, indexed: ids.length > 2 || p.indexed, spread: context.spread, from: start - pad, to: end + pad, badges: true }));
    setResetAxes(v => v + 1);
  };
  const showReferences = (ids: string[] = []) => { setContextIds(ids); setPanel("reference"); setSidebar(true); };
  const errors = [flowQuery, boardQuery, noteQuery, seriesQuery].filter(q => q.isError);
  return <div className="flex min-h-full flex-col bg-background" data-testid="graph-compare-page">
    <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 pr-28">
      <div className="flex items-center gap-2"><Layers size={18} className="text-sky-500" /><h1 className="text-sm font-semibold">그래프 비교</h1><span className="border-l pl-3 text-xs text-muted-foreground">시간에 남기는 인사이트</span></div>
      <div className="flex items-center gap-2">{editable && <button className={buttonClass + " bg-primary text-primary-foreground hover:bg-primary/90"} disabled={!canEdit} onClick={() => addNote(iso((range[0] + range[1]) / 2), null)}><Plus size={14} />인사이트 작성</button>}<button className={buttonClass} aria-label={sidebar ? "사이드바 접기" : "사이드바 열기"} onClick={() => setSidebar(!sidebar)}>{sidebar ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}</button></div>
    </header>
    <div className="border-b px-4 pt-2"><CapCollaboration /></div>
    {!!errors.length && <div role="alert" className="border-b bg-amber-500/10 px-4 py-2 text-xs">일부 자료를 불러오지 못했습니다. <button className="underline" onClick={() => errors.forEach(q => void q.refetch())}>다시 불러오기</button></div>}
    <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
      <button className={buttonClass} aria-expanded={indicators} aria-controls="comparison-indicators" onClick={() => setIndicators(!indicators)}><Layers size={14} />표시 지표 {prefs.ids.length}/{prefs.indexed ? 4 : 2}<ChevronDown size={13} className={indicators ? "rotate-180" : ""} /></button>
      <div className="flex flex-1 flex-wrap gap-x-3 gap-y-1 text-[11px]">{prefs.ids.map(id => { const s = COMPARE_SERIES.find(s => s.id === id)!; return <span key={id} className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />{s.label}</span>; })}{!prefs.ids.length && <span className="text-muted-foreground">비교할 지표를 체크하세요</span>}</div>
      <select aria-label="표시 방식" className={inputClass} value={prefs.indexed ? "index" : "raw"} onChange={e => { const indexed = e.target.value === "index"; setPrefs(p => ({ ...p, indexed, ids: indexed ? p.ids : p.ids.slice(0, 2) })); }}><option value="index">기준월=100 · 최대 4개</option><option value="raw">원래 값 · 좌우 축 2개</option></select>
      <button className={buttonClass + (options ? " bg-accent" : "")} aria-expanded={options} onClick={() => setOptions(!options)}><Settings2 size={14} />표시 설정</button>
    </div>
    {indicators && <section id="comparison-indicators" aria-label="표시 지표 선택" className="border-b bg-muted/10 px-4 py-3">
      <div className="grid gap-x-6 gap-y-3 xl:grid-cols-2 2xl:grid-cols-3">{Object.entries(COMPARE_CATEGORIES).map(([key, category]) => <fieldset key={key} className="min-w-0"><legend className="mb-1.5 text-[10px] font-semibold" style={{ color: category.color }}>{category.label}</legend><div className="flex flex-wrap gap-x-3 gap-y-2">{COMPARE_SERIES.filter(s => s.category === key).map(s => {
        const checked = prefs.ids.includes(s.id), disabled = !checked && prefs.ids.length >= (prefs.indexed ? 4 : 2);
        return <label key={s.id} title={disabled ? "선택한 지표를 하나 해제하면 켤 수 있습니다." : s.note} className={"inline-flex items-center gap-1.5 text-[11px] " + (disabled ? "cursor-not-allowed text-muted-foreground/50" : "cursor-pointer hover:text-sky-600")}><input type="checkbox" aria-label={s.label} className="h-3.5 w-3.5 accent-sky-500" checked={checked} disabled={disabled} onChange={e => { const on = e.target.checked; setPrefs(p => ({ ...p, ids: on ? p.ids.includes(s.id) || p.ids.length >= (p.indexed ? 4 : 2) ? p.ids : [...p.ids, s.id] : p.ids.filter(id => id !== s.id) })); }} /><span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />{s.label}</label>;
      })}</div></fieldset>)}</div>
      <p className="mt-3 text-[10px] text-muted-foreground">체크로 켜고 끄기 · {prefs.indexed ? "최대 4개를 같은 기준월로 비교" : "최대 2개를 좌우 축으로 비교 · 선택한 순서대로 왼쪽 / 오른쪽 축"}{prefs.ids.length >= (prefs.indexed ? 4 : 2) && " · 다른 지표를 켜려면 하나를 해제하세요."}</p>
    </section>}
    {options && <section className="space-y-3 border-b bg-muted/20 px-4 py-3 text-xs" aria-label="차트 표시 설정">
      <div className="flex flex-wrap items-center gap-4">{prefs.indexed && <label>기준월 <input aria-label="기준월" type="month" className={inputClass} value={prefs.base} onChange={e => { if (validDate(e.target.value + "-01")) setPrefs(p => ({ ...p, base: e.target.value })); }} /></label>}
        <label>시작 <input aria-label="기간 시작" type="date" className={inputClass} value={iso(range[0])} min={iso(extent[0])} max={iso(range[1] - 31 * DAY)} onChange={e => { const t = Date.parse(e.target.value); if (Number.isFinite(t) && t <= range[1] - 31 * DAY) setRange([t, range[1]]); }} /></label>
        <label>종료 <input aria-label="기간 종료" type="date" className={inputClass} value={iso(range[1])} min={iso(range[0] + 31 * DAY)} max={iso(extent[1])} onChange={e => { const t = Date.parse(e.target.value); if (Number.isFinite(t) && t >= range[0] + 31 * DAY) setRange([range[0], t]); }} /></label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={prefs.smooth} onChange={e => setPrefs(p => ({ ...p, smooth: e.target.checked }))} />큰 흐름</label>{prefs.smooth && <select className={inputClass} aria-label="단순화 구간" value={prefs.months} onChange={e => setPrefs(p => ({ ...p, months: Number(e.target.value) }))}>{[3, 6, 12, 24].map(m => <option key={m} value={m}>{m}개월 고점·저점</option>)}</select>}
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={prefs.phases} onChange={e => setPrefs(p => ({ ...p, phases: e.target.checked }))} />국면 배경</label>{prefs.phases && <select aria-label="국면 기준 지표" className={inputClass} value={reference?.def.id ?? ""} disabled={!rawSeries.length} onChange={e => setPrefs(p => ({ ...p, reference: e.target.value }))}>{rawSeries.map(s => <option key={s.def.id} value={s.def.id}>{s.def.label}</option>)}</select>}
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={prefs.badges} onChange={e => setPrefs(p => ({ ...p, badges: e.target.checked }))} />인사이트 배지</label>
      </div>
      {prefs.smooth && <p className="text-muted-foreground">구간별 실제 고점·저점을 연결합니다. 원래 값·기준월·세로축은 유지되며 생략된 월도 커서로 확인할 수 있습니다.</p>}
      {prefs.phases && <p className="text-muted-foreground">상승·하강은 기준 지표의 12개월 평균을 6개월 전과 비교한 경향입니다. ±1% 이내는 앞선 방향을 유지합니다.</p>}
    </section>}
    {prefs.indexed && <div className="border-b px-4 py-1.5 text-[11px] text-muted-foreground">{base ? "기준월 " + base + " = 100 · 확대·이동해도 기준은 유지됩니다." + (base !== prefs.base ? " 요청월 이후 첫 공통 양수 월을 적용했습니다." : "") : "공통 양수 기준값이 없습니다. 지표·기준월을 바꾸거나 ‘원래 값’으로 비교하세요."}</div>}
    <div className="flex min-w-0 flex-1 flex-col lg:flex-row">
      <div className="flex min-w-0 flex-1">
        <nav aria-label="차트 도구" className="flex w-11 shrink-0 flex-col items-center gap-2 border-r bg-card py-3">
          {([{ id: "move", label: "선택·이동", icon: MousePointer2 }, { id: "date", label: "날짜에 인사이트 기록", icon: CalendarPlus }, { id: "period", label: "기간을 드래그해 기록", icon: ScanLine }] as const).map(t => <button key={t.id} title={t.label} aria-label={t.label} aria-pressed={tool === t.id} disabled={t.id !== "move" && !canEdit} className={"rounded-lg p-2 disabled:opacity-30 " + (tool === t.id ? "bg-sky-500/15 text-sky-600" : "hover:bg-muted")} onClick={() => setTool(t.id)}><t.icon size={18} /></button>)}
          <div className="my-1 w-6 border-t" /><button title="인사이트 목록" aria-label="인사이트 목록" className="rounded-lg p-2 hover:bg-muted" onClick={() => { setSelected(null); setPanel("insights"); setSidebar(true); }}><StickyNote size={18} /></button>
          <button title="경제사 참고" aria-label="경제사 참고" className="rounded-lg p-2 hover:bg-muted" onClick={() => showReferences()}><BookOpen size={18} /></button>
          <button title="스프레드 계산" aria-label="스프레드 계산" aria-expanded={spreadOptions} className={"rounded-lg p-2 hover:bg-muted " + (prefs.spread ? "text-violet-500" : "")} onClick={() => setSpreadOptions(v => !v)}><ArrowLeftRight size={18} /></button>
          <button title="전체 기간·세로축 자동 맞춤" aria-label="전체 기간·세로축 자동 맞춤" className="rounded-lg p-2 hover:bg-muted" onClick={() => { setRange(extent); setResetAxes(v => v + 1); }}><RotateCcw size={17} /></button>
        </nav>
        <div className="min-w-0 flex-1 overflow-x-auto">
          {spreadOptions && <SpreadControls value={prefs.spread} onChange={spread => setPrefs(p => ({ ...p, spread }))} onClose={() => setSpreadOptions(false)} />}
          {seriesQuery.isLoading ? <div className="p-20 text-center text-sm text-muted-foreground">시계열 불러오는 중…</div> : <CompareChart spread={chartSpread} onRemoveSpread={() => setPrefs(p => ({ ...p, spread: null }))} series={series} range={range} extent={extent} indexed={prefs.indexed} onRange={setRange} phases={phases} events={history} onEvents={showReferences} simplifyMonths={prefs.smooth ? prefs.months : 1} notes={prefs.badges ? notes : []} selectedNote={panel === "insights" && prefs.badges ? selected : null} onNote={openNote} onCreate={addNote} tool={canEdit ? tool : "move"} onCancelTool={() => setTool("move")} resetAxes={resetAxes} layoutKey={[indicators, options, sidebar, prefs.indexed, spreadOptions, !!prefs.spread].join(":")} />}
        </div>
      </div>
      {sidebar && <ComparisonSidebar seriesData={seriesQuery.data} currentContext={{ ids: prefs.ids, spread: prefs.spread }} onRestore={restoreContext} layoutKey={[indicators, options, prefs.indexed].join(":")} notes={notes} selected={chosen} onSelect={openNote} onCloseNote={() => setSelected(null)} panel={panel} onPanel={next => { if (next === "reference") showReferences(); else setPanel(next); }} canEdit={canEdit} loading={noteQuery.isLoading} onAdd={() => addNote(iso((range[0] + range[1]) / 2), null)} onRemove={id => { collaboration.edit("note:" + id, null); setSelected(null); }} onView={note => { const start = Date.parse(note.date), end = Date.parse(note.endDate ?? note.date), pad = Math.max(365 * DAY, (end - start) * .25); setRange([Math.max(extent[0], start - pad), Math.min(extent[1], end + pad)]); }} flows={flows} nodes={nodes} referencesLoading={flowQuery.isLoading || boardQuery.isLoading} contextIds={contextIds} onClearContext={() => setContextIds([])} showHistory={prefs.history} onHistory={history => setPrefs(p => ({ ...p, history }))} onJump={slug => navigate("/capitalism?flow=" + encodeURIComponent(slug))} />}
    </div>
    <details className="border-t px-4 py-2 text-[11px] text-muted-foreground"><summary className="cursor-pointer">지표 출처 · 수록 기간 · 비교 기준</summary><p className="my-2">월 단위 비교 · 일·주간 자료는 월 마지막 관측값, 월평균·분기 자료는 원래 발표값을 사용합니다. 결측은 채우지 않습니다. 기준월=100은 상대 변화 비교입니다.</p>{rawSeries.map(s => <div key={s.def.id} className="border-t py-2"><a href={s.def.url} target="_blank" rel="noreferrer" className="underline">{s.def.label}</a> · {s.def.unit} · {s.points[0]?.date ?? "자료 없음"} ~ {s.points.at(-1)?.date ?? ""}<p>{s.def.note}</p></div>)}</details>
  </div>;
}
