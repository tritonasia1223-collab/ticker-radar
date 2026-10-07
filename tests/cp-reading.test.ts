import { describe, expect, it } from 'vitest';
import { readingIndicators, type Snapshot } from '../shared/credit/schema';
import { analyze } from '../shared/credit/signals';
import { cpDashboard } from '../shared/credit/cp-dashboard';

const snapshot: Snapshot = { version: 1, collectedAt: '2026-10-07T00:00:00Z', configHash: 'test', series: [
  { key: 'RIFSPPNA2P2D90NB', points: [{date:'2026-09-23',value:4.4},{date:'2026-09-24',value:4.5},{date:'2026-10-05',value:9}] },
  { key: 'DCPN3M', points: [{date:'2026-09-23',value:4.1},{date:'2026-09-25',value:4.2},{date:'2026-10-05',value:7}] },
  { key: 'DTB3', points: [{date:'2026-09-23',value:3.9},{date:'2026-09-24',value:4},{date:'2026-09-25',value:4},{date:'2026-10-05',value:5}] },
].map(s => ({...s, checkedAt:'2026-10-07T00:00:00Z', transport:'검증용', notes:[]})) };

describe('B안 CP 금리차 분해', () => {
  it('통합 그래프는 세 금리의 공통 관측일과 실제값을 사용하고 축만 좁힌다', () => {
    const data = analyze(snapshot, '2026-09-30', 'observation', readingIndicators);
    const chart = cpDashboard(data, '2026-09-30');
    expect(chart.rows).toHaveLength(1);
    expect(chart.current).toMatchObject({date:'2026-09-23',bill:3.9,aa:4.1,a2:4.4});
    expect(chart.current!.aaSpread).toBeCloseTo(0.2);
    expect(chart.current!.creditSpread).toBeCloseTo(0.3);
    expect(chart.domain[0]).toBeGreaterThan(0);
    expect(chart.domain[0]).toBeLessThan(3.9);
    expect(chart.domain[1]).toBeGreaterThan(4.4);
    expect(chart.domain[1]).toBeLessThan(5);
  });
  it('공통 관측이 없으면 최신값을 억지로 조합하지 않는다', () => {
    const data = analyze({...snapshot,series:snapshot.series.filter(s=>s.key!=='DTB3')}, '2026-09-30', 'observation', readingIndicators);
    expect(cpDashboard(data, '2026-09-30').current).toBeNull();
  });
  it('금리 순서가 뒤집혀도 음수 스프레드와 원금리를 유지한다', () => {
    const reversed = {...snapshot,series:snapshot.series.map(s=>({...s,points:[{date:'2026-09-23',value:s.key==='RIFSPPNA2P2D90NB'?3.8:s.key==='DCPN3M'?4.1:4.2}]}))};
    const chart = cpDashboard(analyze(reversed,'2026-09-30','observation',readingIndicators),'2026-09-30');
    expect(chart.current!.creditSpread).toBeCloseTo(-0.3);
    expect(chart.current!.aaSpread).toBeCloseTo(-0.1);
    expect(chart.current!.a2).toBe(3.8);
  });
  it('같은 날짜의 두 금리차 합계는 기존 A2/P2-국채 차이와 일치한다', () => {
    const result = analyze(snapshot,'2026-09-30','observation',readingIndicators);
    expect(result).toHaveLength(2);
    const a=result[0].lines[0].points.find(p=>p.date==='2026-09-23')!;
    const b=result[1].lines[0].points.find(p=>p.date==='2026-09-23')!;
    expect(a.value).toBeCloseTo(0.3);
    expect(b.value).toBeCloseTo(0.2);
    expect(a.value+b.value).toBeCloseTo(4.4-3.9);
  });
  it('결측 금리를 다른 날 값으로 채우지 않고 선택일 이후 관측을 제외한다', () => {
    const result=analyze(snapshot,'2026-09-30','observation',readingIndicators);
    expect(result[0].lines[0].points.map(p=>p.date)).toEqual(['2026-09-23']);
    expect(result[1].lines[0].points.map(p=>p.date)).toEqual(['2026-09-23','2026-09-25']);
    for(const r of result)for(const l of r.comparisonLines!)expect(l.points.map(p=>p.date)).toEqual(r.lines[0].points.map(p=>p.date));
  });
});
