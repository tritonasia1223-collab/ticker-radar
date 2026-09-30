import type { ReactNode } from "react";
import { type HowMuch, type WhereFrom, type WhereTo, type WhoBought, type Stress } from "@shared/liquidity-read";
import { fmt, s1 } from "@shared/liquidity-sentences";
import { liquidityReview, treasuryReview } from "@shared/liquidity-review";
import { ReviewText } from "./ReviewText";
import type { TreasuryFlow } from "@shared/treasury-flow";

function ReviewRow({ question, children, dashed = false }: { question: string; children: ReactNode; dashed?: boolean }) {
  return <div className={`grid gap-2 py-5 md:grid-cols-[130px_minmax(0,1fr)] md:gap-6 border-t border-[#D9D5CA] ${dashed ? "border-dashed" : ""}`}>
    <h3 className="text-sm font-semibold leading-relaxed">{question}</h3>
    <div className="space-y-3 text-[15px] leading-[1.85] text-[#3B3934]">{children}</div>
  </div>;
}

export function LiquidityDashboard({ how, from, to, who, flow, flowLoading, flowError, stress, alerts }: { how: HowMuch | null; from: WhereFrom | null; to: WhereTo | null; who: WhoBought | null; flow: TreasuryFlow | null; flowLoading: boolean; flowError: string | null; stress: Stress; alerts: ReactNode }) {
  const liquidity = liquidityReview(from, to);
  const treasury = who ? treasuryReview(who) : null;
  const mark = (value: number, signed = false) => ({ text: `${signed ? fmt.signedEok(value) : fmt.amount(value)} 달러`, value });
  const destinationAmounts = to ? [
    ...(!fmt.isZeroEok(to.dReserves) ? [mark(to.dReserves, to.resShare >= 0.5 && to.resShare <= 1 && !fmt.isZeroEok(to.dNl))] : []),
    ...(!fmt.isZeroEok(to.dOther) ? [mark(to.dOther)] : []),
  ] : [];
  const debtHeadline = flow ? `국채는 ${flow.weeks}주간 ${fmt.isZeroEok(flow.net) ? "거의 변하지 않았습니다" : `순액으로 ${fmt.amount(flow.net)} 달러 ${flow.net > 0 ? "늘었습니다" : "줄었습니다"}`}.` : flowLoading ? "국채 발행·상환을 확인하고 있습니다." : "선택 기간의 국채 순증가액을 확인하지 못했습니다.";
  return <section aria-label="유동성과 국채 리뷰" className="mb-8" data-testid="liquidity-review">
    <div className="border-t-2 border-[#1A1A18] pt-6">
      <div className="text-xs text-[#918D83]">{how ? `${how.prevDate ? how.prevDate + " → " : ""}${how.date}` : "관측 자료 없음"}</div>
      <h2 className="mt-3 mb-6 text-[24px] font-semibold leading-normal sm:text-[28px]" style={{ fontFamily: "'Noto Serif KR', serif" }} data-testid="liquidity-headline">{how ? s1(how).summary.map((p, i) => <span key={i} style={{ color: p.tone === "release" ? "#1F7A4D" : p.tone === "absorb" ? "#B3402E" : undefined }}>{p.text}</span>) : "선택 주차의 유동성 관측이 없습니다."}</h2>
      <ReviewRow question="어디서?">
        <ReviewText text={liquidity.sourceIntro} />
        {liquidity.sourceItems.map(item => <div key={item.key}><strong>{item.label}: </strong><ReviewText className="inline" text={item.text} amounts={[mark(item.effect)]} /></div>)}
        {liquidity.sourceOffset && <ReviewText text={liquidity.sourceOffset} />}
      </ReviewRow>
      <div className="relative">
        <span aria-hidden="true" className="absolute left-4 top-0 flex h-7 w-8 -translate-y-1/2 items-center justify-center bg-[#F6F4EE] text-[#918D83] md:left-[65px] md:-translate-x-1/2">
          <svg width="20" height="24" viewBox="0 0 20 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3v17m-5-5 5 5 5-5" /></svg>
        </span>
        <ReviewRow question="이 유동성은 어디로?" dashed><ReviewText text={liquidity.destination} amounts={destinationAmounts} /></ReviewRow>
      </div>
    </div>
    <div className="mt-6 border-t-2 border-[#1A1A18] pt-6">
      {flow && <div className="text-xs text-[#918D83]">{flow.from} → {flow.end} · 유동성과 같은 {flow.weeks}주</div>}
      <h2 className="mt-3 mb-6 text-[24px] font-semibold leading-normal sm:text-[28px]" style={{ fontFamily: "'Noto Serif KR', serif" }} data-testid="treasury-headline">{flow && !fmt.isZeroEok(flow.net) ? <>국채는 {flow.weeks}주간 순액으로 <span style={{ color: flow.net > 0 ? "#1F7A4D" : "#B3402E" }}>{fmt.amount(flow.net)} 달러 {flow.net > 0 ? "늘었습니다" : "줄었습니다"}.</span></> : debtHeadline}</h2>
      {!flow && flowError && <p className="text-xs text-[#918D83]">{flowError}</p>}
      {flow && <>
        <ReviewRow question="얼마나 발행했나?"><ReviewText text={`총 ${fmt.amount(flow.issues)} 달러를 발행했습니다. 만기가 돌아온 기존 국채를 갚기 위한 재발행 물량도 포함됩니다.`} /></ReviewRow>
        <ReviewRow question="얼마나 갚았나?"><ReviewText text={`기존 국채 ${fmt.amount(flow.redemptions)} 달러를 상환했습니다.`} /></ReviewRow>
        <ReviewRow question="그래서 얼마나 늘었나?">
          <ReviewText text={`상환액과 물가 조정을 반영하면, 국채는 ${fmt.isZeroEok(flow.net) ? "거의 변하지 않았습니다" : `순액으로 ${fmt.amount(flow.net)} 달러 ${flow.net > 0 ? "늘었습니다" : "줄었습니다"}`}. 같은 기간 단기채는 ${fmt.isZeroEok(flow.billsNet) ? "거의 변하지 않았습니다" : `${fmt.amount(flow.billsNet)} 달러 ${flow.billsNet > 0 ? "늘었습니다" : "줄었습니다"}`}.`} amounts={[mark(flow.net), mark(flow.billsNet)]} />
          <details className="text-xs text-[#918D83]" data-testid="treasury-calculation"><summary className="w-fit cursor-pointer border-b border-[#B9B4A6] pb-1">정확한 산출 방법</summary>
            <div className="mt-3 space-y-2 leading-relaxed">
              <p>재무부 DTS III-A 시장성 국채 기준 · {flow.start}~{flow.end}. 비교일 {flow.from}은 제외하고 선택일은 포함합니다. 비시장성 국채·Federal Financing Bank는 제외합니다.</p>
              <p>백만 달러: 발행 {flow.issues.toLocaleString("ko-KR")} − 상환 {flow.redemptions.toLocaleString("ko-KR")} + 물가연동국채 원금 조정 ({flow.inflation.toLocaleString("ko-KR")}) = 순증감 {flow.net.toLocaleString("ko-KR")}. 회계연도 누계의 기준일 간 차이로 계산하며, 연도 전환 시 전년도 말 누계를 더합니다. 반올림·수정으로 월말 잔액 차이와 소폭 다를 수 있습니다.</p>
              <p>실제 기준 관측: {flow.baselineDate} → {flow.observedThrough}. 주말·연방 공휴일은 직전 영업일을 사용합니다. 일일 원자료는 통상 다음 영업일 발표되며 6시간 캐시 후 다시 확인합니다. 발행·상환은 액면가 기준으로, 실제 현금 유입·유출과는 차이가 있습니다.</p>
              <p>입찰·생키도 같은 기간의 결제일을 사용합니다. 다만 입찰 낙찰액과 DTS 발행액은 집계·조정 기준이 달라 동일한 금액은 아닙니다.</p>
              {who && treasury && <p>낙찰 총액 {fmt.amount(who.totalReported)} 달러 · {who.counted}건. 보고 총액과 주체별 합계 차이는 {fmt.signedEok(treasury.difference)} 달러이며 특정 주체에 배분하지 않습니다.</p>}
              <ReviewText text="SOMA는 입찰에서의 만기 국채 재투자이며, 연준의 순매입액이 아닙니다. 유동성 기여액은 Δ연준 자산 − ΔTGA − Δ역레포로 계산합니다. 연준 자산 재조정·역레포 회수·TGA 사용은 잔액 변화의 순액이며 정책 의도나 실제 자금 이동 경로를 확정한 표현은 아닙니다." />
            </div>
          </details>
        </ReviewRow>
      </>}
      {!treasury || !who ? <p className="py-4 text-sm text-[#5F5C54]">선택 기간의 국채 입찰 자료가 없습니다.</p> : <>
        <ReviewRow question="발행한 국채는 누가 받아갔나?"><ReviewText text={treasury.buyers.replace("발행액", "같은 기간 입찰 낙찰액")} />
          <p className="text-xs text-[#918D83]">간접 입찰자: 딜러 등 중개기관을 통해 응찰하는 펀드·해외 중앙은행 등의 투자자.</p>
          <ReviewText text={treasury.allocations} />
          <ReviewText className="text-xs text-[#918D83]" text="딜러는 입찰 참여가 요구되지만, 낙찰액 전체가 의무 인수 물량은 아닙니다. 이후 다른 투자자에게 판매할 수 있어 이 금액만으로 국채 수요 약화를 단정할 수 없습니다." />
        </ReviewRow>
      </>}
    </div>
    <ReviewRow question="위험 신호는?">
    {stress.breached.length > 0 && <div className="my-5 rounded-lg border border-[#DCC5AA] bg-[#FAF5EB] p-4 text-sm leading-relaxed" role="status"><strong>자금시장에 주의 신호가 있습니다.</strong><p className="mt-2">{stress.breached.map(r => `${r.name} ${r.value}${r.unit === "bp" ? "bp" : ""} · 경계 ${r.threshold} · ${r.date}`).join(" / ")}</p></div>}
    {alerts}
    </ReviewRow>
  </section>;
}
