import { bondRateDecomposition } from '@shared/credit/bond-rate-decomposition';

const treasuryColor = '#B4B2A8', premiumColor = '#D65A37';
const pp = (value: number) => `${Math.abs(value) < 0.005 ? '' : value > 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}%p`;

export function BondRateDecomposition({ result, asOf, linked = false }: { result: ReturnType<typeof bondRateDecomposition>; asOf: string; linked?: boolean }) {
  const [min, max] = result.domain;
  const position = (value: number) => (value - min) / (max - min) * 100;
  const mixed = min < 0;
  return <article data-testid="bond-rate-decomposition" className={linked ? '' : 'border-t border-[#D9D5CA] pt-6'}>
    <h3 className={linked ? 'sr-only' : 'text-lg font-semibold mb-4'}>회사채 금리 변화의 구성</h3>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] table-fixed text-[13px] tabular-nums text-right">
        <thead className="text-xs text-[#777369]"><tr className="border-b border-[#D9D5CA]">
          <th scope="col" className="py-3 pr-2 text-left font-normal w-[18%]">등급</th>
          <th scope="col" className="py-3 px-1 font-normal w-[15%]">금리 변화</th>
          <th scope="col" className="py-3 px-1 font-normal w-[19%]"><span style={{ color: treasuryColor }}>■ </span>국채 금리 몫</th>
          <th scope="col" className="py-3 px-1 font-normal w-[16%]"><span style={{ color: premiumColor }}>■ </span>가산금리 몫</th>
          <th scope="col" className="py-3 pl-3 w-[32%] font-normal"><span className="sr-only">변화분 분해 막대</span></th>
        </tr></thead>
        <tbody>{result.rows.map(row => {
          const change = row.change;
          let positive = 0, negative = 0;
          const segments = change ? [{ value: change.treasury, color: treasuryColor }, { value: change.premium, color: premiumColor }].map(segment => {
            const start = segment.value >= 0 ? positive : negative;
            if (segment.value >= 0) positive += segment.value; else negative += segment.value;
            return { ...segment, left: position(Math.min(start, start + segment.value)), width: Math.abs(segment.value) / (max - min) * 100 };
          }) : [];
          return <tr key={row.id} className="border-b border-[#E4E0D7]">
            <th scope="row" className="py-4 pr-2 text-left font-medium whitespace-nowrap">{row.label}</th>
            <td className="py-4 px-1 font-semibold whitespace-nowrap">{change ? pp(change.total) : '—'}</td>
            <td className="py-4 px-1 whitespace-nowrap">{change ? `약 ${pp(change.treasury)}` : '—'}</td>
            <td className="py-4 px-1 whitespace-nowrap">{change ? pp(change.premium) : '—'}</td>
            <td className="py-4 pl-3">{change ? <div className="relative h-5" role="img" aria-label={`${row.label}: 국채 금리 몫 약 ${pp(change.treasury)}, 가산금리 몫 ${pp(change.premium)}, 합계 ${pp(change.total)}`}>
              {segments.map((segment, index) => <div key={index} className="absolute top-0 h-full" style={{ left: `${segment.left}%`, width: `${segment.width}%`, background: segment.color }} />)}
              {mixed && <div className="absolute -top-1 h-7 border-l border-dashed border-[#777369]" style={{ left: `${position(0)}%` }} />}
            </div> : <span className="text-xs text-[#918D83]">비교 자료 부족</span>}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <div className="mt-3 space-y-1 text-xs leading-relaxed text-[#918D83]">
      <p>{result.previous} → {asOf} · 단위: %p{mixed ? ' · 0선 왼쪽은 하락, 오른쪽은 상승 기여' : ''}</p>
      {result.rows.filter(row => row.change && (row.change.from !== result.previous || row.change.to !== asOf)).map(row => <p key={row.id}>{row.name} 실제 비교: {row.change!.from} → {row.change!.to}</p>)}
      <p>국채 금리 몫 ≈ 시장금리 변화 − OAS 변화. 같은 날짜의 두 지표로 계산한 근사치이며, 국채 금리를 직접 측정한 값은 아닙니다.</p>
    </div>
  </article>;
}
