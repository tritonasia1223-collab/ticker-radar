import type { LiquidityContext, Obs } from "./liquidity-beta.js";
import type { ReadWeek, HowMuch, WhereFrom, WhereTo, WhoBought, Stress } from "./liquidity-read.js";
import type { TreasuryFlow } from "./treasury-flow.js";
import type { IndicatorAnalysis } from "./credit/signals.js";
import type { ChapterParagraph } from "./credit/chapter-reading.js";
import { delta, para, usable } from "./credit/report.js";
import { changeFrom } from "./liquidity-beta.js";
import { fmt } from "./liquidity-sentences.js";

const DAY=86400000;
const finite=Number.isFinite;
const amount=(v:number)=>`${fmt.amount(Math.abs(v))} 달러`;
const direction=(v:number)=>v>0?'늘었습니다':v<0?'줄었습니다':'변하지 않았습니다';
export interface ReportInput {
  asOf:string; weeks:4|13; history:ReadWeek[]; sel:ReadWeek; prev:ReadWeek|null;
  context:LiquidityContext['series']; how:HowMuch|null; from:WhereFrom|null; to:WhereTo|null;
  who:WhoBought|null; stress:Stress; flow:TreasuryFlow|null; credit:IndicatorAnalysis[];
}
export function liquidityReport(i:ReportInput) {
  const {asOf,weeks,sel,prev,how,from,to,who,stress,flow,credit}=i;
  // 전체 이력이 전달돼도 선택일 이후의 관측은 해설에 사용하지 않는다.
  const ctx=Object.fromEntries(Object.entries(i.context).map(([k,p])=>[k,p.filter(o=>o.date<=asOf&&finite(o.value))])) as LiquidityContext['series'];
  const obs=(key:keyof typeof ctx,maxDays=70):Obs|null=>{const p=ctx[key]?.at(-1);return p&&Date.parse(asOf)-Date.parse(p.date)<=maxDays*DAY?p:null;};
  const change=(key:keyof typeof ctx,days:number,tolerance:number,maxDays=70)=>obs(key,maxDays)?changeFrom(ctx[key]??[],asOf,days,tolerance):null;
  const line=(key:string)=>credit.find(c=>c.id===key)?.lines[0];
  const spread=stress.rows.find(r=>r.key==='spread'), emergency=stress.rows.find(r=>r.key==='loans');
  const validRow=(r:typeof spread)=>!!r&&r.value!=null&&finite(r.value)&&!!r.date&&Date.parse(asOf)-Date.parse(r.date)<=7*DAY;
  const fundingKnown=validRow(spread)&&validRow(emergency);
  const fundingStress=fundingKnown&&(spread!.breached===true||emergency!.breached===true);
  const loan=delta(line('h8_ci_loans'),13);
  const rates=['ig_oas','hy_oas'].map(id=>credit.find(c=>c.id===id)?.comparisonLines?.[0]);
  const rateUp=rates.every(l=>{const c=delta(l,weeks);return c&&c.value>0;});
  const ccc=delta(line('ccc_oas'),weeks),hy=delta(line('hy_oas'),weeks);
  const selective=!!ccc&&!!hy&&ccc.from===hy.from&&ccc.to===hy.to&&ccc.value>0&&ccc.value>hy.value;
  const overview:ChapterParagraph[]=[];
  overview.push(para(fundingStress?'자금시장에 부담 신호가 나타났습니다. 기업의 조달 경로까지 영향이 번지는지 확인해야 합니다.'
    :fundingKnown&&loan&&loan.value>0&&rateUp?'은행을 통한 기업 자금 조달은 이어지지만, 높아진 금리가 신규 차입과 차환 부담을 키우고 있습니다.'
    :fundingKnown&&loan&&loan.value>0?'은행 기업대출의 중기 증가가 이어지고 있습니다. 자금시장과 회사채 가격을 함께 확인해 공급의 지속성을 판단해야 합니다.'
    :!fundingKnown||!loan?'전체 자금 공급을 판단할 자료가 일부 부족합니다. 확인된 유동성 변화와 조달 지표를 나눠 살펴봅니다.'
    :'기업대출의 중기 증가가 확인되지 않습니다. 은행의 심사 태도와 기업 수요, 시장 조달 여건을 함께 봐야 합니다.','conclusion'));
  if(to&&finite(to.dReserves))overview.push(para(`은행 지급준비금은 ${direction(to.dReserves)}. ${!fundingKnown?'단기 자금시장의 최신 자료가 부족해 실제 조달 압박 여부는 확인하지 못했습니다.':fundingStress?'단기 금리 또는 연준 자금 창구에서도 경계 조건이 관측됐습니다. 잔액 변화가 가격과 함께 나빠지는지 살펴야 합니다.':'다만 SOFR−IORB에서 경계 조건을 넘는 압박은 확인되지 않았습니다. 준비금 규모만으로 자금 부족이라고 보기는 어렵습니다.'}`));
  if(selective)overview.push(para('회사채 부담은 신용도에 따라 다릅니다. CCC 이하 기업의 위험 프리미엄이 HY 전체보다 더 확대돼, 가장 취약한 차주의 여건이 상대적으로 나빠졌습니다. 실제 부실 공시와 함께 확인할 변화입니다.'));
  else if(rateUp)overview.push(para('IG·HY 회사채 시장금리가 함께 올랐습니다. 자금 조달이 가능하더라도 빚을 새로 내거나 갈아타는 비용은 별도의 부담이 됩니다.'));
  const dates=[['기업대출',line('h8_ci_loans')],['은행 심사 조사',line('sloos_ci_standards')],['회사채 발행',line('corporate_bond_issuance')],['회사채 가격',line('hy_oas')]] as const;
  overview.push(para(`유동성 ${asOf} · ${dates.map(([label,l])=>`${label} ${usable(l)?l.latest!.date:'확인 불가'}`).join(' · ')}. 관측일 기준이며 사후 공시·수정치를 포함합니다.`,'explanation'));
  const sections:Record<string,ChapterParagraph[]>={s1:[],s2:[],s3:[],s4:[],s5:[],background:[]};
  const m2=change('m2',365,16),deposit=change('deposits',364,7),nl=how?.nlYoy;
  if(m2&&nl)sections.s1.push(para(`같은 전년 비교에서 순유동성은 ${direction(nl.delta)}. M2는 ${direction(m2.delta)}. ${Math.sign(nl.delta)!==Math.sign(m2.delta)?'연준 대차대조표로 보는 유동성과 민간이 보유한 예금·통화량은 다른 방향으로 움직였습니다. 순유동성 감소를 민간 통화량의 감소와 같게 읽으면 안 됩니다.':'두 지표의 방향은 같지만, 순유동성과 가계·기업이 보유한 통화량은 서로 다른 범위를 측정합니다.'}`));
  if(deposit)sections.s1.push(para(`은행 예금도 전년 대비 ${Math.abs(deposit.pct).toFixed(1)}% ${direction(deposit.delta)}. 대출과 예금은 함께 살펴볼 민간 신용의 단서지만, 예금 증가액 전부를 신규 대출이 만든 돈으로 해석하지는 않습니다.`));
  const gdp=(ctx.gdp??[]).map(p=>({...p,end:new Date(Date.UTC(Number(p.date.slice(0,4)),Number(p.date.slice(5,7))+2,0)).toISOString().slice(0,10)})).filter(p=>p.end<=asOf&&Date.parse(asOf)-Date.parse(p.end)<=183*DAY).at(-1);
  const m2Quarter=gdp?(ctx.m2??[]).findLast(p=>p.date.slice(0,7)===gdp.end.slice(0,7)):null;
  if(gdp&&gdp.value>0&&m2Quarter)sections.s1.push(para(`최근 완결 분기 말(${gdp.end})의 M2를 같은 분기 명목 GDP 연율과 비교하면 ${(m2Quarter.value/gdp.value*100).toFixed(1)}%입니다. 경제 규모와 비교한 통화량의 참고 비율이며, 특정 비율만으로 돈이 과잉이거나 부족하다고 판단하지 않습니다.`));
  sections.s1.push(para(`M2 ${m2?.to.date??'자료 부족'} · 예금 ${deposit?.to.date??'자료 부족'}. 예금 구성의 급변은 재분류 가능성도 있어 개별 항목보다 합계와 함께 봅니다.`,'explanation'));
  if(from&&prev){
    const assets=sel.total-prev.total,tga=sel.tga-prev.tga;
    sections.s2.push(para(assets>0&&from.dNl<0?'연준 자산은 늘었지만 TGA와 역레포의 순흡수 효과가 이를 넘어섰습니다. 연준 자산 증가가 그대로 민간 유동성 증가로 이어진 것은 아닙니다.'
      :assets<0&&from.dNl>0?'연준 자산은 줄었지만 TGA와 역레포에서 회수된 자금의 효과가 이를 웃돌았습니다. 총자산만 보면 놓치기 쉬운 유동성 증가입니다.'
      :`순유동성 변화는 연준 자산, TGA, 역레포의 기여를 합친 결과입니다. ${from.contributions.some(c=>Math.sign(c.effect)!==Math.sign(from.dNl)&&c.effect!==0)?'일부 항목이 반대 방향으로 움직여 다른 항목의 영향을 상쇄했습니다.':'이번 비교에서는 주요 항목의 방향과 순변화를 함께 확인할 수 있습니다.'}`));
    const treasury=sel.treast-prev.treast,mbs=sel.mbs-prev.mbs;
    if(finite(treasury)&&finite(mbs))sections.s2.push(para(treasury>0&&mbs<0?'연준 보유 국채는 늘고 MBS는 줄었습니다. 서로 반대 방향인 보유 변화와 기타 자산을 합쳐야 총자산의 순증감을 설명할 수 있습니다.':'연준 총자산의 변화는 국채·MBS·기타 자산의 합계입니다. 한 항목의 보유 변화만으로 전체 자금 공급을 설명하지 않습니다.'));
    if(tga>0&&flow&&flow.from===prev.date&&flow.end===asOf&&Math.abs(flow.net)<tga*.25)sections.s2.push(para('같은 기간 TGA는 늘었지만 시장성 국채 순증감은 상대적으로 작았습니다. TGA 증가를 국채 순발행만으로 설명하기 어렵고, 세입·지출 등 다른 재무부 현금 흐름도 확인해야 합니다.'));
    sections.s2.push(para(`분석 구간 ${prev.date}~${asOf}. 역레포 잔액의 증감은 연준에 맡긴 자금의 변화이며, 주간 H.4.1 전체 역레포를 국내 MMF의 ON RRP와 동일하게 보지 않습니다.`,'explanation'));
  }
  const sample=i.history.filter(w=>w.date<=asOf&&Date.parse(w.date)>=Date.parse(asOf)-3*365.25*DAY&&finite(w.reserves));
  if(sample.length>=100&&finite(sel.reserves)){
    const pct=100*sample.filter(w=>w.reserves<=sel.reserves).length/sample.length;
    sections.s3.push(para(`현재 지급준비금은 확보한 ${sample[0].date}~${sample.at(-1)!.date} 주간 관측에서 ${pct<=20?`하위 약 ${Math.max(1,Math.round(pct))}%`:pct>=80?`상위 약 ${Math.max(1,Math.round(100-pct))}%`:'중간'} 구간입니다. 과거의 낮은 잔액이 곧바로 현재의 위험선을 뜻하지는 않습니다. 실제 자금 압박은 다음 장의 단기 금리와 함께 확인합니다.`));
  }
  if(/-(03|06|09|12)-/.test(asOf)&&Number(asOf.slice(8))>=25)sections.s3.push(para('분기말 관측에는 결제·현금 관리의 영향이 섞일 수 있습니다. 다음 주에도 준비금 감소가 이어지는지, 단기 조달금리까지 오르는지를 확인해야 합니다.'));
  sections.s3.push(para('국내 ON RRP의 완충 여력을 판단하려면 별도 잔액이 필요합니다. 이 페이지의 주간 전체 역레포 잔액에서 국내 MMF의 여력을 직접 추정하지 않습니다.','explanation'));
  if(flow){const long=flow.net-flow.billsNet;
    sections.s4.push(para(`선택한 ${weeks}주 동안 단기채 잔액은 ${amount(flow.billsNet)} ${direction(flow.billsNet)}. 중장기채 등 나머지는 ${amount(long)} ${direction(long)}. ${flow.billsNet*long<0?'총량 변화와 함께 만기 구성이 서로 반대 방향으로 바뀌었습니다.':'총량뿐 아니라 어떤 만기의 국채가 늘거나 줄었는지도 중요합니다.'}`));
  }
  if(who&&finite(who.dealerShare)&&who.dealerSharePrev!=null)sections.s4.push(para(`${who.excludeBills?'단기채를 제외한':'전체'} 입찰에서 딜러 배분 비중은 직전 같은 기간 ${ (who.dealerSharePrev*100).toFixed(1)}%에서 ${(who.dealerShare*100).toFixed(1)}%로 ${direction(who.dealerShare-who.dealerSharePrev)}. 입찰자 구성의 변화는 확인되지만, 낙찰 후 재판매와 입찰 조건을 보지 않고 최종 수요의 강약을 확정하기는 어렵습니다.`));
  sections.s5.push(para(!fundingKnown?'단기 조달금리와 연준 창구 사용량을 함께 판단할 최신 자료가 부족합니다.'
    :fundingStress?'단기 조달금리 또는 연준 자금 창구에서 압박 신호가 나타났습니다. 준비금의 양이 줄었는지뿐 아니라 실제 자금 가격과 창구 수요가 어떻게 반응했는지 함께 봐야 합니다.'
    :'현재 SOFR−IORB는 설정된 경계선 아래입니다. 준비금의 규모만으로 자금이 부족하다고 판단하기 어려운 이유입니다.','conclusion'));
  sections.s5.push(para('SOFR는 국채를 담보로 하루 돈을 빌리는 시장금리이고, IORB는 연준이 은행 지급준비금에 주는 이자율입니다. 같은 날의 차이로 단기 자금의 가격 압박을 살펴봅니다.','explanation'));
  if(validRow(spread))sections.s5.push(para(`SOFR−IORB는 ${spread!.date} 기준 ${spread!.value!.toFixed(1)}bp입니다. ${spread!.breached?'평소 정책금리 수준만으로 설명하기 어려운 단기 조달 압박이 있는지 주의해야 합니다.':'두 금리의 차이가 경계 조건 이내여도 기업의 장기 조달금리까지 낮다는 뜻은 아닙니다.'}`));
  if(validRow(emergency))sections.s5.push(para(`연준 긴급 자금 창구 합계는 ${amount(emergency!.value!)}입니다 (${emergency!.date}). ${emergency!.breached?'창구 사용과 시장금리 상승이 함께 지속되는지 확인할 필요가 있습니다.':'창구 사용액에는 별도 경계선을 설정하지 않았으므로, 이 잔액만으로 정상·위기를 판정하지 않습니다.'}`));
  const nfci=obs('nfci',14);
  if(nfci)sections.s5.push(para(`금융여건 지수 NFCI는 ${nfci.value<0?'장기 평균보다 완화적인':'장기 평균보다 긴축적인'} 쪽입니다. 주간 종합지수라 일간 가격 변화와 시차가 있으며, 저신용 기업 일부의 부담이 평균에 가려질 수도 있습니다.`));
  const real=change('dfii10',weeks*7,4,7),dollar=change('dtwexbgs',weeks*7,4,7),pce=change('pcepilfe',365,16),production=change('indpro',365,16),un=obs('unrate');
  if(real)sections.background.push(para(`10년 실질금리는 비교 구간에 ${Math.abs(real.delta).toFixed(2)}%p ${real.delta>0?'올랐습니다':real.delta<0?'내렸습니다':'변하지 않았습니다'}. ${dollar?`같은 선택 기간 광의 달러지수는 ${Math.abs(dollar.pct).toFixed(1)}% ${direction(dollar.delta)}. `:''}${real.delta>0?'기업의 차환 여건과 장기 자산의 할인율 부담을 함께 살펴볼 변화입니다.':'실질금리의 방향과 신용 위험 프리미엄의 방향이 같은지도 확인해야 합니다.'}`));
  if(pce&&production&&un)sections.background.push(para(`근원 PCE는 전년 대비 ${pce.pct.toFixed(1)}%, 산업생산은 ${production.pct.toFixed(1)}% 변했고 실업률은 ${un.value.toFixed(1)}%입니다. ${production.delta>0?'생산 증가가 이어지는 가운데 금융 여건이 어떻게 바뀌는지 보는 조합입니다.':'생산의 약화와 조달 부담이 겹치는지 살펴야 합니다.'} 한 달의 변화만으로 경기 국면이나 정책 의도를 확정하지 않습니다.`));
  sections.background.push(para(`실질금리 ${real?.to.date??'자료 부족'} · 달러 ${dollar?.to.date??'자료 부족'} · 물가 ${pce?.to.date??'자료 부족'} · 생산 ${production?.to.date??'자료 부족'} · 실업률 ${un?.date??'자료 부족'}. 서로 다른 주기의 최신 관측을 사용합니다.`,'explanation'));
  return {overview,sections};
}

