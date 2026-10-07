import { describe, expect, it } from 'vitest';
import { analyze } from '../shared/credit/signals';
import { creditChapter } from '../shared/credit/chapter-reading';
import { creditSignals } from '../shared/credit/scenarios';
import { bankChartReading } from '../shared/credit/bank-chart-reading';

describe('은행 그래프별 해설', () => {
  it('근거가 없는 편집 해설을 자동 해설로 대체하지 않는다', () => {
    const data=analyze(null,'2026-09-30','observation');
    const paragraphs=creditChapter('credit-bank',data,creditSignals(data),4).paragraphs!;
    expect(paragraphs.filter(p=>p.kind!=='explanation').every(p=>!!p.indicatorId)).toBe(true);
    const standards=bankChartReading('sloos_ci_standards',paragraphs,data,'2026-09-30',3);
    expect(standards).toEqual([]);
  });
  it('편집 해설은 지정한 날짜·기간·근거가 모두 일치할 때만 표시한다', () => {
    const data=analyze(null,'2026-09-30','observation');
    const s=data.find(i=>i.id==='sloos_ci_standards')!.lines[0];
    s.points=Array.from({length:12},(_,i)=>({date:new Date(Date.UTC(2023,9+i*3,1)).toISOString().slice(0,10),value:i===6?18.5:i===11?0:8.1}));
    s.latest=s.points.at(-1)!;s.stale=false;s.errors=[];
    const hy=data.find(i=>i.id==='hy_oas')!.lines[0];
    hy.points=[{date:'2025-04-07',value:4.61},{date:'2026-09-30',value:3.12}];
    hy.latest=hy.points.at(-1)!;hy.stale=false;hy.errors=[];
    const fallback=[{kind:'analysis' as const,text:'관측 해설',indicatorId:'sloos_ci_standards'}];
    const read=(date='2026-09-30',years=3)=>bankChartReading('sloos_ci_standards',fallback,data,date,years);
    expect(read()[0].text).toContain('3년간 한 번도 음수가 없었습니다');
    expect(read('2026-09-23')).toEqual([]);
    expect(read('2026-09-30',1)).toEqual([]);
    s.points[0].value=-1;
    expect(read()).toEqual([]);
  });
});
