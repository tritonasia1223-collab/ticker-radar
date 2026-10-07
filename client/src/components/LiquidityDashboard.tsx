import type { ReactNode } from "react";
import { type HowMuch, type WhereFrom, type WhereTo, type WhoBought, type Stress } from "@shared/liquidity-read";
import { fmt, s1 } from "@shared/liquidity-sentences";
import { liquidityReview } from "@shared/liquidity-review";
import { ReviewText } from "./ReviewText";
import type { TreasuryFlow } from "@shared/treasury-flow";

function ReviewRow({ question, children, dashed = false }: { question: string; children: ReactNode; dashed?: boolean }) {
  return <div className={`grid gap-2 py-5 md:grid-cols-[130px_minmax(0,1fr)] md:gap-6 border-t border-[#D9D5CA] ${dashed ? "border-dashed" : ""}`}>
    <div className="flex flex-col">
      <h3 className="text-sm font-semibold leading-relaxed">{question}</h3>
    </div>
    <div className="space-y-3 text-[15px] leading-[1.85] text-[#3B3934]">{children}</div>
  </div>;
}

export function LiquidityDashboard({ how, from, to, who, flow, flowLoading, flowError }: { how: HowMuch | null; from: WhereFrom | null; to: WhereTo | null; who: WhoBought | null; flow: TreasuryFlow | null; flowLoading: boolean; flowError: string | null }) {
  const liquidity = liquidityReview(from, to);
  const mark = (value: number, signed = false) => ({ text: `${signed ? fmt.signedEok(value) : fmt.amount(value)} 달러`, value });
  const destinationAmounts = to ? [
    ...(!fmt.isZeroEok(to.dReserves) ? [mark(to.dReserves, to.resShare >= 0.5 && to.resShare <= 1 && !fmt.isZeroEok(to.dNl))] : []),
    ...(!fmt.isZeroEok(to.dOther) ? [mark(to.dOther)] : []),
  ] : [];
  const debtHeadline = flow ? `국채는 ${flow.weeks}주간 ${fmt.isZeroEok(flow.net) ? "거의 변하지 않았습니다" : `순액으로 ${fmt.amount(flow.net)} 달러 ${flow.net > 0 ? "늘었습니다" : "줄었습니다"}`}.` : flowLoading ? "국채 발행·상환을 확인하고 있습니다." : "선택 기간의 국채 순증가액을 확인하지 못했습니다.";
  const rolloverShare = flow && flow.issues > 0 ? flow.redemptions / flow.issues : null;
  const rolloverText = rolloverShare === null ? "" : rolloverShare > 1 ? "같은 기간 상환액은 발행액보다 많았습니다." : rolloverShare >= 0.9 ? "거의 대부분이 기존 국채에 대한 롤오버 분량입니다." : rolloverShare >= 0.5 ? "절반 이상이 기존 국채에 대한 롤오버 분량입니다." : "기존 국채에 대한 롤오버 물량도 포함됩니다.";
  const calculationAmount = (value: number) => (value / 100).toLocaleString("ko-KR", { maximumFractionDigits: 2 });
  const topicAmount = (value: number) => {
    const amount = fmt.amount(value);
    return amount + (amount.endsWith("조") ? "는" : "은");
  };
  return <section aria-label="유동성과 국채 리뷰" className="mb-8" data-testid="liquidity-review">
    <div className="border-t-2 border-[#1A1A18] pt-6">
      <div className="text-xs text-[#918D83]">{how ? `${how.prevDate ? how.prevDate + " → " : ""}${how.date}` : "관측 자료 없음"}</div>
      <h2 className="mt-3 mb-6 text-[24px] font-semibold leading-normal sm:text-[28px]" style={{ fontFamily: "'Noto Serif KR', serif" }} data-testid="liquidity-headline">{how ? s1(how).summary.map((p, i) => <span key={i} style={{ color: p.tone === "release" ? "#1F7A4D" : p.tone === "absorb" ? "#B3402E" : undefined }}>{p.text}</span>) : "선택 주차의 유동성 관측이 없습니다."}</h2>
      <ReviewRow question="어디서?">
        <ReviewText text={liquidity.sourceIntro} />
        <ul className="list-disc space-y-2 pl-5 marker:text-[#918D83]">{liquidity.sourceItems.map(item => <li key={item.key}><ReviewText text={item.text} amounts={[mark(item.effect)]} /></li>)}</ul>
        {liquidity.sourceOffset && <ReviewText text={liquidity.sourceOffset} />}
      </ReviewRow>
      <ReviewRow question="이 유동성은 어디로?" dashed><ReviewText text={liquidity.destination} amounts={destinationAmounts} /></ReviewRow>
    </div>
    <div className="mt-6 border-t-2 border-[#1A1A18] pt-6">
      {flow && <div className="text-xs text-[#918D83]">{flow.from} → {flow.end} · 유동성과 같은 {flow.weeks}주</div>}
      <h2 className="mt-3 mb-6 text-[24px] font-semibold leading-normal sm:text-[28px]" style={{ fontFamily: "'Noto Serif KR', serif" }} data-testid="treasury-headline">{flow && !fmt.isZeroEok(flow.net) ? <>국채는 {flow.weeks}주간 순액으로 <span style={{ color: flow.net > 0 ? "#1F7A4D" : "#B3402E" }}>{fmt.amount(flow.net)} 달러 {flow.net > 0 ? "늘었습니다" : "줄었습니다"}.</span></> : debtHeadline}</h2>
      {!flow && flowError && <p className="text-xs text-[#918D83]">{flowError}</p>}
      {flow && <>
        <ReviewRow question="얼마나 발행했나?">
          <ReviewText text={`총 ${fmt.amount(flow.issues)} 달러어치 국채를 발행했습니다. ${rolloverText}`} />
          <ReviewText text={`상환액과 물가 조정을 반영하면, 국채는 ${fmt.isZeroEok(flow.net) ? "거의 변하지 않았습니다" : `순액으로 ${fmt.amount(flow.net)} 달러 ${flow.net > 0 ? "늘었습니다" : "줄었습니다"}`}. 같은 기간 단기채는 ${fmt.isZeroEok(flow.billsNet) ? "거의 변하지 않았습니다" : `${fmt.amount(flow.billsNet)} 달러 ${flow.billsNet > 0 ? "늘었습니다" : "줄었습니다"}`}.`} amounts={[mark(flow.net), mark(flow.billsNet)]} />
          <details className="text-xs text-[#918D83]" data-testid="treasury-calculation"><summary className="w-fit cursor-pointer border-b border-[#B9B4A6] pb-1">정확한 산출 방법</summary>
            <div className="mt-3 space-y-2 leading-relaxed">
              <p className="font-semibold">순증감 = 발행 − 상환 + 물가 조정</p>
              <p>{calculationAmount(flow.issues)} − {calculationAmount(flow.redemptions)} {flow.inflation < 0 ? "−" : "+"} {calculationAmount(Math.abs(flow.inflation))} = {calculationAmount(flow.net)}억 달러</p>
              <p>{flow.start}~{flow.end} · 재무부 DTS 시장성 국채 · 액면가 기준(FFB 제외). 물가 조정은 물가연동국채 원금의 증감입니다.</p>
              <p>롤오버 설명은 상환액 ÷ 발행액 기준의 근사치입니다{rolloverShare !== null ? `(약 ${(rolloverShare * 100).toFixed(1)}%)` : ""}. 실제 현금흐름·입찰 낙찰액과는 차이가 있습니다.</p>
              {(flow.baselineDate !== flow.from || flow.observedThrough !== flow.end) && <p>휴일은 직전 영업일 적용: {flow.baselineDate} → {flow.observedThrough}.</p>}
            </div>
          </details>
        </ReviewRow>
      </>}
      {!who ? <p className="py-4 text-sm text-[#5F5C54]">선택 기간의 국채 입찰 자료가 없습니다.</p> : <>
        <ReviewRow question="이걸 누가 받아갔나?" dashed>
          <ReviewText text={`낙찰된 ${fmt.amount(who.totalReported)} 달러어치 국채 가운데,\n${topicAmount(who.byBidder.indirect)} 간접 입찰자가,\n${topicAmount(who.byBidder.dealer)} 프라이머리 딜러가 가져갔습니다.\n이외에도 직접 입찰자(${fmt.amount(who.byBidder.direct)}), 연준의 만기 재투자(${fmt.amount(who.byBidder.soma)})도 있습니다.`} />
          <ReviewText className="text-xs text-[#918D83]" text="간접 입찰자는 중개기관(딜러 등)을 통해 응찰하는 펀드나 해외 중앙은행 등을 말합니다. 딜러는 입찰 참여가 요구되지만, 낙찰액 전체가 의무 인수 물량인 것은 아닙니다. 또 딜러는 이후 다른 투자자에게 국채를 되팔 수 있어, 이 금액만으로 국채 수요를 판단할 수 없습니다." />
        </ReviewRow>
      </>}
    </div>
  </section>;
}
