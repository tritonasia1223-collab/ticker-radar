import type { LiquidityContext, Obs } from "./liquidity-beta.js";
import type { ReadWeek, HowMuch, WhereFrom, WhereTo, WhoBought, Stress } from "./liquidity-read.js";
import type { TreasuryFlow } from "./treasury-flow.js";
import type { IndicatorAnalysis } from "./credit/signals.js";
import type { ChapterParagraph } from "./credit/chapter-reading.js";
import { delta, para, usable } from "./credit/report.js";
import { changeFrom } from "./liquidity-beta.js";
import { fmt } from "./liquidity-sentences.js";
import { fedFacilities, facilityReading } from "./fed-facilities.js";
import { observedComparison, observedNumber } from "./observed-comparison.js";
import { FUNDING_EDITORIAL } from "./funding-editorial.js";

const DAY=86400000;
const finite=Number.isFinite;
const amount=(v:number)=>`${fmt.amount(Math.abs(v))} 달러`;
const direction=(v:number)=>v>0?'늘었습니다':v<0?'줄었습니다':'변하지 않았습니다';
export function economySummary(context: LiquidityContext['series'], asOf: string) {
  const points = (key: keyof LiquidityContext['series']) => (context[key] ?? []).filter(p => p.date <= asOf && finite(p.value)).sort((a,b) => a.date.localeCompare(b.date));
  const quarterEnd = (date: string) => new Date(Date.UTC(Number(date.slice(0,4)), Number(date.slice(5,7)) + 2, 0)).toISOString().slice(0,10);
  const gdp = points('gdp').filter(p => quarterEnd(p.date) <= asOf);
  const latest = (p: Obs[], age: number, end = (d: string) => d) => p.length && Date.parse(asOf)-Date.parse(end(p.at(-1)!.date)) <= age*DAY ? p.at(-1)! : null;
  const yearChange = (p: Obs[], now: Obs | null) => {
    const before = now && p.find(v => v.date === `${Number(now.date.slice(0,4))-1}${now.date.slice(4)}`);
    return now && before && before.value > 0 ? (now.value / before.value - 1) * 100 : null;
  };
  const gdpNow = latest(gdp, 183, quarterEnd), gdpYoy = yearChange(gdp, gdpNow);
  const un = latest(points('unrate'), 70), cpi = points('cpi'), cpiNow = latest(cpi, 70), cpiYoy = yearChange(cpi, cpiNow);
  const m2 = points('m2'), m2Now = latest(m2, 70), m2Yoy = yearChange(m2, m2Now);
  const month = (date: string) => `${date.slice(0,4)}년 ${Number(date.slice(5,7))}월`;
  const gdpText = gdpYoy != null && gdpNow ? `명목 GDP는 전년 대비 ${Math.abs(gdpYoy).toFixed(1)}% ${direction(gdpYoy)} (${gdpNow.date.slice(0,4)}년 ${Math.floor((Number(gdpNow.date.slice(5,7))-1)/3)+1}분기).` : '명목 GDP 전년비는 비교 자료가 부족합니다.';
  const unText = un ? `실업률은 ${un.value.toFixed(1)}%입니다 (${month(un.date)}).` : '실업률은 자료가 부족합니다.';
  const cpiText = cpiYoy != null && cpiNow ? `CPI(소비자물가)는 전년 대비 ${Math.abs(cpiYoy).toFixed(1)}% ${cpiYoy >= 0 ? '상승' : '하락'}했습니다 (${month(cpiNow.date)}).` : 'CPI(소비자물가) 전년비는 비교 자료가 부족합니다.';
  return { economy: `경기 지표: ${gdpText} ${unText} ${cpiText}`, m2: m2Yoy != null && m2Now ? ` M2는 전년 대비 ${Math.abs(m2Yoy).toFixed(1)}% ${direction(m2Yoy)} (${month(m2Now.date)}).` : '' };
}
export function liquidityQuantity(sel: ReadWeek, prev: ReadWeek | null, weeks: 4 | 13): string {
  if (!prev || [sel, prev].some(w => [w.total, w.tga, w.rrp, w.reserves].some(v => !finite(v)))) return `유동성의 양: 선택한 ${weeks}주 구간의 비교 자료가 부족합니다.`;
  const money = (v: number) => {
    const eok = Math.round(Math.abs(v) / 100), jo = Math.floor(eok / 10000), rest = eok % 10000;
    return `${jo ? `${jo}조 ` : ""}${rest || !jo ? `${rest.toLocaleString("ko-KR")}억 ` : ""}달러`;
  };
  const assets = sel.total - prev.total, tga = sel.tga - prev.tga, rrp = sel.rrp - prev.rrp;
  const reserves = sel.reserves - prev.reserves, net = assets - tga - rrp;
  const flat = (v: number) => Math.round(Math.abs(v) / 100) === 0;
  const balance = flat(reserves) ? `지급준비금은 ${weeks}주간 거의 변하지 않아 ${money(sel.reserves)}입니다.` : `지급준비금은 ${weeks}주간 ${money(reserves)} ${reserves > 0 ? "늘어" : "줄어"} ${money(sel.reserves)}가 됐습니다.`;
  const assetText = flat(assets) ? "연준 자산은 거의 변하지 않았고" : `연준 자산은 ${money(assets)} ${assets > 0 ? net < 0 ? "늘었지만" : "늘었고" : net > 0 ? "줄었지만" : "줄었고"}`;
  const holding = (name: string, v: number) => flat(v) ? `${name} 잔액은 거의 변하지 않았습니다.` : v > 0 ? `${name}에 ${money(v)}가 더 쌓였습니다.` : `${name}에서 ${money(v)}가 회수됐습니다.`;
  const sources = tga >= 50 && rrp >= 50 ? `TGA에 ${money(tga)}, 역레포에 ${money(rrp)}가 더 쌓이면서` : `${holding("TGA", tga)} ${holding("역레포", rrp)} 그 결과`;
  return `유동성의 양: ${balance} ${assetText}, ${sources} 순유동성은 ${flat(net) ? "거의 변하지 않았습니다" : `${money(net)} ${direction(net)}`}.`;
}
export interface ReportInput {
  asOf:string; weeks:4|13; history:ReadWeek[]; sel:ReadWeek; prev:ReadWeek|null;
  context:LiquidityContext['series']; how:HowMuch|null; from:WhereFrom|null; to:WhereTo|null;
  who:WhoBought|null; stress:Stress; flow:TreasuryFlow|null; credit:IndicatorAnalysis[];
}
export function fundingComparisons(i: Pick<ReportInput, 'context' | 'history' | 'asOf' | 'weeks'>) {
  const rates = new Map((i.context.iorb ?? []).map(p => [p.date,p.value]));
  const spread = (i.context.sofr ?? []).flatMap(p => rates.has(p.date) ? [{date:p.date,value:(p.value-rates.get(p.date)!)*100}] : []);
  return {
    spread: observedComparison(spread,i.asOf,i.weeks,4,7),
    nfci: observedComparison(i.context.nfci ?? [],i.asOf,i.weeks,7,14),
    hy: observedComparison(i.context.hy ?? [],i.asOf,i.weeks,4,7),
    loans: fedFacilities(i.history,i.asOf,i.weeks).stats,
  };
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

  const loan=delta(line('h8_ci_loans'),13);
  const rates=['ig_oas','hy_oas'].map(id=>credit.find(c=>c.id===id)?.comparisonLines?.[0]);
  const rateUp=rates.every(l=>{const c=delta(l,weeks);return c&&c.value>0;});
  const ccc=delta(line('ccc_oas'),weeks),hy=delta(line('hy_oas'),weeks);
  const selective=!!ccc&&!!hy&&ccc.from===hy.from&&ccc.to===hy.to&&ccc.value>0&&ccc.value>hy.value;
  const overview:ChapterParagraph[]=[];
  overview.push(para(fundingKnown&&loan&&loan.value>0&&rateUp?'은행을 통한 기업 자금 조달은 이어지지만, 높아진 금리가 신규 차입과 차환 부담을 키우고 있습니다.'
    :fundingKnown&&loan&&loan.value>0?'은행 기업대출의 중기 증가가 이어지고 있습니다. 자금시장과 회사채 가격을 함께 확인해 공급의 지속성을 판단해야 합니다.'
    :!fundingKnown||!loan?'전체 자금 공급을 판단할 자료가 일부 부족합니다. 확인된 유동성 변화와 조달 지표를 나눠 살펴봅니다.'
    :'기업대출의 중기 증가가 확인되지 않습니다. 은행의 심사 태도와 기업 수요, 시장 조달 여건을 함께 봐야 합니다.','conclusion'));
  if(to&&finite(to.dReserves))overview.push(para(`은행 지급준비금은 ${direction(to.dReserves)}. 단기 조달금리와 연준 창구 사용액의 같은 기간 변화를 함께 비교합니다.`));
  if(selective)overview.push(para('회사채 부담은 신용도에 따라 다릅니다. CCC 이하 기업의 위험 프리미엄이 HY 전체보다 더 확대돼, 가장 취약한 차주의 여건이 상대적으로 나빠졌습니다. 실제 부실 공시와 함께 확인할 변화입니다.'));
  else if(rateUp)overview.push(para('IG·HY 회사채 시장금리가 함께 올랐습니다. 자금 조달이 가능하더라도 빚을 새로 내거나 갈아타는 비용은 별도의 부담이 됩니다.'));
  const dates=[['기업대출',line('h8_ci_loans')],['은행 심사 조사',line('sloos_ci_standards')],['회사채 발행',line('corporate_bond_issuance')],['회사채 가격',line('hy_oas')]] as const;
  overview.push(para(`유동성 ${asOf} · ${dates.map(([label,l])=>`${label} ${usable(l)?l.latest!.date:'확인 불가'}`).join(' · ')}. 관측일 기준이며 사후 공시·수정치를 포함합니다.`,'explanation'));
  const sections:Record<string,ChapterParagraph[]>={s1:[],s2:[],s3:[],s4:[],s5:[],background:[]};
  // 월간 M2는 선택 기간에 대응하는 1개월·3개월 전의 실제 관측과 비교한다.
  const months=weeks===4?1:3, m2Now=obs('m2');
  const m2Date=m2Now?new Date(Date.UTC(Number(m2Now.date.slice(0,4)),Number(m2Now.date.slice(5,7))-1-months,1)).toISOString().slice(0,7):null;
  const m2Before=m2Date?(ctx.m2??[]).findLast(p=>p.date.slice(0,7)===m2Date):null;
  const m2=m2Now&&m2Before?{from:m2Before,to:m2Now,delta:m2Now.value-m2Before.value}:null;
  const deposit=change('deposits',weeks*7,7);
  if(how&&finite(how.dNl))sections.s1.push(para(`순유동성은 선택한 ${weeks}주 동안 ${amount(how.dNl)} ${direction(how.dNl)}. 현재 잔액은 ${amount(how.nl)}입니다.`));
  else sections.s1.push(para(`선택한 ${weeks}주 구간의 순유동성 비교 자료가 부족합니다.`));
  if(m2)sections.s1.push(para(`M2는 최근 ${months}개월 동안 ${amount(m2.delta)} ${direction(m2.delta)}. ${how&&finite(how.dNl)&&Math.sign(how.dNl)*Math.sign(m2.delta)<0?'순유동성과 민간의 통화량이 서로 다른 방향으로 움직였습니다. 순유동성의 변화를 예금·현금 전체의 변화와 같게 읽을 수는 없습니다.':'월간 M2와 주간 순유동성은 관측 주기와 포함 범위가 다르므로 구분해 읽습니다.'}`));
  else sections.s1.push(para(`M2의 최근 ${months}개월 비교 자료가 부족합니다.`,'explanation'));
  if(deposit)sections.s1.push(para(`은행 예금은 최근 ${weeks}주 비교에서 ${amount(deposit.delta)} ${direction(deposit.delta)}. 예금 증감에는 자금 이동도 반영되므로 신규 대출의 증감과 같지는 않습니다.`));
  sections.s1.push(para(`순유동성 ${how?.prevDate||'자료 부족'}~${asOf} · M2 ${m2?`${m2.from.date.slice(0,7)}~${m2.to.date.slice(0,7)}`:'자료 부족'} · 예금 ${deposit?`${deposit.from.date}~${deposit.to.date}`:'자료 부족'}.`,'explanation'));
  if(from&&prev){
    const lead=from.ranked.find(c=>finite(c.effect)&&c.effect!==0&&Math.sign(c.effect)===Math.sign(from.dNl));
    sections.s2.push(para(`선택한 ${weeks}주 동안 순유동성은 ${amount(from.dNl)} ${direction(from.dNl)}.${lead?` 가장 크게 작용한 항목은 ${lead.key==='tga'?'TGA':lead.key==='rrp'?'역레포':'연준 자산'}로, ${amount(lead.effect)}의 ${lead.effect>0?'방출':'흡수'} 효과가 있었습니다.`:''}`));
    const assets=sel.total-prev.total,tga=sel.tga-prev.tga;
    sections.s2.push(para(assets>0&&from.dNl<0?'연준 자산은 늘었지만 TGA와 역레포의 순흡수 효과가 이를 넘어섰습니다. 연준 자산 증가가 그대로 민간 유동성 증가로 이어진 것은 아닙니다.'
      :assets<0&&from.dNl>0?'연준 자산은 줄었지만 TGA와 역레포에서 회수된 자금의 효과가 이를 웃돌았습니다. 총자산만 보면 놓치기 쉬운 유동성 증가입니다.'
      :`순유동성 변화는 연준 자산, TGA, 역레포의 기여를 합친 결과입니다. ${from.contributions.some(c=>Math.sign(c.effect)!==Math.sign(from.dNl)&&c.effect!==0)?'일부 항목이 반대 방향으로 움직여 다른 항목의 영향을 상쇄했습니다.':'이번 비교에서는 주요 항목의 방향과 순변화를 함께 확인할 수 있습니다.'}`));
    const treasury=sel.treast-prev.treast,mbs=sel.mbs-prev.mbs;
    if(finite(treasury)&&finite(mbs))sections.s2.push(para(treasury>0&&mbs<0?'연준 보유 국채는 늘고 MBS는 줄었습니다. 서로 반대 방향인 보유 변화와 기타 자산을 합쳐야 총자산의 순증감을 설명할 수 있습니다.':'연준 총자산의 변화는 국채·MBS·기타 자산의 합계입니다. 한 항목의 보유 변화만으로 전체 자금 공급을 설명하지 않습니다.'));
    if(tga>0&&flow&&flow.from===prev.date&&flow.end===asOf&&Math.abs(flow.net)<tga*.25)sections.s2.push(para('같은 기간 TGA는 늘었지만 시장성 국채 순증감은 상대적으로 작았습니다. TGA 증가를 국채 순발행만으로 설명하기 어렵고, 세입·지출 등 다른 재무부 현금 흐름도 확인해야 합니다.'));
    sections.s2.push(para(`분석 구간 ${prev.date}~${asOf}.`,'explanation'));
  }
  if(to&&finite(to.dReserves)&&finite(to.dOther))sections.s3.push(para(`선택한 ${weeks}주 동안 은행 지급준비금은 ${amount(to.dReserves)} ${direction(to.dReserves)}. 현금통화·기타 항목은 ${amount(to.dOther)} ${direction(to.dOther)}.`));
  const sample=i.history.filter(w=>w.date<=asOf&&Date.parse(w.date)>=Date.parse(asOf)-3*365.25*DAY&&finite(w.reserves));
  if(sample.length>=100&&finite(sel.reserves)){
    const pct=100*sample.filter(w=>w.reserves<=sel.reserves).length/sample.length;
    sections.s3.push(para(`현재 지급준비금은 확보한 ${sample[0].date}~${sample.at(-1)!.date} 주간 관측에서 현재 값 이하의 관측이 ${pct.toFixed(0)}%입니다 (${sample.length}개 관측). 과거의 낮은 잔액이 곧바로 현재의 위험선을 뜻하지는 않습니다. 실제 자금 압박은 다음 장의 단기 금리와 함께 확인합니다.`));
  }
  if(/-(03|06|09|12)-/.test(asOf)&&Number(asOf.slice(8))>=25)sections.s3.push(para('분기말 관측에는 결제·현금 관리의 영향이 섞일 수 있습니다. 다음 주에도 같은 방향의 변화가 이어지는지, 단기 조달금리도 함께 움직이는지를 확인해야 합니다.'));
  if(who)sections.s4.push(para(`선택한 ${weeks}주 동안 ${who.excludeBills?'단기채를 제외한 ':''}국채 낙찰액은 ${amount(who.totalReported)}입니다.`));
  if(flow){const long=flow.net-flow.billsNet;
    sections.s4.push(para(`전체 시장성 국채 잔액은 같은 ${weeks}주 동안 순액으로 ${amount(flow.net)} ${direction(flow.net)}. 단기채는 ${amount(flow.billsNet)} ${direction(flow.billsNet)}. 중장기채 등 나머지는 ${amount(long)} ${direction(long)}. ${flow.billsNet*long<0?'서로 반대 방향의 변화가 합계에서 상쇄됐습니다.':''}`));
  }
  if(who&&finite(who.dealerShare)&&who.dealerSharePrev!=null)sections.s4.push(para(`${who.excludeBills?'단기채를 제외한':'전체'} 입찰에서 딜러 배분 비중은 직전 같은 기간 ${ (who.dealerSharePrev*100).toFixed(1)}%에서 ${(who.dealerShare*100).toFixed(1)}%로 ${direction(who.dealerShare-who.dealerSharePrev)}. 입찰자 구성의 변화는 확인되지만, 낙찰 후 재판매와 입찰 조건을 보지 않고 최종 수요의 강약을 확정하기는 어렵습니다.`));
  const funding = fundingComparisons(i);
  const sf = funding.spread.current, nf = funding.nfci.current;
  if (sf) sections.s5.push(para(sf.value === 0
    ? '현재 SOFR-IORB 스프레드는 0으로 돈이 넘치지도, 부족하지도 않은 균형 구간 입니다.'
    : `현재 SOFR−IORB 스프레드는 ${observedNumber(sf.value,'bp',true)}로, 국채를 담보로 하루 돈을 빌리는 시장금리가 은행이 지준에 받는 이자율보다 ${observedNumber(Math.abs(sf.value),'bp')} ${sf.value > 0 ? '높습니다' : '낮습니다'}.`));
  // 사용자가 지정한 편집 문안. 0에 대한 해설은 실제 관측값이 0일 때만 표시한다.
  if (sf?.value === 0) sections.s5.push(para('단, 시장 참여자들은 이를 "위험 직전 신호"로 받아들이기도 합니다.'));
  if (asOf === FUNDING_EDITORIAL.asOf && weeks === FUNDING_EDITORIAL.weeks && nf) {
    sections.s5.push(...FUNDING_EDITORIAL.paragraphs.map(text => para(text)));
  } else {
  for (const row of stress.rows) {
    if (row.key === 'hy' || row.key === 'loans') continue;
    const stats = funding[row.key];
    if (!stats.current) { sections.s5.push(para(`${row.name}의 최신 자료가 부족합니다.`)); continue; }
    if (row.key === 'spread') continue;
    const movement = stats.previous && stats.change != null ? `${weeks}주 비교에서 ${observedNumber(stats.previous.value,row.unit)}에서 ${observedNumber(stats.current.value,row.unit)}로 ${direction(stats.change)} (${stats.previous.date}~${stats.current.date}).` : '같은 기간의 비교 관측이 부족합니다.';
    sections.s5.push(para(`${row.name}은 ${observedNumber(stats.current.value,row.unit)}입니다 (${stats.current.date}). ${movement}`));
    if (stats.history) sections.s5.push(para(`현재 값은 확보한 과거 관측의 중앙값 ${observedNumber(stats.history.median,row.unit)}${stats.current.value === stats.history.median ? "와 같습니다" : stats.current.value > stats.history.median ? "보다 높습니다" : "보다 낮습니다"}.`,'explanation'));
  }
  if (!stress.rows.length) sections.s5.unshift(para('단기 자금시장과 금융여건의 최신 자료가 부족합니다.'));
  const facilities = fedFacilities(i.history,asOf,weeks);
  sections.s5.push(para(facilityReading(facilities,weeks)));
  if (nf) sections.s5.push(para(`현재 금융여건은 지수의 장기 평균보다 ${nf.value<0?'완화적인':nf.value>0?'긴축적인':'같은'} 쪽입니다.`));
  }
  const real=change('dfii10',weeks*7,4,7),dollar=change('dtwexbgs',weeks*7,4,7),pce=change('pcepilfe',365,16),production=change('indpro',365,16),un=obs('unrate');
  if(real)sections.background.push(para(`10년 실질금리는 비교 구간에 ${Math.abs(real.delta).toFixed(2)}%p ${real.delta>0?'올랐습니다':real.delta<0?'내렸습니다':'변하지 않았습니다'}. ${dollar?`같은 선택 기간 광의 달러지수는 ${Math.abs(dollar.pct).toFixed(1)}% ${direction(dollar.delta)}. `:''}${real.delta>0?'기업의 차환 여건과 장기 자산의 할인율 부담을 함께 살펴볼 변화입니다.':'실질금리의 방향과 신용 위험 프리미엄의 방향이 같은지도 확인해야 합니다.'}`));
  if(pce&&production&&un)sections.background.push(para(`근원 PCE는 전년 대비 ${pce.pct.toFixed(1)}%, 산업생산은 ${production.pct.toFixed(1)}% 변했고 실업률은 ${un.value.toFixed(1)}%입니다. ${production.delta>0?'생산 증가가 이어지는 가운데 금융 여건이 어떻게 바뀌는지 보는 조합입니다.':'생산의 약화와 조달 부담이 겹치는지 살펴야 합니다.'} 한 달의 변화만으로 경기 국면이나 정책 의도를 확정하지 않습니다.`));
  sections.background.push(para(`실질금리 ${real?.to.date??'자료 부족'} · 달러 ${dollar?.to.date??'자료 부족'} · 물가 ${pce?.to.date??'자료 부족'} · 생산 ${production?.to.date??'자료 부족'} · 실업률 ${un?.date??'자료 부족'}. 서로 다른 주기의 최신 관측을 사용합니다.`,'explanation'));
  return {overview,sections};
}
