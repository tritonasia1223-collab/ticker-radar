import { describe, expect, it } from "vitest";
import { analyze, type LineAnalysis } from "../shared/credit/signals";
import { scenarios, creditSignals } from "../shared/credit/scenarios";
import { creditChapter } from "../shared/credit/chapter-reading";
import { liquidityReport, liquidityQuantity, economySummary, type ReportInput } from "../shared/liquidity-report";
import { ownershipInsights } from "../shared/treasury-ownership";
import ownership from "../shared/treasury-ownership-data.json";

function fixture() {
  const data=analyze(null,'2026-09-30','observation');
  const set=(id:string,value:number,change:number,comparison=false)=>{
    const item=data.find(i=>i.id===id)!;
    const l=(comparison?item.comparisonLines!:item.lines)[0];
    l.latest={date:'2026-09-30',value};l.stale=false;l.errors=[];
    l.changes[4]={from:'2026-09-02',to:'2026-09-30',value:change,pct:change/value*100,unchangedRelease:false};
    return l;
  };
  const text=(id:string,w:4|13=4)=>creditChapter(id,data,scenarios(data),w).paragraphs!.map(p=>p.text).join(' ');
  return {data,set,text};
}
describe('도표를 연결한 신용 보고서',()=>{
  it('주간 잔액 감소와 중기 증가를 구분한다',()=>{
    const f=fixture(),l=f.set('h8_ci_loans',2900,-2);
    l.changes[13]={from:'2026-07-01',to:'2026-09-30',value:50,pct:1.7,unchangedRelease:false};
    f.set('sloos_ci_standards',0,0);f.set('sloos_ci_demand',10,0);
    expect(f.text('credit-bank')).toContain('최근 비교 구간과 중기 흐름은 다릅니다');
    expect(f.text('credit-bank',13)).not.toContain('최근 비교 구간과 중기 흐름은 다릅니다');
  });
  it('금리와 OAS의 다른 방향을 설명하되 관측 구간이 다르면 결합하지 않는다',()=>{
    const f=fixture();const spread=f.set('ig_oas',1,-.2),yieldLine=f.set('ig_oas',6,.5,true);
    expect(f.text('credit-bonds')).toContain('위험 프리미엄은 줄었지만 시장금리는 올랐습니다');
    spread.changes[4]!.from='2026-09-01';
    expect(f.text('credit-bonds')).toContain('같은 구간으로 비교할 자료가 부족');
    yieldLine.stale=true;
    expect(f.text('credit-bonds')).not.toContain('우량 기업(IG)의 시장금리는 올랐');
  });
  it('CCC 자체가 하락했다면 격차 확대를 비용 악화로 잘못 쓰지 않는다',()=>{
    const f=fixture();f.set('ccc_oas',10,-.1);f.set('hy_oas',3,-.3);
    expect(f.text('credit-fragile')).toContain('CCC 자체의 프리미엄은 오르지 않아');
    expect(f.text('credit-fragile')).not.toContain('가장 취약한 기업의 부담이 상대적으로 더 커졌습니다');
  });
  it('부실 자료가 없으면 시장 가격만으로 공시 악화를 단정하지 않는다',()=>{
    const f=fixture();f.set('ccc_oas',12,1);f.set('hy_oas',3,.2);
    expect(f.text('credit-fragile')).toContain('부실·PIK 공시의 비교 자료가 부족');
    expect(f.text('credit-fragile')).not.toContain('실제 공시의 변화를 함께 추적');
  });
  it('CP 감소를 가격과 함께 해석하고 부족한 대출 자료는 별도로 표시한다',()=>{
    const f=fixture();f.set('cp_outstanding',1400,-30);f.set('cp_spread',.2,-.01);
    expect(f.text('credit-short')).toContain('전형적인 경색 조합은 아직 아닙니다');
    expect(f.text('credit-short')).toContain('비상 차입 여부까지 평가하지 않았습니다');
    f.set('cp_spread',1,.8);
    expect(f.text('credit-short')).toContain('조달 규모와 가격이 모두 불리한 방향');
  });
  it('ETF 자료가 없으면 고점 또는 안정이라고 서술하지 않는다',()=>{
    const f=fixture();
    expect(f.text('credit-fragile')).not.toContain('대출 ETF의 분배금 반영 성과는');
  });
});
function macro():ReportInput {
  const sel={date:'2026-09-30',total:600,tga:50,rrp:10,reserves:400,currency:130,liabResidual:10,treast:500,mbs:80,discount:1,repo:0,swap:0,btfp:NaN};
  return {asOf:sel.date,weeks:4,sel,prev:null,history:[sel],context:{},how:null,from:null,to:null,who:null,flow:null,stress:{rows:[],evaluated:[],breached:[]},credit:[]};
}
describe('상단·거시 보고서',()=>{
  it('확인할 자료가 없으면 조달 정상으로 결론내리지 않는다',()=>{
    const r=liquidityReport(macro());
    expect(r.overview[0].text).toContain('자료가 일부 부족');
    expect(r.sections.s5[0].text).toContain('최신 자료가 부족');
  });
  it('오래된 단기 금리를 현재 자금 압박 평가에 쓰지 않는다',()=>{
    const i=macro();i.stress.rows=[{key:'spread',name:'SOFR',desc:'',unit:'bp',value:0,date:'2026-01-01',min:0,max:50,threshold:20,breached:false}];
    expect(liquidityReport(i).sections.s5.map(p=>p.text).join(' ')).not.toContain('경계 조건을 넘는 압박이 확인되지');
  });
  it('선택일 이후 관측과 아직 끝나지 않은 GDP 분기를 사용하지 않는다',()=>{
    const i=macro();i.asOf='2026-08-15';i.context={dfii10:[{date:'2026-10-01',value:99}],gdp:[{date:'2026-07-01',value:100}],m2:[{date:'2026-09-01',value:90}]};
    const r=liquidityReport(i);
    expect(JSON.stringify(r)).not.toContain('99.00');expect(JSON.stringify(r.sections.s1)).not.toContain('최근 완결 분기');
  });
  it('동일 분기의 M2가 없으면 서로 다른 기준일의 GDP 비율을 만들지 않는다',()=>{
    const i=macro();i.context={gdp:[{date:'2026-04-01',value:100}],m2:[{date:'2026-08-01',value:90}]};
    expect(JSON.stringify(liquidityReport(i).sections.s1)).not.toContain('90.0%');
  });
  it('서클과 테더의 해설도 보유 그래프와 같은 분기를 사용한다',()=>{
    const r=ownershipInsights(ownership,'2026-09-30');
    expect(r.issuers.circle).toContain('2026-06-30');expect(r.issuers.circle).not.toContain('2026-08-31');
    expect(r.owners.join(' ')).toContain('신규 국채를 매입했다는 뜻은 아닙니다');
    expect(ownershipInsights(ownership,'2009-01-01').owners).toEqual([]);
  });
});

describe('시나리오 판정 폐기', () => {
  it('운영 분석은 지표별 신호를 보존하고 시나리오 점수와 후보를 만들지 않는다', () => {
    const f = fixture(); f.set('ccc_oas', 12, 1); f.set('hy_oas', 3, .2);
    const data = analyze(null, '2026-09-30', 'observation');
    const current = creditSignals(data);
    expect(current.rows).toEqual([]);
    expect(current.closest).toEqual([]);
    expect(current.signals).toEqual(scenarios(data).signals);
    const chapter = creditChapter('credit-watchpoints', data, current, 4);
    expect(JSON.stringify(chapter)).not.toMatch(/시나리오|적합도|후보/);
    expect(chapter.paragraphs?.some(p => p.text.includes('다음에는'))).toBe(true);
  });
});

describe('선택 기간에 맞춘 유동성의 양', () => {
  const sel = { ...macro().sel, total: 6743026, tga: 984044, rrp: 361880, reserves: 2881691 };
  it('4주와 13주의 비교값을 각각 문장에 반영한다', () => {
    const one = { ...sel, date: '2026-09-02', total: sel.total - 5827, tga: sel.tga - 39682, rrp: sel.rrp - 4141, reserves: sel.reserves + 47594 };
    const quarter = { ...sel, date: '2026-07-01', total: sel.total - 18467, tga: sel.tga - 176687, rrp: sel.rrp - 23445, reserves: sel.reserves + 195328 };
    const a = liquidityQuantity(sel, one, 4), b = liquidityQuantity(sel, quarter, 13);
    expect(a).toContain('4주간 476억 달러 줄어 2조 8,817억 달러');
    expect(a).toContain('58억 달러 늘었지만'); expect(a).toContain('380억 달러 줄었습니다');
    expect(b).toContain('13주간 1,953억 달러 줄어');
    expect(b).toContain('1,767억 달러'); expect(b).toContain('1,817억 달러 줄었습니다');
  });
  it('TGA에서 회수하고 역레포에 쌓는 혼합 방향도 구분한다', () => {
    const prev = { ...sel, total: sel.total + 10000, tga: sel.tga + 30000, rrp: sel.rrp - 5000 };
    const text = liquidityQuantity(sel, prev, 4);
    expect(text).toContain('TGA)에서 300억 달러가 회수');
    expect(text).toContain('역레포에 50억 달러가 더 쌓');
    expect(text).toContain('순유동성은 150억 달러 늘었습니다');
  });
  it('비교값이 없으면 현재 잔액을 변화량으로 쓰지 않는다', () => {
    expect(liquidityQuantity(sel, null, 13)).toContain('13주 구간의 비교 자료가 부족');
  });
});
describe('경기 지표 요약', () => {
  const context = {
    gdp: [{date:'2025-04-01',value:100}, {date:'2026-04-01',value:106.3}, {date:'2026-07-01',value:999}],
    unrate: [{date:'2026-08-01',value:4.2}, {date:'2026-10-01',value:99}],
    cpi: [{date:'2025-08-01',value:100}, {date:'2026-08-01',value:103}],
    m2: [{date:'2025-08-01',value:100}, {date:'2026-08-01',value:105.7}],
  };
  it('완결 GDP 분기와 월간 지표의 동일 월 전년비를 표시하고 M2를 분리한다', () => {
    const result=economySummary(context,'2026-09-23');
    expect(result.economy).toContain('경기 지표: 명목 GDP는 전년 대비 6.3%');
    expect(result.economy).toContain('2026년 2분기');
    expect(result.economy).toContain('실업률은 4.2%');
    expect(result.economy).toContain('CPI(소비자물가)는 전년 대비 3.0%');
    expect(result.economy).not.toContain('M2');
    expect(result.m2).toContain('5.7%');
  });
  it('CPI 결측을 PCE나 0%로 대체하지 않는다', () => {
    const result=economySummary({...context,cpi:[],pcepilfe:[{date:'2026-08-01',value:3}]},'2026-09-23');
    expect(result.economy).toContain('CPI(소비자물가) 전년비는 비교 자료가 부족');
  });
  it('선택일보다 오래된 지표를 최신값으로 제시하지 않는다', () => {
    const result=economySummary(context,'2027-06-01');
    expect(result.economy).toContain('실업률은 자료가 부족');
    expect(result.m2).toBe('');
  });
});