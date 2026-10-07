import { expect, it } from 'vitest';
import { bondRateDecomposition } from '../shared/credit/bond-rate-decomposition';
import type { IndicatorAnalysis } from '../shared/credit/signals';

function sample(yields: [string, number][], spreads: [string, number][]): IndicatorAnalysis[] {
  const points = (items: [string, number][]) => items.map(([date, value]) => ({ date, value }));
  return [{ id: 'ig_oas', comparisonLines: [{ points: points(yields) }], lines: [{ points: points(spreads) }] }] as IndicatorAnalysis[];
}

it('금리 변화에서 OAS 변화를 분리하고 합계를 보존한다', () => {
  const data = sample([['2026-09-02',5.52],['2026-09-30',6.02]], [['2026-09-02',0.7],['2026-09-30',0.73]]);
  const change = bondRateDecomposition(data, '2026-09-30', 4).rows[0].change!;
  expect(change.total).toBeCloseTo(0.5);
  expect(change.premium).toBeCloseTo(0.03);
  expect(change.treasury).toBeCloseTo(0.47);
  expect(change.treasury + change.premium).toBeCloseTo(change.total);
});

it('서로 다른 날짜와 미래값을 섞지 않고 오래된 결측은 남긴다', () => {
  const data = sample([['2026-09-02',5],['2026-09-29',6],['2026-09-30',8],['2026-10-01',99]], [['2026-09-02',1],['2026-09-29',1.5],['2026-10-01',99]]);
  const result = bondRateDecomposition(data, '2026-09-30', 4);
  expect(result.rows[0].change).toMatchObject({ from: '2026-09-02', to: '2026-09-29', total: 1, premium: 0.5 });
  expect(result.rows[1].change).toBeNull();
  expect(bondRateDecomposition(data, '2026-10-20', 4).rows[0].change).toBeNull();
});

it('1년 비교에서 상승·하락 기여가 상쇄돼도 각각의 부호를 유지한다', () => {
  const data = sample([['2025-09-30',6],['2026-09-30',5.5]], [['2025-09-30',1],['2026-09-30',1.5]]);
  const result = bondRateDecomposition(data, '2026-09-30', 'year');
  expect(result.previous).toBe('2025-09-30');
  expect(result.rows[0].change).toMatchObject({ total: -0.5, treasury: -1, premium: 0.5 });
  expect(result.domain).toEqual([-1, 0.5]);
});
