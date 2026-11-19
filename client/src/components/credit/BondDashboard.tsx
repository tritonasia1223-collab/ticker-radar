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
  const dashboard = useMemo(() => bondDashboard(data, asOf, weeks, mode), [data, asOf, weeks, mode]);
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
        {([['yield', '시장금리'], ['oas', 'OAS']] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={mode === key} onClick={() => setMode(key)} className="rounded-full border px-4 py-2 text-xs" style={{ background: mode === key ? '#1A1A18' : 'transparent', color: mode === key ? '#FFF' : '#1A1A18', borderColor: '#D9D5CA' }}>{label}</button>)}
      </div>
    </div>
    <div className="flex justify-end gap-2 mb-3" role="group" aria-label="회사채 금리 변화 비교 기간">
      {([false, true] as const).map(selected => <button key={String(selected)} type="button" aria-pressed={annual === selected} onClick={() => { setAnnual(selected); onAnnualChange?.(selected); }} className="rounded-full border px-4 py-2 text-xs" style={{ background: annual === selected ? '#1A1A18' : 'transparent', color: annual === selected ? '#FFF' : '#1A1A18', borderColor: '#D9D5CA' }}>{selected ? '최근 1년' : `최근 ${weeks}주`}</button>)}
    </div>
    <div className="overflow-x-auto mb-7">
      <div className="min-w-[560px]">
        <table data-testid="bond-rate-flow" className="w-full table-fixed text-sm tabular-nums text-center">
          <colgroup><col style={{ width: '28%' }} /><col style={{ width: '22%' }} /><col style={{ width: '28%' }} /><col style={{ width: '22%' }} /></colgroup>
          <thead className="text-[#777369] text-xs"><tr className="border-b border-[#D9D5CA]">
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
            return <tr key={row.id} className="border-b border-[#E4E0D7]">
              <th scope="row" className="text-left font-medium pr-3 py-4"><span style={{ color: row.color }}>● </span>{row.label}</th>
              <td className="px-2 py-4">{before == null ? '—' : `${before.toFixed(2)}${unit}`}{change && change.from !== decomposition.previous && <div className="text-[10px] text-[#918D83]">{change.from}</div>}</td>
              <td className="px-3 py-3">
                <span data-bond-flow-change={row.id} className="block text-[13px] font-semibold mb-1" style={{ color: delta == null || Math.abs(delta) < 0.005 ? '#777369' : delta > 0 ? '#1F7A4D' : '#B3402E' }}>{delta == null ? '비교 자료 부족' : changeLabel(delta)}</span>
                <svg viewBox="0 0 100 12" className="h-3 w-full" preserveAspectRatio="none" aria-hidden="true"><path d="M3 6 H95 M90 2 L96 6 L90 10" fill="none" stroke="#A7A298" strokeWidth="1.2" vectorEffect="non-scaling-stroke" /></svg>
              </td>
              <td className="px-2 py-4 font-semibold">{now == null ? '—' : `${now.toFixed(2)}${unit}`}{change && change.to !== asOf && <div className="text-[10px] font-normal text-[#918D83]">{change.to}</div>}</td>
            </tr>;
          })}</tbody>
        </table>
        <div className="relative h-14" data-testid="bond-change-connector">
          <svg viewBox="0 0 100 56" className="h-full w-full" preserveAspectRatio="none" aria-hidden="true">
            <path d={`M64 0 V23 H${mode === 'yield' ? 25.5 : 60} V54`} stroke="#A7A298" strokeWidth="1" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" fill="none" />
          </svg>
          <span className="absolute left-0 top-5 bg-[#F6F4EE] pr-2 text-xs text-[#777369]">{mode === 'yield' ? '금리 변화의 구성' : 'OAS 변화 = 가산금리 몫'}</span>
        </div>
        <BondRateDecomposition result={decomposition} asOf={asOf} linked />
      </div>
    </div>
    <div className="rounded-xl border border-[#D9D5CA] bg-white py-4 px-2">
      <div className="px-3 mb-3 text-xs text-[#777369]">최근 3년 · {asOf} 기준 · {mode === 'yield' ? '시장금리 (%)' : 'OAS (%p)'}</div>
      {dashboard.rows.length ? <div style={{ height: 300 }}><ResponsiveContainer width="100%" height="100%"><LineChart data={dashboard.rows} margin={{ top: 20, bottom: 8, left: 0, right: 112 }}>
        <CartesianGrid vertical={false} stroke="#EAE7DF" />
        <XAxis dataKey="date" tickFormatter={d => String(d).slice(2, 7)} minTickGap={45} tick={{ fontSize: 11, fill: '#777369' }} tickLine={false} axisLine={{ stroke: '#D9D5CA' }} />
        <YAxis width={42} domain={[0, 'auto']} tick={{ fontSize: 11, fill: '#777369' }} tickLine={false} axisLine={false} />
        <Tooltip labelFormatter={label => String(label)} formatter={(v: number, name: string) => [`${Number(v).toFixed(2)}${unit}`, name]} contentStyle={{ border: '1px solid #D9D5CA', borderRadius: 8, fontSize: 12 }} />
        {dashboard.series.map(s => <Line key={s.id} dataKey={s.id} name={s.name} stroke={s.color} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />)}
        {dashboard.series.map(s => s.current && <ReferenceDot key={s.id} x={s.current.date} y={s.current.value} r={3} fill={s.color} stroke="white" label={{ position: 'right', value: `${s.name} ${value(s.current)}`, fill: s.color, fontSize: 11, offset: 10 }} />)}
      </LineChart></ResponsiveContainer></div> : <p className="p-8 text-center text-sm text-[#777369]">이 기간에 표시할 자료가 없습니다.</p>}
    </div>
  </article>;
}
