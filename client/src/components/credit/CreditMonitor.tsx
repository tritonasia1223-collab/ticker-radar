import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid } from "recharts";
import { ArrowDownRight, ArrowUpRight, RefreshCw, Landmark, Network, ExternalLink, ChevronLeft, ChevronRight } from "lucide-react";
import { config, type Indicator } from "@shared/credit/schema";
import { analyze, DAY, type IndicatorAnalysis, type LineAnalysis } from "@shared/credit/signals";
import { scenarios } from "@shared/credit/scenarios";
import { RateComparisonChart } from "./RateComparisonChart";
import { rateNarrative } from "@shared/credit/rate-comparison";
import { distributionAdjusted } from "@shared/credit/reading";
import { CreditTrendNote } from "./CreditTrendNote";

type Response = { asOf: string; collectedAt: string | null; configChanged?: boolean; error?: string | null; indicators: IndicatorAnalysis[]; scenarios: ReturnType<typeof scenarios> };
const colors = ["#6366f1", "#0d9488", "#d97706", "#db2777", "#7c3aed", "#0284c7", "#65a30d", "#ea580c", "#64748b"];
const frequencies: Record<string, string> = { daily: "일간", weekly: "주간", monthly: "월간", quarterly: "분기" };
const units: Record<string, string> = { billions: "십억 달러", percent: "%", pp: "%p", ratio: "배", usd: "달러" };
const metricLabels: Record<string, string> = { gapConsecutiveWeeks: "격차 연속 확대(주)", gapChange: "격차 누적 변화(%p)", primaryTrendChange: "CCC 자체 변화(%p)", latest: "수준", delta4: "4주 절대변화", change4: "4주 변화율(%)", change13: "13주 변화율(%)", annual13: "13주 연율화(%)", previousDelta: "직전 관측 대비", percentile: "확보 기간 백분위(%)", speedPercentile: "4주 증가율 백분위(%)", speed13Percentile: "13주 증가율 백분위(%)", issuanceYoy: "3개월 발행합 전년비(%)", priceChange4: "4주 수정주가 변화율(%)" };
const ruleLabel = (s: string) => s.replace("absLte", "절댓값 ≤").replace("absLt", "절댓값 <").replace("gte", "≥").replace("lte", "≤");
const num = (v: number | null | undefined, digits = 2) => v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("ko-KR", { maximumFractionDigits: digits, minimumFractionDigits: digits });
const signed = (v: number | null | undefined, digits = 2) => v == null ? "—" : `${v > 0 ? "+" : ""}${num(v, digits)}`;
function value(v: number | null | undefined, unit: string) { if (v == null) return "—"; if (unit === "billions") return Math.abs(v) >= 1000 ? `${num(v / 1000)}조 달러` : `${num(v * 10, 1)}억 달러`; return `${num(v)}${unit === "usd" ? " 달러" : units[unit] ?? ""}`; }
function delta(line: LineAnalysis, weeks: number) {
  const c = line.changes[weeks]; if (!c) return "비교 자료 부족";
  if (c.unchangedRelease) return "새 관측 없음";
  if (line.unit === "pp") return `${signed(c.value * 100, 0)} bp`;
  if (line.unit === "percent") return `${signed(c.value)} %p`;
  if (line.unit === "ratio") return `${signed(c.value)} 배`;
  return `${signed(c.pct)}%`;
}
function Pill({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) { return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${muted ? "bg-muted text-muted-foreground" : "bg-indigo-500/10 text-indigo-600 dark:text-indigo-300"}`}>{children}</span>; }

function IndicatorCard(props: { spec: Indicator; result: IndicatorAnalysis; years: number; asOf: string; signals: ReturnType<typeof scenarios>["signals"] }) {
  const { spec, result, years, asOf } = props;
  if (!spec.chart.marketYield && spec.chart.kind !== "spread") return <OriginalIndicatorCard {...props} />;
  return <article data-credit-indicator={spec.id} className="p-4 md:p-5 space-y-4 min-w-0">
    <h3 className="font-semibold text-sm">{spec.name}</h3>
    <p className="text-xs leading-relaxed text-muted-foreground">{rateNarrative(result, 4)}</p>
    <RateComparisonChart id={spec.id} kind={spec.chart.marketYield ? "oas" : "difference"} rates={result.comparisonLines ?? []} spread={result.lines[0]} asOf={asOf} years={years} />
    {spec.signal_keys.includes("ccc_gap_trend") && <CreditTrendNote signals={props.signals} />}
    <p className="text-xs leading-relaxed text-muted-foreground">{spec.interpretation}</p>
    <details className="text-[11px] text-muted-foreground"><summary className="cursor-pointer">갱신 주기·관측 범위·판정 근거</summary><div className="pt-2 space-y-2">
      <p>{spec.refresh?.publication} · {spec.refresh?.collection}</p>
      <p>신호 조건은 시장금리가 아닌 스프레드에 적용합니다.</p>
      {spec.signal_keys.map(k => <p key={k}>{config.signalLabels[k]} · {props.signals[k]?.status === true ? "충족" : props.signals[k]?.status === false ? "미충족" : "확인 대기"}</p>)}
      {[...result.lines, ...(result.comparisonLines ?? [])].map(l => <p key={l.key}>{l.label}: {l.sampleStart ?? "—"} ~ {l.sampleEnd ?? "—"} · {l.sampleCount}개{l.errors.length ? ` · ${l.errors.join(" / ")}` : ""}</p>)}
      {spec.caveats?.map(c => <p key={c}>{c}</p>)}
    </div></details>
  </article>;
}

function OriginalIndicatorCard({ spec, result, years, asOf, signals }: { spec: Indicator; result: IndicatorAnalysis; years: number; asOf: string; signals: ReturnType<typeof scenarios>["signals"] }) {
  const [indexed, setIndexed] = useState(!!spec.chart.indexed);
  const adjusted = distributionAdjusted(spec);
  const [selected, setSelected] = useState(spec.chart.lines[0]?.key);
  const focus = result.lines.find(l => l.key === selected) ?? result.lines[0];
  const start = new Date(Date.parse(asOf) - years * 365.25 * DAY).toISOString().slice(0, 10);
  const data = useMemo(() => {
    const rows = new Map<string, Record<string, string | number>>();
    result.lines.forEach((l, idx) => {
      const points = l.points.filter(p => p.date >= start); const base = points[0]?.value;
      for (const p of points) { let row = rows.get(p.date); if (!row) { row = { date: p.date }; rows.set(p.date, row); } row[`s${idx}`] = indexed && base ? p.value / base * 100 : p.value; }
    });
    return [...rows.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [result.lines, start, indexed]);
  const available = data.length > 0;
  const warnings = [...new Set(result.lines.flatMap(l => l.errors))];
  const slow = ["monthly", "quarterly"].includes(spec.frequency);
  return <article data-credit-indicator={spec.id} className="p-4 md:p-5 min-w-0 flex flex-col gap-4">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><div className="flex gap-1.5 items-center flex-wrap mb-1.5"><Pill muted>{spec.category}</Pill><Pill muted>{frequencies[spec.frequency]}</Pill>{spec.essential && <Pill>핵심</Pill>}</div><h3 className="font-semibold text-sm leading-snug">{spec.name}</h3></div>
      {(result.status === "manual" || result.status === "missing" || result.status === "partial") && <span className="text-[11px] text-amber-700 dark:text-amber-400 shrink-0">{result.status === "manual" ? "입력 대기" : result.status === "missing" ? "자료 없음" : "일부 확인 필요"}</span>}
    </div>
    <p className="text-xs text-muted-foreground leading-relaxed min-h-8">{spec.measures}</p>
    {spec.refresh && <div className="rounded-lg bg-muted/40 px-3 py-2 text-[10px] leading-relaxed text-muted-foreground"><div>발표 주기: {spec.refresh.publication}</div><div>{spec.refresh.collection}</div><div>최근 원천 확인: {focus.sources.filter(s => s.checkedAt).map(s => new Date(s.checkedAt!).toLocaleString("ko-KR")).filter((v, n, all) => all.indexOf(v) === n).join(" · ") || "아직 확인 전"}</div>{focus.stale && focus.latest && <div className="text-amber-700 dark:text-amber-400">{focus.collectionOverdue ? "수집 확인이 3일 넘게 지연되었습니다." : "관측·공시가 예상 갱신 간격을 넘었습니다."}</div>}</div>}
    <div>
      {result.lines.length > 1 && <div className="flex flex-wrap gap-1 mb-2" aria-label={`${spec.name} 표시 계열`}>{result.lines.map((l, n) => <button type="button" key={l.key} onClick={() => setSelected(l.key)} aria-pressed={focus.key === l.key} className={`text-[10px] px-2 py-1 rounded-md border ${focus.key === l.key ? "border-foreground/30 bg-muted" : "border-transparent text-muted-foreground"}`}><span className="inline-block w-1.5 h-1.5 rounded-full mr-1" style={{ background: colors[n % colors.length] }} />{l.label}</button>)}</div>}
      {adjusted && <p className="text-xs text-muted-foreground">분배금·분할 수정가격</p>}
      <div className="flex items-end gap-3 flex-wrap"><strong className="text-2xl tracking-tight tabular-nums font-semibold">{value(focus.latest?.value, focus.unit)}</strong><span className="text-[11px] text-muted-foreground pb-1">{focus.latest ? `${focus.latest.date} 관측 · 선택일 기준 ${focus.ageDays}일 전` : "유효 관측을 기다리는 중"}</span></div>
      {focus.latest?.publishedAt && <p className="text-[10px] text-muted-foreground mt-1">공시 {focus.latest.publishedAt}{focus.latest.publishedAt > asOf ? " · 선택일 이후 공시된 관측 자료" : ""}{focus.navAgeDays != null ? ` · NAV 기준 ${focus.latest.basis} · NAV 관측 후 ${focus.navAgeDays}일` : ""}</p>}
    </div>
    <div className="grid grid-cols-3 divide-x divide-border border-y border-border py-2.5">
      {[1, 4, 13].map(w => <div key={w} className="px-2 first:pl-0"><div className="text-[10px] text-muted-foreground mb-1">{w}주 변화</div><div className="text-xs font-medium tabular-nums">{delta(focus, w)}</div>{focus.changes[w] && <div className="text-[9px] text-muted-foreground mt-1">{focus.changes[w]!.from} → {focus.changes[w]!.to}</div>}</div>)}
    </div>
    {slow && <p className="text-[10px] text-muted-foreground -mt-2">주간 변화는 선택일과 관측 시점을 기준으로 비교합니다. 직전 관측 대비 {signed(focus.metrics.previousDelta)} {focus.unit === "percent" ? "%p" : units[focus.unit]}</p>}
    <div>
      <div className="flex flex-wrap justify-between items-center gap-2 mb-2"><span className="text-[10px] text-muted-foreground">{adjusted ? indexed ? "분배금 반영 성과 · 첫 관측 = 100" : "분배금·분할 수정가격 · 달러" : indexed ? "표시 기간 첫 관측 = 100" : units[spec.chart.unit]} · 선택일 이전 {years}년</span>{spec.chart.indexed && <button type="button" className="text-[10px] rounded border px-2 py-1" onClick={() => setIndexed(v => !v)}>{adjusted ? indexed ? "수정가격 보기" : "분배금 반영 성과 보기" : indexed ? "실제 값 보기" : "기준 100 보기"}</button>}</div>
      <div className="h-[190px] min-w-0">
        {available ? <ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 4" />
          <XAxis dataKey="date" tickFormatter={d => years <= 1 ? String(d).slice(2, 7) : String(d).slice(0, 7)} minTickGap={42} tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
          <YAxis width={45} domain={["auto", "auto"]} tick={{ fontSize: 9 }} tickFormatter={v => Number(v).toLocaleString("ko-KR", { maximumFractionDigits: 1 })} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ background: "hsl(var(--popover))", borderColor: "hsl(var(--border))", color: "hsl(var(--popover-foreground))", borderRadius: 10, fontSize: 11 }} formatter={(v: any, n: any) => [indexed ? num(Number(v)) : value(Number(v), spec.chart.unit), n]} />
          {spec.chart.unit === "ratio" && <ReferenceLine y={1} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />}
          {result.lines.map((l, n) => <Line key={l.key} name={l.label} dataKey={`s${n}`} stroke={colors[n % colors.length]} strokeWidth={focus.key === l.key ? 2 : 1.3} opacity={result.lines.length <= 4 || focus.key === l.key ? 1 : 0.35} dot={l.points.length === 1 ? { r: 3 } : false} type={slow ? "stepAfter" : "linear"} connectNulls={false} isAnimationActive={false} />)}
        </LineChart></ResponsiveContainer> : <div className="h-full rounded-xl border border-dashed flex items-center justify-center text-xs text-muted-foreground px-6 text-center leading-6">{result.status === "manual" ? "수동 CSV를 입력하면 이 자리에 차트가 표시됩니다." : "선택한 기간에 확보된 관측 자료가 없습니다. 다른 주차나 표시 기간을 선택하세요."}</div>}
      </div>
    </div>
    {spec.chart.unit === "billions" && <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground"><span>전년비 <b className="text-foreground">{signed(focus.metrics.yoy)}%</b></span>{spec.frequency === "weekly" && <span>13주 연율화 <b className="text-foreground">{signed(focus.metrics.annual13)}%</b></span>}</div>}
    <div className="rounded-lg bg-muted/50 px-3 py-2 text-[11px] grid grid-cols-2 gap-2"><span>10년 백분위 <b className="tabular-nums">{num(focus.tenYearPercentile, 0)}{focus.tenYearPercentile == null ? " · 자료 부족" : "%"}</b></span><span>확보 기간 <b>{num(focus.metrics.percentile, 0)}{focus.metrics.percentile == null ? "" : "%"}</b></span><span className="col-span-2 text-[10px] text-muted-foreground">{focus.sampleStart ? `${focus.sampleStart} ~ ${focus.sampleEnd} · ${focus.sampleCount.toLocaleString()}개 관측` : "분석 기간 없음"} · 높을수록 원값이 큼</span></div>
    <p className="text-xs leading-relaxed text-muted-foreground"><span className="font-medium text-foreground">읽는 법 </span>{spec.interpretation ?? spec.role}</p>
    {focus.notes.length > 0 && <details className="text-[10px] text-muted-foreground"><summary className="cursor-pointer">수집·자료 안내</summary><div className="pt-2 space-y-1">{focus.notes.map(note => <p key={note}>{note}</p>)}</div></details>}
    <div className="flex flex-wrap gap-1.5">{spec.signal_keys.map(k => <span key={k} className={`rounded-md px-2 py-1 text-[10px] ${signals[k]?.status === true ? "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300" : "bg-muted text-muted-foreground"}`}>{config.signalLabels[k]} · {signals[k]?.status === true ? "충족" : signals[k]?.status === false ? "미충족" : "확인 대기"}</span>)}</div>
    {(spec.caveats?.length || warnings.length) ? <div className="text-[10px] text-muted-foreground leading-relaxed">{spec.caveats?.map(t => <p key={t}>{t}</p>)}{warnings.map(t => <p key={t} className="text-amber-700 dark:text-amber-400">{t}</p>)}</div> : null}
    <div className="mt-auto border-t pt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">{focus.sources.map(s => s.url ? <a key={s.label} href={s.url} target="_blank" rel="noreferrer" className="inline-flex gap-1 items-center hover:text-foreground">{s.label}<ExternalLink size={10} /></a> : <span key={s.label}>{s.label}</span>)}</div>
  </article>;
}

function CreditPath({ path, index, results, years, asOf, signals }: {
  path: typeof config.paths[number]; index: number; results: IndicatorAnalysis[];
  years: number; asOf: string; signals: ReturnType<typeof scenarios>["signals"];
}) {
  const [selected, setSelected] = useState(0);
  const spec = path.indicators[selected];
  const panelId = `credit-path-${path.path_id}`;
  const move = (direction: number) => setSelected(current => (current + direction + path.indicators.length) % path.indicators.length);
  return <div data-credit-path={path.path_id} className="rounded-2xl border border-border bg-card shadow-sm min-w-0 overflow-hidden">
    <div className="p-4 md:p-5 border-b border-border space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">{index === 0 ? <Landmark size={18} className="shrink-0" /> : <Network size={18} className="shrink-0" />}<h2 className="text-base font-semibold">{path.path_name}</h2></div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">{selected + 1} / {path.indicators.length}</span>
          <button type="button" onClick={() => move(-1)} aria-label={`${path.path_name} 이전 지표`} aria-controls={panelId} className="rounded-lg border p-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ChevronLeft size={16} /></button>
          <button type="button" onClick={() => move(1)} aria-label={`${path.path_name} 다음 지표`} aria-controls={panelId} className="rounded-lg border p-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ChevronRight size={16} /></button>
        </div>
      </div>
      <div role="group" aria-label={`${path.path_name} 지표 선택`} className="flex flex-wrap gap-1.5">
        {path.indicators.map((indicator, n) => <button key={indicator.id} type="button" onClick={() => setSelected(n)} aria-pressed={selected === n} aria-controls={panelId} title={indicator.name} className={`rounded-lg border px-2.5 py-2 text-xs text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected === n ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 font-medium" : "border-transparent bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"}`}>{indicator.name.replace(/\([^)]*\)/g, "").trim()}</button>)}
      </div>
    </div>
    <div id={panelId} role="region" aria-label={spec.name}>
      <IndicatorCard key={spec.id} spec={spec} result={results.find(result => result.id === spec.id)!} years={years} asOf={asOf} signals={signals} />
    </div>
  </div>;
}

export default function CreditMonitor({ asOf }: { asOf: string }) {
  const [years, setYears] = useState(3);
  const query = useQuery<Response>({ queryKey: ["/api/liquidity/credit", asOf, years, "observation"], queryFn: async ({ signal }) => { const r = await fetch(`/api/liquidity/credit?asOf=${asOf}&basis=observation&years=${years}`, { signal }); const body = await r.json(); if (!body.indicators) throw new Error("신용 자료 응답 오류"); return body; }, staleTime: 5 * 60 * 1000, retry: 1 });
  const empty = useMemo(() => analyze(null, asOf, "observation"), [asOf]); const results = query.data?.indicators ?? empty; const outcome = query.data?.scenarios ?? scenarios(empty);
  return <section id="credit-monitor" className="pt-10 pb-8 space-y-7" aria-label="민간 신용 경로 모니터">
    <header className="border-t-2 border-foreground/80 pt-6 space-y-3">
      <div className="flex justify-between items-start gap-3"><div><div className="text-[10px] uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-300 font-semibold mb-2">미국 · 민간 신용</div><h2 className="text-xl md:text-2xl font-semibold tracking-tight">돈은 계속 공급되고 있나</h2></div><button type="button" onClick={() => void query.refetch()} disabled={query.isFetching} className="p-2 rounded-lg border text-muted-foreground hover:bg-muted disabled:opacity-50" aria-label="저장된 신용 자료 다시 불러오기"><RefreshCw size={15} className={query.isFetching ? "animate-spin" : ""} /></button></div>
      <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">은행의 대출 태도와 실제 대출, 시장의 조달 비용과 발행량을 함께 봅니다. 경로별 지표 이름을 선택하거나 화살표로 넘겨보세요.</p>
      <div className="flex justify-between items-center flex-wrap gap-3"><div className="text-[11px] text-muted-foreground">신용 기준일 <b className="text-foreground">{asOf}</b> · 상단 선택 주차와 연동{query.data?.collectedAt && <span className="block mt-1">자료 수집 시각 {new Date(query.data.collectedAt).toLocaleString("ko-KR")}</span>}</div><div className="inline-flex rounded-full border p-0.5" aria-label="신용 차트 기간">{[1, 3, 5, 10].map(y => <button type="button" key={y} aria-pressed={years === y} className={`px-3 py-1 text-xs rounded-full ${years === y ? "bg-foreground text-background" : "text-muted-foreground"}`} onClick={() => setYears(y)}>{y}년</button>)}</div></div>
      {(query.isError || query.data?.error) && <p role="alert" className="text-xs text-amber-700 dark:text-amber-400">{query.data?.error ?? "신용 자료를 불러오지 못했습니다."} 카드에서 필요한 항목을 확인할 수 있습니다.</p>}
      {query.isLoading && <p role="status" className="text-xs text-muted-foreground">저장된 신용 자료를 불러오는 중…</p>}
      {query.data?.configChanged && <p className="text-xs text-amber-700">지표 설정이 변경되었습니다. 다음 수집 시 원자료를 갱신합니다.</p>}
    </header>
    {config.paths.map((path, n) => <CreditPath key={path.path_id} path={path} index={n} results={empty.map(fallback => results.find(result => result.id === fallback.id) ?? fallback)} years={years} asOf={asOf} signals={outcome.signals} />)}
    <div className="space-y-4 border-t pt-7"><div><h2 className="text-lg font-semibold">지표를 함께 읽으면</h2><p className="text-xs text-muted-foreground mt-1">규칙 기반 적합도 · 발생 확률이 아닙니다. 자료 부족을 정상으로 처리하지 않습니다.</p></div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">{outcome.summary.map(s => <div key={s.name} className="rounded-xl border p-4"><div className="text-xs text-muted-foreground">{s.name}</div><div className="text-sm font-semibold mt-2">{s.status}</div><p className="text-[11px] leading-relaxed text-muted-foreground mt-2">{s.evidence.join(" · ") || "뚜렷한 긴장 조합이 아직 확인되지 않았습니다."}</p>{s.missing.length > 0 && <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-2">확인 필요: {s.missing.join(" · ")}</p>}</div>)}</div>
      <p className="text-sm font-medium">{outcome.closest.length ? `가까운 시나리오: ${outcome.closest.join(" · ")}${outcome.closest.length > 1 ? " (혼합)" : ""}` : "대표 시나리오 판단 보류 — 필수 근거 또는 조건이 충분하지 않습니다."}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{outcome.rows.map(row => <div key={row.id} className={`rounded-xl border p-4 ${row.candidate ? "border-indigo-500/60 bg-indigo-500/5" : "bg-card"}`}><div className="flex justify-between gap-2"><h3 className="font-semibold text-sm">{row.id} · {row.name}</h3><span className="text-sm font-semibold tabular-nums">{num(row.score, 0)}<span className="text-[10px] font-normal text-muted-foreground"> / 100</span></span></div><div className="flex justify-between text-[10px] text-muted-foreground mt-2"><span>{row.candidate ? "조건 충족" : "조건 미충족·확인 대기"}</span><span>자료 충족률 {num(row.coverage * 100, 0)}%</span></div><div className="h-1.5 bg-muted rounded-full mt-2"><div className="h-full bg-indigo-500/60 rounded-full" style={{ width: `${row.score ?? 0}%` }} /></div><details className="mt-3 text-[11px]"><summary className="cursor-pointer text-muted-foreground">일치·반대·부족 근거 보기</summary><div className="space-y-3 pt-3">{row.evidence.map(e => <div key={e.signal}><div className="font-medium flex items-center gap-1">{e.status === true ? <ArrowUpRight size={12} /> : e.status === false ? <ArrowDownRight size={12} /> : "—"}{e.label} · {e.status === true ? "일치" : e.status === false ? "반대" : "자료 부족"}{e.required ? " (필수)" : ""}</div>{e.evidence.map((p, idx) => <p key={idx} className="text-[10px] text-muted-foreground pl-4 mt-0.5">{p.line} · {metricLabels[p.metric] ?? p.metric}: {num(p.value)} (조건 {ruleLabel(p.expected)}) · {p.from ? `${p.from} → ` : ""}{p.date ?? "관측 없음"}{p.reason ? ` · ${p.reason}` : ""}</p>)}</div>)}</div></details></div>)}</div>
    </div>
    <footer className="text-[10px] text-muted-foreground leading-relaxed border-t pt-4">현재 확보한 자료를 관측 시점에 배치한 과거 분석입니다. 선택일 이후의 공시·수정 수치가 포함될 수 있습니다. BDC P/NAV는 해당 주가와 그날까지의 최신 분기말 NAV를 연결합니다. 개별 지표의 출처·주기·대상 범위가 다릅니다. 확보된 관측 기간을 표시하며, 10년 미만의 자료를 10년 백분위로 표시하지 않습니다. 수동 지표는 CSV 입력 전까지 판단 근거에서 제외됩니다.</footer>
  </section>;
}
