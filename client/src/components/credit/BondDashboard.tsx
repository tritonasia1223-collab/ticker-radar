import { seriesColors } from "@/lib/series-theme";
import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { bondDashboard, type BondMode } from '@shared/credit/bond-dashboard';
import type { IndicatorAnalysis } from '@shared/credit/signals';
import type { Point } from '@shared/credit/schema';
import { bondRateDecomposition } from '@shared/credit/bond-rate-decomposition';
import { BondRateDecomposition } from './BondRateDecomposition';

export function BondDashboard({ data, asOf, weeks, onAnnualChange }: { data: IndicatorAnalysis[]; asOf: string; weeks: 4 | 13; onAnnualChange?: (annual: boolean) => void }) {
  const [mode, setMode] = useState<BondMode>('yield');
  const [annual, setAnnual] = useState(false);
  const decomposition = useMemo(() => bondRateDecomposition(data, asOf, annual ? 'year' : weeks), [data, asOf, annual, weeks]);
  const dashboard = useMemo(() => { const result = bondDashboard(data, asOf, weeks, mode); return {...result, series: result.series.map(s => ({...s, color: seriesColors[s.id] ?? "var(--ink-soft)"}))}; }, [data, asOf, weeks, mode]);
  const unit = mode === 'yield' ? '%' : '%p';
  const value = (p: Point | null) => p ? `${p.value.toFixed(2)}${unit}` : '—';
  const dateLabel = (date: string) => {
    const month = Number(date.slice(5, 7)), day = Number(date.slice(8));
    return annual ? `${date.slice(0, 4)}년 ${month}월` : `${month}월 ${day <= 10 ? '초' : day <= 20 ? '중순' : '말'}`;
  };
  const changeLabel = (amount: number) => `${Math.abs(amount) < 0.005 ? '' : amount > 0 ? '+' : '−'}${Math.abs(amount).toFixed(2)}%p`;
  return <article data-bond-dashboard>
    <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
      <h3 className="text-lg font-semibold">투자 등급 별 회사채 금리</h3>
      <div className="flex gap-2" aria-label="회사채 대시보드 표시 지표">
        {([['yield', '시장금리'], ['oas', 'OAS']] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={mode === key} onClick={() => setMode(key)} className="rounded-full border px-4 py-2 text-xs" style={{ background: mode === key ? 'var(--ink)' : 'transparent', color: mode === key ? 'var(--surface)' : 'var(--ink)', borderColor: 'var(--line-soft)' }}>{label}</button>)}
      </div>
    </div>
    <div className="flex justify-end gap-2 mb-3" role="group" aria-label="회사채 금리 변화 비교 기간">
      {([false, true] as const).map(selected => <button key={String(selected)} type="button" aria-pressed={annual === selected} onClick={() => { setAnnual(selected); onAnnualChange?.(selected); }} className="rounded-full border px-4 py-2 text-xs" style={{ background: annual === selected ? 'var(--ink)' : 'transparent', color: annual === selected ? 'var(--surface)' : 'var(--ink)', borderColor: 'var(--line-soft)' }}>{selected ? '최근 1년' : `최근 ${weeks}주`}</button>)}
    </div>
    <div className="overflow-x-auto mb-7">
      <div className="min-w-[560px]">
        <table data-testid="bond-rate-flow" className="w-full table-fixed text-sm tabular-nums text-center">
          <colgroup><col style={{ width: '28%' }} /><col style={{ width: '22%' }} /><col style={{ width: '28%' }} /><col style={{ width: '22%' }} /></colgroup>
          <thead className="text-[color:var(--ink-soft)] text-xs"><tr className="border-b border-[var(--line-soft)]">
            <th scope="col" className="py-3 pr-3 font-normal text-left">{mode === 'yield' ? '회사채 시장금리' : '회사채 OAS'}</th>
            <th scope="col" className="py-3 px-2 font-normal">{dateLabel(decomposition.previous)}</th>
            <th scope="col" className="py-3 px-2 font-normal"><span className="sr-only">{mode === 'yield' ? '금리 변화' : 'OAS 변화'}</span></th>
            <th scope="col" className="py-3 px-2 font-normal">{dateLabel(asOf)}</th>
          </tr></thead>
          <tbody>{decomposition.rows.map(row => {
            const change = row.change;
            const delta = change ? mode === 'yield' ? change.total : change.premium : null;
            const before = change ? mode === 'yield' ? change.fromYield : change.fromOas : null;
            const now = change ? mode === 'yield' ? change.toYield : change.toOas : null;
            return <tr key={row.id} className="border-b border-[var(--line-soft)]">
              <th scope="row" className="text-left font-medium pr-3 py-4"><span style={{ color: row.color }}>● </span>{row.label}</th>
              <td className="px-2 py-4">{before == null ? '—' : `${before.toFixed(2)}${unit}`}{change && change.from !== decomposition.previous && <div className="text-[length:var(--font-size-10px)] text-[color:var(--ink-soft)]">{change.from}</div>}</td>
              <td className="px-3 py-3">
                <span data-bond-flow-change={row.id} className="block text-[length:var(--font-size-13px)] font-semibold mb-1" style={{ color: delta == null || Math.abs(delta) < 0.005 ? 'var(--ink-soft)' : delta > 0 ? 'var(--tone-green-700)' : 'var(--tone-red-500)' }}>{delta == null ? '비교 자료 부족' : changeLabel(delta)}</span>
                <svg viewBox="0 0 100 12" className="h-3 w-full" preserveAspectRatio="none" aria-hidden="true"><path d="M3 6 H95 M90 2 L96 6 L90 10" fill="none" stroke="var(--ink-soft)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" /></svg>
              </td>
              <td className="px-2 py-4 font-semibold">{now == null ? '—' : `${now.toFixed(2)}${unit}`}{change && change.to !== asOf && <div className="text-[length:var(--font-size-10px)] font-normal text-[color:var(--ink-soft)]">{change.to}</div>}</td>
            </tr>;
          })}</tbody>
        </table>
        <div className="relative h-14" data-testid="bond-change-connector">
          <svg viewBox="0 0 100 56" className="h-full w-full" preserveAspectRatio="none" aria-hidden="true">
            <path d={`M64 0 V23 H${mode === 'yield' ? 25.5 : 60} V54`} stroke="var(--ink-soft)" strokeWidth="1" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" fill="none" />
          </svg>
          <span className="absolute left-0 top-5 bg-[color:var(--bg)] pr-2 text-xs text-[color:var(--ink-soft)]">{mode === 'yield' ? '금리 변화의 구성' : 'OAS 변화 = 가산금리 몫'}</span>
        </div>
        <BondRateDecomposition result={decomposition} asOf={asOf} linked />
      </div>
    </div>
    <div className="rounded-xl border border-[var(--line-soft)] bg-white py-4 px-2">
      <div className="px-3 mb-3 text-xs text-[color:var(--ink-soft)]">최근 3년 · {asOf} 기준 · {mode === 'yield' ? '시장금리 (%)' : 'OAS (%p)'}</div>
      {dashboard.rows.length ? <div style={{ height: 300 }}><ResponsiveContainer width="100%" height="100%"><LineChart data={dashboard.rows} margin={{ top: 20, bottom: 8, left: 0, right: 112 }}>
        <CartesianGrid vertical={false} stroke="var(--line-soft)" />
        <XAxis dataKey="date" tickFormatter={d => String(d).slice(2, 7)} minTickGap={45} tick={{ fontSize: "var(--font-size-11)", fill: 'var(--ink-soft)' }} tickLine={false} axisLine={{ stroke: 'var(--line-soft)' }} />
        <YAxis width={42} domain={[0, 'auto']} tick={{ fontSize: "var(--font-size-11)", fill: 'var(--ink-soft)' }} tickLine={false} axisLine={false} />
        <Tooltip labelFormatter={label => String(label)} formatter={(v: number, name: string) => [`${Number(v).toFixed(2)}${unit}`, name]} contentStyle={{ border: '1px solid var(--line-soft)', borderRadius: "var(--radius-8)", fontSize: "var(--font-size-12)" }} />
        {dashboard.series.map(s => <Line key={s.id} dataKey={s.id} name={s.name} stroke={s.color} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />)}
        {dashboard.series.map(s => s.current && <ReferenceDot key={s.id} x={s.current.date} y={s.current.value} r={3} fill={s.color} stroke="var(--surface)" label={{ position: 'right', value: `${s.name} ${value(s.current)}`, fill: s.color, fontSize: "var(--font-size-11)", offset: 10 }} />)}
      </LineChart></ResponsiveContainer></div> : <p className="p-8 text-center text-sm text-[color:var(--ink-soft)]">이 기간에 표시할 자료가 없습니다.</p>}
    </div>
  </article>;
}
