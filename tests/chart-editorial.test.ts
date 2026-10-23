import { expect, it } from 'vitest';
import { chartEditorial } from '../shared/credit/chart-editorial';
import { octoberWeekTwoEditorial, octoberWeekTwoNote } from '../shared/october-week-two-editorial';

it('2주차 문안은 다른 주차로 번지지 않고 기존 H.8 해설을 유지한다', () => {
  for (const id of ['h8_ci_loans', 'h8_loans_to_nondepository']) {
    expect(chartEditorial(id, '2026-10-14', 4)).toEqual(chartEditorial(id, '2026-10-07', 4));
    expect(octoberWeekTwoNote(id, '2026-10-14')).toContain('새 관측이 없어');
  }
  for (const id of ['bond-dashboard', 'cp-dashboard', 'bdc_price_to_nav']) {
    expect(chartEditorial(id, '2026-10-14', 4).length).toBeGreaterThan(0);
    expect(chartEditorial(id, '2026-10-28', 4)).toEqual([]);
    expect(chartEditorial(id, '2026-10-14', 13)).toEqual([]);
  }
  for (const id of ['overview', 'source', 'destination', 'ownership']) {
    expect(octoberWeekTwoEditorial(id, '2026-10-14').length).toBeGreaterThan(0);
    expect(octoberWeekTwoEditorial(id, '2026-10-07')).toEqual([]);
  }
  for (const id of ['bond-dashboard', 'cp-dashboard', 'bdc_price_to_nav', 'spread', 'nfci', 'facilities']) {
    expect(octoberWeekTwoNote(id, '2026-10-14')).toBeUndefined();
  }
});

it('수동 해설을 작성한 날짜와 비교 기간에만 표시한다', () => {
  for (const id of ['h8_ci_loans', 'h8_loans_to_nondepository', 'bond-dashboard', 'leveraged_loans', 'cp-dashboard', 'bdc_price_to_nav', 'bdc_credit_quality']) {
    expect(chartEditorial(id, '2026-09-30', 4).length).toBeGreaterThan(0);
    expect(chartEditorial(id, '2026-09-23', 4)).toEqual([]);
    expect(chartEditorial(id, '2026-09-30', 13)).toEqual([]);
  }
  expect(chartEditorial('corporate_bond_issuance', '2026-09-30', 4)).toEqual([]);
});
