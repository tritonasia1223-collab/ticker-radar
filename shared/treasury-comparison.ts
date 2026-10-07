import { BIDDERS, type AuctionAgg, type Bidder, type Maturity } from './liquidity-beta.js';
import type { TreasuryFlow } from './treasury-flow.js';
import type { ChapterParagraph } from './credit/chapter-reading.js';

export interface TreasuryStock { date: string; total: number; bills: number }
export function billShares(monthly: TreasuryStock[], asOf: string) {
  return monthly.filter(m => m.date <= asOf && Number.isFinite(m.total) && m.total > 0 && Number.isFinite(m.bills))
    .sort((a, b) => a.date.localeCompare(b.date)).map(m => ({ date: m.date, share: m.bills / m.total * 100 }));
}

/** 생키와 동일하게 SOMA·비경쟁을 포함한 전체 낙찰액을 분모로 쓴다. */
export function bidderAllocation(agg: AuctionAgg | null, maturities: Maturity[]) {
  if (!agg || agg.skipped || agg.unknownTypes.length || !maturities.some(m => agg.countedByMaturity[m] > 0)) return null;
  const total = maturities.reduce((sum, m) => sum + agg.reported[m], 0);
  if (!Number.isFinite(total) || total <= 0) return null;
  const amounts = Object.fromEntries(BIDDERS.map(b => [b, maturities.reduce((sum, m) => sum + agg.matrix[m][b], 0)])) as Record<Bidder, number>;
  if (Object.values(amounts).some(v => !Number.isFinite(v) || v < 0)) return null;
  const allocated = Object.values(amounts).reduce((sum, v) => sum + v, 0);
  // 미배분·반올림 차이는 기타로 남기고 전체를 다시 100%로 정규화하지 않는다.
  if (allocated > total * 1.001) return null;
  return { total, ...Object.fromEntries(BIDDERS.map(b => [b, amounts[b] / total * 100])), other: Math.max(0, total - allocated) / total * 100 } as { total: number; other: number } & Record<Bidder, number>;
}

export const NON_BILLS: Maturity[] = ['notes', 'bonds', 'tips', 'frn'];

/** 사용자가 지정한 9월 해설만 해당 주차에 표시한다. 다른 주차에 자동 문안을 채우지 않는다. */
export function treasuryEditorialByChart(asOf: string, weeks: number, flow: TreasuryFlow | null, current: AuctionAgg | null, previous: AuctionAgg | null, monthly: TreasuryStock[]): { issuance: ChapterParagraph[]; auctions: ChapterParagraph[] } {
  if (asOf !== '2026-09-30' || weeks !== 4 || !flow || flow.end !== asOf || flow.weeks !== weeks
    || Math.round(flow.net / 100) !== -20 || Math.round(flow.billsNet / 100) !== -1391) return { issuance: [], auctions: [] };
  const issuance: ChapterParagraph[] = [
    { kind: 'analysis', text: '7월 구간 4천억 달러 대, 8월 구간 3천억 달러씩 늘던 잔액이 9월 구간에는 20억 달러 줄었습니다.' },
    { kind: 'analysis', text: '바뀐 것은 단기채입니다. 7월 구간에 3,405억 달러를 늘렸던 단기채가 9월 구간에는 1,391억 달러 순상환으로 돌아섰습니다. 반면 중장기채는 688억, 1,140억, 1,371억 달러로 매 구간 늘었습니다.' },
    { kind: 'analysis', text: '그래서 9월은 총량은 그대로인데 구성이 달라진 구간입니다. 단기채를 들고 있던 쪽(주로 MMF)에는 현금이 돌아왔고, 시장이 새로 소화해야 하는 물량은 만기가 긴 채권으로 옮겨갔습니다.' },
  ];
  const auctions: ChapterParagraph[] = current && previous ? [
    { kind: 'analysis', text: '금리가 급등한 4주였지만 국채 수요는 무너지지 않았습니다.' },
    { kind: 'analysis', text: '장기채 수요가 특히 강했습니다. 장기채 350억 달러 가운데 간접 입찰이 69.2%를 가져가 직전 4주(53.9%)보다 크게 늘었습니다. 금리가 오르자 그 수익률을 보고 들어온 매수로 보입니다.' },
    { kind: 'analysis', text: '다만 딜러 몫이 직전 4주 10.6%에서 조금 올랐습니다. 아직은 정상 범위이지만, 이 비중이 계속 오르면 시장이 물량을 버거워하기 시작했다는 신호입니다.' },
  ] : [];
  return { issuance, auctions };
}

export function treasuryEditorial(asOf: string, weeks: number, flow: TreasuryFlow | null, current: AuctionAgg | null, previous: AuctionAgg | null, monthly: TreasuryStock[]): ChapterParagraph[] {
  const groups = treasuryEditorialByChart(asOf, weeks, flow, current, previous, monthly);
  return [...groups.issuance, ...groups.auctions];
}
