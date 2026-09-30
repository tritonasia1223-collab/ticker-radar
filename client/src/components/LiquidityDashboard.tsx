import type { ReactNode } from "react";
import { type HowMuch, type WhereFrom, type WhereTo, type WhoBought, type Stress } from "@shared/liquidity-read";
import { fmt, s1 } from "@shared/liquidity-sentences";
import { liquidityReview, treasuryReview } from "@shared/liquidity-review";
import { ReviewText } from "./ReviewText";

function ReviewRow({ question, children, dashed = false }: { question: string; children: ReactNode; dashed?: boolean }) {
  return <div className={`grid gap-2 py-5 md:grid-cols-[130px_minmax(0,1fr)] md:gap-6 border-t border-[#D9D5CA] ${dashed ? "border-dashed" : ""}`}>
    <h3 className="text-sm font-semibold leading-relaxed">{question}</h3>
    <div className="space-y-3 text-[15px] leading-[1.85] text-[#3B3934]">{children}</div>
  </div>;
}

export function LiquidityDashboard({ how, from, to, who, stress, alerts }: { how: HowMuch | null; from: WhereFrom | null; to: WhereTo | null; who: WhoBought | null; stress: Stress; alerts: ReactNode }) {
  const liquidity = liquidityReview(from, to);
  const treasury = who ? treasuryReview(who) : null;
  const mark = (value: number, signed = false) => ({ text: `${signed ? fmt.signedEok(value) : fmt.amount(value)} 달러`, value });
  const sourceAmounts = from?.ranked.filter(c => Number.isFinite(c.effect) && !fmt.isZeroEok(c.effect)).map(c => mark(c.effect)) ?? [];
  const destinationAmounts = to ? [
    ...(!fmt.isZeroEok(to.dReserves) ? [mark(to.dReserves, to.resShare >= 0.5 && to.resShare <= 1 && !fmt.isZeroEok(to.dNl))] : []),
    ...(!fmt.isZeroEok(to.dOther) ? [mark(to.dOther)] : []),
  ] : [];
  const net = who?.netIssuance, bills = who?.billsNet;
  const aligned = net && bills && net.from.date === bills.from.date && net.to.date === bills.to.date;
  const treasuryAmounts = [
    ...(net && !fmt.isZeroEok(net.delta) ? [mark(net.delta)] : []),
    ...(aligned && (treasury?.billPercent != null || !fmt.isZeroEok(bills.delta)) ? [mark(bills.delta)] : []),
  ];
  return <section aria-label="유동성과 국채 리뷰" className="mb-8" data-testid="liquidity-review">
    <div className="border-t-2 border-[#1A1A18] pt-6">
      <div className="text-xs text-[#918D83]">{how ? `${how.prevDate ? how.prevDate + " → " : ""}${how.date}` : "관측 자료 없음"}</div>
      <h2 className="mt-3 mb-6 text-[24px] font-semibold leading-normal sm:text-[28px]" style={{ fontFamily: "'Noto Serif KR', serif" }} data-testid="liquidity-headline">{how ? s1(how).summary.map((p, i) => <span key={i} style={{ color: p.tone === "release" ? "#1F7A4D" : p.tone === "absorb" ? "#B3402E" : undefined }}>{p.text}</span>) : "선택 주차의 유동성 관측이 없습니다."}</h2>
      <ReviewRow question="어디서?"><ReviewText text={liquidity.source} amounts={sourceAmounts} /></ReviewRow>
      <ReviewRow question="이 유동성은 어디로?" dashed><ReviewText text={liquidity.destination} amounts={destinationAmounts} /></ReviewRow>
    </div>
    <div className="mt-6 border-t-2 border-[#1A1A18] pt-6">
      <h2 className="mb-5 text-xl font-semibold" style={{ fontFamily: "'Noto Serif KR', serif" }}>국채 리뷰</h2>
      {!treasury || !who ? <p className="py-4 text-sm text-[#5F5C54]">선택 기간의 국채 입찰 자료가 없습니다.</p> : <>
        <ReviewRow question="국채는 얼마나 발행됐나?"><ReviewText text={treasury.issuance} /></ReviewRow>
        <ReviewRow question={who.netIssuance && who.netIssuance.delta < 0 ? "국채 잔액은 얼마나 줄었나?" : "실제로 늘어난 국채는?"}><ReviewText text={treasury.net} amounts={treasuryAmounts} />
          {treasury.periodMismatch && <p className="text-xs text-[#918D83]">발행액과 순증감의 집계 기간이 달라 직접 대조할 수 없습니다.</p>}
          <details className="text-xs text-[#918D83]" data-testid="treasury-calculation"><summary className="w-fit cursor-pointer border-b border-[#B9B4A6] pb-1">정확한 산출 방법</summary>
            <div className="mt-3 space-y-2 rounded-lg bg-[#EFEEE8] p-4 leading-relaxed">
              <p>발행액: {who.start}~{who.end} 결제된 {who.counted}건의 보고 총액 합계. {who.excludeBills ? "단기채 제외." : "전체 만기 포함."} <br />상환액을 차감하지 않은 총발행액입니다.</p>
              {who.netIssuance && <p>전체 시장성 국채 순증감: {fmt.monthKo(who.netIssuance.to.date)} 말 잔액 − {fmt.monthKo(who.netIssuance.from.date)} 말 잔액 = {fmt.signedEok(who.netIssuance.delta)} 달러.<br />입찰 총액에서 롤오버를 추정해 뺀 값이 아닙니다.</p>}
              {treasury.billPercent !== null && who.billsNet && who.netIssuance && <p>단기채 비중: 같은 월말 구간의 단기채 순증가 {fmt.eok(who.billsNet.delta)}억 ÷ 전체 순증가 {fmt.eok(who.netIssuance.delta)}억 × 100 = {treasury.billPercent.toFixed(1)}%.<br />반올림 전 원자료로 계산합니다.</p>}
              <p>낙찰 주체별 금액은 각 분류를 직접 합산합니다. 비경쟁·기타는 {fmt.amount(who.byBidder.noncomp)} 달러이며, 딜러 금액을 다른 항목 차감으로 역산하지 않습니다.</p>
              {!fmt.isZeroEok(treasury.difference) && <p>보고 총액과 표시된 분류 합계의 차이는 {fmt.signedEok(treasury.difference)} 달러입니다.<br />이 차액은 특정 주체에 임의로 배분하지 않습니다.</p>}
              <ReviewText text="SOMA는 입찰에서의 만기 국채 재투자이며, 연준의 순매입액이 아닙니다. 유동성 기여액은 Δ연준 자산 − ΔTGA − Δ역레포로 계산합니다. 역레포 회수와 TGA 사용은 입출금 상계 후 순액입니다. 지급준비금·현금통화·기타는 같은 기간의 회계상 잔액 변화로, 특정 자금의 이동 경로를 추적한 값이 아닙니다." />
            </div>
          </details>
        </ReviewRow>
        <ReviewRow question="발행한 국채는 누가 받아갔나?"><ReviewText text={treasury.buyers} />
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
