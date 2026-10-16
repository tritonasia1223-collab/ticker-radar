import { expect, it } from 'vitest';
import { liquidityPeriods } from '../shared/liquidity-periods';

const history = [
  { date: '2026-07-08', total: 6750000, tga: 800000, rrp: 350000 },
  { date: '2026-09-09', total: 6740619, tga: 843705, rrp: 349663 },
  { date: '2026-09-30', total: 6743031, tga: 984046, rrp: 361883 },
  { date: '2026-10-07', total: 6747560, tga: 885783, rrp: 333739 },
];
it('주간 반등과 4주 감소를 동시에 계산하고 선택일 이후 값은 사용하지 않는다', () => {
  const result = liquidityPeriods(history, '2026-10-07');
  expect(result[1].change).toBe(130936);
  expect(result[4].change).toBe(-19213);
  expect(result[13].change).toBe(-71962);
  expect(liquidityPeriods(history, '2026-09-30')[1].change).toBeNull();
});
it('정확한 비교 주차가 없거나 값이 결측이면 0으로 표시하지 않는다', () => {
  expect(liquidityPeriods(history.slice(1), '2026-10-07')[13].change).toBeNull();
  expect(liquidityPeriods(history.map(p => p.date === '2026-09-30' ? { ...p, rrp: NaN } : p), '2026-10-07')[1].change).toBeNull();
  expect(liquidityPeriods(history, '')[1].change).toBeNull();
});
