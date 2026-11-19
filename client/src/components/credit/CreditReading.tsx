import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, ReferenceLine, ReferenceDot, CartesianGrid } from "recharts";
import { indicators, readingIndicators, type Indicator } from "@shared/credit/schema";
import { analyze, DAY, type IndicatorAnalysis } from "@shared/credit/signals";
import { creditSignals } from "@shared/credit/scenarios";
import { readingGroups, readingNotes, indicatorReading, formatCredit, distributionAdjusted, type CreditOutcome } from "@shared/credit/reading";

import { RateComparisonChart } from "./RateComparisonChart";
import { BondDashboard } from "./BondDashboard";
import { CpDashboard } from "./CpDashboard";
import { currentDrawdown } from "@shared/credit/drawdown";
import { BankSizeComparison } from "./BankSizeComparison";
import { NonbankLendingNote } from "./NonbankLendingNote";
import { SloosStandardsNote } from "./SloosStandardsNote";
import { BANK_DEFINITIONS, creditChapter, type ChapterReading, type ChapterParagraph } from "@shared/credit/chapter-reading";
import { chartEditorial } from "@shared/credit/chart-editorial";
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
  leveraged_loans: '참고 지표 - 레버리지론 ETF',
};
function ReadingDefinition({ id }: { id: string }) {
  const emphasis = id === 'bdc_price_to_nav' ? '평소 1배 근처인 ARCC가 1배 아래에 머물면' : null;
  return <div data-credit-definition={id} className="rounded-xl bg-[#EAF0EE] px-5 py-5 md:px-6 flex flex-col gap-4">
    {readingNotes[id].reading.split('\n').map((text, index) => <p key={index} style={{ ...paragraph, fontSize: 15 }}>{emphasis && text.includes(emphasis) ? <>{text.split(emphasis)[0]}<strong className="font-semibold">{emphasis}</strong>{text.split(emphasis)[1]}</> : text}</p>)}
  </div>;
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
  const fallback = useMemo(() => analyze(null, asOf || "2000-01-01", "observation", [...indicators, ...readingIndicators]), [asOf]);
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


function BdcQualitySnapshot({ spec, result, state }: { spec: Indicator; result: IndicatorAnalysis; state: CreditReadingState }) {
  const companyOf = (label: string) => label.split(' ')[0];
  const metricOf = (label: string) => label.slice(label.indexOf(' ') + 1);
  const companies = [...new Set(spec.chart.lines.map(line => companyOf(line.label)))];
  const metrics = [...new Set(spec.chart.lines.map(line => metricOf(line.label)))];
  return <article data-credit-reading={spec.id} id={`read-${spec.id}`} className="border-t border-[#D9D5CA] pt-6" style={{ scrollMarginTop: 20 }}>
    <div style={caption}>분기 · 최신 스냅샷</div>
    <h3 className="text-lg font-semibold mt-2 mb-5">{supportingTitles[spec.id]}</h3>
    <ReadingDefinition id={spec.id} />
    <div className="mt-5 mb-3" style={caption}>선택 주차 {state.asOf}까지의 최신 관측값</div>
    <div className="overflow-x-auto rounded-xl border border-[#D9D5CA] bg-white" data-testid="bdc-quality-snapshot">
      <table className="w-full min-w-[520px] text-sm tabular-nums">
        <thead><tr className="border-b border-[#D9D5CA] text-[#5F5C54]">
          <th scope="col" className="px-5 py-4 text-left font-medium">회사 · 기준일</th>
          {metrics.map(metric => <th key={metric} scope="col" className="px-5 py-4 text-right font-medium">{metric}</th>)}
        </tr></thead>
        <tbody>{companies.map(company => {
          const lines = result.lines.filter(line => companyOf(line.label) === company);
          const dates = [...new Set(lines.flatMap(line => line.latest ? [line.latest.date] : []))];
          const sameDate = dates.length === 1 ? dates[0] : null;
          return <tr key={company} className="border-b border-[#E8E5DC] last:border-b-0">
            <th scope="row" className="px-5 py-5 text-left font-medium">{company}<div className="mt-1 font-normal" style={caption}>{sameDate ?? (dates.length ? '항목별 기준일' : '관측 자료 없음')}</div></th>
            {metrics.map(metric => {
              const line = lines.find(item => metricOf(item.label) === metric);
              return <td key={metric} className="px-5 py-5 text-right align-top">
                <span className="text-lg font-semibold">{formatCredit(line?.latest?.value, line?.unit ?? spec.chart.unit)}</span>
                {!sameDate && line?.latest && <div className="mt-1" style={caption}>{line.latest.date}</div>}
                {!line?.latest && <div style={caption}>자료 없음</div>}
                {line?.latest && (line.stale || line.errors.length > 0) && <div style={caption}>갱신 지연·수집 상태 확인</div>}
              </td>;
            })}
          </tr>;
        })}</tbody>
      </table>
    </div>
    <p className="mt-3" style={{ ...caption, color: '#918D83' }}>PIK는 총투자수익 대비 비중입니다. ARCC·OBDC는 PIK 이자·배당, FSK는 PIK 이자만 포함합니다.</p>
    <details className="mt-4 mb-6" style={caption}><summary className="cursor-pointer">관측 기준·갱신 주기</summary>
      <div className="pt-3 space-y-2">
        <p>{spec.refresh?.publication} · {spec.refresh?.collection}</p>
        {spec.caveats?.map(text => <p key={text}>{text}</p>)}
        {result.lines.map(line => <p key={line.key}>{line.label}: {line.latest?.date ?? '자료 없음'}{line.latest?.publishedAt ? ` · 공시 ${line.latest.publishedAt}` : ''}{line.latest?.basis ? ` · ${line.latest.basis}` : ''}{line.errors.length ? ` · ${line.errors.join(' / ')}` : ''}</p>)}
      </div>
    </details>
  </article>;
}

function ReadingChart(props: { spec: Indicator; result: IndicatorAnalysis; state: CreditReadingState; weeks: 4 | 13 }) {
  const { spec, result, state, weeks } = props;
  if (spec.id === 'bdc_credit_quality') return <BdcQualitySnapshot {...props} />;
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
  const chartYears = totalIssuanceOnly ? 1 : state.years;
  const focus = result.lines.find(l => l.key === (totalIssuanceOnly ? spec.chart.lines[0]?.key : selected)) ?? result.lines[0];
  const [indexed, setIndexed] = useState(!!spec.chart.indexed);
  const adjusted = distributionAdjusted(spec);
  const note = readingNotes[spec.id];
  const interpretation = indicatorReading(spec, focus, weeks, state.outcome);
  const all = !!spec.chart.indexed || spec.chart.kind === "pnav";
  const shown = all ? result.lines : [focus];
  const start = new Date(Date.parse(state.asOf) - chartYears * 365.25 * DAY).toISOString().slice(0, 10);
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
  const leveraged = spec.id === 'leveraged_loans';
  const drawdown = leveraged && !focus.stale && !focus.errors.length ? currentDrawdown(focus.points, start, state.asOf) : null;
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
  const comparisonDate = leveraged ? drawdown?.peak.date : c?.from;
  const nowMarker = marker(focus.latest?.date), oldMarker = marker(comparisonDate);
  return <article data-credit-reading={spec.id} style={{ borderTop: `1px solid ${border}`, paddingTop: 24, scrollMarginTop: "var(--liquidity-sticky-top, 84px)" }} id={`read-${spec.id}`}>
    <div style={caption}>{supporting ? periods[spec.frequency] : `${totalIssuanceOnly ? '회사채 전체 발행액' : spec.name} · ${periods[spec.frequency]}`}</div>
    <h3 style={{ fontFamily: supporting ? undefined : serif, fontWeight: 600, fontSize: supporting ? 18 : 20, lineHeight: 1.55, margin: supporting ? '8px 0 20px' : '8px 0' }}>{supportingTitles[spec.id] ?? bankTitle ?? note.question}</h3>
    {supporting && <ReadingDefinition id={spec.id} />}
    {bankTitle && !supporting && <p style={{ ...paragraph, fontWeight: 600 }}>{bankHeadline}</p>}
    {!compact && <p style={{ ...paragraph, marginTop: 8 }}>{spec.measures}</p>}
    {!totalIssuanceOnly && result.lines.length > 1 && <div className="flex flex-wrap gap-2 mt-4" aria-label={`${spec.name} 해설 계열`}>
      {result.lines.map((l, n) => <button type="button" key={l.key} aria-pressed={focus.key === l.key} onClick={() => setSelected(l.key)} style={{ fontSize: 12, padding: "6px 10px", border: `1px solid ${focus.key === l.key ? ink : border}`, borderRadius: 20, background: focus.key === l.key ? "#E8E5DC" : "transparent", color: ink }}><span style={{ color: colors[n % colors.length] }}>● </span>{l.label}{!l.latest ? " · 자료 없음" : ""}</button>)}
    </div>}
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 mb-4">
      <div>{supporting && <div style={caption}>{result.lines.length > 1 ? focus.label : '현재'}</div>}{adjusted && <div style={caption}>분배금·분할 수정가격</div>}<strong style={{ fontSize: 22 }}>{formatCredit(focus.latest?.value, focus.unit)}</strong><div style={caption}>{focus.latest ? compact ? `(${focus.latest.date} 기준)` : `${focus.latest.date} 관측 · 선택일보다 ${focus.ageDays ?? "—"}일 전` : "선택 시점의 관측 없음"}</div></div>
      {leveraged ? <div data-testid="leveraged-drawdown">
        <span style={{ fontSize: 15, fontWeight: 600 }}>최근 {chartYears}년 고점 대비 <span style={{ color: drawdown && drawdown.percent < 0 ? '#B3402E' : undefined }}>{drawdown ? formatCredit(drawdown.percent, 'percent', true) : '비교 자료 부족'}</span></span>
        <div style={caption}>{drawdown ? `고점 ${drawdown.peak.date} → ${drawdown.latest.date}` : '고점과 최신 관측을 확인해야 낙폭을 계산할 수 있습니다.'}</div>
        <div style={caption}>{adjusted ? '분배금·분할 수정가격 기준' : '가격 기준'}{drawdown ? ` · 확보 자료 ${drawdown.sampleStart}부터` : ''}</div>
      </div> : <div><span style={{ fontSize: 15, fontWeight: 600 }}>{interpretation.label} <span style={{ color: changeColor }}>{c && !c.unchangedRelease ? formatCredit(c.value, deltaUnit, true) : c?.unchangedRelease ? "새 관측 없음" : "비교 자료 부족"}</span></span><div style={caption}>{c ? `${c.from} → ${c.to}` : "이전 관측을 확보해야 변화량을 계산할 수 있습니다."}</div></div>}
    </div>
    {(!focus.latest || focus.stale || errors.length > 0) && <p style={{ ...caption, marginBottom: 12 }} role="note">{!focus.latest ? "자료가 없어 판단에 사용하지 않습니다." : "갱신 지연 또는 수집 오류가 있어 이 계열은 변화 비교에서 제외합니다."}</p>}
    <div style={{ background: "#FFF", border: `1px solid ${border}`, borderRadius: 12, padding: "16px 8px" }}>
      <div className="flex flex-wrap justify-between gap-2 px-3 mb-3" style={caption}><span>{adjusted ? indexed ? "분배금 반영 성과 · 각 계열 첫 관측 = 100" : "분배금·분할 수정가격 · 달러" : indexed ? "각 계열 첫 관측 = 100" : `단위: ${({ billions: "십억 달러", percent: "%", pp: "%p", ratio: "배", usd: "달러" } as Record<string, string>)[spec.chart.unit] ?? spec.chart.unit}`} · {state.asOf}까지 {chartYears}년</span>{spec.chart.indexed && <button type="button" className="underline" onClick={() => setIndexed(v => !v)}>{adjusted ? indexed ? "수정가격 보기" : "분배금 반영 성과 보기" : indexed ? "실제 잔액·가격 보기" : "기준 100으로 비교"}</button>}</div>
      {totalIssuanceOnly && <p style={{ ...caption, padding: "0 12px 10px", color: "#918D83" }}>확보된 월별 자료: {chart[0]?.date ? String(chart[0].date).slice(0, 7) : "—"} ~ {chart.at(-1)?.date ? String(chart.at(-1)!.date).slice(0, 7) : "—"}{chart.length < chartYears * 12 ? " · 이전 자료 미확보" : ""}</p>}
      {chart.length ? <div style={{ height: 220 }}><ResponsiveContainer width="100%" height="100%"><LineChart data={chart} margin={{ left: 4, right: 20, top: 12, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#E8E5DC" />
        <XAxis dataKey="date" minTickGap={50} tickFormatter={d => String(d).slice(2, 7)} tick={{ fontSize: 11, fill: muted }} tickLine={false} axisLine={false} />
        <YAxis width={56} domain={["auto", "auto"]} tickFormatter={v => Number(v).toLocaleString("ko-KR", { maximumFractionDigits: 1, notation: "compact" })} tick={{ fontSize: 11, fill: muted }} tickLine={false} axisLine={false} />
        {indexed && <ReferenceLine y={100} stroke={muted} strokeDasharray="3 3" />}
        {!indexed && (spec.id.startsWith("sloos") || spec.chart.kind === "pnav") && <ReferenceLine y={spec.chart.kind === "pnav" ? 1 : 0} stroke={muted} strokeDasharray="3 3" />}
        {shown.map((l, n) => <Line key={l.key} dataKey={`v${n}`} stroke={colors[n % colors.length]} strokeWidth={l.key === focus.key ? 2.5 : 1.5} opacity={l.key === focus.key ? 1 : 0.6} dot={l.points.length === 1 ? { r: 3 } : false} type={slow ? "stepAfter" : "linear"} connectNulls={false} isAnimationActive={false} />)}
        {typeof oldMarker === "number" && comparisonDate && <ReferenceDot x={comparisonDate} y={oldMarker} r={4} fill="#FFF" stroke={ink} />}
        {typeof nowMarker === "number" && focus.latest && <ReferenceDot x={focus.latest.date} y={nowMarker} r={4} fill={ink} stroke="#FFF" />}
      </LineChart></ResponsiveContainer></div> : <div style={{ padding: 35, textAlign: "center", ...caption }}>이 기간에 표시할 자료가 없습니다.</div>}
      <div style={{ ...caption, padding: "6px 12px 0" }}>● 최신 관측 · ○ {leveraged ? '기간 내 고점' : '비교 관측'}{all ? " · 선택한 계열을 진하게 표시" : ""}{slow ? " · 새 관측 사이의 수평선은 추가 발표를 뜻하지 않습니다" : ""}</div>
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

export function CreditReadingGroup({ group, state, weeks, renderReadingRow }: { group: typeof readingGroups[number]; state: CreditReadingState; weeks: 4 | 13; renderReadingRow?: (id: string, content: ReactNode, paragraphs: ChapterParagraph[]) => ReactNode }) {
  const [bondAnnual, setBondAnnual] = useState(false);
  const chapter = creditChapterForState(group.id, state, weeks);
  const unavailable = state.query.isError || state.query.data?.error || state.query.data?.configChanged;
  const bank = group.id === 'credit-bank';
  const editorial = (id: string) => unavailable || state.query.isLoading ? [] : chartEditorial(id, state.asOf, weeks);
  const row = (id: string, content: ReactNode, paragraphs = editorial(id)) => renderReadingRow ? renderReadingRow(id, content, paragraphs) : content;
  const renderChart = (id: string) => {
    const spec = indicators.find(i => i.id === id)!, result = state.data.find(i => i.id === id)!;
    const chart = <ReadingChart key={id} spec={spec} result={result} state={state} weeks={weeks} />;
    const manual = editorial(id);
    return row(id, chart, manual.length ? manual : bank ? bankChartReading(id, chapter.paragraphs ?? [], state.data, state.asOf, state.years) : []);
  };
  if (group.id === 'credit-short') return <>
    {row('cp-intro', <div data-cp-definition className="rounded-xl bg-[#EAF0EE] px-5 py-5 md:px-6 flex flex-col gap-4">
      <p style={{ ...paragraph, fontSize: 15 }}>기업어음(CP)은 기업이 급여나 재고 대금 같은 운영자금을 몇 달간 빌리는 수단입니다. 만기가 짧아 계속 새로 빌려 갚아야 하므로, 시장이 며칠만 막혀도 멀쩡한 기업이 돈을 못 구합니다. 그래서 회사채 시장과 별개로 CP를 살펴보는 것이 좋습니다.</p>
      <p style={{ ...paragraph, fontSize: 15 }}>A2/P2 등급은 단기 신용등급에서 최상급(A1/P1) 바로 아래 등급으로, 장기 신용 등급으로 따지면 A- ~ BBB 정도의 멀쩡한 기업입니다. A2/P2 아래의 투기등급(CCC~) 부터는 기업 어음 시장에 사실상 들어오지 못해 포함하지 않습니다.</p>
    </div>, [])}
    {row('cp-dashboard', <CpDashboard data={state.data} asOf={state.asOf} />)}
  </>;
  if (group.id === 'credit-bonds') return <>
    {(state.query.isLoading || unavailable) && <p style={caption}>{chapter.text}</p>}
    {renderChart('corporate_bond_issuance')}
    {row('bond-definition', <div data-bond-definition className="rounded-xl bg-[#EAF0EE] px-5 py-5 md:px-6"><p style={{ ...paragraph, fontSize: 15, whiteSpace: 'pre-line' }}>{BOND_DEFINITION}</p></div>, [])}
    {row('bond-dashboard', <BondDashboard data={state.data} asOf={state.asOf} weeks={weeks} onAnnualChange={setBondAnnual} />, bondAnnual ? [] : editorial('bond-dashboard'))}
    {renderChart('leveraged_loans')}
  </>;
  if (bank && renderReadingRow) return <>
    {renderReadingRow('bank-intro', <>
      <h2 style={{ fontFamily: serif, fontSize: 24, lineHeight: 1.5, margin: 0 }}>{group.question}</h2>
      <div data-bank-definition="h8" className="rounded-xl bg-[#EAF0EE] px-5 py-5 md:px-6"><p style={{ ...paragraph, fontSize: 15 }}>{BANK_DEFINITIONS.h8}</p></div>
      {(state.query.isLoading || unavailable) && <p style={caption}>{chapter.text}</p>}
    </>, [])}
    {group.ids.filter(id => id.startsWith('h8_') && id !== 'h8_large_vs_small_banks').map(renderChart)}
    {renderReadingRow('sloos-intro', <div data-bank-definition="sloos" className="rounded-xl bg-[#EAF0EE] px-5 py-5 md:px-6"><p style={{ ...paragraph, fontSize: 15 }}>{BANK_DEFINITIONS.sloos}</p></div>, [])}
    {group.ids.filter(id => id.startsWith('sloos_')).map(renderChart)}
    {group.ids.filter(id => id === 'h8_large_vs_small_banks').map(renderChart)}
  </>;
  return <>
    {group.id === 'credit-fragile' && row('bdc-intro', <div data-bdc-definition className="rounded-xl bg-[#EAF0EE] px-5 py-5 md:px-6 flex flex-col gap-4">
      <p style={{ ...paragraph, fontSize: 15 }}>기업어음(CP) 시장에 들어오지 못하는 투기등급 기업의 사정은 07 회사채 챕터의 HY·CCC 회사채 금리로 확인합니다. 이 챕터는 그보다 더 안쪽, 신용등급조차 없는 중견기업을 봅니다.</p>
      <p style={{ ...paragraph, fontSize: 15 }}>이 기업들은 주가도 채권 가격도 없어서 직접 볼 방법이 없습니다. 대신 이들에게 돈을 빌려주는 BDC를 봅니다. BDC는 자산의 70% 이상을 비상장·소형 기업에 투자해야 하는 미국의 상장 투자회사로, 대출 내역과 연체 상황을 분기마다 공시합니다. 은행 연체율로 가계 사정을 가늠하듯, BDC 장부로 중견기업 사정을 가늠하는 것입니다.</p>
      <p style={{ ...paragraph, fontSize: 15 }}>여기서는 규모가 큰 상장 BDC 3곳(ARCC, OBDC, FSK)을 봅니다.</p>
    </div>, [])}
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

