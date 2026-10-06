import { describe, expect, it } from "vitest";
import { analyze } from "../shared/credit/signals";
import { scenarios } from "../shared/credit/scenarios";
import { creditChapter } from "../shared/credit/chapter-reading";
import { liquidityChapters } from "../shared/liquidity-chapters";
import { whereFrom, whereTo, howMuch, type ReadWeek, type Stress } from "../shared/liquidity-read";

function fixture() {
  const data = analyze(null, "2026-09-23", "observation");
  const set = (id: string, value: number, delta4: number, delta13 = delta4) => {
    const l = data.find(i => i.id === id)!.lines[0];
    l.latest = {date: "2026-09-23", value}; l.stale = false; l.errors = [];
    for (const [w, delta] of [[4,delta4],[13,delta13]]) l.changes[w] = {from:"2026-08-26",to:"2026-09-23",value:delta,pct:null,unchangedRelease:false};
    return l;
  };
  const outcome = scenarios(data);
  return {data, outcome, set};
}
describe("챕터의 관측 기반 종합 답변", () => {
  it("엄격한 확장 조건에 못 미쳐도 잔액 증가와 높은 대출 문턱을 함께 답한다", () => {
    const f = fixture(); f.set("h8_ci_loans", 2800, 5); f.set("sloos_ci_standards", 4, -2); f.set("sloos_ci_demand", 3, 0);
    const r = creditChapter("credit-bank", f.data, f.outcome, 4);
    expect(r.text).toContain("잔액은 4주간 늘었습니다"); expect(r.text).toContain("문턱을 높인");
    expect(r.text).not.toMatch(/혼합 신호|판단 유보|조건이 관측/);
    expect(r.details.join(" ")).toContain("최신 분기");
  });
  it("선택 기간 반전과 수요 둔화를 반영한다", () => {
    const f = fixture(); f.set("h8_ci_loans", 2800, 5, -10); f.set("sloos_ci_standards", -5, 0); f.set("sloos_ci_demand", -4, 0);
    const r = creditChapter("credit-bank", f.data, f.outcome, 13);
    expect(r.text).toContain("13주간 줄었습니다"); expect(r.text).toContain("문턱은 낮아졌지만"); expect(r.text).toContain("수요는 약해졌습니다");
  });
  it("비상 인출은 잔액 증가보다 우선하며 비은행 대출 증가만으로 경고하지 않는다", () => {
    const f = fixture(); f.set("h8_ci_loans", 2800, 200); f.outcome.signals.loan_emergency_warning.status = true;
    expect(creditChapter("credit-bank", f.data, f.outcome, 4).text).toContain("비상 한도 인출");
    f.outcome.signals.loan_emergency_warning.status = false; f.outcome.signals.ndfi_growth.status = true;
    expect(creditChapter("credit-bank", f.data, f.outcome, 4).text).not.toMatch(/비상|부실/);
  });
  it("급변 경고가 없어도 취약 기업의 작은 악화를 숨기지 않는다", () => {
    const f = fixture(); f.set("ccc_oas", 10, .1); f.outcome.signals.ccc_wide.status = false; f.outcome.signals.ccc_gap_trend.status = false;
    expect(creditChapter("credit-fragile", f.data, f.outcome, 4).text).toContain("4주 전보다 커졌습니다");
    f.outcome.signals.ccc_gap_trend.status = true;
    expect(creditChapter("credit-fragile", f.data, f.outcome, 4).text).toContain("여러 주에 걸쳐");
  });
  it("결측·오류·오래된 관측·같은 발표를 정상 또는 변화 없음으로 쓰지 않는다", () => {
    const f = fixture();
    expect(creditChapter("credit-bank", f.data, f.outcome, 4).text).toContain("자료가 부족");
    const l = f.set("h8_ci_loans",2800,10); l.stale = true;
    expect(creditChapter("credit-bank", f.data, f.outcome, 4).text).not.toContain("늘었습니다");
    l.stale=false; l.errors=["수집 실패"];
    expect(creditChapter("credit-bank", f.data, f.outcome, 4).text).not.toContain("늘었습니다");
    l.errors=[]; l.changes[4]!.unchangedRelease=true;
    expect(creditChapter("credit-bank", f.data, f.outcome, 4).text).not.toContain("늘었습니다");
  });
  it("CP 잔액과 추가 금리의 반대 방향을 그대로 설명한다", () => {
    const f = fixture(); f.set("cp_outstanding", 1500, 20); f.set("cp_spread", .4, -.1);
    const r = creditChapter("credit-short", f.data, f.outcome, 4);
    expect(r.text).toContain("잔액은 4주간 늘었습니다"); expect(r.text).toContain("금리는 낮아졌습니다");
    expect(r.details.join(" ")).toContain("실제 조달금리 하락을 뜻하지");
  });
  it("회사채 안정 조건 밖이어도 실제 발행이 확인되면 조달 지속을 설명한다", () => {
    const f = fixture(); f.set("corporate_bond_issuance", 200, 10);
    f.outcome.signals.ig_stable.status = false; f.outcome.signals.hy_stable.status = false;
    expect(creditChapter("credit-bonds", f.data, f.outcome, 4).text).toContain("자금 조달은 이어지고");
    f.outcome.signals.hy_wide.status = true;
    expect(creditChapter("credit-bonds", f.data, f.outcome, 4).text).toContain("위험 프리미엄이 커지고");
  });
});

const week = (date: string, total: number, tga: number, rrp: number, reserves: number): ReadWeek => ({date,total,tga,rrp,reserves,currency:100,liabResidual:total-tga-rrp-reserves-100,treast:total,mbs:0,discount:0,btfp:0,repo:0,swap:0});
const quiet: Stress = {rows:[],evaluated:[],breached:[]};
describe("01~05 왼쪽 요약", () => {
  it("흡수·방출 상쇄에서 순변화와 같은 방향의 원인을 고른다", () => {
    const a=week("2026-08-26",1000000,100000,100000,500000), b=week("2026-09-23",950000,60000,60000,520000);
    const from=whereFrom(a,b,.5), to=whereTo(a,b,[],[],null);
    const result=liquidityChapters(howMuch([a,b],b,a,4,[],.1),from,to,null,quiet,4);
    expect(result.s2).not.toContain("연준 자산 감소"); expect(result.s2).toContain("상쇄");
    expect(result.s3).toContain("지급준비금은 4주간 200억 달러 늘었습니다");
    expect(result.s3).not.toContain("들어갔");
  });
  it("비교 관측 없음과 영변화를 구분하고 음수 순유동성 부호를 보존한다", () => {
    const b=week("2026-09-23",100000,200000,100000,1000);
    const result=liquidityChapters(howMuch([b],b,null,4,[],.1),null,null,null,quiet,4);
    expect(result.s1).toContain("−2,000억"); expect(result.s1).toContain("비교 시점의 자료는 없습니다");
    expect(result.s5).toContain("자료가 부족");
  });
});
