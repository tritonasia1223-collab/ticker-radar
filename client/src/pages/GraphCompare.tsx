import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Plus, X, ArrowUpRight, Layers, Search } from "lucide-react";
import { CompareChart, iso } from "@/components/CompareChart";
import { CapRichText } from "@/components/CapRichText";
import { CapCollaboration } from "@/components/CapCollaboration";
import { useEditMode } from "@/components/EditModeProvider";
import { useCapSeries } from "@/lib/capitalism-series";
import { COMPARE_SERIES } from "@/lib/comparison-series";
import { collaboration, collabApi, seedCollaboration, syncError, focusResource } from "@/lib/cap-collab-client";
import { useCapEditScope } from "@/lib/use-cap-edit-scope";
import { parseRich } from "@/lib/capitalism-richtext";
import type { FlowDTO } from "@/lib/capitalism-types";
import type { Resource } from "../../../shared/cap-collaboration";
import { monthlyPoints, trendSections, commonBase, rebase, placementSchema, validDate, type Placement, type PlacedNode } from "../../../shared/cap-comparison";

const EMPTY_FLOWS: FlowDTO[] = [];
const DAY = 86400000;
const inputClass = "rounded-md border border-border bg-background px-2 py-1.5 text-xs min-w-0";
const buttonClass = "inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed";
const plain = (text: string) => parseRich(text).map(s => s.text).join("").trim();
type Preferences = { ids: string[]; indexed: boolean; base: string; from: number; to: number; smooth: boolean; months: number; phases: boolean; reference: string; history: boolean };
const defaultPrefs: Preferences = { ids: ["dollar", "fx_krw", "fx_jpy"], indexed: true, base: "2000-01", from: Date.UTC(1990, 0, 1), to: Date.now(), smooth: false, months: 12, phases: true, reference: "dollar", history: true };
function readPreferences(): Preferences {
  try {
    const v = JSON.parse(localStorage.getItem("comparison-view-v1") ?? "null");
    if (v && Array.isArray(v.ids) && typeof v.indexed === "boolean" && /^\d{4}-\d{2}$/.test(v.base) && validDate(v.base + "-01") && Number.isFinite(v.from) && Number.isFinite(v.to) && v.to > v.from && Math.abs(v.from) < 1e14 && Math.abs(v.to) < 1e14) {
      return { ...defaultPrefs, ...v, ids: v.ids.filter((id: string) => COMPARE_SERIES.some(s => s.id === id)).slice(0, v.indexed ? 4 : 2), smooth: v.smooth === true, months: [3, 6, 12, 24].includes(v.months) ? v.months : 12, phases: v.phases !== false, history: v.history !== false, reference: typeof v.reference === "string" ? v.reference : "dollar" };
    }
  } catch { /* Private view preferences are optional. */ }
  return defaultPrefs;
}

export default function GraphCompare() {
  const [, navigate] = useLocation();
  const revision = useSyncExternalStore(collaboration.subscribe, collaboration.snapshot);
  const { editable: editMode } = useEditMode();
  const flowQuery = useQuery<FlowDTO[]>({ queryKey: ["/api/capitalism/flows"] });
  const boardQuery = useQuery<Resource[]>({ queryKey: ["comparison-board"], queryFn: () => collabApi("comparison"), staleTime: Infinity, refetchOnWindowFocus: false });
  const seriesQuery = useCapSeries();
  const flows = flowQuery.data ?? EMPTY_FLOWS;
  const [ready, setReady] = useState(false), [prefs, setPrefs] = useState(readPreferences);
  const [selected, setSelected] = useState<string | null>(null), [picker, setPicker] = useState(false), [message, setMessage] = useState("");
  const [contextIds, setContextIds] = useState<string[]>([]);
  useEffect(() => { const previous = document.title; document.title = "그래프 비교(베타) — 피스쿠스"; return () => { document.title = previous; }; }, []);
  useEffect(() => {
    if (!flowQuery.isSuccess || !boardQuery.isSuccess) return;
    boardQuery.data.forEach(r => collaboration.seed(r));
    seedCollaboration(flows, []); setReady(true);
  }, [flowQuery.isSuccess, boardQuery.isSuccess, boardQuery.data, flows]);
  useEffect(() => { try { localStorage.setItem("comparison-view-v1", JSON.stringify(prefs)); } catch { /* View-only settings need no server save. */ } }, [prefs]);
  const nodes = useMemo(() => {
    const keys = new Set([...(boardQuery.data ?? []).map(r => r.key), ...collaboration.confirmed.keys(), ...collaboration.drafts.keys()]);
    return [...keys].filter(k => k.startsWith("plot:")).flatMap(key => {
      const d = collaboration.get(key) ?? (collaboration.confirmed.has(key) ? null : boardQuery.data?.find(r => r.key === key)?.doc);
      const p = placementSchema.safeParse(d); return p.success ? [{ id: key.slice(5), ...p.data }] : [];
    }).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  }, [revision, boardQuery.data]);
  const titles = useMemo(() => Object.fromEntries(flows.map(f => [f.slug, f.title])), [flows]);
  const rawSeries = useMemo(() => prefs.ids.flatMap(id => {
    const def = COMPARE_SERIES.find(s => s.id === id);
    return def ? [{ def, points: monthlyPoints(seriesQuery.data?.[id] ?? []) }] : [];
  }), [prefs.ids, seriesQuery.data]);
  // Both modes use exactly the same observations, reference value and axes.
  // Only the rendered line is simplified in CompareChart.
  const base = useMemo(() => commonBase(rawSeries.map(s => s.points), prefs.base), [rawSeries, prefs.base]);
  const series = useMemo(() => rawSeries.map(s => ({ ...s, points: prefs.indexed ? (base ? rebase(s.points, base) : []) : s.points })), [rawSeries, prefs.indexed, base]);
  const reference = rawSeries.find(s => s.def.id === prefs.reference) ?? rawSeries[0];
  const phases = useMemo(() => prefs.phases && reference ? trendSections(reference.points, reference.def.cadence) : [], [prefs.phases, reference]);
  const history = useMemo(() => prefs.history ? flows.filter(f => validDate(f.date)).map(f => ({ id: f.slug, date: f.date, title: plain(f.title) })) : [], [prefs.history, flows]);
  const contextFlows = flows.filter(f => contextIds.includes(f.slug));
  const extent = useMemo<[number, number]>(() => {
    const times = rawSeries.flatMap(s => s.points.flatMap((p, i, arr) => i === 0 || i === arr.length - 1 ? [p.time] : []));
    for (const n of nodes) if (n.date) { times.push(Date.parse(n.date)); if (n.endDate) times.push(Date.parse(n.endDate)); }
    const lo = times.length ? Math.min(...times) : Date.UTC(1970, 0, 1), hi = times.length ? Math.max(...times) : Date.now();
    return [lo, Math.max(lo + 31 * DAY, hi)];
  }, [rawSeries, nodes]);
  const range = useMemo<[number, number]>(() => {
    const a = Math.max(extent[0], Math.min(extent[1] - 31 * DAY, prefs.from)), b = Math.min(extent[1], Math.max(a + 31 * DAY, prefs.to)); return [a, b];
  }, [prefs.from, prefs.to, extent]);
  const canEdit = ready && editMode && flowQuery.isSuccess && boardQuery.isSuccess && ![...collaboration.drafts.values()].some(d => d.conflicts?.length);
  const chosen = nodes.find(n => n.id === selected), sourceFlow = flows.find(f => f.slug === chosen?.flowSlug), sourceNode = sourceFlow?.nodes.find(n => n.id === chosen?.nodeKey);
  const goToFlow = (slug: string) => navigate(`/capitalism?flow=${encodeURIComponent(slug)}`);
  const update = (id: string, patch: Partial<Placement>) => {
    const key = `plot:${id}`, current = collaboration.get(key);
    if (!current) return;
    const parsed = placementSchema.safeParse({ ...current, ...patch });
    if (!parsed.success) { setMessage(parsed.error.issues[0].message); return; }
    focusResource(key); collaboration.edit(key, { ...parsed.data }); setMessage("");
  };
  const setRange = (r: [number, number]) => setPrefs(p => ({ ...p, from: r[0], to: r[1] }));
  const errors = [flowQuery, boardQuery, seriesQuery].filter(q => q.isError);
  return <div className="mx-auto max-w-[2200px] space-y-4 p-5" data-testid="graph-compare-page">
    <header className="flex flex-wrap items-start justify-between gap-3 pr-24">
      <div><div className="mb-1 text-[10px] tracking-[.2em] text-sky-500">MACRO / COMPARE</div><h1 className="flex items-center gap-2 text-xl font-semibold"><Layers className="h-5 w-5 text-sky-500" />그래프 비교(베타)</h1><p className="mt-1 text-xs text-muted-foreground">지표를 겹치고, 직접 고른 사건의 진행 과정을 같은 시간축에서 살펴보세요.</p></div>
      {editMode && <button className={buttonClass + " bg-primary text-primary-foreground hover:bg-primary/90"} disabled={!canEdit} onClick={() => setPicker(true)} data-testid="compare-add"><Plus size={14} />사건 가져오기</button>}
    </header>
    <CapCollaboration />
    {!!errors.length && <div role="alert" className="rounded border border-amber-500/40 p-3 text-sm">일부 자료를 불러오지 못했습니다. <button className="underline" onClick={() => errors.forEach(q => void q.refetch())}>다시 불러오기</button></div>}
    {syncError && ready && <p className="text-xs text-muted-foreground" role="status">최신 변경 연결 확인 중 · 입력을 마친 배치는 기기 초안에 보관됩니다.</p>}
    {message && <p role="alert" className="text-sm text-amber-600">{message}</p>}
    <section className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-medium">표시 지표</span>
        {prefs.ids.map(id => { const s = COMPARE_SERIES.find(s => s.id === id)!; return <button key={id} className={buttonClass} style={{ borderColor: s.color + "60" }} onClick={() => setPrefs(p => ({ ...p, ids: p.ids.filter(x => x !== id) }))} title="클릭하면 그래프에서 숨김"><span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}<X size={12} /></button>; })}
        <select aria-label="지표 추가" className={inputClass} value="" disabled={prefs.ids.length >= (prefs.indexed ? 4 : 2)} onChange={e => { const id = e.target.value; if (id) setPrefs(p => ({ ...p, ids: [...p.ids, id] })); }}>
          <option value="">+ 지표 선택</option>{COMPARE_SERIES.filter(s => !prefs.ids.includes(s.id)).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select><span className="text-[10px] text-muted-foreground">최대 {prefs.indexed ? 4 : 2}개</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-xs">
        <label className="flex items-center gap-2">표시 방식<select aria-label="표시 방식" className={inputClass} value={prefs.indexed ? "index" : "raw"} onChange={e => { const indexed = e.target.value === "index"; setPrefs(p => ({ ...p, indexed, ids: indexed ? p.ids : p.ids.slice(0, 2) })); }}><option value="index">기준월=100 (최대 4개)</option><option value="raw">원래 값 · 좌우 축 (최대 2개)</option></select></label>
        {prefs.indexed && <label className="flex items-center gap-2">기준월<input aria-label="기준월" className={inputClass} type="month" value={prefs.base} onChange={e => { if (validDate(e.target.value + "-01")) setPrefs(p => ({ ...p, base: e.target.value })); }} /></label>}
        <label className="flex items-center gap-2">기간<input className={inputClass} type="date" aria-label="기간 시작" value={iso(range[0])} min={iso(extent[0])} max={iso(range[1] - 31 * DAY)} onChange={e => { const t = Date.parse(e.target.value); if (Number.isFinite(t) && t <= range[1] - 31 * DAY) setRange([t, range[1]]); }} /></label><span>~</span>
        <input className={inputClass} type="date" aria-label="기간 종료" value={iso(range[1])} min={iso(range[0] + 31 * DAY)} max={iso(extent[1])} onChange={e => { const t = Date.parse(e.target.value); if (Number.isFinite(t) && t >= range[0] + 31 * DAY) setRange([range[0], t]); }} />
        <button className="underline text-muted-foreground" onClick={() => setRange(extent)}>전체 기간</button>
      </div>
      {prefs.indexed && <p className="text-xs text-muted-foreground">{base ? `적용 기준월 ${base} = 100${base !== prefs.base ? " · 요청한 월 이후 모든 지표에 양수 관측값이 있는 첫 공통 월을 사용했습니다." : " · 확대·이동해도 기준은 유지됩니다."}` : "공통 양수 기준값이 없습니다. 지표·기준월을 바꾸거나 ‘원래 값’으로 비교하세요."}</p>}
      <div className="flex flex-wrap items-center gap-3 border-t pt-3 text-xs">
        <div className="inline-flex rounded-lg border p-0.5" role="group" aria-label="그래프 선 모드">
          {[false, true].map(smooth => <button key={String(smooth)} aria-pressed={prefs.smooth === smooth} className={`rounded-md px-3 py-1.5 ${prefs.smooth === smooth ? "bg-sky-500/15 text-sky-600 font-semibold" : "text-muted-foreground"}`} onClick={() => setPrefs(p => ({ ...p, smooth }))}>{smooth ? "큰 흐름" : "원본"}</button>)}
        </div>
        {prefs.smooth && <label className="flex items-center gap-2">단순화 구간<select aria-label="단순화 구간" className={inputClass} value={prefs.months} onChange={e => setPrefs(p => ({ ...p, months: Number(e.target.value) }))}>{[3, 6, 12, 24].map(m => <option key={m} value={m}>{m}개월</option>)}</select></label>}
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={prefs.phases} onChange={e => setPrefs(p => ({ ...p, phases: e.target.checked }))} />국면 배경</label>
        {prefs.phases && <select aria-label="국면 기준 지표" className={inputClass} value={reference?.def.id ?? ""} disabled={!rawSeries.length} onChange={e => setPrefs(p => ({ ...p, reference: e.target.value }))}>{rawSeries.length ? rawSeries.map(s => <option key={s.def.id} value={s.def.id}>{s.def.label} 기준</option>) : <option value="">지표 선택 필요</option>}</select>}
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={prefs.history} onChange={e => setPrefs(p => ({ ...p, history: e.target.checked }))} />경제사 카드 표시</label>
      </div>
      {prefs.smooth && <p className="text-[11px] text-muted-foreground">{prefs.months}개월 구간별 고점·저점을 원래 값과 날짜 그대로 연결합니다. 구간 안의 작은 굴곡은 생략하며, 기준월과 세로축은 원본 모드와 같습니다. 마우스를 올리면 생략된 월의 실제 관측값도 볼 수 있습니다.</p>}
      {prefs.phases && <p className="text-[11px] text-muted-foreground"><span className="text-emerald-600">■ 상승 경향</span> · <span className="text-rose-500">■ 하강 경향</span> · 회색 방향 미정 — 기준 지표의 12개월 평균을 6개월 전과 비교합니다. ±1% 안의 작은 변화는 앞선 방향을 유지합니다. 경계는 대략적인 경향이며 전환일 판정은 아닙니다.</p>}
    </section>
    {seriesQuery.isLoading ? <div className="rounded-xl border p-16 text-center text-muted-foreground">시계열 불러오는 중…</div> : <section className="overflow-x-auto rounded-xl border bg-card">
      <CompareChart series={series} range={range} extent={extent} indexed={prefs.indexed} nodes={nodes} selected={selected} onSelect={setSelected} onRange={setRange} titles={titles} phases={phases} events={history} onEvents={setContextIds} simplifyMonths={prefs.smooth ? prefs.months : 1} />
    </section>}
    {!!contextFlows.length && <section className="rounded-xl border border-amber-500/30 bg-card p-4" data-testid="historical-context">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">이 시기의 경제사 카드</h2><button aria-label="시대적 사건 닫기" onClick={() => setContextIds([])}><X size={16} /></button></div>
      <p className="mb-3 text-xs text-muted-foreground">경제사에 직접 작성한 날짜와 내용입니다. 그래프의 변화와 나란히 살펴보고, 원인에 대한 해석은 원본 카드에 기록하세요.</p>
      <div className="max-h-80 space-y-2 overflow-auto">{contextFlows.map(f => <details key={f.slug} className="rounded-lg border p-3" open={contextFlows.length === 1 || undefined}><summary className="cursor-pointer text-sm"><span className="mr-3 text-xs tabular-nums text-muted-foreground">{f.date}</span>{plain(f.title)}</summary><div className="mt-3 space-y-3 text-xs">{f.nodes.map(n => <div key={n.id} className="border-l-2 border-amber-500/30 pl-3"><CapRichText text={n.text} onJump={goToFlow} />{n.ref && <div className="mt-1 text-muted-foreground"><CapRichText text={n.ref} onJump={goToFlow} /></div>}</div>)}<button className={buttonClass} onClick={() => goToFlow(f.slug)}>원본 카드<ArrowUpRight size={12} /></button></div></details>)}</div>
    </section>}
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,440px)]">
      <section className="rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">가져온 사건 <span className="text-muted-foreground">{nodes.length}</span></h2><span className="text-[11px] text-muted-foreground">날짜 미지정 {nodes.filter(n => !n.date).length} · 두 사람이 공유하는 배치</span></div>
        {!nodes.length && <p className="py-6 text-center text-sm text-muted-foreground">‘사건 가져오기’에서 기존 카드의 필요한 노드를 골라 보세요.</p>}
        <div className="max-h-80 space-y-1 overflow-auto">{nodes.map(p => {
          const exists = flows.some(f => f.slug === p.flowSlug && f.nodes.some(n => n.id === p.nodeKey));
          return <button key={p.id} className={`flex w-full items-center gap-3 rounded-lg p-2.5 text-left text-xs ${selected === p.id ? "bg-sky-500/10 ring-1 ring-sky-500/40" : "hover:bg-muted"}`} onClick={() => setSelected(p.id)} data-testid={`placement-${p.id}`}><span className="w-24 shrink-0 tabular-nums text-muted-foreground">{p.date ?? "미배치"}</span><span className="min-w-0"><b className="block truncate">{p.title}</b><span className="text-muted-foreground">{exists ? titles[p.flowSlug] : "원본 없음 · 배치는 보관 중"}{p.endDate ? ` · ~ ${p.endDate}` : ""}</span></span></button>;
        })}</div>
      </section>
      <section className="rounded-xl border bg-card p-4" data-testid="compare-detail">
        {!chosen ? <p className="py-6 text-center text-sm text-muted-foreground">사건을 선택하면 날짜와 원문을 확인할 수 있습니다.</p> : <>
          <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">사건 배치</h2><button aria-label="상세 닫기" onClick={() => setSelected(null)}><X size={16} /></button></div>
          {canEdit ? <PlacementEditor key={chosen.id} placement={chosen} onUpdate={update} /> : <div className="mb-3 text-sm"><b>{chosen.title}</b><p>{chosen.date ?? "날짜 미지정"}{chosen.endDate ? ` ~ ${chosen.endDate}` : ""}</p></div>}
          <div className="mt-3 flex flex-wrap gap-2">
            {chosen.date && <button className={buttonClass} onClick={() => setRange([Math.max(extent[0], Date.parse(chosen.date!) - 2 * 365 * DAY), Math.min(extent[1], Date.parse(chosen.endDate ?? chosen.date!) + 2 * 365 * DAY)])}>이 사건 구간 보기</button>}
            {sourceFlow && <button className={buttonClass} onClick={() => goToFlow(sourceFlow.slug)}>원본 카드<ArrowUpRight size={12} /></button>}
            {canEdit && <button className={buttonClass + " text-red-500"} onClick={() => { collaboration.edit(`plot:${chosen.id}`, null); setSelected(null); }}>배치에서 제거</button>}
          </div>
          <div className="mt-4 max-h-96 space-y-3 overflow-auto border-t pt-3 text-xs">
            <div className="text-[10px] text-muted-foreground">원본 내용 · {sourceFlow?.title ?? "카드 없음"}</div>
            {sourceNode ? <><CapRichText text={sourceNode.text} onJump={goToFlow} />{sourceNode.ref && <div className="rounded bg-muted/50 p-3"><CapRichText text={sourceNode.ref} onJump={goToFlow} /></div>}{sourceNode.table && <div className="overflow-auto"><b>{sourceNode.table.title}</b><table className="mt-1 w-full border-collapse"><tbody>{sourceNode.table.cells.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j} className="border p-2 whitespace-pre-wrap">{cell}</td>)}</tr>)}</tbody></table></div>}</> : <p>원본 노드가 없습니다. 배치 제목과 날짜는 유지됩니다.</p>}
          </div>
        </>}
      </section>
    </div>
    <details className="rounded-xl border bg-card px-4 py-3 text-xs"><summary className="cursor-pointer text-muted-foreground">지표 출처 · 수록 기간 · 비교 기준</summary><p className="my-3 text-muted-foreground">월 단위 비교입니다. 일·주간 자료는 각 월 마지막 관측값을 사용하며, 월평균·분기 자료는 원래 발표값을 유지합니다. 결측 월을 채우지 않습니다. 기준월=100은 상대 변화 비교이며 단위나 경제적 의미를 같게 만들지는 않습니다.</p>{rawSeries.map(s => <div key={s.def.id} className="border-t py-2"><a href={s.def.url} target="_blank" rel="noreferrer" className="font-medium underline" style={{ color: s.def.color }}>{s.def.label}</a> · {s.def.unit} · {s.points[0]?.date ?? "자료 없음"} ~ {s.points.at(-1)?.date ?? ""}<p className="mt-1 text-muted-foreground">{s.def.note}</p></div>)}</details>
    {picker && canEdit && <NodePicker flows={flows} existing={nodes} onClose={() => setPicker(false)} onAdd={items => {
      items.forEach(({ flow, nodeKey }, i) => {
        const source = flow.nodes.find(n => n.id === nodeKey)!; const id = crypto.randomUUID();
        const p: Placement = { flowSlug: flow.slug, nodeKey, title: (plain(source.text) || source.table?.title || flow.title).slice(0, 80), date: null, endDate: null, sortOrder: Date.now() + i };
        collaboration.edit(`plot:${id}`, { ...p }); setSelected(id);
      }); setPicker(false);
    }} />}
  </div>;
}

// Buffered fields commit on blur. The focus scope holds the comparison base while
// typing so remote edits to the same field produce a conflict instead of being lost.
function PlacementEditor({ placement, onUpdate }: { placement: PlacedNode; onUpdate: (id: string, patch: Partial<Placement>) => void }) {
  const { id, ...value } = placement;
  const scope = useCapEditScope(`plot:${id}`);
  const [draft, setDraft] = useState(value), [error, setError] = useState("");
  const latest = useRef(draft); latest.current = draft;
  const dirty = useRef<Partial<Placement>>({}), save = useRef(onUpdate); save.current = onUpdate;
  useEffect(() => { if (!Object.keys(dirty.current).length) setDraft(value); }, [placement]);
  const commit = () => {
    if (!Object.keys(dirty.current).length) return;
    const parsed = placementSchema.safeParse(latest.current);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    const patch = dirty.current; dirty.current = {}; setError(""); save.current(id, patch);
  };
  const commitRef = useRef(commit); commitRef.current = commit;
  useLayoutEffect(() => () => commitRef.current(), [id]);
  const change = (patch: Partial<Placement>) => { dirty.current = { ...dirty.current, ...patch }; setDraft(d => ({ ...d, ...patch })); };
  return <div {...scope} className="space-y-2" onBlur={commit}>
    <label className="block text-xs">연표 표시 제목<input aria-label="연표 표시 제목" className={inputClass + " mt-1 w-full"} maxLength={160} value={draft.title} onChange={e => change({ title: e.target.value })} /></label>
    <div className="flex gap-2"><label className="min-w-0 flex-1 text-xs">시작일<input aria-label="사건 시작일" className={inputClass + " mt-1 w-full"} type="date" value={draft.date ?? ""} onChange={e => change({ date: e.target.value || null, ...(e.target.value ? {} : { endDate: null }) })} /></label><label className="min-w-0 flex-1 text-xs">종료일 (선택)<input aria-label="사건 종료일" className={inputClass + " mt-1 w-full"} type="date" min={draft.date ?? undefined} disabled={!draft.date} value={draft.endDate ?? ""} onChange={e => change({ endDate: e.target.value || null })} /></label></div>
    <p className="text-[10px] text-muted-foreground">날짜는 직접 지정합니다. 칸 밖으로 이동하면 저장됩니다.</p>
    {error && <p role="alert" className="text-xs text-red-500">{error} <button onClick={() => { dirty.current = {}; setDraft(value); setError(""); }} className="underline">입력 취소</button></p>}
  </div>;
}

function NodePicker({ flows, existing, onClose, onAdd }: { flows: FlowDTO[]; existing: PlacedNode[]; onClose: () => void; onAdd: (nodes: { flow: FlowDTO; nodeKey: string }[]) => void }) {
  const [search, setSearch] = useState(""), [checked, setChecked] = useState<string[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const candidates = useMemo(() => flows.map(flow => ({ flow, nodes: flow.nodes.filter(n => !existing.some(p => p.flowSlug === flow.slug && p.nodeKey === n.id) && (!search || `${flow.title} ${plain(n.text)}`.toLowerCase().includes(search.toLowerCase()))) })).filter(g => g.nodes.length), [flows, existing, search]);
  return <dialog ref={dialog} onCancel={onClose} onClose={onClose} className="m-auto w-[min(720px,92vw)] rounded-xl border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/50" aria-labelledby="picker-title" data-testid="node-picker">
    <div className="flex items-center justify-between border-b p-4"><div><h2 id="picker-title" className="font-semibold">기존 카드에서 사건 가져오기</h2><p className="mt-1 text-xs text-muted-foreground">진행 과정을 볼 노드를 고르세요. 원본은 그대로 유지됩니다.</p></div><button aria-label="가져오기 닫기" onClick={onClose}><X size={18} /></button></div>
    <div className="flex items-center gap-2 p-4"><Search size={16} /><input autoFocus className={inputClass + " w-full"} aria-label="카드와 노드 검색" placeholder="카드 제목 또는 노드 내용 검색" value={search} onChange={e => setSearch(e.target.value)} /></div>
    <div className="max-h-[50vh] overflow-auto px-4 pb-3">{candidates.slice(0, 60).map(({ flow, nodes }) => <details key={flow.slug} className="mb-2 rounded-lg border p-3" open={!!search || undefined}><summary className="cursor-pointer text-sm"><b>{flow.title}</b><span className="ml-2 text-xs text-muted-foreground">{flow.date} · {nodes.length}개</span></summary><div className="mt-2 space-y-1">{nodes.map(n => { const key = JSON.stringify([flow.slug, n.id]); return <label key={key} className="flex cursor-pointer items-start gap-2 rounded p-2 hover:bg-muted"><input type="checkbox" className="mt-1" checked={checked.includes(key)} onChange={e => setChecked(prev => e.target.checked ? [...prev, key] : prev.filter(k => k !== key))} /><span className="line-clamp-3 whitespace-pre-wrap text-xs">{plain(n.text) || n.table?.title || "본문 없는 노드"}</span></label>; })}</div></details>)}{!candidates.length && <p className="p-5 text-center text-sm text-muted-foreground">가져올 노드가 없습니다.</p>}{candidates.length > 60 && <p className="text-xs text-muted-foreground">앞의 60개 카드를 표시합니다. 검색으로 범위를 좁혀 주세요.</p>}</div>
    <div className="flex justify-end gap-2 border-t p-4"><button className={buttonClass} onClick={onClose}>취소</button><button className={buttonClass + " bg-primary text-primary-foreground"} disabled={!checked.length} onClick={() => onAdd(checked.flatMap(k => { const [slug, nodeKey] = JSON.parse(k); const flow = flows.find(f => f.slug === slug); return flow ? [{ flow, nodeKey }] : []; }))}>{checked.length}개 가져오기</button></div>
  </dialog>;
}
