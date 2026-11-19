import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Obs } from "@shared/liquidity-beta";
import type { ReadWeek } from "@shared/liquidity-read";
import { observedNumber, type ObservedComparison } from "@shared/observed-comparison";
import { facilityAmount, facilityHistory, type FedFacilities } from "@shared/fed-facilities";
import { FUNDING_DEFINITIONS } from "@shared/funding-definitions";
import { FedFacilitiesBreakdown } from "./FedFacilitiesBreakdown";

const tick = (v: number) => new Date(v).toISOString().slice(2,7);
const dateLabel = (v: unknown) => new Date(Number(v)).toISOString().slice(0,10);
const num = (v: number) => v.toLocaleString("ko-KR", {maximumFractionDigits:2});
const frame = "rounded-xl border border-[#D9D5CA] bg-white p-4";
const definition = "rounded-xl bg-[#EAF0EE] px-5 py-5 md:px-6 text-[15px] leading-[1.8] text-[#3B3934]";
const caption = "text-xs leading-relaxed text-[#918D83]";

function ReadingValue({ value, change, date, previousDate, weeks }: {value:string;change:string;date?:string|null;previousDate?:string|null;weeks:4|13}) {
  return <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
    <div><span className="text-xs text-[#5F5C54] mr-2">현재</span><strong className="text-xl font-semibold tabular-nums">{value}</strong></div>
    <span className="text-sm">{weeks}주 변화 <span className="font-medium">{change}</span></span>
    <p className={`${caption} w-full`}>{previousDate && date ? `${previousDate} → ${date}` : date ?? '관측 없음'}</p>
  </div>;
}

export function NfciHistoryChart({points,stats,asOf,weeks}:{points:Obs[];stats:ObservedComparison;asOf:string;weeks:4|13}) {
  const start=Date.parse(asOf)-3*365.25*86400000;
  const series=points.filter(p=>p.date<=asOf && Date.parse(p.date)>=start).sort((a,b)=>a.date.localeCompare(b.date)).map(p=>({time:Date.parse(p.date),value:Number.isFinite(p.value)?p.value:null}));
  const now=stats.current;
  return <section data-testid="nfci-history" className="space-y-5 py-6 border-t border-[#D9D5CA]">
    <h3 className="text-sm font-semibold">NFCI 지수</h3>
    <p data-funding-definition="nfci" className={definition}>{FUNDING_DEFINITIONS.nfci}</p>
    <ReadingValue value={now?num(now.value):'자료 없음'} change={stats.change==null?'비교 불가':observedNumber(stats.change,'index',true)} date={now?.date} previousDate={stats.previous?.date} weeks={weeks}/>
    <div className={frame}>
      <p className={`${caption} mb-3`}>최근 3년 · 0 = 장기 평균</p>
      <div className="h-[250px]" role="img" aria-label="최근 3년 NFCI 추이와 장기 평균 0선">
        {series.some(p=>p.value!=null)?<ResponsiveContainer width="100%" height="100%"><LineChart data={series} margin={{top:20,right:24,left:0,bottom:0}}>
          <CartesianGrid vertical={false} stroke="#E8E5DC"/>
          <XAxis dataKey="time" type="number" scale="time" domain={['dataMin','dataMax']} tickFormatter={tick} minTickGap={48} tick={{fontSize:11}} axisLine={false} tickLine={false}/>
          <YAxis width={46} domain={[(min:number)=>Math.min(min,0),(max:number)=>Math.max(max,0)]} tickFormatter={num} tick={{fontSize:11}} axisLine={false} tickLine={false}/>
          <ReferenceLine y={0} stroke="#918D83" strokeDasharray="4 4" label={{value:'장기 평균 0',position:'insideTopRight',fontSize:11,fill:'#5F5C54'}}/>
          <Tooltip labelFormatter={dateLabel} formatter={(v:number)=>[num(v),'NFCI']} contentStyle={{fontSize:12,borderColor:'#D9D5CA'}}/>
          <Line dataKey="value" stroke="#477FA3" strokeWidth={2} connectNulls={false} isAnimationActive={false} dot={false}/>
        </LineChart></ResponsiveContainer>:<p className={`${caption} py-20 text-center`}>선택 기간의 자료가 없습니다.</p>}
      </div>
    </div>
  </section>;
}

export function FacilitiesHistoryChart({history,data,asOf,weeks}:{history:ReadWeek[];data:FedFacilities;asOf:string;weeks:4|13}) {
  const series=facilityHistory(history,asOf,data);
  return <section data-testid="facilities-history" className="space-y-5 py-6 border-t border-[#D9D5CA]">
    <h3 className="text-sm font-semibold">연준 긴급대출 창구 합계</h3>
    <p data-funding-definition="loans" className={definition}>{FUNDING_DEFINITIONS.loans}{data.includesBtfp?' 선택 시점의 BTFP 잔액도 포함했습니다.':''}</p>
    <ReadingValue value={data.value==null?'자료 없음':facilityAmount(data.value)} change={data.change==null?'비교 불가':facilityAmount(data.change,true)} date={data.currentDate} previousDate={data.previousDate} weeks={weeks}/>
    <div className={frame}>
      <p className={`${caption} mb-3`}>최근 3년 · 주간 잔액 · 단위: 억 달러</p>
      <div className="h-[250px]" role="img" aria-label="최근 3년 연준 대출·레포·스왑 구성별 누적 막대그래프">
        {series.some(p=>data.rows.every(r=>p[r.key]!=null))?<ResponsiveContainer width="100%" height="100%"><BarChart data={series} margin={{top:8,right:12,left:0,bottom:0}} barCategoryGap="20%">
          <CartesianGrid vertical={false} stroke="#E8E5DC"/>
          <XAxis dataKey="date" tickFormatter={(v:string)=>v.slice(2,7)} minTickGap={48} tick={{fontSize:11}} axisLine={false} tickLine={false}/>
          <YAxis width={48} tickFormatter={num} tick={{fontSize:11}} axisLine={false} tickLine={false}/>
          <Tooltip formatter={(v:number,name:string)=>[`${num(v)}억 달러`,name]} contentStyle={{fontSize:12,borderColor:'#D9D5CA'}}/>
          {data.rows.map(r=><Bar key={r.key} dataKey={r.key} name={r.label} stackId="facilities" fill={r.color} isAnimationActive={false}/>)}
        </BarChart></ResponsiveContainer>:<p className={`${caption} py-20 text-center`}>선택 기간의 구성 자료가 없습니다.</p>}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 mt-3 text-xs text-[#5F5C54]">{data.rows.map(r=><span key={r.key}><span className="inline-block w-2 h-2 mr-2 rounded-sm" style={{background:r.color}}/>{r.label}</span>)}</div>
    </div>
    <FedFacilitiesBreakdown data={data} weeks={weeks}/>
  </section>;
}
