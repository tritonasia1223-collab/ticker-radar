import { describe, expect, it } from "vitest";
import { fedFacilities, facilityReading, facilityHistory } from "../shared/fed-facilities";
import { liquidityReport, type ReportInput } from "../shared/liquidity-report";
import type { ReadWeek } from "../shared/liquidity-read";

const week = (date:string,discount:number,repo:number,swap:number,btfp=NaN): ReadWeek => ({date,discount,repo,swap,btfp,total:1,tga:0,rrp:0,reserves:1,currency:0,liabResidual:0,treast:0,mbs:0});
const history = [week('2026-07-01',7778,1,250),week('2026-09-02',5282,0,132),week('2026-09-30',8738,1200,207)];

describe('연준 자금 공급 항목별 비교',()=>{
  it('누적 막대는 선택일 이후 자료를 제외하고 결측 주를 0으로 쌓지 않는다',()=>{
    const points=[...history,week('2026-09-16',5,NaN,1),week('2026-10-07',99999,99999,99999)];
    const bars=facilityHistory(points,'2026-09-30',fedFacilities(points,'2026-09-30',4));
    expect(bars.at(-1)?.discount).toBe(87.38);
    expect(bars.at(-1)?.repo).toBe(12);
    expect(bars.at(-1)?.btfp).toBeUndefined();
    expect(bars.find(p=>p.date==='2026-09-02')?.repo).toBe(0);
    expect(bars.find(p=>p.date==='2026-09-16')?.discount).toBeNull();
    const past=[week('2024-08-07',100,0,100,NaN),week('2024-09-04',200,0,300,800)];
    const btfpBars=facilityHistory(past,'2024-09-04',fedFacilities(past,'2024-09-04',4));
    expect(btfpBars[0].discount).toBeNull();
    expect(btfpBars[1].btfp).toBe(8);
  });
  it('합계와 구성별 변화가 일치하고 0 레포 잔액을 결측과 구분한다',()=>{
    const r=fedFacilities(history,'2026-09-30',4);
    expect(r.value).toBe(10145);expect(r.previous).toBe(5414);expect(r.change).toBe(4731);
    expect(r.rows.map(x=>x.change)).toEqual([3456,1200,75]);
    expect(r.rows.reduce((n,x)=>n+x.change!,0)).toBe(r.change);
    expect(r.rows.find(x=>x.key==='repo')?.previous).toBe(0);
    expect(r.includesBtfp).toBe(false);
    expect(facilityReading(r,4)).toContain('47.31억 달러 늘어 101.45억');
  });
  it('상단 13주 비교와 선택 주차를 따르고 미래 값을 사용하지 않는다',()=>{
    const r=fedFacilities([...history,week('2026-10-07',99999,99999,99999)],'2026-09-30',13);
    expect(r.change).toBe(2116);expect(r.previousDate).toBe('2026-07-01');
    expect(r.rows.map(x=>x.change)).toEqual([960,1199,-43]);
    expect(fedFacilities(history,'2026-09-02',4).value).toBe(5414);
  });
  it('관측된 BTFP는 과거 합계에 포함하되 미관측 BTFP를 0으로 만들지 않는다',()=>{
    const past=[week('2024-08-07',10,0,5,100),week('2024-09-04',20,0,3,80)];
    const r=fedFacilities(past,'2024-09-04',4);
    expect(r.includesBtfp).toBe(true);expect(r.value).toBe(103);expect(r.previous).toBe(115);
    expect(r.rows.find(x=>x.key==='btfp')?.change).toBe(-20);
    past[0].btfp=NaN;
    expect(fedFacilities(past,'2024-09-04',4).previous).toBeNull();
  });
  it('구성 항목이 빠지면 부분 합계를 전체로 표시하거나 이전 주로 대체하지 않는다',()=>{
    const missing=[...history.slice(0,2),week('2026-09-23',6235,1,72),week('2026-09-30',NaN,1200,207)];
    const r=fedFacilities(missing,'2026-09-30',4);
    expect(r.value).toBeNull();expect(r.stats.current).toBeNull();expect(r.change).toBeNull();
    expect(r.rows.find(x=>x.key==='repo')?.change).toBe(1200);
    expect(facilityReading(r,4)).toContain('자료가 부족');
  });
  it('05 보고서에는 HY 설명 없이 연준 구성별 증감을 반영한다',()=>{
    const input:ReportInput={asOf:'2026-09-30',weeks:4,history,sel:history[2],prev:history[1],context:{hy:[{date:'2026-09-30',value:3.12}]},how:null,from:null,to:null,who:null,flow:null,credit:[],stress:{rows:[{key:'hy',name:'HY 위험 프리미엄',desc:'',unit:'pctp',value:3.12,date:'2026-09-30',min:0,max:10,threshold:null,breached:null}],evaluated:[],breached:[]}};
    const text=liquidityReport(input).sections.s5.map(p=>p.text).join(' ');
    expect(text).not.toContain('HY');expect(text).toContain('34.56억 달러');expect(text).toContain('0.75억 달러');
  });
});
