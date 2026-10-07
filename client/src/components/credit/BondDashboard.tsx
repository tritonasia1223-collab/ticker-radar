import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { bondDashboard, type BondMode } from '@shared/credit/bond-dashboard';
import type { IndicatorAnalysis } from '@shared/credit/signals';
import type { Point } from '@shared/credit/schema';

export function BondDashboard({ data, asOf, weeks }: { data: IndicatorAnalysis[]; asOf: string; weeks: 4 | 13 }) {
  const [mode, setMode] = useState<BondMode>('yield');
  const dashboard = useMemo(() => bondDashboard(data, asOf, weeks, mode), [data, asOf, weeks, mode]);
  const unit = mode === 'yield' ? '%' : '%p';
  const value = (p: Point | null) => p ? `${p.value.toFixed(2)}${unit}` : '—';
  return <article data-bond-dashboard>
    <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
      <h3 className="text-lg font-semibold">투자 등급 별 회사채 금리</h3>
      <div className="flex gap-2" aria-label="회사채 대시보드 표시 지표">
        {([['yield', '시장금리'], ['oas', 'OAS']] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={mode === key} onClick={() => setMode(key)} className="rounded-full border px-4 py-2 text-xs" style={{ background: mode === key ? '#1A1A18' : 'transparent', color: mode === key ? '#FFF' : '#1A1A18', borderColor: '#D9D5CA' }}>{label}</button>)}
      </div>
    </div>
    <div className="overflow-x-auto mb-6">
      <table className="w-full text-sm text-right" style={{ minWidth: 420, fontVariantNumeric: 'tabular-nums' }}>
        <thead className="text-[#777369] text-xs"><tr>{[mode === 'yield' ? '회사채 시장금리' : '회사채 OAS', `${asOf.slice(5, 7)}월 ${asOf.slice(8)}일`, `${weeks}주 전`, '1년 전'].map((s, i) => <th key={s} className={`py-3 px-3 font-normal border-b border-[#D9D5CA] ${!i ? 'text-left' : ''}`}>{s}</th>)}</tr></thead>
        <tbody>{dashboard.series.map(s => <tr key={s.id} className="border-b border-[#E4E0D7]">
          <th className="text-left font-medium px-3 py-3"><span style={{ color: s.color }}>● </span>{s.label}</th>
          {([['current', asOf], ['previous', dashboard.previous], ['annual', dashboard.annual]] as const).map(([key, target]) => <td key={key} className={`px-3 py-3 ${key === 'current' ? 'font-semibold' : ''}`}>
            {value(s[key])}{s[key] && s[key].date !== target && <div className="text-[10px] font-normal text-[#918D83]">{s[key].date}</div>}
          </td>)}
        </tr>)}</tbody>
      </table>
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
