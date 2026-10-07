import { useQueries } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { debtWindow, type TreasuryFlow, type TreasuryFlowResponse } from '@shared/treasury-flow';

const caption = 'text-xs leading-relaxed text-[#918D83]';
const color = (v: number) => v > 0 ? '#1F7A4D' : v < 0 ? '#B3402E' : '#777369';
const number = (v: number | null | undefined, signed = false) => v == null || !Number.isFinite(v) ? '—' : `${signed && v > 0 ? '+' : ''}${Math.round(v / 100).toLocaleString('ko-KR')}`;
const tableRows: { name: string; value: (f: TreasuryFlow) => number; signed?: boolean; muted?: boolean; total?: boolean; detail?: boolean }[] = [
  { name: '발행 (+)', value: f => f.issues },
  { name: '상환 (−)', value: f => f.redemptions },
  { name: '물가 조정', value: f => f.inflation, signed: true, muted: true },
  { name: '최종 순증감', value: f => f.net, signed: true, total: true },
  { name: '단기채', value: f => f.billsNet, signed: true, detail: true },
  { name: '중장기채 등', value: f => f.net - f.billsNet, signed: true, detail: true },
];

export function TreasuryPeriodComparison({ asOf, weeks, current }: { asOf: string; weeks: 4 | 13; current: TreasuryFlow | null }) {
  const dates = [2, 1, 0].map(offset => debtWindow(asOf, weeks, offset).end);
  const previous = useQueries({ queries: dates.slice(0, 2).map(end => ({
    queryKey: ['/api/liquidity/treasury-flow', weeks, end],
    queryFn: async (): Promise<TreasuryFlowResponse> => apiRequest('GET', `/api/liquidity/treasury-flow?weeks=${weeks}&asOf=${end}`).then(r => r.json()),
    staleTime: 6 * 60 * 60 * 1000,
  })) });
  const periods = dates.map((end, index) => {
    const raw = index === 2 ? current : previous[index].data?.flow;
    const flow = raw?.end === end && raw.weeks === weeks && [raw.net, raw.billsNet, raw.issues, raw.redemptions, raw.inflation].every(Number.isFinite) ? raw : null;
    // 월 이름은 4주 구간의 가운데 날짜를 사용하고 실제 집계일을 함께 표시한다.
    const middle = new Date(Date.parse(end) - 14 * 86400000);
    const label = weeks === 4 ? `${middle.getUTCMonth() + 1}월 비교 구간` : index === 2 ? '최근 13주' : index === 1 ? '직전 13주' : '그 이전 13주';
    return { end, flow, label };
  });
  return <section data-testid="treasury-period-comparison" className="space-y-4">
    <div className="flex flex-wrap items-baseline justify-between gap-3"><h3 className="text-lg font-semibold">국채 발행·상환·순증감</h3><span className={caption}>단위: 억 달러</span></div>
    <div className="overflow-x-auto">
      <table data-testid="treasury-flow-table" className="w-full text-sm text-right" style={{ minWidth: 520, fontVariantNumeric: 'tabular-nums' }}>
        <thead><tr className="border-b border-[#D9D5CA]">
          <th scope="col" className="text-left font-normal py-4 pr-3 text-[#777369]">구분</th>
          {periods.map(p => <th scope="col" key={p.end} className="font-medium py-4 pl-3">
            {p.label}
            <div className="text-[11px] text-[#918D83] font-normal mt-1">{p.flow?.start ?? debtWindow(p.end, weeks).start}<br />~{p.end}</div>
          </th>)}
        </tr></thead>
        <tbody>{tableRows.map(row => <tr key={row.name} className={row.total ? 'border-t-2 border-[#1A1A18]' : row.detail ? '' : 'border-b border-[#E4E0D7]'}>
          <th scope="row" className={`text-left ${row.total ? 'font-semibold py-4' : row.detail ? 'font-normal py-2 pl-4 text-xs text-[#777369]' : 'font-normal py-3'} ${row.muted ? 'text-[#918D83] text-xs' : ''}`}>{row.name}</th>
          {periods.map(p => { const value = p.flow ? row.value(p.flow) : null; return <td key={p.end} className={`pl-3 ${row.total ? 'py-4 text-lg font-semibold' : row.detail ? 'py-2 text-xs' : 'py-3'} ${row.muted ? 'text-xs text-[#918D83]' : ''}`} style={{ color: row.signed && !row.muted && value != null ? color(value) : undefined }}>{number(value, row.signed)}</td>; })}
        </tr>)}</tbody>
      </table>
    </div>
    <p className={caption}>최종 순증감 = 발행 − 상환 + 물가 조정. 달력 월 전체가 아닌 연속된 {weeks}주 비교이며, 금액은 반올림했습니다.</p>
    {periods.some(p => !p.flow) && <p className={caption}>{previous.some(q => q.isLoading) ? '이전 기간 자료를 불러오는 중입니다.' : '자료가 없는 기간은 빈 값으로 표시합니다.'}</p>}
  </section>;
}
