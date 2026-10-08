import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Plus, ChevronDown, Layers, MousePointer2, CalendarPlus, ScanLine, BookOpen, PanelRightClose, PanelRightOpen, Settings2, StickyNote, RotateCcw, ArrowLeftRight } from "lucide-react";
import { CompareChart, iso, type ChartTool } from "@/components/CompareChart";
import { ComparisonInsightContext } from "@/components/ComparisonInsightContext";
import { ComparisonIndicatorPicker } from "@/components/ComparisonIndicatorPicker";
import { SeriesSourceHistory } from "@/components/SeriesSourceHistory";
import { sourcePeriods } from "@/lib/capitalism-history";
import { ComparisonSidebar } from "@/components/ComparisonSidebar";
import { CapCollaboration } from "@/components/CapCollaboration";
import { useEditMode } from "@/components/EditModeProvider";
import { useCapSeries } from "@/lib/capitalism-series";
import { COMPARE_SERIES, makeSpread, activeSeriesIds, viewingSeriesIds, activeSpread, availableSpreadIds } from "@/lib/comparison-series";
import { independentComparisonView, buildComparisonAxes } from "@/lib/comparison-axes";
import { SpreadControls } from "@/components/SpreadControls";
import { collaboration, collabApi, seedCollaboration, focusResource } from "@/lib/cap-collab-client";
import { parseRich } from "@/lib/capitalism-richtext";
import type { FlowDTO } from "@/lib/capitalism-types";
import type { Resource } from "../../../shared/cap-collaboration";
import { monthlyPoints, trendSections, placementSchema, comparisonInsightSchema, validDate, comparisonViewSchema, insightTimeRange, type ComparisonView, type SpreadSpec, type InsightContext, type SavedInsight, type PlacedNode } from "../../../shared/cap-comparison";

const EMPTY_FLOWS: FlowDTO[] = [];
const DAY = 86400000;
const inputClass = "rounded-md border border-border bg-background px-2 py-1.5 text-xs min-w-0";
const buttonClass = "inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed";
const plain = (text: string) => parseRich(text).map(s => s.text).join("").trim();
type Preferences = { ids: string[]; view: ComparisonView; from: number; to: number; smooth: boolean; months: number; phases: boolean; reference: string; history: boolean; badges: boolean; spread: SpreadSpec | null };
const defaults: Preferences = { ids: ["dxy", "reer", "usd_purchasing_power"], view: { mode: "independent", base: "2000-01", assignments: {}, rightUnit: null }, from: Date.UTC(1990, 0, 1), to: Date.now(), smooth: false, months: 12, phases: false, reference: "dxy", history: false, badges: true, spread: null };
function readPreferences(): Preferences {
  try {
    const current = localStorage.getItem("comparison-view-v3") ?? localStorage.getItem("comparison-view-v2");
    const v = JSON.parse(current ?? localStorage.getItem("comparison-view-v1") ?? "null");
    const parsedView = comparisonViewSchema.safeParse(v?.view);
    const base = parsedView.success ? parsedView.data.base : v?.base;
    if (v && Array.isArray(v.ids) && validDate(base + "-01") && Number.isFinite(v.from) && Number.isFinite(v.to) && v.to > v.from && Math.abs(v.from) < 1e14 && Math.abs(v.to) < 1e14) {
      const ids = viewingSeriesIds(v.ids);
      const view = independentComparisonView(ids, parsedView.success ? parsedView.data : undefined, base);
      return { ...defaults, ids, view, from: v.from, to: v.to, smooth: v.smooth === true, months: [3, 6, 12, 24].includes(v.months) ? v.months : 12, phases: current ? v.phases === true : false, history: current ? v.history === true : false, badges: v.badges !== false, reference: v.reference === "inflation" ? "cpi_level" : v.reference === "trade" ? "net_exports_gdp" : v.reference === "gdp_growth" ? "real_gdp" : typeof v.reference === "string" ? v.reference : "dxy", spread: activeSpread(v.spread) };
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
  const [focusedSeries, setFocusedSeries] = useState<string | null>(null);
  useEffect(() => { if (focusedSeries && !prefs.ids.includes(focusedSeries)) setFocusedSeries(null); }, [prefs.ids, focusedSeries]);
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<"insights" | "reference">("insights");
  const [sidebar, setSidebar] = useState(true), [options, setOptions] = useState(false);
  const [indicators, setIndicators] = useState(false);
  const indicatorPanel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!indicators) return;
    const outside = (e: PointerEvent) => { if (!indicatorPanel.current?.contains(e.target as Node)) setIndicators(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") setIndicators(false); };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [indicators]);
  const [spreadOptions, setSpreadOptions] = useState(false);
  const [tool, setTool] = useState<ChartTool>("move"), [resetAxes, setResetAxes] = useState(0);
  useEffect(() => { setResetAxes(v => v + 1); }, [prefs.view.base]);
  const [contextIds, setContextIds] = useState<string[]>([]);
  useEffect(() => { const previous = document.title; document.title = "그래프 비교 · 인사이트 — 피스쿠스"; return () => { document.title = previous; }; }, []);
  useEffect(() => {
    if (!noteQuery.isSuccess) return;
    noteQuery.data.forEach(r => collaboration.seed(r));
    seedCollaboration([], []); setReady(true);
  }, [noteQuery.isSuccess, noteQuery.data]);
  useEffect(() => { boardQuery.data?.forEach(r => collaboration.seed(r)); }, [boardQuery.data]);
  useEffect(() => { if (flowQuery.isSuccess) seedCollaboration(flows, []); }, [flowQuery.isSuccess, flows]);
  useEffect(() => { try { localStorage.setItem("comparison-view-v3", JSON.stringify(prefs)); } catch { /* Optional preferences. */ } }, [prefs]);
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
  const comparison = useMemo(() => buildComparisonAxes(rawSeries, prefs.view), [rawSeries, prefs.view]);
  const { series, axes } = comparison;
  const currentContext: InsightContext = { ids: series.map(s => s.def.id), spread: prefs.spread, view: { ...prefs.view, assignments: Object.fromEntries(Object.entries(prefs.view.assignments).filter(([id]) => series.some(s => s.def.id === id))), rightUnit: comparison.rightUnit } };
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
  const openNote = (id: string) => {
    setSelected(id); setPanel("insights"); setSidebar(true); focusResource("note:" + id);
    const note = notes.find(n => n.id === id);
    if (note) setRange(insightTimeRange(note, extent));
  };
  const addNote = (date: string, endDate: string | null) => {
    if (!canEdit) return;
    const id = crypto.randomUUID();
    collaboration.edit("note:" + id, { title: "새 인사이트", date, endDate, text: "", caption: "", sortOrder: Date.now(), context: currentContext });
    setPrefs(p => ({ ...p, badges: true })); openNote(id); setTool("move");
  };
  const restoreContext = (context: InsightContext, note: SavedInsight) => {
    const ids = activeSeriesIds(context.ids);
    const start = Date.parse(note.date), end = Date.parse(note.endDate ?? note.date), pad = Math.max(365 * DAY, (end - start) * .25);
    setPrefs(p => ({ ...p, ids, view: independentComparisonView(ids, context.view, p.view.base), spread: activeSpread(context.spread), from: start - pad, to: end + pad, badges: true }));
    setResetAxes(v => v + 1);
  };
  const showReferences = (ids: string[] = []) => { setContextIds(ids); setPanel("reference"); setSidebar(true); };
  const errors = [flowQuery, boardQuery, noteQuery, seriesQuery].filter(q => q.isError);
  return <div className="flex min-h-full flex-col bg-background" data-testid="graph-compare-page">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2 lg:pr-28">
      <div className="flex items-center gap-2"><Layers size={18} className="text-sky-500" /><h1 className="text-sm font-semibold">그래프 비교</h1></div>
      <div className="ml-auto text-muted-foreground [&>div]:mb-0"><CapCollaboration /></div>
      <div className="flex items-center gap-2">{editable && <button className={buttonClass + " bg-primary text-primary-foreground hover:bg-primary/90"} disabled={!canEdit} onClick={() => addNote(iso((range[0] + range[1]) / 2), null)}><Plus size={14} />인사이트 작성</button>}<button className={buttonClass} aria-label={sidebar ? "사이드바 접기" : "사이드바 열기"} onClick={() => setSidebar(!sidebar)}>{sidebar ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}</button></div>
    </header>
    {!!errors.length && <div role="alert" className="border-b bg-amber-500/10 px-4 py-2 text-xs">일부 자료를 불러오지 못했습니다. <button className="underline" onClick={() => errors.forEach(q => void q.refetch())}>다시 불러오기</button></div>}
    <div ref={indicatorPanel} className="relative">
    <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
      <button className={buttonClass} aria-expanded={indicators} aria-controls="comparison-indicators" onClick={() => setIndicators(!indicators)}><Layers size={14} />표시 지표 {prefs.ids.length}개<ChevronDown size={13} className={indicators ? "rotate-180" : ""} /></button>
      <div className="order-last flex w-full flex-wrap gap-x-2 gap-y-1 text-[11px] sm:order-none sm:w-auto sm:flex-1">{prefs.ids.map(id => { const s = COMPARE_SERIES.find(s => s.id === id)!; return <button key={id} type="button" aria-label={s.label + " 기준선 보기"} aria-pressed={focusedSeries === id} title="클릭하면 강조 · 기준선 고정, 다시 클릭하면 해제" onClick={() => setFocusedSeries(v => v === id ? null : id)} className={"inline-flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-accent " + (focusedSeries === id ? "bg-accent font-semibold ring-1 ring-border" : "")}><span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />{s.label}</button>; })}{!prefs.ids.length && <span className="text-muted-foreground">비교할 지표를 체크하세요</span>}</div>
      <button className={buttonClass + (options ? " bg-accent" : "")} aria-expanded={options} onClick={() => setOptions(!options)}><Settings2 size={14} />표시 설정</button>
    </div>
    {indicators && <ComparisonIndicatorPicker ids={prefs.ids} onClose={() => setIndicators(false)} onClear={() => setPrefs(p => ({ ...p, ids: [], view: independentComparisonView([], p.view) }))} onToggle={(id, on) => setPrefs(p => { const ids = on ? p.ids.includes(id) ? p.ids : [...p.ids, id] : p.ids.filter(v => v !== id); return { ...p, ids, view: independentComparisonView(ids, p.view) }; })} />}
    </div>
    {options && <section className="space-y-3 border-b bg-muted/20 px-4 py-3 text-xs" aria-label="차트 표시 설정">
      <div className="flex flex-wrap items-center gap-4">
        <label>시작 <input aria-label="기간 시작" type="date" className={inputClass} value={iso(range[0])} min={iso(extent[0])} max={iso(range[1] - 31 * DAY)} onChange={e => { const t = Date.parse(e.target.value); if (Number.isFinite(t) && t <= range[1] - 31 * DAY) setRange([t, range[1]]); }} /></label>
        <label>종료 <input aria-label="기간 종료" type="date" className={inputClass} value={iso(range[1])} min={iso(range[0] + 31 * DAY)} max={iso(extent[1])} onChange={e => { const t = Date.parse(e.target.value); if (Number.isFinite(t) && t >= range[0] + 31 * DAY) setRange([range[0], t]); }} /></label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={prefs.smooth} onChange={e => setPrefs(p => ({ ...p, smooth: e.target.checked }))} />큰 흐름</label>{prefs.smooth && <select className={inputClass} aria-label="단순화 구간" value={prefs.months} onChange={e => setPrefs(p => ({ ...p, months: Number(e.target.value) }))}>{[3, 6, 12, 24].map(m => <option key={m} value={m}>{m}개월 고점·저점</option>)}</select>}
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={prefs.phases} onChange={e => setPrefs(p => ({ ...p, phases: e.target.checked }))} />국면 배경</label>{prefs.phases && <select aria-label="국면 기준 지표" className={inputClass} value={reference?.def.id ?? ""} disabled={!rawSeries.length} onChange={e => setPrefs(p => ({ ...p, reference: e.target.value }))}>{rawSeries.map(s => <option key={s.def.id} value={s.def.id}>{s.def.label}</option>)}</select>}
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={prefs.badges} onChange={e => setPrefs(p => ({ ...p, badges: e.target.checked }))} />인사이트 배지</label>
      </div>
      {prefs.smooth && <p className="text-muted-foreground">구간별 실제 고점·저점을 연결합니다. 실제 값과 지표별 배율은 유지되며 생략된 월도 커서로 확인할 수 있습니다.</p>}
      {prefs.phases && <p className="text-muted-foreground">상승·하강은 기준 지표의 12개월 평균을 6개월 전과 비교한 경향입니다. ±1% 이내는 앞선 방향을 유지합니다.</p>}
    </section>}
    <p className="border-b px-4 py-1.5 text-[11px] text-muted-foreground" data-testid="independent-scales-note">지표별 독립 배율 · 높이와 기울기는 지표 간 크기 비교가 아닙니다. 지표명을 누르면 해당 그래프와 기준선을 고정해서 볼 수 있습니다.</p>
    <div className="flex min-w-0 flex-1 flex-col lg:flex-row">
      <div className="flex min-w-0 flex-1">
        <nav aria-label="차트 도구" className="flex w-11 shrink-0 flex-col items-center gap-2 border-r bg-card py-3">
          {([{ id: "move", label: "선택·이동", icon: MousePointer2 }, { id: "date", label: "날짜에 인사이트 기록", icon: CalendarPlus }, { id: "period", label: "기간을 드래그해 기록", icon: ScanLine }] as const).map(t => <button key={t.id} title={t.label} aria-label={t.label} aria-pressed={tool === t.id} disabled={t.id !== "move" && !canEdit} className={"rounded-lg p-2 disabled:opacity-30 " + (tool === t.id ? "bg-sky-500/15 text-sky-600" : "hover:bg-muted")} onClick={() => setTool(t.id)}><t.icon size={18} /></button>)}
          <div className="my-1 w-6 border-t" /><button title="인사이트 목록" aria-label="인사이트 목록" className="rounded-lg p-2 hover:bg-muted" onClick={() => { setSelected(null); setPanel("insights"); setSidebar(true); }}><StickyNote size={18} /></button>
          <button title="경제사 참고" aria-label="경제사 참고" className="rounded-lg p-2 hover:bg-muted" onClick={() => showReferences()}><BookOpen size={18} /></button>
          {availableSpreadIds.length >= 2 && <button title="스프레드 계산" aria-label="스프레드 계산" aria-expanded={spreadOptions} className={"rounded-lg p-2 hover:bg-muted " + (prefs.spread ? "text-violet-500" : "")} onClick={() => setSpreadOptions(v => !v)}><ArrowLeftRight size={18} /></button>}
          <button title="전체 기간 보기" aria-label="전체 기간 보기" className="rounded-lg p-2 hover:bg-muted" onClick={() => { setRange(extent); setResetAxes(v => v + 1); }}><RotateCcw size={17} /></button>
        </nav>
        <div className="min-w-0 flex-1 overflow-x-auto">
          {availableSpreadIds.length >= 2 && spreadOptions && <SpreadControls value={prefs.spread} onChange={spread => setPrefs(p => ({ ...p, spread }))} onClose={() => setSpreadOptions(false)} />}
          {seriesQuery.isLoading ? <div className="p-20 text-center text-sm text-muted-foreground">시계열 불러오는 중…</div> : <CompareChart focusedSeries={focusedSeries} onClearFocus={() => setFocusedSeries(null)} summary={chosen?.endDate && <ComparisonInsightContext summary note={chosen} currentContext={currentContext} seriesData={seriesQuery.data} canEdit={canEdit} onRestore={restoreContext} />} spread={chartSpread} onRemoveSpread={() => setPrefs(p => ({ ...p, spread: null }))} series={series} range={range} extent={extent} axes={axes} onRange={setRange} phases={phases} events={history} onEvents={showReferences} simplifyMonths={prefs.smooth ? prefs.months : 1} notes={notes} showBadges={prefs.badges} selectedNote={selected} onNote={openNote} onCreate={addNote} tool={canEdit ? tool : "move"} onCancelTool={() => setTool("move")} resetAxes={resetAxes} layoutKey={[indicators, options, sidebar, prefs.view.mode, spreadOptions, !!prefs.spread].join(":")} />}
        </div>
      </div>
      {sidebar && <ComparisonSidebar seriesData={seriesQuery.data} currentContext={currentContext} onRestore={restoreContext} layoutKey={[indicators, options, prefs.view.mode].join(":")} notes={notes} selected={chosen} onSelect={openNote} onCloseNote={() => setSelected(null)} panel={panel} onPanel={next => { if (next === "reference") showReferences(); else setPanel(next); }} canEdit={canEdit} loading={noteQuery.isLoading} onAdd={() => addNote(iso((range[0] + range[1]) / 2), null)} onRemove={id => { collaboration.edit("note:" + id, null); setSelected(null); }} onView={note => setRange(insightTimeRange(note, extent))} flows={flows} nodes={nodes} referencesLoading={flowQuery.isLoading || boardQuery.isLoading} contextIds={contextIds} onClearContext={() => setContextIds([])} showHistory={prefs.history} onHistory={history => setPrefs(p => ({ ...p, history }))} onJump={slug => navigate("/capitalism?flow=" + encodeURIComponent(slug))} />}
    </div>
    <details className="border-t px-4 py-2 text-[11px] text-muted-foreground"><summary className="cursor-pointer">지표 출처 · 수록 기간 · 비교 기준</summary><p className="my-2">월 단위 비교 · 일·주간 자료는 월 마지막 관측값, 월평균·분기 자료는 원래 발표값을 사용합니다. 결측은 채우지 않습니다. 각 지표는 보이는 기간의 값 범위에 맞춰 독립적으로 배율을 조절합니다. 같은 높이·기울기가 같은 값·변동률을 뜻하지 않습니다. 커서는 실제 값과 단위를 표시합니다. 실질금리·순수출/GDP·무역수지는 0, DXY·REER는 100을 참고선으로 표시하며, 커서를 가까이 대거나 지표명을 눌렀을 때만 보입니다. 범위 밖 기준선은 위치를 문구로 안내합니다.</p>{rawSeries.map(s => <div key={s.def.id} className="border-t py-2"><a href={s.def.url} target="_blank" rel="noreferrer" className="underline">{s.def.label}</a> · {s.def.unit} · {s.points[0]?.date ?? "자료 없음"} ~ {s.points.at(-1)?.date ?? ""}{sourcePeriods(s.def.id).length ? <SeriesSourceHistory seriesKey={s.def.id} /> : <p>{s.def.note}</p>}</div>)}</details>
  </div>;
}
