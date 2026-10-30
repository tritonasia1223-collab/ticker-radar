import { expect, it } from 'vitest';
import { weeklyEditorial, weeklyEditorialNote } from '../shared/weekly-editorial';
import { overviewEditorial, amountEditorial } from '../shared/liquidity-editorial';
import { fundingReadingByChart } from '../shared/funding-editorial';
import { chartEditorial } from '../shared/credit/chart-editorial';
import { treasuryEditorialByChart } from '../shared/treasury-comparison';

it('새 주차의 각 진입점에서 해당 그래프 해설을 연결한다', () => {
  expect(overviewEditorial('2026-10-21')[0].text).toContain('686억');
  expect(weeklyEditorial('source','2026-10-21')[0].text).toContain('돈을 풀었던');
  expect(fundingReadingByChart('2026-10-21',4,-2,true).facilities[0].text).toContain('92억');
  expect(chartEditorial('bond-dashboard','2026-10-21',4)[0].text).toContain('21bp');
  expect(treasuryEditorialByChart('2026-10-21',4,{end:'2026-10-21',weeks:4} as any,{} as any,{} as any,[]).issuance[0].text).toContain('538억');
});
it('과거 주차와 없는 주차를 섞지 않고 생략한 블록을 비워둔다', () => {
  expect(overviewEditorial('2026-10-14')[0].text).toContain('150억');
  expect(weeklyEditorial('overview','2026-11-04')).toEqual([]);
  expect(chartEditorial('sloos_ci_standards','2026-10-21',4)).toEqual([]);
  expect(amountEditorial('2026-10-21',4)).toEqual([]);
  expect(weeklyEditorial('source','2026-10-21',13)).toEqual([]);
  expect(weeklyEditorialNote('ownership','2026-10-21')).toContain('새 분기 관측이 없어');
  expect(weeklyEditorialNote('h8_ci_loans','2026-10-21')).toContain('10월 7일');
});
it('10월 28일 새 관측과 자료 지연 안내를 해당 주차에만 연결한다', () => {
  expect(overviewEditorial('2026-10-28')[0].text).toContain('TGA');
  expect(fundingReadingByChart('2026-10-28',4,4,true).spread[0].text).toContain('+4bp');
  expect(chartEditorial('bdc_credit_quality','2026-10-28',4)[0].text).toContain('새 장부');
  expect(weeklyEditorialNote('auctions','2026-10-28')).toContain('갱신 지연');
  expect(weeklyEditorialNote('ownership','2026-10-28')).toContain('새 분기 관측');
  expect(chartEditorial('corporate_bond_issuance','2026-10-28',4)).toEqual([]);
});
