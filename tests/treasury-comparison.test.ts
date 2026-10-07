import { describe, expect, it } from 'vitest';
import { aggregateAuctions, type AuctionRow } from '../shared/liquidity-beta';
import { bidderAllocation, billShares, NON_BILLS, treasuryEditorial } from '../shared/treasury-comparison';

function auction(type: string, total: number, indirect: number, soma: number): AuctionRow {
  return { security_type: type, issue_date: '2026-09-10', total_accepted: total * 1e6, primary_dealer_accepted: 0, direct_bidder_accepted: (total - indirect - soma) * 1e6, indirect_bidder_accepted: indirect * 1e6, soma_accepted: soma * 1e6, noncomp_accepted: 0 };
}
describe('국채 기간 비교', () => {
  it('만기를 분리하고 SOMA를 분모에서 제외하지 않는다', () => {
    const agg = aggregateAuctions([auction('Bill', 900, 450, 0), auction('Note', 100, 50, 20), auction('Bond', 50, 40, 0)], '2026-09-03', '2026-09-30');
    expect(bidderAllocation(agg, NON_BILLS)?.total).toBe(150);
    expect(bidderAllocation(agg, NON_BILLS)?.indirect).toBe(60);
    expect(bidderAllocation(agg, ['bonds'])?.indirect).toBe(80);
    expect(bidderAllocation({ ...agg, skipped: 1 }, NON_BILLS)).toBeNull();
    expect(bidderAllocation(null, NON_BILLS)).toBeNull();
  });
  it('단기채 비중에 미래 월말 또는 결측 잔액을 넣지 않는다', () => {
    expect(billShares([{ date: '2026-08-31', bills: 20, total: 100 }, { date: '2026-10-31', bills: 30, total: 100 }, { date: '2026-07-31', bills: 1, total: 0 }], '2026-09-30')).toEqual([{ date: '2026-08-31', share: 20 }]);
  });
  it('지정 문안은 데이터가 없거나 다른 주차에는 나타나지 않는다', () => {
    expect(treasuryEditorial('2026-09-30', 4, null, null, null, [])).toEqual([]);
    expect(treasuryEditorial('2026-09-23', 4, null, null, null, [])).toEqual([]);
  });
});
