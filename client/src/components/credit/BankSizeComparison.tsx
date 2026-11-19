import { useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Indicator } from '@shared/credit/schema';
import type { IndicatorAnalysis, LineAnalysis } from '@shared/credit/signals';
import { bankComparison } from '@shared/credit/bank-comparison';
import { formatCredit } from '@shared/credit/reading';
import type { CreditReadingState } from './CreditReading';

const blue='#3E5C76', ochre='#B18E58', muted='#918D83';
const number=(v:number)=>v.toLocaleString('ko-KR',{maximumFractionDigits:1});
function BankPair({title,lines,state,weeks,indexed}:{title:string;lines:LineAnalysis[];state:CreditReadingState;weeks:4|13;indexed:boolean}) {
  const [large,small]=lines;
  const chart=bankComparison(large?.points??[],small?.points??[],state.asOf,state.years,indexed);
  return <section className="min-w-0" aria-label={`${title} 대형·소형은행 비교`}>
    <h4 className="text-base font-semibold mb-4">{title}</h4>
    <div className="grid grid-cols-2 gap-3 mb-4">
      {lines.map((line,i)=>{const c=line.changes[weeks], valid=!!line.latest&&!line.stale&&!line.errors.length&&c&&!c.unchangedRelease&&Number.isFinite(c.value);return <div key={line.key} className="min-w-0">
        <p className="text-xs mb-1" style={{color:i===0?blue:ochre}}>● {i===0?'대형은행':'소형은행'}</p>
        <strong className="text-lg font-semibold tabular-nums">{formatCredit(line.latest?.value,line.unit)}</strong>
        <p className="text-xs text-[#918D83]">{line.latest?`(${line.latest.date} 기준)`:'관측 없음'}</p>
        <p className="text-xs mt-2">{weeks}주 비교 <span style={{color:valid?(c.value>0?'#1F7A4D':c.value<0?'#B3402E':undefined):muted}}>{valid?formatCredit(c.value,line.unit,true):'비교 자료 부족'}</span></p>
        {c&&<p className="text-[11px] text-[#918D83]">{c.from} → {c.to}</p>}
      </div>;})}
    </div>
    <div className="rounded-xl border border-[#D9D5CA] bg-white px-2 py-4">
      <p className="text-[11px] text-[#918D83] px-2 mb-3">{indexed?chart.base?`${chart.base} = 100 · 두 은행군의 출발점 통일`:'공통 기준일 자료 없음':'단위: 십억 달러'} · 최근 {state.years}년</p>
      <div className="h-[240px]" role="img" aria-label={`${title} 대형은행·소형은행 두 선 비교`}>
        {chart.rows.length?<ResponsiveContainer width="100%" height="100%"><LineChart data={chart.rows} margin={{top:8,right:12,left:0,bottom:0}}>
          <CartesianGrid vertical={false} stroke="#E8E5DC"/>
          <XAxis dataKey="date" tickFormatter={v=>String(v).slice(2,7)} minTickGap={40} tick={{fontSize:10}} tickLine={false} axisLine={false}/>
          <YAxis width={42} domain={['auto','auto']} tickFormatter={number} tick={{fontSize:10}} tickLine={false} axisLine={false}/>
          {indexed&&<ReferenceLine y={100} stroke={muted} strokeDasharray="3 3"/>}
          <Tooltip formatter={(v:number,name:string)=>[`${number(v)}${indexed?'':' 십억 달러'}`,name]} contentStyle={{fontSize:12,borderColor:'#D9D5CA'}}/>
          <Line dataKey="large" name="대형은행" stroke={blue} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false}/>
          <Line dataKey="small" name="소형은행" stroke={ochre} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false}/>
        </LineChart></ResponsiveContainer>:<p className="py-20 text-center text-xs text-[#918D83]">비교할 자료가 없습니다.</p>}
      </div>
    </div>
  </section>;
}

export function BankSizeComparison({spec,result,state,weeks}:{spec:Indicator;result:IndicatorAnalysis;state:CreditReadingState;weeks:4|13}) {
  const [indexed,setIndexed]=useState(true);
  const linesFor=(kind:string)=>spec.chart.lines.filter(l=>l.label.endsWith(kind)).flatMap(l=>{const found=result.lines.find(r=>r.key===l.key);return found?[found]:[];});
  return <article id={`read-${spec.id}`} data-credit-reading={spec.id} className="border-t border-[#D9D5CA] pt-6" style={{scrollMarginTop:'var(--liquidity-sticky-top, 84px)'}}>
    <div className="text-xs text-[#5F5C54]">{spec.name} · 주간</div>
    <div className="flex flex-wrap justify-between items-center gap-3 my-3">
      <h3 style={{fontFamily:"'Noto Serif KR', serif",fontSize:20,lineHeight:1.55}}>참고 지표 - H.8 대형·소형은행 대출·예금</h3>
      <button className="text-xs underline text-[#5F5C54]" onClick={()=>setIndexed(v=>!v)}>{indexed?'실제 잔액 보기':'기준 100으로 비교'}</button>
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6" data-testid="bank-size-pairs">
      <BankPair title="예금" lines={linesFor('예금')} state={state} weeks={weeks} indexed={indexed}/>
      <BankPair title="대출·리스" lines={linesFor('대출·리스')} state={state} weeks={weeks} indexed={indexed}/>
    </div>
    <div className="mt-5 space-y-3 text-sm leading-[1.85] text-[#3B3934]" data-testid="bank-size-explanation">
      <p>이 그래프는 은행 대출의 양을 보는 지표가 아닌, 은행 대출이 어디서 막혔는지를 확인하는 참고 지표입니다. 중요한 것은 <strong className="font-semibold">소형은행 선이 대형은행 선에서 떨어져 나가는지 여부</strong>입니다. 해석 방식은 다음과 같습니다.</p>
      <p><strong className="font-semibold">예금 선은 돈이 은행에 머무는지를 봅니다.</strong> 소형은행 예금만 꺾이고 대형은행 예금이 늘면, 돈이 작은 은행에서 큰 은행으로 도망가는 중입니다. 2023년 지역은행 사태가 이 모양이었습니다.</p>
      <p><strong className="font-semibold">대출 선은 은행이 돈을 내줄 여력이 있는지를 봅니다.</strong> 소형은행 대출만 둔해지면 지역 중소기업과 상업용 부동산 쪽 돈줄이 먼저 마릅니다. 이쪽 대출은 소형은행 비중이 높기 때문입니다.</p>
    </div>
    <details className="my-5 text-xs leading-relaxed text-[#918D83]"><summary className="cursor-pointer">관측 범위·갱신 주기</summary><div className="pt-2 space-y-2">
      <p>{spec.refresh?.publication} · {spec.refresh?.collection}</p>
      {result.lines.map(l=><p key={l.key}>{l.label}: {l.sampleStart??'—'} ~ {l.sampleEnd??'—'} · {l.sampleCount}개 관측{l.stale?' · 갱신 확인 필요':''}{l.errors.length?` · ${l.errors.join(' / ')}`:''}</p>)}
      {spec.caveats?.map(c=><p key={c}>{c}</p>)}
    </div></details>
  </article>;
}
