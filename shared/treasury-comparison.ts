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
export function treasuryEditorial(asOf: string, weeks: number, flow: TreasuryFlow | null, current: AuctionAgg | null, previous: AuctionAgg | null, monthly: TreasuryStock[]): ChapterParagraph[] {
  if (asOf !== '2026-09-30' || weeks !== 4 || !flow || flow.end !== asOf || flow.weeks !== weeks
    || Math.round(flow.net / 100) !== -20 || Math.round(flow.billsNet / 100) !== -1391) return [];
  const shares = billShares(monthly, asOf), latest = shares.at(-1);
  const nonBills = bidderAllocation(current, NON_BILLS), before = bidderAllocation(previous, NON_BILLS);
  const bonds = bidderAllocation(current, ['bonds']), oldBonds = bidderAllocation(previous, ['bonds']);
  const eok = (v: number) => Math.round(Math.abs(v) / 100).toLocaleString('ko-KR');
  const p: ChapterParagraph[] = [
    { kind: 'analysis', text: `9월의 최근 4주에는 국채 순발행을 통한 자금 흡수가 거의 없었습니다. 순발행은 오히려 ${eok(flow.net)}억 달러 감소입니다.`, emphasis: ['국채 순발행을 통한 자금 흡수가 거의 없었습니다.'] },
    { kind: 'analysis', text: `단기채는 줄고, 중장기채 등 나머지는 늘어 합계가 0에 가까웠습니다. 단기채는 ${eok(flow.billsNet)}억 달러 순상환, 중장기채 등은 ${eok(flow.net - flow.billsNet)}억 달러 순발행입니다.`, emphasis: ['단기채는 줄고, 중장기채 등 나머지는 늘어 합계가 0에 가까웠습니다.'] },
  ];
  if (latest) {
    const earlier = shares.filter(s => s.date < latest.date && s.share >= latest.share).at(-1);
    p.push({ kind: 'analysis', text: `다만, 단기채 비중은 ${earlier ? `${earlier.date.slice(0, 4)}년 ${Number(earlier.date.slice(5, 7))}월 이후 가장 높습니다.` : '확보한 기간에서 가장 높습니다.'} 전체 시장성 국채 중 단기채 비중은 ${latest.share.toFixed(1)}%입니다 (${Number(latest.date.slice(5, 7))}월 말 기준).`, emphasis: ['단기채 비중'] });
  }
  if (nonBills && before) p.push({ kind: 'analysis', text: `중장기물은 간접·직접 입찰자 중심의 배분이 이어졌습니다. 이번 기간 간접 입찰은 ${nonBills.indirect.toFixed(1)}%, 직접 입찰은 ${nonBills.direct.toFixed(1)}%입니다. 프라이머리 딜러 몫은 직전 4주 ${before.dealer.toFixed(1)}%에서 ${nonBills.dealer.toFixed(1)}%로 소폭 상승했습니다.`, emphasis: ['간접·직접 입찰자 중심의 배분이 이어졌습니다.'] });
  if (bonds && oldBonds) p.push({ kind: 'analysis', text: `특히 장기채는 간접 입찰 비중이 크게 늘었습니다. 낙찰액 ${eok(bonds.total)}억 달러 가운데 간접 입찰이 ${bonds.indirect.toFixed(1)}%로, 직전 4주의 ${oldBonds.indirect.toFixed(1)}%보다 높아졌습니다. 높은 수익률이 매수 유인으로 작용했을 가능성이 있습니다.`, emphasis: ['장기채는 간접 입찰 비중이 크게 늘었습니다.'] });
  p.push({ kind: 'explanation', text: `순발행·입찰 비교: ${flow.start}~${flow.end}, 직전 ${previous?.start ?? '—'}~${previous?.end ?? '—'}. 순발행만으로 전체 유동성 효과를 계산할 수 없고, 낙찰자 비중만으로 수요 강도나 매수 동기를 확정하지 않습니다.` });
  return p;
}
