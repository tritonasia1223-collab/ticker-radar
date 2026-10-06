import { BIDDER_SUBJECT, type HowMuch, type WhereFrom, type WhereTo, type WhoBought, type Stress } from "./liquidity-read.js";
import { fmt } from "./liquidity-sentences.js";

const changed = (v: number) => fmt.isZeroEok(v) ? "거의 변하지 않았습니다" : `${fmt.amount(v)} 달러 ${v > 0 ? "늘었습니다" : "줄었습니다"}`;

// 왼쪽 장 요약도 본문과 같은 선택 주·비교 기간·입찰 필터를 사용한다.
export function liquidityChapters(how: HowMuch | null, from: WhereFrom | null, to: WhereTo | null, who: WhoBought | null, stress: Stress, weeks: 4 | 13) {
  const size = !how || !Number.isFinite(how.nl) ? "순유동성 자료를 확인하지 못했습니다." : `순유동성은 ${how.nl < 0 ? "−" : ""}${fmt.amount(how.nl)} 달러입니다. ${Number.isFinite(how.dNl) ? `${weeks}주간 ${changed(how.dNl)}.` : "비교 시점의 자료는 없습니다."}`;
  let source = "비교 자료가 없어 유동성 변화의 원인을 확인하지 못했습니다.";
  if (from && Number.isFinite(from.dNl)) {
    const ranked = [...from.ranked].filter(c => Number.isFinite(c.effect) && !fmt.isZeroEok(c.effect)).sort((a,b) => Math.abs(b.effect) - Math.abs(a.effect));
    const lead = ranked.find(c => Math.sign(c.effect) === Math.sign(from.dNl));
    if (fmt.isZeroEok(from.dNl)) source = ranked.length ? "유동성 방출과 흡수 요인이 상쇄돼 순변화가 작습니다." : "각 항목의 유동성 기여에 큰 변화가 없습니다.";
    else if (lead) {
      const name = lead.key === "rrp" ? lead.effect > 0 ? "역레포 자금 회수" : "역레포 예치 증가" : lead.key === "tga" ? lead.effect > 0 ? "재무부의 TGA 자금 사용" : "재무부의 TGA 잔고 확충" : lead.effect > 0 ? "연준 자산 증가" : "연준 자산 감소";
      source = `유동성 ${from.dNl > 0 ? "증가" : "감소"}의 가장 큰 요인은 ${name}입니다.`;
      if (ranked.some(c => Math.sign(c.effect) !== Math.sign(from.dNl))) source += " 반대 방향의 움직임이 일부 상쇄했습니다.";
    }
  }
  const destination = !to || !Number.isFinite(to.dReserves) || !Number.isFinite(to.dOther) ? "지급준비금의 변화는 비교 자료가 부족합니다."
    : `은행 지급준비금은 ${weeks}주간 ${changed(to.dReserves)}. 현금통화·기타 항목은 ${changed(to.dOther)}.`;
  const buyer = !who ? "국채 입찰 자료를 확인하고 있습니다." : !who.top ? "선택 기간에 집계된 국채 낙찰액이 없습니다."
    : `${who.excludeBills ? "단기채를 제외한 " : ""}국채 낙찰액의 ${(who.top.share * 100).toFixed(1)}%를 ${BIDDER_SUBJECT[who.top.bidder]}${who.top.bidder === "soma" ? "이" : "가"} 받아갔습니다. 입찰 이후의 최종 보유자와는 다릅니다.`;
  const names: Record<string, string> = { spread: "초단기 조달금리", nfci: "전반적인 금융여건", hy: "저신용 회사채의 추가 금리", loans: "연준 긴급대출" };
  const pressure = !stress.evaluated.length ? "자금시장 상태를 확인할 자료가 부족합니다."
    : stress.breached.length ? `${stress.breached.map(r => names[r.key] ?? r.name).join("·")}에서 부담 신호가 보입니다. 한 지표만으로 자금 부족을 단정하지 않습니다.`
    : `확인된 자금시장 지표에서는 뚜렷한 긴장이 보이지 않습니다.${stress.evaluated.length < stress.rows.length ? " 일부 지표는 확인이 필요합니다." : ""}`;
  return { s1: size, s2: source, s3: destination, s4: buyer, s5: pressure };
}
