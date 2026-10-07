import { expect, it } from 'vitest';
import { currentDrawdown } from '../shared/credit/drawdown';

it('표시 기간 밖의 고점과 선택일 이후 자료를 제외하고 현재 낙폭을 계산한다', () => {
  const result = currentDrawdown([
    {date:'2022-01-01',value:200}, {date:'2026-10-01',value:300},
    {date:'2026-09-30',value:90}, {date:'2026-08-01',value:100}, {date:'2026-07-01',value:80},
  ], '2023-09-30', '2026-09-30');
  expect(result?.peak.date).toBe('2026-08-01');
  expect(result?.latest.date).toBe('2026-09-30');
  expect(result?.percent).toBeCloseTo(-10);
});

it('고점을 회복하면 과거 최대 낙폭 대신 현재 낙폭 0을 표시한다', () => {
  const result = currentDrawdown([{date:'2026-07-01',value:100}, {date:'2026-08-01',value:70}, {date:'2026-09-30',value:100}], '2023-09-30', '2026-09-30');
  expect(result?.percent).toBe(0);
  expect(result?.peak.date).toBe('2026-09-30');
});

it('유효한 비교 관측이 부족하면 0%로 채우지 않는다', () => {
  expect(currentDrawdown([], '2023-09-30', '2026-09-30')).toBeNull();
  expect(currentDrawdown([{date:'2026-09-01',value:0}, {date:'2026-09-30',value:100}], '2023-09-30', '2026-09-30')).toBeNull();
});
