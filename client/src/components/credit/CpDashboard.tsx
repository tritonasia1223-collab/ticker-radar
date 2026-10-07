import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { cpDashboard } from '@shared/credit/cp-dashboard';
import type { IndicatorAnalysis } from '@shared/credit/signals';

const series = [
  {key: 'bill', label: '단기국채', detail: '3개월', color: '#929188'},
  {key: 'aa', label: 'AA 등급', detail: '90일 CP', color: '#578980'},
  {key: 'a2', label: 'A2/P2 등급', detail: '90일 CP', color: '#BA7155'},
] as const;

export function CpDashboard({data, asOf}: {data: IndicatorAnalysis[]; asOf: string}) {
  const {rows, current, domain} = useMemo(() => cpDashboard(data, asOf), [data, asOf]);
  const percent = (v: number | undefined) => v == null ? '—' : `${v.toFixed(2)}%`;
  const gap = (v: number | undefined) => v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%p`;
  return <article data-cp-dashboard className="space-y-5">
    <div className="space-y-1.5">
      <h3 className="text-lg font-semibold">단기국채·CP 금리</h3>
      <p className="text-xs leading-relaxed text-[#5F5C54]">{current ? `(${current.date} 기준 · 세 금리의 최근 공통 관측일)` : '선택 시점에 함께 비교할 관측이 없습니다.'}</p>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-x-2 gap-y-3" aria-label="현재 금리와 등급 사이 스프레드">
      {series.map((s, i) => <div key={s.key} className="contents">
        {i > 0 && <div className="text-center py-2 sm:py-0" style={{color: s.color}}>
          <div className="text-[13px] font-semibold tabular-nums">{gap(i === 1 ? current?.aaSpread : current?.creditSpread)}</div>
          <div className="hidden sm:block text-lg leading-none" aria-hidden="true">→</div>
          <div className="sm:hidden text-lg leading-none" aria-hidden="true">↓</div>
          <div className="text-[10px] text-[#777369]">{i === 1 ? 'AA − T-bill' : 'A2/P2 − AA'}</div>
        </div>}
        <div className="text-center py-2">
          <div className="text-xs text-[#5F5C54]"><span style={{color:s.color}}>● </span>{s.label}</div>
          <div className="text-[22px] font-semibold tabular-nums mt-1">{percent(current?.[s.key])}</div>
          <div className="text-[11px] text-[#918D83] mt-1">{s.detail}</div>
        </div>
      </div>)}
    </div>
    <div className="rounded-xl border border-[#D9D5CA] bg-white py-4 px-2">
      <div className="px-3 mb-4 text-xs text-[#777369]">최근 3년 · {asOf}까지 · 금리 (%)</div>
      {rows.length ? <div className="h-[280px]" role="img" aria-label="최근 3년 단기국채·AA CP·A2/P2 CP 실제 금리 비교 그래프"><ResponsiveContainer width="100%" height="100%"><LineChart data={rows} margin={{top:12,right:16,left:0,bottom:4}}>
        <CartesianGrid vertical={false} stroke="#EAE7DF" />
        <XAxis dataKey="time" type="number" scale="time" domain={['dataMin','dataMax']} tickFormatter={t => new Date(t).toISOString().slice(2,7)} minTickGap={45} tick={{fontSize:11,fill:'#777369'}} tickLine={false} axisLine={false} />
        <YAxis domain={domain} width={48} tickFormatter={v => Number(v).toLocaleString('ko-KR',{maximumFractionDigits:2})} tick={{fontSize:11,fill:'#777369'}} tickLine={false} axisLine={false} />
        {series.map(s => <Line key={s.key} dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={rows.length === 1 ? {r:3} : false} connectNulls={false} isAnimationActive={false} />)}
      </LineChart></ResponsiveContainer></div> : <p className="p-8 text-center text-sm text-[#777369]">세 금리가 같은 날 관측된 자료가 없습니다.</p>}
      <p className="px-3 pt-2 text-[11px] leading-relaxed text-[#918D83]">금리 차이가 보이도록 세로축 범위를 좁혔습니다. 세로축은 0부터 시작하지 않습니다.</p>
    </div>
    <p className="text-xs leading-relaxed text-[#918D83]">같은 날짜의 관측값끼리 비교합니다. CP는 비금융기업 90일물, 단기국채는 3개월물이며 모두 할인율 기준입니다.</p>
  </article>;
}
