import { useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { DAY } from "@shared/credit/signals";
import { rateRows, type RateLine } from "@shared/credit/rate-comparison";
import { formatCredit } from "@shared/credit/reading";

const colors = ["var(--tone-blue-500)", "var(--tone-orange-500)", "var(--tone-indigo-500)"];
const caption = "text-[length:var(--font-size-11px)] leading-relaxed text-muted-foreground";

export function RateComparisonChart({ id, kind, rates, spread, asOf, years, weeks = 4, spreadUnit = "pp", showNote = true, showSources = true, compact = false, initialMode = "rates", readingLayout = false }: {
  id: string; kind: "oas" | "difference"; rates: RateLine[]; spread: RateLine;
  asOf: string; years: number; weeks?: 4 | 13; spreadUnit?: "pp" | "bp"; showNote?: boolean; showSources?: boolean; compact?: boolean; initialMode?: "rates" | "spread"; readingLayout?: boolean;
}) {
  const [mode, setMode] = useState<"rates" | "spread">(initialMode);
  const start = new Date(Date.parse(asOf) - years * 365.25 * DAY).toISOString().slice(0, 10);
  const chart = useMemo(() => mode === "rates" ? rateRows(rates[0]?.points ?? [], kind === "difference" ? rates[1]?.points ?? [] : [], start, asOf) :
    spread.points.filter(p => p.date >= start && p.date <= asOf).map(p => ({ time: Date.parse(p.date), a: p.value * (spreadUnit === "bp" ? 100 : 1) })), [mode, rates, spread, start, asOf, kind, spreadUnit]);
  const rows = [...rates, spread];
  const active = mode === "rates" ? rates : [spread];
  const fmt = (v: number | undefined, spreadValue = false, signed = false) => spreadValue && spreadUnit === "bp" ? v == null ? "—" : `${signed && v > 0 ? "+" : ""}${Number((v * 100).toFixed(2))}bp` : formatCredit(v, spreadValue ? "pp" : "percent", signed);
  const spreadChange = spread.changes[weeks];
  const changeAvailable = spreadChange && !spreadChange.unchangedRelease;
  const observationAge = spread.latest ? Math.floor((Date.parse(asOf) - Date.parse(spread.latest.date)) / DAY) : null;
  const available = chart.some(row => row.a != null || ("b" in row && row.b != null));
  return <div data-testid={`rate-chart-${id}`} className="min-w-0">
    <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label={`${id} 그래프 보기`}>
      {(["rates", "spread"] as const).map(key => <button type="button" key={key} aria-pressed={mode === key} onClick={() => setMode(key)} className={`rounded-full border px-3 py-2 text-xs ${mode === key ? "bg-[color:var(--ink)] text-white border-[color:var(--ink)]" : "border-[var(--line-soft)] text-inherit"}`}>
        {key === "rates" ? kind === "oas" ? "회사채 시장금리" : "금리 함께 보기" : kind === "oas" ? "OAS 보기" : "스프레드만 보기"}
      </button>)}
    </div>
    {readingLayout ? <>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <div className="text-xs leading-relaxed text-[color:var(--ink-soft)]">스프레드</div>
          <div className="text-[length:var(--font-size-22px)] font-semibold tabular-nums">{fmt(spread.latest?.value, true)}</div>
          <div className="text-xs leading-relaxed text-[color:var(--ink-soft)]">{spread.latest ? `(${spread.latest.date} 기준)` : '관측 없음'}</div>
        </div>
        <div>
          <div className="text-[length:var(--font-size-15px)] font-semibold">{weeks}주 비교 <span className="tabular-nums" style={{ color: changeAvailable ? spreadChange.value > 0 ? 'var(--tone-green-700)' : spreadChange.value < 0 ? 'var(--tone-red-500)' : undefined : undefined }}>{changeAvailable ? fmt(spreadChange.value, true, true) : '비교 자료 부족'}</span></div>
          {spreadChange && <div className="text-xs leading-relaxed text-[color:var(--ink-soft)]">{spreadChange.from} → {spreadChange.to}</div>}
        </div>
      </div>
      {(spread.errors.length > 0 || spread.stale) && <p className="text-xs leading-relaxed text-[color:var(--ink-soft)] mb-4">{spread.errors.length ? '수집 상태 확인 필요 · 마지막 유효 관측을 표시합니다.' : observationAge != null ? `최근 공통 관측은 선택일보다 ${observationAge}일 전입니다.` : '공통 관측 자료가 없습니다.'}</p>}
    </> : <div className={`grid gap-3 mb-4 ${kind === "oas" ? "grid-cols-2" : "grid-cols-3"}`}>
      {rows.map((line, index) => { const isSpread = index === rows.length - 1; const c = line.changes[weeks]; return <div key={`${line.key}-${index}`}>
        <div className={caption}><span style={{ color: isSpread ? colors[2] : colors[index] }}>● </span>{line.label}</div>
        <div className="text-xl font-semibold tabular-nums mt-1">{fmt(line.latest?.value, isSpread)}</div>
        <div className={caption}>{line.latest ? compact ? `(${line.latest.date} 기준)` : line.latest.date : "관측 없음"}{line.latest && (line.stale || line.errors.length > 0) ? " · 갱신 확인 필요" : ""}</div>
        <div className={compact ? "text-sm mt-2 font-medium" : caption}>{weeks}주 {compact ? "비교" : "변화"} <span style={{ color: compact && c && !line.stale && !line.errors.length && !c.unchangedRelease ? c.value > 0 ? 'var(--tone-green-700)' : c.value < 0 ? 'var(--tone-red-500)' : undefined : undefined }}>{c && !c.unchangedRelease ? isSpread ? fmt(c.value, true, true) : formatCredit(c.value, "pp", true) : "비교 자료 부족"}</span></div>
        {c && <div className={caption}>비교 {c.from} → {c.to}</div>}
      </div>; })}
    </div>}
    <div className="rounded-xl border border-[color:var(--line-soft)] bg-white p-3 text-[color:var(--ink)]">
      <div className="flex flex-wrap justify-between gap-2 mb-3 text-[length:var(--font-size-11px)] text-[color:var(--ink-soft)]">
        <span>단위: {mode === "rates" ? "%" : spreadUnit === "bp" ? "bp" : "%p"} · {asOf}까지 {years}년</span>
        {!readingLayout && <span>{active.map(l => l.label).join(" / ")}</span>}
        {readingLayout && <span>{mode === 'spread' ? '스프레드' : '원금리 비교'}</span>}
      </div>
      {readingLayout && mode === 'rates' && <div className="flex flex-wrap gap-x-5 gap-y-2 px-1 mb-3 text-xs text-[color:var(--ink-soft)]">{rates.map((line, index) => <span key={line.key}><span style={{ color: colors[index] }}>● </span>{line.label} <span className="font-medium tabular-nums">{fmt(line.latest?.value)}</span></span>)}</div>}
      {available ? <div className="h-[220px]" role="img" aria-label={`${id} ${mode === "rates" ? "원금리 비교" : "스프레드"} 그래프`}><ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--line-soft)" />
          <XAxis dataKey="time" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={v => new Date(v).toISOString().slice(2, 7)} minTickGap={45} tick={{ fontSize: "var(--font-size-10)" }} axisLine={false} tickLine={false} />
          <YAxis width={45} domain={["auto", "auto"]} tickFormatter={v => Number(v).toLocaleString("ko-KR", { maximumFractionDigits: 2 })} tick={{ fontSize: "var(--font-size-10)" }} axisLine={false} tickLine={false} />
          {mode === "spread" && <ReferenceLine y={0} stroke="var(--ink-soft)" strokeDasharray="3 3" />}
          {kind === "difference" && mode === "rates" && <Area dataKey="band" type="linear" fill="var(--tone-blue-400)" fillOpacity={0.2} stroke="none" connectNulls={false} isAnimationActive={false} />}
          <Line dataKey="a" type="linear" stroke={mode === "spread" ? colors[2] : colors[0]} strokeWidth={2} dot={chart.length === 1} connectNulls={false} isAnimationActive={false} />
          {kind === "difference" && mode === "rates" && <Line dataKey="b" type="linear" stroke={colors[1]} strokeWidth={1.8} dot={chart.length === 1} connectNulls={false} isAnimationActive={false} />}
        </ComposedChart>
      </ResponsiveContainer></div> : <div className="py-14 text-center text-xs text-[color:var(--ink-soft)]">선택한 기간의 {mode === "rates" ? "금리" : "스프레드"} 자료가 없습니다.</div>}
      {showNote && <p className="mt-2 text-[length:var(--font-size-11px)] leading-relaxed text-[color:var(--ink-soft)]">{kind === "oas" ? "시장금리: 신규 발행·차환 여건의 참고치. 기존 채무 전체의 평균 지급이자율은 아닙니다. OAS는 만기·옵션을 조정한 프리미엄으로, 특정 국채 금리와 단순 차감하지 않습니다." : `두 금리 모두 관측된 날짜만 사용합니다. 음영은 두 금리 간격입니다. 스프레드 = ${rates[0]?.label ?? "A"} − ${rates[1]?.label ?? "B"}. 간격 축소만으로 조달금리 하락을 뜻하지 않습니다.`}</p>}
    </div>
    {showSources && <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[length:var(--font-size-10px)] text-muted-foreground">{rows.flatMap(l => "sources" in l ? (l as RateLine & { sources: { url?: string; label: string }[] }).sources : []).filter((s, n, all) => all.findIndex(other => other.url === s.url) === n).map(s => s.url && <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="underline">{s.label}</a>)}</div>}
  </div>;
}
