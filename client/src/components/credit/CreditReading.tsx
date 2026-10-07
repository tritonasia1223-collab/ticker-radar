import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, ReferenceLine, ReferenceDot, CartesianGrid } from "recharts";
import { indicators, type Indicator } from "@shared/credit/schema";
import { analyze, DAY, type IndicatorAnalysis } from "@shared/credit/signals";
import { creditSignals } from "@shared/credit/scenarios";
import { readingGroups, readingNotes, indicatorReading, formatCredit, distributionAdjusted, type CreditOutcome } from "@shared/credit/reading";

import { RateComparisonChart } from "./RateComparisonChart";
import { BondDashboard } from "./BondDashboard";
import { BankSizeComparison } from "./BankSizeComparison";
import { NonbankLendingNote } from "./NonbankLendingNote";
import { SloosStandardsNote } from "./SloosStandardsNote";
import { BANK_DEFINITIONS, creditChapter, type ChapterReading, type ChapterParagraph } from "@shared/credit/chapter-reading";
import { bankChartReading } from "@shared/credit/bank-chart-reading";
import { BOND_DEFINITION } from "@shared/credit/report";

type Response = { asOf: string; collectedAt: string | null; error?: string | null; configChanged?: boolean; indicators: IndicatorAnalysis[]; scenarios: CreditOutcome };
const ink = "#1A1A18", muted = "#5F5C54", border = "#D9D5CA";
const colors = ["#3E5C76", "#C89B3C", "#7B5EA7", "#6A9BC3"];
const serif = "'Noto Serif KR', 'Apple SD Gothic Neo', serif";
const paragraph = { fontSize: 14, lineHeight: 1.8, color: "#3B3934", margin: 0 };
const caption = { fontSize: 12, lineHeight: 1.65, color: muted };
const bankTitles: Record<string, string> = {
  h8_ci_loans: 'H.8 기업 대출 잔액',
  h8_large_vs_small_banks: 'H.8 대형·소형은행 대출·예금',
  h8_loans_to_nondepository: 'H.8 비은행 금융회사 대출 잔액',
  sloos_ci_standards: 'SLOOS 기업대출 심사 기준',
  sloos_ci_demand: 'SLOOS 기업대출 수요',
};
const marketTitles: Record<string, string> = {
  ig_oas: 'IG 회사채 시장금리·OAS',
  hy_oas: 'HY 회사채 시장금리·OAS',
  corporate_bond_issuance: '회사채 발행액',
  cp_spread: '기업어음(CP) 금리·국채 금리차',
  cp_outstanding: '기업어음(CP) 발행 잔액',
};
const supportingTitles: Record<string, string> = {
  cp_spread: '기업어음(CP) 금리·국채 금리차',
  cp_outstanding: '기업어음(CP) 발행 잔액',
  bdc_price_to_nav: 'BDC 주가·순자산 비율 (P/NAV)',
  bdc_credit_quality: 'BDC 부실 대출·PIK 비중',
  leveraged_loans: '레버리지론 ETF',
};
function ReadingDefinition({ id }: { id: string }) {
  return <p data-credit-definition={id} className="rounded-xl bg-[#EAF0EE] px-5 py-5 md:px-6" style={{ ...paragraph, fontSize: 15 }}>{readingNotes[id].reading}</p>;
}
const periods: Record<string, string> = { daily: "일간", weekly: "주간", monthly: "월간", quarterly: "분기" };
const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

export function useCreditReading(asOf: string) {
  const years = 3;
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
  return { query, data, outcome, years, asOf };
}
export type CreditReadingState = ReturnType<typeof useCreditReading>;

export function creditChapterForState(id: string, state: CreditReadingState, weeks: 4 | 13): ChapterReading {
  if (state.query.isLoading) return { text: "선택 시점의 신용 자료를 확인하고 있습니다.", details: [] };
  if (state.query.isError || state.query.data?.error || state.query.data?.configChanged) return { text: "선택 시점의 신용 자료를 확인하지 못했습니다.", details: [] };
  return creditChapter(id, state.data, state.outcome, weeks);
}


function ReadingChart(props: { spec: Indicator; result: IndicatorAnalysis; state: CreditReadingState; weeks: 4 | 13 }) {
  const { spec, result, state, weeks } = props;
  if (spec.id === 'h8_large_vs_small_banks') return <BankSizeComparison {...props} />;
  if (!spec.chart.marketYield && spec.chart.kind !== "spread") return <OriginalReadingChart {...props} />;
  const note = readingNotes[spec.id];
  const supporting = !!supportingTitles[spec.id];
  return <article data-credit-reading={spec.id} id={`read-${spec.id}`} style={{ borderTop: `1px solid ${border}`, paddingTop: 24, scrollMarginTop: "var(--liquidity-sticky-top, 84px)" }}>
    <div style={caption}>{supporting ? periods[spec.frequency] : `${spec.name} · ${periods[spec.frequency]}`}</div>
    <h3 style={{ fontFamily: supporting ? undefined : serif, fontWeight: 600, fontSize: supporting ? 18 : 20, lineHeight: 1.55, margin: '8px 0 20px' }}>{supportingTitles[spec.id] ?? marketTitles[spec.id] ?? note.question}</h3>
    {supporting && <div className="mb-5"><ReadingDefinition id={spec.id} /></div>}
    <RateComparisonChart id={spec.id} kind={spec.chart.marketYield ? "oas" : "difference"} rates={result.comparisonLines ?? []} spread={result.lines[0]} asOf={state.asOf} years={state.years} weeks={weeks} showSources={false} compact={!!marketTitles[spec.id]} showNote={!marketTitles[spec.id]} />
    <div className="py-4 space-y-2">
      {!supporting && !['ig_oas', 'hy_oas'].includes(spec.id) && <p style={paragraph}>{note.reading}</p>}
      <details style={caption}><summary className="cursor-pointer">관측 범위·갱신 주기</summary><div className="pt-2 space-y-2">
        <p>{spec.refresh?.publication} · {spec.refresh?.collection}</p>
        {[...result.lines, ...(result.comparisonLines ?? [])].map(l => <p key={l.key}>{l.label}: {l.sampleStart ?? "—"} ~ {l.sampleEnd ?? "—"} · {l.sampleCount}개. {l.tenYearPercentile == null ? "10년 백분위 자료 부족" : `10년 백분위 ${formatCredit(l.tenYearPercentile, "percent")}`}{l.errors.length ? ` · ${l.errors.join(" / ")}` : ""}</p>)}
        {spec.caveats?.map(c => <p key={c}>{c}</p>)}
      </div></details>
    </div>
  </article>;
}

function OriginalReadingChart({ spec, result, state, weeks }: { spec: Indicator; result: IndicatorAnalysis; state: CreditReadingState; weeks: 4 | 13 }) {
  const [selected, setSelected] = useState(result.lines[0]?.key);
  const totalIssuanceOnly = spec.id === 'corporate_bond_issuance';
  const focus = result.lines.find(l => l.key === (totalIssuanceOnly ? spec.chart.lines[0]?.key : selected)) ?? result.lines[0];
  const bdcQuality = spec.id === 'bdc_credit_quality';
  const companyOf = (label: string) => label.split(' ')[0];
  const metricOf = (label: string) => label.slice(label.indexOf(' ') + 1);
  const company = companyOf(focus.label), metric = metricOf(focus.label);
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
  const bankTitle = bankTitles[spec.id] ?? marketTitles[spec.id];
  const supporting = !!supportingTitles[spec.id];
  const compact = !!bankTitle || supporting;
  const bankSubject = spec.id === 'h8_ci_loans' ? '상업은행의 기업 대출 잔액은'
    : spec.id === 'h8_large_vs_small_banks' ? `${focus.label.replace(' · ', '은행의 ')} 잔액은`
    : spec.id === 'h8_loans_to_nondepository' ? '상업은행의 비은행 금융회사 대출 잔액은'
    : spec.id === 'sloos_ci_standards' ? '기업대출 심사 기준 지표는'
    : spec.id === 'corporate_bond_issuance' ? '회사채 발행액은'
    : spec.id === 'cp_outstanding' ? '기업어음 발행 잔액은' : '기업대출 수요 지표는';
  const validChange = interpretation.known && c && !c.unchangedRelease && Number.isFinite(c.value);
  const bankHeadline = validChange
    ? `${bankSubject} ${spec.frequency === 'quarterly' ? '직전 분기와' : spec.frequency === 'monthly' ? '직전 월과' : `${weeks}주 전과`} 비교해 ${c.value < 0 ? '하락했습니다' : c.value > 0 ? '상승했습니다' : '변하지 않았습니다'}.`
    : interpretation.headline;
  const changeColor = compact && validChange ? c.value > 0 ? '#1F7A4D' : c.value < 0 ? '#B3402E' : undefined : undefined;
  const deltaUnit = spec.chart.unit === "percent" ? "pp" : spec.chart.unit;
  const percent = focus.tenYearPercentile ?? focus.metrics.percentile;
  const errors = [...new Set(focus.errors)];
  const focusIndex = all ? result.lines.indexOf(focus) : 0;
  const marker = (date?: string) => date ? chart.find(p => p.date === date)?.[`v${focusIndex}`] : undefined;
  const nowMarker = marker(focus.latest?.date), oldMarker = marker(c?.from);
  return <article data-credit-reading={spec.id} style={{ borderTop: `1px solid ${border}`, paddingTop: 24, scrollMarginTop: "var(--liquidity-sticky-top, 84px)" }} id={`read-${spec.id}`}>
    <div style={caption}>{supporting ? periods[spec.frequency] : `${totalIssuanceOnly ? '회사채 전체 발행액' : spec.name} · ${periods[spec.frequency]}`}</div>
    <h3 style={{ fontFamily: supporting ? undefined : serif, fontWeight: 600, fontSize: supporting ? 18 : 20, lineHeight: 1.55, margin: supporting ? '8px 0 20px' : '8px 0' }}>{supportingTitles[spec.id] ?? bankTitle ?? note.question}</h3>
    {supporting && <ReadingDefinition id={spec.id} />}
    {bankTitle && !supporting && <p style={{ ...paragraph, fontWeight: 600 }}>{bankHeadline}</p>}
    {!compact && <p style={{ ...paragraph, marginTop: 8 }}>{spec.measures}</p>}
    {bdcQuality && <div className="space-y-3 mt-5" aria-label="BDC 공시 계열 선택">
      {(['회사', '항목'] as const).map(kind => <div key={kind} className="flex flex-wrap items-center gap-2" role="group" aria-label={`BDC ${kind}`}>
        <span className="text-xs text-[#777369] w-8">{kind}</span>
        {[...new Set(result.lines.filter(l => kind === '회사' || companyOf(l.label) === company).map(l => kind === '회사' ? companyOf(l.label) : metricOf(l.label)))].map(label => {
          const active = label === (kind === '회사' ? company : metric);
          return <button key={label} type="button" aria-pressed={active} onClick={() => {
            const candidates = result.lines.filter(l => companyOf(l.label) === (kind === '회사' ? label : company));
            const next = candidates.find(l => metricOf(l.label) === (kind === '항목' ? label : metric)) ?? candidates[0];
            if (next) setSelected(next.key);
          }} className="rounded-full border px-3 py-2 text-xs" style={{ borderColor: active ? ink : border, background: active ? ink : 'transparent', color: active ? '#FFF' : ink }}>{label}</button>;
        })}
      </div>)}
    </div>}
    {!totalIssuanceOnly && !bdcQuality && result.lines.length > 1 && <div className="flex flex-wrap gap-2 mt-4" aria-label={`${spec.name} 해설 계열`}>
      {result.lines.map((l, n) => <button type="button" key={l.key} aria-pressed={focus.key === l.key} onClick={() => setSelected(l.key)} style={{ fontSize: 12, padding: "6px 10px", border: `1px solid ${focus.key === l.key ? ink : border}`, borderRadius: 20, background: focus.key === l.key ? "#E8E5DC" : "transparent", color: ink }}><span style={{ color: colors[n % colors.length] }}>● </span>{l.label}{!l.latest ? " · 자료 없음" : ""}</button>)}
    </div>}
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 mb-4">
      <div>{supporting && <div style={caption}>{result.lines.length > 1 ? focus.label : '현재'}</div>}{adjusted && <div style={caption}>분배금·분할 수정가격</div>}<strong style={{ fontSize: 22 }}>{formatCredit(focus.latest?.value, focus.unit)}</strong><div style={caption}>{focus.latest ? compact ? `(${focus.latest.date} 기준)` : `${focus.latest.date} 관측 · 선택일보다 ${focus.ageDays ?? "—"}일 전` : "선택 시점의 관측 없음"}</div></div>
      <div><span style={{ fontSize: 15, fontWeight: 600 }}>{interpretation.label} <span style={{ color: changeColor }}>{c && !c.unchangedRelease ? formatCredit(c.value, deltaUnit, true) : c?.unchangedRelease ? "새 관측 없음" : "비교 자료 부족"}</span></span><div style={caption}>{c ? `${c.from} → ${c.to}` : "이전 관측을 확보해야 변화량을 계산할 수 있습니다."}</div></div>
    </div>
    {(!focus.latest || focus.stale || errors.length > 0) && <p style={{ ...caption, marginBottom: 12 }} role="note">{!focus.latest ? "자료가 없어 판단에 사용하지 않습니다." : "갱신 지연 또는 수집 오류가 있어 이 계열은 변화 비교에서 제외합니다."}</p>}
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
      {adjusted && !supporting && <p style={{ ...caption, padding: "8px 12px 0" }}>{note.reading}</p>}
    </div>
    <div style={{ padding: "16px 0 24px", display: "flex", flexDirection: "column", gap: 10 }}>
      {spec.id === 'h8_loans_to_nondepository' && <NonbankLendingNote />}
      {spec.id === 'sloos_ci_standards' && <SloosStandardsNote />}
      {marketTitles[spec.id] && !totalIssuanceOnly && !supporting && <p style={paragraph}>{note.reading}</p>}
      {!compact && <>
        {!adjusted && <p style={paragraph}><b>지표 의미.</b> {note.reading}</p>}
      </>}
      <details style={caption}><summary style={{ cursor: "pointer" }}>관측 범위·갱신 주기</summary>
        <div style={{ paddingTop: 10, display: "flex", flexDirection: "column", gap: 5 }}>
          <span>{spec.refresh?.publication} · {spec.refresh?.collection}</span>
          <span>확보된 백분위 표본: {focus.sampleStart ?? "—"} ~ {focus.sampleEnd ?? "—"} · {focus.sampleCount}개. {percent == null ? "백분위 계산 자료 부족" : `${focus.tenYearPercentile != null ? "10년" : "확보 기간"} 백분위 ${formatCredit(percent, "percent")}`}</span>
          {focus.latest?.publishedAt && <span>공시일 {focus.latest.publishedAt}{focus.latest.publishedAt > state.asOf ? " · 선택일 이후 공시된 관측값" : ""}</span>}
          {focus.latest?.basis && <span>기준: {focus.latest.basis}{focus.navAgeDays != null ? ` · NAV 관측 후 ${focus.navAgeDays}일` : ""}</span>}
          {[...new Set([...(spec.caveats ?? []), ...focus.notes, ...errors])].map(t => <span key={t}>{t}</span>)}
        </div>
      </details>
    </div>
  </article>;
}

export function CreditReadingGroup({ group, state, weeks, renderBankRow }: { group: typeof readingGroups[number]; state: CreditReadingState; weeks: 4 | 13; renderBankRow?: (id: string, content: ReactNode, paragraphs: ChapterParagraph[]) => ReactNode }) {
  const chapter = creditChapterForState(group.id, state, weeks);
  const unavailable = state.query.isError || state.query.data?.error || state.query.data?.configChanged;
  const bank = group.id === 'credit-bank';
  const renderChart = (id: string) => {
    const spec = indicators.find(i => i.id === id)!, result = state.data.find(i => i.id === id)!;
    const chart = <ReadingChart key={id} spec={spec} result={result} state={state} weeks={weeks} />;
    return bank && renderBankRow ? renderBankRow(id, chart, bankChartReading(id, chapter.paragraphs ?? [], state.data, state.asOf, state.years)) : chart;
  };
  if (group.id === 'credit-bonds') return <>
    <div data-bond-definition className="rounded-xl bg-[#EAF0EE] px-5 py-5 md:px-6"><p style={{ ...paragraph, fontSize: 15, whiteSpace: 'pre-line' }}>{BOND_DEFINITION}</p></div>
    {(state.query.isLoading || unavailable) && <p style={caption}>{chapter.text}</p>}
    <BondDashboard data={state.data} asOf={state.asOf} weeks={weeks} />
    {renderChart('corporate_bond_issuance')}
  </>;
  if (bank && renderBankRow) return <>
    {renderBankRow('bank-intro', <>
      <h2 style={{ fontFamily: serif, fontSize: 24, lineHeight: 1.5, margin: 0 }}>{group.question}</h2>
      <div data-bank-definition="h8" className="rounded-xl bg-[#EAF0EE] px-5 py-5 md:px-6"><p style={{ ...paragraph, fontSize: 15 }}>{BANK_DEFINITIONS.h8}</p></div>
      {(state.query.isLoading || unavailable) && <p style={caption}>{chapter.text}</p>}
    </>, [])}
    {group.ids.filter(id => id.startsWith('h8_') && id !== 'h8_large_vs_small_banks').map(renderChart)}
    {renderBankRow('sloos-intro', <div data-bank-definition="sloos" className="rounded-xl bg-[#EAF0EE] px-5 py-5 md:px-6"><p style={{ ...paragraph, fontSize: 15 }}>{BANK_DEFINITIONS.sloos}</p></div>, [])}
    {group.ids.filter(id => id.startsWith('sloos_')).map(renderChart)}
    {group.ids.filter(id => id === 'h8_large_vs_small_banks').map(renderChart)}
  </>;
  return <>
    {bank && <h2 style={{ fontFamily: serif, fontSize: 24, lineHeight: 1.5, margin: 0 }}>{group.question}</h2>}
    {bank ? <>
      <div data-bank-definition="h8" className="rounded-xl bg-[#EAF0EE] px-5 py-5 md:px-6"><p style={{ ...paragraph, fontSize: 15 }}>{BANK_DEFINITIONS.h8}</p></div>
      {group.ids.filter(id => id.startsWith('h8_') && id !== 'h8_large_vs_small_banks').map(renderChart)}
      <div data-bank-definition="sloos" className="rounded-xl bg-[#EAF0EE] px-5 py-5 md:px-6">
        <p style={{ ...paragraph, fontSize: 15 }}>{BANK_DEFINITIONS.sloos}</p>
      </div>
      {group.ids.filter(id => id.startsWith('sloos_')).map(renderChart)}
      {group.ids.filter(id => id === 'h8_large_vs_small_banks').map(renderChart)}
    </> : group.ids.filter(id => id !== 'ccc_oas').map(renderChart)}
  </>;
}

