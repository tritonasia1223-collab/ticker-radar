import { facilityAmount, type FedFacilities } from "@shared/fed-facilities";

export function FedFacilitiesBreakdown({ data, weeks }: { data: FedFacilities; weeks: 4 | 13 }) {
  const rows = [...data.rows].sort((a,b) => (b.value ?? -1)-(a.value ?? -1));
  const number = (v: number | null) => v == null ? "자료 없음" : facilityAmount(v);
  const color = (v: number | null) => v == null || v === 0 ? '#5F5C54' : v>0?'#1F7A4D':'#B3402E';
  return <div className="pt-1" aria-label="연준 대출·레포·스왑 구성" data-testid="fed-facilities-breakdown">
    <div className="overflow-x-auto">
      <table className="w-full text-xs text-[#5F5C54]" style={{minWidth:360}}>
        <thead className="text-[#918D83]"><tr className="border-b border-[#D9D5CA]"><th className="pb-2 text-left font-normal">구성별 내역</th><th className="pb-2 text-right font-normal">현재 잔액</th><th className="pb-2 text-right font-normal">{weeks}주 증감</th></tr></thead>
        <tbody>{rows.map(r=><tr key={r.key} className="border-b border-[#D9D5CA] align-top">
          <th className="py-2.5 pr-4 text-left font-normal"><span className="inline-block w-2 h-2 mr-2 rounded-sm" style={{background:r.color}} />{r.label}</th>
          <td className="py-2.5 pr-3 text-right whitespace-nowrap tabular-nums">{number(r.value)}</td>
          <td className="py-2.5 text-right whitespace-nowrap tabular-nums" style={{color:color(r.change)}}>{r.change == null ? "비교 불가" : facilityAmount(r.change,true)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="mt-3 text-xs leading-relaxed text-[#918D83]">수요일 잔액 기준 · 신규 대출 총액 아님{!data.includesBtfp ? ' · BTFP 제외 (선택 시점 관측 없음)' : ''}</p>
    <details className="mt-3 text-xs leading-relaxed text-[#918D83]"><summary className="cursor-pointer">창구별 설명·집계 범위</summary>
      {rows.map(r=><p key={r.key} className="mt-2">{r.label}: {r.description}</p>)}
      <p className="mt-2">비교 관측: {data.previousDate ?? '자료 없음'} → {data.currentDate ?? '자료 없음'}. 과거 막대와 증감도 선택 시점과 같은 창구 구성으로 계산합니다. 구성 자료가 없는 주는 0으로 채우지 않고 비워둡니다.</p>
      <p className="mt-2">연준 H.4.1의 선택 계열을 합한 값입니다. 연준의 모든 대출·지원제도를 포함하지 않으며, 레포·스왑 이용 증가만으로 비상 상황을 뜻하지 않습니다. 레포 합계만으로 국내 SRF와 해외 통화당국 대상 거래의 비중을 구분할 수 없습니다.</p>
    </details>
  </div>;
}
