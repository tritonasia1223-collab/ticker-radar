import { useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { DAY } from "@shared/credit/signals";
import { rateRows, type RateLine } from "@shared/credit/rate-comparison";
import { formatCredit } from "@shared/credit/reading";

const colors = ["#477FA3", "#B18E58", "#7B6B93"];
const caption = "text-[11px] leading-relaxed text-muted-foreground";

export function RateComparisonChart({ id, kind, rates, spread, asOf, years, weeks = 4, spreadUnit = "pp" }: {
  id: string; kind: "oas" | "difference"; rates: RateLine[]; spread: RateLine;
  asOf: string; years: number; weeks?: 4 | 13; spreadUnit?: "pp" | "bp";
}) {
  const [mode, setMode] = useState<"rates" | "spread">("rates");
  const start = new Date(Date.parse(asOf) - years * 365.25 * DAY).toISOString().slice(0, 10);
  const chart = useMemo(() => mode === "rates" ? rateRows(rates[0]?.points ?? [], kind === "difference" ? rates[1]?.points ?? [] : [], start, asOf) :
    spread.points.filter(p => p.date >= start && p.date <= asOf).map(p => ({ time: Date.parse(p.date), a: p.value * (spreadUnit === "bp" ? 100 : 1) })), [mode, rates, spread, start, asOf, kind, spreadUnit]);
  const rows = [...rates, spread];
  const active = mode === "rates" ? rates : [spread];
  const fmt = (v: number | undefined, spreadValue = false, signed = false) => spreadValue && spreadUnit === "bp" ? v == null ? "—" : `${signed && v > 0 ? "+" : ""}${Number((v * 100).toFixed(2))}bp` : formatCredit(v, spreadValue ? "pp" : "percent", signed);
  const available = chart.some(row => row.a != null || ("b" in row && row.b != null));
  return <div data-testid={`rate-chart-${id}`} className="min-w-0">
    <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label={`${id} 그래프 보기`}>
      {(["rates", "spread"] as const).map(key => <button type="button" key={key} aria-pressed={mode === key} onClick={() => setMode(key)} className={`rounded-full border px-3 py-2 text-xs ${mode === key ? "bg-[#1A1A18] text-white border-[#1A1A18]" : "border-[#D9D5CA] text-inherit"}`}>
        {key === "rates" ? kind === "oas" ? "회사채 시장금리" : "금리 함께 보기" : kind === "oas" ? "OAS 보기" : "스프레드만 보기"}
      </button>)}
    </div>
    <div className={`grid gap-3 mb-4 ${kind === "oas" ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
      {rows.map((line, index) => { const isSpread = index === rows.length - 1; const c = line.changes[weeks]; return <div key={`${line.key}-${index}`}>
        <div className={caption}><span style={{ color: isSpread ? colors[2] : colors[index] }}>● </span>{line.label}</div>
        <div className="text-xl font-semibold tabular-nums mt-1">{fmt(line.latest?.value, isSpread)}</div>
        <div className={caption}>{weeks}주 변화 {c && !c.unchangedRelease ? isSpread ? fmt(c.value, true, true) : formatCredit(c.value, "pp", true) : "비교 자료 부족"}</div>
        <div className={caption}>{line.latest?.date ?? "관측 없음"}{line.latest && (line.stale || line.errors.length > 0) ? " · 갱신 확인 필요" : ""}</div>
        {c && <div className={caption}>비교 {c.from} → {c.to}</div>}
      </div>; })}
    </div>
    <div className="rounded-xl border border-[#D9D5CA] bg-white p-3 text-[#3B3934]">
      <div className="flex flex-wrap justify-between gap-2 mb-3 text-[11px] text-[#5F5C54]">
        <span>단위: {mode === "rates" ? "%" : spreadUnit === "bp" ? "bp" : "%p"} · {asOf}까지 {years}년</span>
        <span>{active.map(l => l.label).join(" / ")}</span>
      </div>
      {available ? <div className="h-[220px]" role="img" aria-label={`${id} ${mode === "rates" ? "원금리 비교" : "스프레드"} 그래프`}><ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#E8E5DC" />
          <XAxis dataKey="time" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={v => new Date(v).toISOString().slice(2, 7)} minTickGap={45} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis width={45} domain={["auto", "auto"]} tickFormatter={v => Number(v).toLocaleString("ko-KR", { maximumFractionDigits: 2 })} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
          {mode === "spread" && <ReferenceLine y={0} stroke="#918D83" strokeDasharray="3 3" />}
          {kind === "difference" && mode === "rates" && <Area dataKey="band" type="linear" fill="#8793A3" fillOpacity={0.2} stroke="none" connectNulls={false} isAnimationActive={false} />}
          <Line dataKey="a" type="linear" stroke={mode === "spread" ? colors[2] : colors[0]} strokeWidth={2} dot={chart.length === 1} connectNulls={false} isAnimationActive={false} />
          {kind === "difference" && mode === "rates" && <Line dataKey="b" type="linear" stroke={colors[1]} strokeWidth={1.8} dot={chart.length === 1} connectNulls={false} isAnimationActive={false} />}
        </ComposedChart>
      </ResponsiveContainer></div> : <div className="py-14 text-center text-xs text-[#918D83]">선택한 기간의 {mode === "rates" ? "금리" : "스프레드"} 자료가 없습니다.</div>}
      <p className="mt-2 text-[11px] leading-relaxed text-[#918D83]">{kind === "oas" ? "시장금리: 신규 발행·차환 여건의 참고치. 기존 채무 전체의 평균 지급이자율은 아닙니다. OAS는 만기·옵션을 조정한 프리미엄으로, 특정 국채 금리와 단순 차감하지 않습니다." : `두 금리 모두 관측된 날짜만 사용합니다. 음영은 두 금리 간격입니다. 스프레드 = ${rates[0]?.label ?? "A"} − ${rates[1]?.label ?? "B"}. 간격 축소만으로 조달금리 하락을 뜻하지 않습니다.`}</p>
    </div>
    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[10px] text-muted-foreground">{rows.flatMap(l => "sources" in l ? (l as RateLine & { sources: { url?: string; label: string }[] }).sources : []).filter((s, n, all) => all.findIndex(other => other.url === s.url) === n).map(s => s.url && <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="underline">{s.label}</a>)}</div>
  </div>;
}
