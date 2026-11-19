import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { netLiquidity, type Obs } from '@shared/liquidity-beta';
import type { ReadWeek } from '@shared/liquidity-read';

export function LiquidityLevels({ weeks, m2, asOf }: { weeks: ReadWeek[]; m2: Obs[]; asOf: string }) {
  const data = useMemo(() => {
    const end = Date.parse(asOf), startDate = new Date(end);
    startDate.setUTCFullYear(startDate.getUTCFullYear() - 3);
    const start = startDate.getTime();
    const points = (series: Obs[]) => series.filter(p => Number.isFinite(p.value) && Date.parse(p.date) >= start && Date.parse(p.date) <= end)
      .map(p => ({ date: p.date, time: Date.parse(p.date), value: p.value / 1_000_000 })).sort((a, b) => a.time - b.time);
    return { start, end, ticks: Array.from({ length: 7 }, (_, i) => start + (end - start) * i / 6), series: [
      { id: 'net-liquidity', name: '순유동성', frequency: '주간', color: '#1A1A18', points: points(weeks.map(w => ({ date: w.date, value: netLiquidity(w) }))) },
      { id: 'm2', name: 'M2', frequency: '월간', color: '#3E5C76', points: points(m2) },
    ] };
  }, [weeks, m2, asOf]);
  return <div className="space-y-6" data-testid="liquidity-levels">
    <p className="text-xs text-[#777369]">최근 3년 · 조 달러 · 시간축은 같고, 세로축 범위는 각각 표시</p>
    {data.series.map(series => {
      const latest = series.points.at(-1);
      return <article key={series.id} data-liquidity-level={series.id}>
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <h3 className="text-base font-semibold">{series.name} 규모</h3>
          <span className="text-xs text-[#777369]">{series.frequency}{latest ? ` · ${latest.date} 기준` : ' · 자료 없음'}</span>
        </div>
        {latest ? <div className="rounded-xl border border-[#D9D5CA] bg-white px-1 py-3" style={{ height: 250 }}>
          <ResponsiveContainer width="100%" height="100%"><LineChart data={series.points} syncId="liquidity-levels" syncMethod="value" margin={{ top: 18, right: 90, bottom: 2, left: 0 }}>
            <CartesianGrid vertical={false} stroke="#E8E5DC" />
            <XAxis dataKey="time" type="number" domain={[data.start, data.end]} ticks={data.ticks} tickFormatter={t => new Date(t).toISOString().slice(2, 7).replace('-', '.')} tick={{ fontSize: 11, fill: '#777369' }} axisLine={false} tickLine={false} />
            <YAxis width={48} domain={['auto', 'auto']} tickFormatter={v => Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 2 })} tick={{ fontSize: 11, fill: '#777369' }} axisLine={false} tickLine={false} />
            <Tooltip labelFormatter={t => new Date(Number(t)).toISOString().slice(0, 10)} formatter={(v: number) => [`${Number(v).toFixed(3)}조 달러`, series.name]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
            <Line dataKey="value" name={series.name} stroke={series.color} strokeWidth={2.2} dot={false} isAnimationActive={false} connectNulls={false} />
            <ReferenceDot x={latest.time} y={latest.value} r={3} fill={series.color} stroke="white" label={{ position: 'right', value: `${latest.value.toFixed(2)}조`, fill: series.color, fontSize: 12, offset: 8 }} />
          </LineChart></ResponsiveContainer>
        </div> : <p className="py-8 text-center text-sm text-[#777369]">이 기간에 표시할 자료가 없습니다.</p>}
      </article>;
    })}
  </div>;
}
