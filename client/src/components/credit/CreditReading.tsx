import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, ReferenceLine, ReferenceDot, CartesianGrid } from "recharts";
import { indicators, config, type Indicator } from "@shared/credit/schema";
import { analyze, DAY, type IndicatorAnalysis } from "@shared/credit/signals";
import { creditSignals } from "@shared/credit/scenarios";
import { readingGroups, readingNotes, groupReading, indicatorReading, formatCredit, distributionAdjusted, type CreditOutcome } from "@shared/credit/reading";

import { creditReview } from "@shared/credit/review";
import { ReviewText } from "../ReviewText";
import { RateComparisonChart } from "./RateComparisonChart";
import { rateNarrative } from "@shared/credit/rate-comparison";
import { bondReading } from "@shared/credit/bond-reading";
import { CreditTrendNote } from "./CreditTrendNote";
import { creditChapter, type ChapterReading } from "@shared/credit/chapter-reading";
import { creditWatchpoints } from "@shared/credit/report";

type Response = { asOf: string; collectedAt: string | null; error?: string | null; configChanged?: boolean; indicators: IndicatorAnalysis[]; scenarios: CreditOutcome };
const ink = "#1A1A18", muted = "#5F5C54", border = "#D9D5CA";
const colors = ["#3E5C76", "#C89B3C", "#7B5EA7", "#6A9BC3"];
const serif = "'Noto Serif KR', 'Apple SD Gothic Neo', serif";
const paragraph = { fontSize: 14, lineHeight: 1.8, color: "#3B3934", margin: 0 };
const caption = { fontSize: 12, lineHeight: 1.65, color: muted };
const periods: Record<string, string> = { daily: "일간", weekly: "주간", monthly: "월간", quarterly: "분기" };
const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

export function useCreditReading(asOf: string) {
  const [years, setYears] = useState(3);
  const query = useQuery<Response>({ queryKey: ["/api/liquidity/credit", asOf, years, "observation"], enabled: !!asOf,
    queryFn: async ({ signal }) => {
      const r = await fetch(`/api/liquidity/credit?asOf=${asOf}&basis=observation&years=${years}`, { signal });
      const body = await r.json();
      if (!r.ok || !Array.isArray(body.indicators) || body.asOf !== asOf) throw new Error(body.error ?? "신용 자료 응답 오류");
      return body;
    }, staleTime: 5 * 60 * 1000, retry: 1 });
  const fallback = useMemo(() => analyze(null, asOf || "2000-01-01", "observation"), [asOf]);
  const data = query.data?.indicators ?? fallback;
  const outcome = query.data?.scenarios ?? creditSignals(fallback);
  return { query, data, outcome, years, setYears, asOf };
}
export type CreditReadingState = ReturnType<typeof useCreditReading>;

export function creditChapterForState(id: string, state: CreditReadingState, weeks: 4 | 13): ChapterReading {
  if (state.query.isLoading) return { text: "선택 시점의 신용 자료를 확인하고 있습니다.", details: [] };
  if (state.query.isError || state.query.data?.error || state.query.data?.configChanged) return { text: "선택 시점의 신용 자료를 확인하지 못했습니다.", details: [] };
  return creditChapter(id, state.data, state.outcome, weeks);
}

export function CreditSummary({ state, weeks = 4 }: { state: CreditReadingState; weeks?: 4 | 13 }) {
  const { query, outcome, asOf } = state;
  if (query.isLoading) return <div className="text-xs text-[#918D83]">신용 자료 조회 중</div>;
  if (query.isError || query.data?.error || query.data?.configChanged) return <div className="text-xs text-[#918D83]" role="status">신용 자료 {query.data?.configChanged ? "설정 변경 · 재집계 대기" : "조회 오류 · 판단 불가"} <button type="button" onClick={() => void query.refetch()} className="ml-2 underline">다시 불러오기</button></div>;
  const review = creditReview(outcome);
  return <section aria-label="신용 상태 리뷰" data-credit-summary={asOf} className="min-w-0">
    {review.stories.length ? review.stories.map(story => <div key={story.id} className="mb-3 rounded-xl border border-[#DCC5AA] bg-[#FAF5EB] p-5 text-sm leading-[1.85] text-[#684525]">
      <a href={`#${story.id}`} onClick={e => { e.preventDefault(); jump(story.id); }} className="font-semibold text-base">{story.headline}</a>
      {story.evidence.map((e, n) => <p key={n} className="mt-2">{e.text}<br /><span className="text-xs text-[#918D83]">({e.date})</span></p>)}
      <ReviewText className="mt-2" text={story.meaning} />
    </div>) : <ReviewText className="text-[15px] leading-[1.85]" text={review.normal} />}
    <div className="mt-2 text-[13px] leading-[1.8] text-[#5F5C54]">{["ig_oas", "hy_oas"].map(id => {
      const rate = state.data.find(i => i.id === id)?.comparisonLines?.[0], c = rate?.changes[weeks];
      return <p key={id}>{rate?.latest && !rate.stale && !rate.errors.length ? `${rate.label} ${formatCredit(rate.latest.value, "percent")} · ${weeks}주 ${c && !c.unchangedRelease ? formatCredit(c.value, "pp", true) : "비교 자료 부족"} (${rate.latest.date})` : `${id === "ig_oas" ? "IG" : "HY"} 시장금리 자료 부족 · 금리 수준 판단 유보`}</p>;
    })}</div>
    {!review.stories.length && review.incompleteIssuance && <p className="mt-2 text-xs text-[#918D83]">등급별 회사채 발행량은 자료 부족으로 판단에서 제외했습니다.</p>}
  </section>;
}

function ReadingChart(props: { spec: Indicator; result: IndicatorAnalysis; state: CreditReadingState; weeks: 4 | 13 }) {
  const { spec, result, state, weeks } = props;
  if (!spec.chart.marketYield && spec.chart.kind !== "spread") return <OriginalReadingChart {...props} />;
  const note = readingNotes[spec.id];
  return <article data-credit-reading={spec.id} id={`read-${spec.id}`} style={{ borderTop: `1px solid ${border}`, paddingTop: 24, scrollMarginTop: "var(--liquidity-sticky-top, 84px)" }}>
    <div style={caption}>{spec.name} · {periods[spec.frequency]}</div>
    <h3 style={{ fontFamily: serif, fontSize: 20, lineHeight: 1.55, margin: "8px 0" }}>{note.question}</h3>
    <ReviewText text={rateNarrative(result, weeks)} className="text-sm font-semibold leading-[1.8] mb-4" />
    <RateComparisonChart id={spec.id} kind={spec.chart.marketYield ? "oas" : "difference"} rates={result.comparisonLines ?? []} spread={result.lines[0]} asOf={state.asOf} years={state.years} weeks={weeks} />
    {spec.signal_keys.includes("ccc_gap_trend") && <div className="mt-3"><CreditTrendNote signals={state.outcome.signals} /></div>}
    <div className="py-4 space-y-2">
      <p style={paragraph}>{note.reading}</p><p style={paragraph}>{note.together}</p>
      <details style={caption}><summary className="cursor-pointer">관측 범위·갱신 주기·판정 근거</summary><div className="pt-2 space-y-2">
        <p>{spec.refresh?.publication} · {spec.refresh?.collection}</p>
        <p>조건 판정은 스프레드 기준입니다. 시장금리의 수준·변화와 별도로 해석합니다.</p>
        {[...result.lines, ...(result.comparisonLines ?? [])].map(l => <p key={l.key}>{l.label}: {l.sampleStart ?? "—"} ~ {l.sampleEnd ?? "—"} · {l.sampleCount}개. {l.tenYearPercentile == null ? "10년 백분위 자료 부족" : `10년 백분위 ${formatCredit(l.tenYearPercentile, "percent")}`}{l.errors.length ? ` · ${l.errors.join(" / ")}` : ""}</p>)}
        {spec.caveats?.map(c => <p key={c}>{c}</p>)}
      </div></details>
    </div>
  </article>;
}

function OriginalReadingChart({ spec, result, state, weeks }: { spec: Indicator; result: IndicatorAnalysis; state: CreditReadingState; weeks: 4 | 13 }) {
  const [selected, setSelected] = useState(result.lines[0]?.key);
  const focus = result.lines.find(l => l.key === selected) ?? result.lines[0];
  const [indexed, setIndexed] = useState(!!spec.chart.indexed);
  const adjusted = distributionAdjusted(spec);
  const note = readingNotes[spec.id];
  const interpretation = indicatorReading(spec, focus, weeks, state.outcome);
  const all = !!spec.chart.indexed || spec.chart.kind === "pnav";
  const shown = all ? result.lines : [focus];
  const start = new Date(Date.parse(state.asOf) - state.years * 365.25 * DAY).toISOString().slice(0, 10);
  const chart = useMemo(() => {
    const rows = new Map<string, Record<string, string | number>>();
    shown.forEach((line, index) => {
      const points = line.points.filter(p => p.date >= start && p.date <= state.asOf);
      const base = points[0]?.value;
      points.forEach(p => { const row = rows.get(p.date) ?? { date: p.date }; row[`v${index}`] = indexed && base ? p.value / base * 100 : p.value; rows.set(p.date, row); });
    });
    return [...rows.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [result, focus, indexed, start, state.asOf]);
  const slow = ["monthly", "quarterly"].includes(spec.frequency);
  const c = interpretation.change;
  const deltaUnit = spec.chart.unit === "percent" ? "pp" : spec.chart.unit;
  const percent = focus.tenYearPercentile ?? focus.metrics.percentile;
  const errors = [...new Set(focus.errors)];
  const focusIndex = all ? result.lines.indexOf(focus) : 0;
  const marker = (date?: string) => date ? chart.find(p => p.date === date)?.[`v${focusIndex}`] : undefined;
  const nowMarker = marker(focus.latest?.date), oldMarker = marker(c?.from);
  return <article data-credit-reading={spec.id} style={{ borderTop: `1px solid ${border}`, paddingTop: 24, scrollMarginTop: "var(--liquidity-sticky-top, 84px)" }} id={`read-${spec.id}`}>
    <div style={caption}>{spec.name} · {periods[spec.frequency]}</div>
    <h3 style={{ fontFamily: serif, fontSize: 20, lineHeight: 1.55, margin: "8px 0" }}>{note.question}</h3>
    <p style={{ ...paragraph, fontWeight: 600 }}>{interpretation.headline}</p>
    <p style={{ ...paragraph, marginTop: 8 }}>{spec.measures}</p>
    {result.lines.length > 1 && <div className="flex flex-wrap gap-2 mt-4" aria-label={`${spec.name} 해설 계열`}>
      {result.lines.map((l, n) => <button type="button" key={l.key} aria-pressed={focus.key === l.key} onClick={() => setSelected(l.key)} style={{ fontSize: 12, padding: "6px 10px", border: `1px solid ${focus.key === l.key ? ink : border}`, borderRadius: 20, background: focus.key === l.key ? "#E8E5DC" : "transparent", color: ink }}><span style={{ color: colors[n % colors.length] }}>● </span>{l.label}{!l.latest ? " · 자료 없음" : ""}</button>)}
    </div>}
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 mb-4">
      <div>{adjusted && <div style={caption}>분배금·분할 수정가격</div>}<strong style={{ fontSize: 22 }}>{formatCredit(focus.latest?.value, focus.unit)}</strong><div style={caption}>{focus.latest ? `${focus.latest.date} 관측 · 선택일보다 ${focus.ageDays ?? "—"}일 전` : "선택 시점의 관측 없음"}</div></div>
      <div><span style={{ fontSize: 15, fontWeight: 600 }}>{interpretation.label} {c && !c.unchangedRelease ? formatCredit(c.value, deltaUnit, true) : c?.unchangedRelease ? "새 관측 없음" : "비교 자료 부족"}</span><div style={caption}>{c ? `${c.from} → ${c.to}` : "이전 관측을 확보해야 변화량을 계산할 수 있습니다."}</div></div>
    </div>
    {(focus.stale || errors.length > 0 || result.status !== "ok") && <p style={{ ...caption, marginBottom: 12 }} role="note">{!focus.latest ? "자료가 없어 판단에 사용하지 않습니다." : !interpretation.known ? "갱신 지연 또는 수집 오류가 있어 이 계열은 조건 판정에서 제외합니다." : "일부 계열이 없거나 확인이 필요합니다. 표시된 계열만으로 전체를 대표하지 않습니다."}</p>}
    <div style={{ background: "#FFF", border: `1px solid ${border}`, borderRadius: 12, padding: "16px 8px" }}>
      <div className="flex flex-wrap justify-between gap-2 px-3 mb-3" style={caption}><span>{adjusted ? indexed ? "분배금 반영 성과 · 각 계열 첫 관측 = 100" : "분배금·분할 수정가격 · 달러" : indexed ? "각 계열 첫 관측 = 100" : `단위: ${({ billions: "십억 달러", percent: "%", pp: "%p", ratio: "배", usd: "달러" } as Record<string, string>)[spec.chart.unit] ?? spec.chart.unit}`} · {state.asOf}까지 {state.years}년</span>{spec.chart.indexed && <button type="button" className="underline" onClick={() => setIndexed(v => !v)}>{adjusted ? indexed ? "수정가격 보기" : "분배금 반영 성과 보기" : indexed ? "실제 잔액·가격 보기" : "기준 100으로 비교"}</button>}</div>
      {chart.length ? <div style={{ height: 220 }}><ResponsiveContainer width="100%" height="100%"><LineChart data={chart} margin={{ left: 4, right: 20, top: 12, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#E8E5DC" />
        <XAxis dataKey="date" minTickGap={50} tickFormatter={d => String(d).slice(2, 7)} tick={{ fontSize: 11, fill: muted }} tickLine={false} axisLine={false} />
        <YAxis width={56} domain={["auto", "auto"]} tickFormatter={v => Number(v).toLocaleString("ko-KR", { maximumFractionDigits: 1, notation: "compact" })} tick={{ fontSize: 11, fill: muted }} tickLine={false} axisLine={false} />
        {indexed && <ReferenceLine y={100} stroke={muted} strokeDasharray="3 3" />}
        {!indexed && (spec.id.startsWith("sloos") || spec.chart.kind === "pnav") && <ReferenceLine y={spec.chart.kind === "pnav" ? 1 : 0} stroke={muted} strokeDasharray="3 3" />}
        {shown.map((l, n) => <Line key={l.key} dataKey={`v${n}`} stroke={colors[n % colors.length]} strokeWidth={l.key === focus.key ? 2.5 : 1.5} opacity={l.key === focus.key ? 1 : 0.6} dot={l.points.length === 1 ? { r: 3 } : false} type={slow ? "stepAfter" : "linear"} connectNulls={false} isAnimationActive={false} />)}
        {typeof oldMarker === "number" && c && <ReferenceDot x={c.from} y={oldMarker} r={4} fill="#FFF" stroke={ink} />}
        {typeof nowMarker === "number" && focus.latest && <ReferenceDot x={focus.latest.date} y={nowMarker} r={4} fill={ink} stroke="#FFF" />}
      </LineChart></ResponsiveContainer></div> : <div style={{ padding: 35, textAlign: "center", ...caption }}>이 기간에 표시할 자료가 없습니다.</div>}
      <div style={{ ...caption, padding: "6px 12px 0" }}>● 최신 관측 · ○ 비교 관측{all ? " · 선택한 계열을 진하게 표시" : ""}{slow ? " · 새 관측 사이의 수평선은 추가 발표를 뜻하지 않습니다" : ""}</div>
      {adjusted && <p style={{ ...caption, padding: "8px 12px 0" }}>{note.reading}</p>}
    </div>
    <div style={{ padding: "16px 0 24px", display: "flex", flexDirection: "column", gap: 10 }}>
      <p style={paragraph}><b>관측 해석.</b> {interpretation.meaning}</p>
      {!adjusted && <p style={paragraph}><b>지표 의미.</b> {note.reading}</p>}
      <p style={paragraph}><b>관련 신호.</b> {note.together}</p>
      {interpretation.matched.length > 0 && <p style={caption}>선택일의 조건 판정: {interpretation.matched.join(" · ")} · A안 공통 규칙</p>}
      <details style={caption}><summary style={{ cursor: "pointer" }}>관측 범위·갱신 주기·판정 근거</summary>
        <div style={{ paddingTop: 10, display: "flex", flexDirection: "column", gap: 5 }}>
          <span>{spec.refresh?.publication} · {spec.refresh?.collection}</span>
          <span>확보된 백분위 표본: {focus.sampleStart ?? "—"} ~ {focus.sampleEnd ?? "—"} · {focus.sampleCount}개. {percent == null ? "백분위 계산 자료 부족" : `${focus.tenYearPercentile != null ? "10년" : "확보 기간"} 백분위 ${formatCredit(percent, "percent")}`}</span>
          {focus.latest?.publishedAt && <span>공시일 {focus.latest.publishedAt}{focus.latest.publishedAt > state.asOf ? " · 선택일 이후 공시된 관측값" : ""}</span>}
          {focus.latest?.basis && <span>기준: {focus.latest.basis}{focus.navAgeDays != null ? ` · NAV 관측 후 ${focus.navAgeDays}일` : ""}</span>}
          {[...new Set([...(spec.caveats ?? []), ...focus.notes, ...errors])].map(t => <span key={t}>{t}</span>)}
          {spec.signal_keys.map(k => <div key={k}>{config.signalLabels[k]}: {state.outcome.signals[k]?.status == null ? "자료 부족" : state.outcome.signals[k].status ? "조건 충족" : "조건 미충족"}{state.outcome.signals[k]?.evidence.map((e, n) => <div key={n} style={{ paddingLeft: 12 }}>{e.line} · {e.date ?? "관측 없음"} · {e.reason ?? `${e.metric}: ${e.value ?? "—"} / 조건 ${e.expected}`}</div>)}</div>)}
        </div>
      </details>
    </div>
  </article>;
}

export function CreditReadingControls({ state }: { state: CreditReadingState }) {
  return <div className="flex flex-wrap justify-between items-center gap-3" style={{ marginBottom: 16 }}>
    <div style={caption}>신용 지표 · {state.asOf}</div>
    <div className="flex gap-2" aria-label="신용 해설 차트 기간">{[1, 3, 5, 10].map(y => <button type="button" key={y} onClick={() => state.setYears(y)} aria-pressed={state.years === y} style={{ border: `1px solid ${border}`, borderRadius: 18, background: state.years === y ? ink : "transparent", color: state.years === y ? "#FFF" : ink, padding: "6px 12px", fontSize: 12 }}>{y}년</button>)}</div>
  </div>;
}

export function CreditReadingGroup({ group, state, weeks }: { group: typeof readingGroups[number]; state: CreditReadingState; weeks: 4 | 13 }) {
  const r = groupReading(group, state.outcome);
  const chapter = creditChapterForState(group.id, state, weeks);
  const unavailable = state.query.isError || state.query.data?.error || state.query.data?.configChanged;
  return <>
    <h2 style={{ fontFamily: serif, fontSize: 24, lineHeight: 1.5, margin: 0 }}>{group.question}</h2>
    {!state.query.isLoading && !unavailable && <div>
      {group.id === "credit-bonds" && <p style={paragraph}>스프레드는 국채 금리보다 추가로 요구하는 금리(프리미엄)를 뜻합니다.</p>}
      <details className="text-xs leading-relaxed text-[#918D83]"><summary className="cursor-pointer">요약 근거·세부 기준</summary><div className="mt-2 space-y-1">{chapter.details.map(text => <p key={text}>{text}</p>)}<p>기존 경고 판정: {r.text}</p></div></details>
    </div>}
    {group.id === readingGroups[0].id && <CreditReadingControls state={state} />}
    {group.ids.map(id => { const spec = indicators.find(i => i.id === id)!, result = state.data.find(i => i.id === id)!; return <ReadingChart key={id} spec={spec} result={result} state={state} weeks={weeks} />; })}
  </>;
}

export function CreditWatchpoints({ state }: { state: CreditReadingState }) {
  const { outcome } = state;
  if (state.query.isLoading || state.query.isError || state.query.data?.error || state.query.data?.configChanged) return <p style={caption}>선택 시점의 신용 자료를 확인한 뒤 판단 조건을 표시합니다.</p>;
  return <>
    <h2 style={{ fontFamily: serif, fontSize: 24, lineHeight: 1.5, margin: 0 }}>다음에 확인할 변화</h2>
    <div className="space-y-5" data-testid="credit-watchpoints">{creditWatchpoints(state.data, outcome).map(point => <div key={point.title} className="border-t border-[#D9D5CA] pt-4"><h3 className="text-sm font-semibold mb-2">{point.title}</h3><p style={paragraph}>{point.text}</p>{point.detail && <details className="mt-2 text-xs leading-relaxed text-[#918D83]"><summary className="cursor-pointer">현재 관측·경고 기준</summary><p className="mt-2">{point.detail}</p></details>}</div>)}</div>

  </>;
}
