import { whereFrom, whereTo, type ReadWeek } from '@shared/liquidity-read';
import { weeksBefore } from '@shared/time-series';
import { fmt } from '@shared/liquidity-sentences';

const green = '#1F7A4D', red = '#B3402E';
type Bar = { name: string; value: number; total?: boolean };
const color = (value: number) => fmt.isZeroEok(value) ? '#777369' : value > 0 ? green : red;
const amount = (value: number) => `${fmt.signedEok(value)} 달러`;
const change = (value: number) => fmt.isZeroEok(value) ? '거의 변하지 않았습니다' : `${fmt.eok(value)}억 달러 ${value > 0 ? '늘었습니다' : '줄었습니다'}`;

function VerticalContributions({ rows, limit, label, bandId }: { rows: Bar[]; limit: number; label: string; bandId: string }) {
  const left = 48, right = 410, zero = 150, halfHeight = 112;
  const step = (328 - left) / (rows.length - 1);
  const y = (value: number) => zero - value / limit * halfHeight;
  return <svg viewBox="0 0 420 314" className="w-full overflow-visible" role="img" aria-label={`${label}: ${rows.map(row => `${row.name} ${amount(row.value)}`).join(', ')}`}>
    <rect data-total-band={bandId} x={332} y={24} width={76} height={288} rx={10} fill="rgba(148, 133, 68, 0.09)" className="md:fill-transparent" />
    <text x={left} y={14} fill="#918D83" fontSize={11}>단위: 억 달러</text>
    {[-1, -0.5, 0, 0.5, 1].map(factor => <g key={factor}>
      <line x1={left} x2={right} y1={y(limit * factor)} y2={y(limit * factor)} stroke={factor === 0 ? '#777369' : '#E4E0D7'} strokeDasharray={factor === 0 ? '4 3' : undefined} />
      <text x={left - 8} y={y(limit * factor) + 4} textAnchor="end" fill="#918D83" fontSize={11}>{Math.round(limit * factor / 100).toLocaleString('ko-KR')}</text>
    </g>)}
    {rows.map((row, index) => {
      const x = row.total ? 370 : left + step * (index + 0.5), end = y(row.value);
      return <g key={row.name}>
        <rect x={x - 23} y={Math.min(zero, end)} width={46} height={Math.max(Math.abs(end - zero), 1)} fill={color(row.value)} rx={3} opacity={row.total ? 1 : 0.82} />
        <text x={x} y={row.value >= 0 ? end - 8 : end + 17} textAnchor="middle" fill={color(row.value)} fontWeight={600} fontSize={13}>{fmt.signedEok(row.value)}</text>
        <text x={x} y={301} textAnchor="middle" fill="#3B3934" fontSize={13} fontWeight={row.total ? 600 : 400}>{row.name}</text>
      </g>;
    })}
  </svg>;
}

export function LiquidityPeriodPanels({ weeks, selected, kind, dominantShare }: { weeks: ReadWeek[]; selected: ReadWeek | null; kind: 'source' | 'destination'; dominantShare: number }) {
  const periods = ([4, 13] as const).map(count => {
    const previous = selected ? weeksBefore(weeks, selected.date, count) : undefined;
    const source = selected && previous ? whereFrom(previous, selected, dominantShare) : null;
    const destination = selected && previous ? whereTo(previous, selected, [], [], null) : null;
    const rows: Bar[] = kind === 'source' && source ? [
      ...(['tga', 'fed', 'rrp'] as const).map(key => ({ name: key === 'tga' ? '재무부' : key === 'fed' ? '연준' : '역레포', value: source.contributions.find(row => row.key === key)!.effect })),
      { name: '합계', value: source.dNl, total: true },
    ] : destination ? [
      { name: '지급준비금', value: destination.dReserves }, { name: '현금·기타', value: destination.dOther }, { name: '합계', value: destination.dNl, total: true },
    ] : [];
    return { count, previous, source, destination, rows: rows.every(row => Number.isFinite(row.value)) ? rows : [] };
  });
  const max = Math.max(100, ...periods.flatMap(period => [
    ...(period.source?.contributions.map(row => row.effect) ?? []),
    period.source?.dNl, period.destination?.dReserves, period.destination?.dOther,
  ].filter((value): value is number => value != null && Number.isFinite(value)).map(Math.abs)));
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const limit = Math.ceil(max / magnitude) * magnitude;
  return <div data-testid={`${kind}-period-panels`}>
    <p className="mb-5 text-xs leading-relaxed text-[#918D83]">{kind === 'source' ? '순유동성에 준 영향' : '순유동성 변화가 반영된 항목'} · <span style={{ color: green }}>초록 +</span> / <span style={{ color: red }}>빨강 −</span> · 두 그래프는 같은 눈금</p>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-y-8 md:gap-x-8">
      {periods.map(period => <section key={period.count} data-testid={`${kind}-${period.count}-weeks`} className="min-w-0">
        <h3 className="text-lg font-semibold">최근 {period.count === 4 ? '한 달(4주)' : '한 분기(13주)'}</h3>
        <p className="mt-1 text-xs text-[#918D83]">{period.previous?.date ?? '비교일 자료 없음'} → {selected?.date ?? '—'}</p>
        {period.rows.length && period.source && period.destination ? <>
          <p className="mt-4 mb-4 text-[17px] leading-relaxed md:min-h-[56px]" style={{ fontFamily: "'Noto Serif KR', serif" }}>
            {kind === 'source' ? <>순유동성이 <strong style={{ color: color(period.source.dNl) }}>{change(period.source.dNl)}</strong>.</> : <>지급준비금은 <strong style={{ color: color(period.destination.dReserves) }}>{change(period.destination.dReserves)}</strong>.</>}
          </p>
          <VerticalContributions rows={period.rows} limit={limit} bandId={`${kind}-${period.count}`} label={`${period.count}주 ${kind === 'source' ? '유동성 원인' : '유동성 반영 항목'}`} />
          {kind === 'source' && period.previous && selected && <div className="mt-4 space-y-2 text-xs leading-relaxed text-[#777369]">
            <p>TGA 잔액 {fmt.eok(period.previous.tga)}억 → {fmt.eok(selected.tga)}억</p>
            <p>연준 자산: {period.source.fedDetail.map(item => `${item.label} ${fmt.signedEok(item.value)}`).join(' · ')}</p>
            <p>역레포 잔액 {fmt.eok(period.previous.rrp)}억 → {fmt.eok(selected.rrp)}억</p>
          </div>}
        </> : <p className="mt-6 text-sm text-[#777369]">{period.count}주 전 관측 자료가 없어 비교하지 않았습니다.</p>}
      </section>)}
    </div>
  </div>;
}
