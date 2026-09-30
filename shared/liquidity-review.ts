// B안 상단 리뷰 문장. 작성 규칙: docs/LIQUIDITY-REVIEW-RULES.md
import { BIDDER_SUBJECT, type Contribution, type WhereFrom, type WhereTo, type WhoBought } from "./liquidity-read.js";
import { fmt } from "./liquidity-sentences.js";

const amount = (value: number) => `${fmt.amount(value)} 달러`;
const sourceName = (c: Contribution) => c.key === "rrp" ? `역레포 ${c.own < 0 ? "감소" : "증가"}` : c.key === "tga" ? `TGA 자금 ${c.own < 0 ? "사용" : "축적"}` : `연준 자산 ${c.own < 0 ? "감소" : "증가"}`;
function sourceSentence(c: Contribution, from: WhereFrom) {
  if (c.key === "rrp") return c.effect > 0 ? `MMF 등이 연준 역레포에 맡겨둔 돈 ${amount(c.effect)}를 순회수했습니다.` : `MMF 등이 연준 역레포에 ${amount(c.effect)}를 추가로 맡겼습니다.`;
  if (c.key === "tga") return c.effect > 0 ? `재무부는 TGA에 보관하던 자금을 사용해 순액으로 ${amount(c.effect)}를 시중에 풀었습니다.` : `재무부는 TGA에 ${amount(c.effect)}를 더 쌓아 시중 유동성을 흡수했습니다.`;
  const detail = from.fedDetail.filter(d => ["treast", "mbs"].includes(d.key) && !fmt.isZeroEok(d.value)).map(d => `${d.key === "treast" ? "국채 보유" : "MBS"} ${d.value > 0 ? "증가" : "감소"}`).join(", ");
  return `연준 자산 재조정 과정에서 순액으로 ${amount(c.effect)}가 ${c.effect > 0 ? "시중에 풀렸습니다" : "시중에서 회수됐습니다"}.${detail ? ` (${detail})` : ""}`;
}

export function liquidityReview(from: WhereFrom | null, to: WhereTo | null) {
  const active = from?.ranked.filter(c => Number.isFinite(c.effect) && !fmt.isZeroEok(c.effect)) ?? [];
  const sourceIntro = !from ? "비교 주차 자료가 없어 증감 요인을 계산할 수 없습니다." : !active.length ? "재무부·역레포·연준 자산에 뚜렷한 변화가 없습니다." : `${active.length === 1 ? "변화를 만든 요인은" : "가장 크게 작용한 요인은"} ${sourceName(active[0])}입니다.`;
  const sourceItems = active.map(c => ({ key: c.key, label: c.key === "fed" ? "연준 자산 재조정" : sourceName(c), text: sourceSentence(c, from!), effect: c.effect }));
  const sourceOffset = active.some(c => c.effect > 0) && active.some(c => c.effect < 0) ? "유동성을 늘린 요인과 줄인 요인이 일부 상쇄됐습니다." : "";
  const source = [sourceIntro, ...sourceItems.map(item => `${item.label}: ${item.text}`), sourceOffset].filter(Boolean).join(" ");
  const destination = !to ? "비교 주차 자료가 없어 잔액 변화를 계산할 수 없습니다." :
    to.resShare >= 0.5 && to.resShare <= 1 && !fmt.isZeroEok(to.dNl) ?
      `${to.dNl > 0 ? "늘어난" : "줄어든"} 유동성${to.resShare > 0.5 ? " 대부분" : "의 절반"}은 은행 지급준비금 ${to.dReserves > 0 ? "증가" : "감소"}(${fmt.signedEok(to.dReserves)} 달러)로 나타났습니다. ${fmt.isZeroEok(to.dOther) ? "현금통화·기타 잔액은 거의 변하지 않았습니다." : `나머지 ${amount(to.dOther)}는 현금통화·기타 항목의 ${to.dOther > 0 ? "증가분" : "감소분"}입니다.`}` :
      `같은 기간 은행 지급준비금은 ${fmt.isZeroEok(to.dReserves) ? "변화가 없고" : `${amount(to.dReserves)} ${to.dReserves > 0 ? "늘었고" : "줄었고"}`}, 현금통화·기타는 ${fmt.isZeroEok(to.dOther) ? "변화가 없습니다" : `${amount(to.dOther)} ${to.dOther > 0 ? "늘었습니다" : "줄었습니다"}`}.`;
  return { source, sourceIntro, sourceItems, sourceOffset, destination };
}

export function treasuryReview(who: WhoBought) {
  const net = who.netIssuance, bills = who.billsNet;
  const aligned = !!net && !!bills && net.from.date === bills.from.date && net.to.date === bills.to.date;
  // 전체 순증가가 양수이고 단기채도 0~전체 순증가 범위일 때만 구성비로 쓴다.
  const billPercent = aligned && net!.delta > 0 && bills!.delta >= 0 && bills!.delta <= net!.delta ? bills!.delta / net!.delta * 100 : null;
  const issuance = `${fmt.dateKo(who.start)}~${fmt.dateKo(who.end)} 결제 기준${who.excludeBills ? " 단기채를 제외한" : ""} 국채 발행 총액은 ${amount(who.totalReported)}입니다. 만기가 돌아온 기존 국채를 갚기 위한 재발행(롤오버) 물량도 포함돼 있습니다.`;
  const netText = net ? `${fmt.monthKo(net.from.date)} 말~${fmt.monthKo(net.to.date)} 말 전체 시장성 국채 잔액은 ${fmt.isZeroEok(net.delta) ? "거의 변하지 않았습니다" : `${amount(net.delta)} ${net.delta > 0 ? "늘었습니다" : "줄었습니다"}`}.` : "해당 기간의 월간 국채 잔액 자료가 없어 순증감을 계산할 수 없습니다.";
  const billsText = !aligned ? "" : billPercent !== null ? ` 이 가운데 ${amount(bills!.delta)}(약 ${billPercent.toFixed(1)}%)가 단기채입니다.` : ` 같은 기간 단기채 잔액은 ${fmt.isZeroEok(bills!.delta) ? "거의 변하지 않았습니다" : `${amount(bills!.delta)} ${bills!.delta > 0 ? "늘었습니다" : "줄었습니다"}`}.`;
  const buyers = !who.top ? "집계된 입찰이 없습니다." : `발행액 ${amount(who.totalReported)} 가운데 가장 큰 몫인 ${amount(who.top.value)}를 ${BIDDER_SUBJECT[who.top.bidder]}${who.top.bidder === "soma" ? "이" : "가"} ${who.top.bidder === "soma" ? "만기 국채 재투자로 인수했습니다" : "낙찰받았습니다"}.`;
  const allocations = `프라이머리 딜러가 자기 계정으로 낙찰받은 금액은 ${amount(who.byBidder.dealer)}입니다. 직접 입찰자는 ${amount(who.byBidder.direct)}, 연준의 만기 국채 재투자(SOMA 롤오버)는 ${amount(who.byBidder.soma)}입니다.`;
  return { issuance, net: netText + billsText, buyers, allocations, billPercent,
    periodMismatch: !!net && (who.start !== net.from.date || who.end !== net.to.date),
    difference: who.totalReported - who.totalAttributed };
}
