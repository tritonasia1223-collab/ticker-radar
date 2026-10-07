import { describe, expect, it } from "vitest";
import { observedComparison, observedHistoryText } from "../shared/observed-comparison";
import { fundingComparisons } from "../shared/liquidity-report";
import { creditGap } from "../shared/credit/observations";
import { analyze } from "../shared/credit/signals";
import { creditSignals, scenarios } from "../shared/credit/scenarios";
import { creditChapter } from "../shared/credit/chapter-reading";
import type { ReadWeek } from "../shared/liquidity-read";

describe("임계값 대신 관측 비교", () => {
  const points = Array.from({length: 15}, (_,n) => ({date: new Date(Date.UTC(2026,0,7+n*7)).toISOString().slice(0,10), value: n+2}));
  const asOf = points.at(-1)!.date;
  it("4주·13주 비교와 실제 관측 분포를 계산하고 미래 값을 제외한다", () => {
    const data = [...points, {date:"2027-01-01",value:999}];
    const four = observedComparison(data,asOf,4,7,14), quarter = observedComparison(data,asOf,13,7,14);
    expect(four.change).toBe(4); expect(quarter.change).toBe(13);
    expect(four.history).toMatchObject({min:2,max:16,median:9,percentile:100,count:15});
    expect(observedHistoryText(four,"bp")).toContain("중앙값은 9bp");
    expect(observedHistoryText(four,"bp")).not.toMatch(/위험|정상|경계/);
  });
  it("관측이 부족하거나 오래된 자료를 0 또는 정상으로 대체하지 않는다", () => {
    const empty = observedComparison([],asOf,4,7,14);
    expect(empty.current).toBeNull(); expect(empty.history).toBeNull();
    expect(observedComparison(points.slice(0,1),asOf,4,7,14).current).toBeNull();
    const zero = observedComparison([{date:asOf,value:0}],asOf,4,7,14);
    expect(zero.current?.value).toBe(0); expect(zero.previous).toBeNull();
    expect(observedHistoryText(zero,"bp")).toContain("부족");
  });
  it("SOFR와 IORB는 같은 날짜끼리 차감한다", () => {
    const result=fundingComparisons({asOf:"2026-09-30",weeks:4,history:[],context:{sofr:[{date:"2026-09-29",value:4},{date:"2026-09-30",value:7}],iorb:[{date:"2026-09-29",value:3.9}]}});
    expect(result.spread.current?.date).toBe("2026-09-29");
    expect(result.spread.current?.value).toBeCloseTo(10);
  });
  it("종료된 BTFP를 제외할 때 과거 대출 합계도 같은 정의로 비교한다", () => {
    const history = points.map((p,n) => ({date:p.date,discount:p.value,repo:0,swap:0,btfp:n===14?NaN:1000}) as ReadWeek);
    const result = fundingComparisons({asOf,weeks:4,history,context:{}}).loans;
    expect(result.change).toBe(4);
    expect(result.history).toMatchObject({min:2,max:16,median:9});
  });
  it("CCC·HY 공통 관측에서 작은 변화도 비교하고 누락은 연결하지 않는다", () => {
    const data=analyze(null,"2026-09-30","observation");
    for(const [id,a,b] of [["ccc_oas",10,10.005],["hy_oas",3,3]] as const){
      const l=data.find(i=>i.id===id)!.lines[0];
      l.points=[{date:"2026-09-02",value:a},{date:"2026-09-30",value:b}];l.latest=l.points[1];l.stale=false;l.errors=[];
    }
    expect(creditGap(data,4)?.change).toBeCloseTo(.005);
    expect(creditGap(data,13)?.change).toBeNull();
    data.find(i=>i.id==="hy_oas")!.lines[0].points[1].date="2026-09-29";
    expect(creditGap(data,4)).toBeNull();
  });
  it("저장된 과거 경고 플래그가 운영 해설을 바꾸지 않는다", () => {
    const data=analyze(null,"2026-09-30","observation"), legacy=scenarios(data);
    const read=()=>["credit-bank","credit-bonds","credit-short","credit-fragile","credit-watchpoints"].map(id=>creditChapter(id,data,legacy,4));
    const before=read();
    for(const value of Object.values(legacy.signals))value.status=true;
    expect(read()).toEqual(before);
    expect(creditSignals(data)).toEqual({signals:{},summary:[],rows:[],closest:[]});
  });
});
