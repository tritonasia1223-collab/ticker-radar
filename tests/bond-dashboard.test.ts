import { describe, expect, it } from 'vitest';
import { bondDashboard } from '../shared/credit/bond-dashboard';
import type { IndicatorAnalysis } from '../shared/credit/signals';

const data = [{ id: 'ig_oas', lines: [{ points: [
  { date: '2023-09-29', value: 9 }, { date: '2025-09-30', value: 1 },
  { date: '2026-09-02', value: 2 }, { date: '2026-09-29', value: 3 },
  { date: '2026-10-01', value: 99 },
] }], comparisonLines: [{ points: [{ date: '2026-09-30', value: 6 }] }] }] as IndicatorAnalysis[];

describe('회사채 비교 대시보드', () => {
  it('선택일 이후 자료와 3년 밖 자료를 제외하고 각 비교일의 직전 관측을 사용한다', () => {
    const d = bondDashboard(data, '2026-09-30', 4, 'oas');
    expect(d.series[0].current).toEqual({ date: '2026-09-29', value: 3 });
    expect(d.series[0].previous?.value).toBe(2);
    expect(d.series[0].annual?.value).toBe(1);
    expect(d.rows.map(p => p.date)).toEqual(['2025-09-30', '2026-09-02', '2026-09-29']);
    expect(d.rows[0].hy_oas).toBeNull();
    expect(d.series[1].current).toBeNull();
  });
  it('시장금리 전환은 실제 금리 계열을 사용하고 없는 과거 비교값을 만들지 않는다', () => {
    const d = bondDashboard(data, '2026-09-30', 13, 'yield');
    expect(d.series[0].current?.value).toBe(6);
    expect(d.series[0].previous).toBeNull();
    expect(d.series[0].annual).toBeNull();
    expect(d.previous).toBe('2026-07-01');
  });
  it('일주일 넘게 오래된 관측을 현재값으로 표시하지 않는다', () => {
    expect(bondDashboard(data, '2026-10-10', 4, 'oas').series[0].current).toBeNull();
  });
});
