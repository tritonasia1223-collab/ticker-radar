import { expect, it } from 'vitest';
import { chartEditorial } from '../shared/credit/chart-editorial';

it('수동 해설을 작성한 날짜와 비교 기간에만 표시한다', () => {
  for (const id of ['h8_ci_loans', 'h8_loans_to_nondepository', 'bond-dashboard', 'leveraged_loans', 'cp-dashboard', 'bdc_price_to_nav', 'bdc_credit_quality']) {
    expect(chartEditorial(id, '2026-09-30', 4).length).toBeGreaterThan(0);
    expect(chartEditorial(id, '2026-09-23', 4)).toEqual([]);
    expect(chartEditorial(id, '2026-09-30', 13)).toEqual([]);
  }
  expect(chartEditorial('corporate_bond_issuance', '2026-09-30', 4)).toEqual([]);
});
