import type { ChapterParagraph } from './chapter-reading.js';
import type { IndicatorAnalysis } from './signals.js';

// 사용자가 지정한 도표 해설만 표시한다. 다른 날짜·범위에는 자동 해설을 채우지 않는다.
export function bankChartReading(id: string, paragraphs: ChapterParagraph[], data: IndicatorAnalysis[], asOf: string, years: number): ChapterParagraph[] {
  const fallback: ChapterParagraph[] = [];
  if (id === 'h8_large_vs_small_banks' && asOf === '2026-09-30' && years === 3) return bankSizeReading(data, asOf) ?? fallback;
  if (id !== 'sloos_ci_standards' || asOf !== '2026-09-30' || years !== 3) return fallback;
  const standards = data.find(i => i.id === id)?.lines[0];
  const hy = data.find(i => i.id === 'hy_oas')?.lines[0];
  const points = standards?.points.filter(p => p.date >= '2023-09-30' && p.date <= asOf) ?? [];
  const hyPoints = hy?.points.filter(p => p.date >= '2023-09-30' && p.date <= asOf) ?? [];
  if (!standards || standards.stale || standards.errors.length || !hy || hy.stale || hy.errors.length
      || points.length < 12 || !points.every(p => Number.isFinite(p.value) && p.value >= 0)
      || standards.latest?.value !== 0 || !points.some(p => p.date === '2025-04-01' && p.value === 18.5)
      || !hyPoints.some(p => p.date.startsWith('2025-04') && p.value === 4.61)
      || Math.max(...hyPoints.map(p => p.value)) !== 4.61) return fallback;
  return [
    { kind: 'analysis', text: '3년간 한 번도 음수가 없었습니다. 은행들의 전체 응답에서 완화가 강화를 웃돈 분기가 없다는 뜻입니다. 강화 응답이 이어졌다는 점에서, 3년 전보다 대출받기 까다로운 상태가 이어진 것으로 읽힙니다.', emphasis: ['3년간 한 번도 음수가 없었습니다.'] },
    { kind: 'analysis', text: '이번 0.0은 “조임이 멈췄다”입니다. 전체 응답에서 추가 강화가 우세하지 않게 된 것이지, 완화가 시작된 것은 아닙니다. 누적된 조임이 풀리는 방향을 확인하려면 음수가 나와야 합니다.', emphasis: ['이번 0.0은 “조임이 멈췄다”입니다.'] },
    { kind: 'analysis', text: '2025년 4월의 18.5는 일시적 재강화였습니다. 같은 시기 HY 가산금리도 3년 고점(4.61%p)을 기록했습니다. 시장 불안과 은행의 심사 강화가 함께 나타난 국면으로 읽힙니다.', emphasis: ['2025년 4월의 18.5는 일시적 재강화였습니다.'] },
    { kind: 'explanation', text: '2026-09-30 선택 · 최근 3년 관측 기준. SLOOS는 강화·완화 응답의 차이로, 심사 기준의 절대 수준이나 원인을 직접 측정하지는 않습니다.' },
  ];
}

function bankSizeReading(data: IndicatorAnalysis[], asOf: string): ChapterParagraph[] | null {
  const lines = data.find(i => i.id === 'h8_large_vs_small_banks')?.lines ?? [];
  const labels = ['대형 · 예금', '소형 · 예금', '대형 · 대출·리스', '소형 · 대출·리스'];
  const observations = labels.map(label => {
    const line = lines.find(l => l.label === label);
    if (!line?.latest || line.stale || line.errors.length || line.latest.date > asOf) return null;
    const points = line.points.filter(p => p.date >= '2023-09-30' && p.date <= line.latest!.date && Number.isFinite(p.value));
    const first = points[0], now = line.latest;
    const target = Date.parse(now.date) - 364 * 86400000;
    const before = points.findLast(p => Date.parse(p.date) <= target);
    if (points.length < 150 || !first || !before || before.value <= 0 || first.value <= 0 || target-Date.parse(before.date)>7*86400000) return null;
    return { date: now.date, first: first.date, before: before.date, value: now.value, increase: now.value-before.value, yearPct: (now.value/before.value-1)*100, totalPct: (now.value/first.value-1)*100 };
  });
  if (observations.some(o => !o)) return null;
  const [largeDeposits, smallDeposits, largeLoans, smallLoans] = observations.map(o => o!);
  if (new Set(observations.map(o=>o!.date)).size!==1 || new Set(observations.map(o=>o!.first)).size!==1 || new Set(observations.map(o=>o!.before)).size!==1) return null;
  // 이 편집 문안의 방향이 실제 잔액과 다르면 해설을 표시하지 않는다.
  if (observations.some(o=>o!.increase<=0) || smallLoans.increase<=smallDeposits.increase || largeLoans.increase>=largeDeposits.increase
      || largeDeposits.yearPct<=smallDeposits.yearPct || largeLoans.yearPct<=smallLoans.yearPct) return null;
  const amount = (billions: number) => `${(Math.round(billions)*10).toLocaleString('ko-KR')}억 달러`;
  const min = Math.min(...observations.map(o=>o!.totalPct)), max = Math.max(...observations.map(o=>o!.totalPct));
  return [
    { kind:'analysis', text:`소형은행만의 이탈은 보이지 않습니다. 네 계열 모두 3년 전보다 늘었고, 누적 증가율은 ${min.toFixed(0)}~${max.toFixed(0)}%로 비슷합니다.`, emphasis:['소형은행만의 이탈은 보이지 않습니다.'] },
    { kind:'analysis', text:`다만 최근 1년은 대형은행이 앞섭니다. 예금 증가율은 ${(largeDeposits.yearPct-smallDeposits.yearPct).toFixed(1)}%p, 대출·리스 증가율은 ${(largeLoans.yearPct-smallLoans.yearPct).toFixed(1)}%p 높습니다. 3년 누적 증가율은 비슷하지만, 최근 1년에는 대형은행 쪽 증가세가 더 강했습니다.`, emphasis:['다만 최근 1년은 대형은행이 앞섭니다.'] },
    { kind:'analysis', text:`소형은행은 예금보다 대출 잔액이 더 많이 늘었습니다. 1년간 예금은 약 ${amount(smallDeposits.increase)}, 대출·리스는 약 ${amount(smallLoans.increase)} 늘었습니다. 대형은행은 예금이 약 ${amount(largeDeposits.increase)}, 대출·리스가 약 ${amount(largeLoans.increase)} 늘어 예금 증가분이 더 컸습니다.`, emphasis:['소형은행은 예금보다 대출 잔액이 더 많이 늘었습니다.'] },
    { kind:'analysis', text:`소형은행은 예금 대비 대출 비중이 높습니다. 대출·리스/예금 비율은 약 ${(smallLoans.value/smallDeposits.value*100).toFixed(0)}%로, 대형은행의 약 ${(largeLoans.value/largeDeposits.value*100).toFixed(0)}%보다 높습니다. 예금이 빠질 때 대출 조정이나 다른 자금 조달에 대한 부담이 더 커질 수 있는 구조입니다.`, emphasis:['소형은행은 예금 대비 대출 비중이 높습니다.'] },
    { kind:'explanation', text:`1년 비교 ${smallDeposits.before} → ${smallDeposits.date}. 금액은 실제 잔액 차이이며 신규 대출·예금 유입 총액은 아닙니다. 대출/예금 비율만으로 지급준비금·보유 증권 등 전체 유동성 여력을 판단하지 않습니다.` },
  ];
}
