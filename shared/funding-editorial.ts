import { hasWeeklyEditorial, weeklyEditorial } from './weekly-editorial.js';
import type { ChapterParagraph } from './credit/chapter-reading.js';
import { OCTOBER_WEEK_TWO, octoberWeekTwoEditorial } from './october-week-two-editorial.js';

// 사용자가 검토한 특정 주차의 편집 문안.
export const FUNDING_EDITORIAL = {
  asOf: '2026-09-30',
  weeks: 4,
  paragraphs: [
    '현재 금융여건은 음수값으로 과거 평균보다 완화적인 상태입니다. 아직 기업들이 돈 빌리기 쉬운 환경이라는 뜻입니다. 다만 눈여겨 볼 지점은, 9월 초를 기점으로 하강 국면에서 상승 국면으로 바뀌어 3주째 조금씩 빡빡해지고 있다는 것입니다. 다음 수치에서 상승 폭이 커지는지가 관건입니다.',
    '시장에서 돈을 구하지 못한 금융회사는 마지막에 연준 창구를 찾습니다. 그래서 이 숫자는 "누가 급했는가"를 보여줍니다.',
    '9월에 창구 이용이 4주 전의 2배 가까이 늘었지만, 아직 걱정할 규모는 아닙니다. 판단은 10월 초 데이터로 갈립니다. 분기말이 지나고 되돌아오면 일시적인 수요인 것이고, 줄지 않고 지난 연말 수준을 넘어서면, 일부 은행의 자금 사정이 실제로 빡빡해졌다는 신호입니다.',
  ],
} as const;

export function fundingReadingByChart(asOf: string, weeks: number, spread: number | null, hasNfci: boolean) {
  if (hasWeeklyEditorial(asOf) && weeks === 4) return {
    rateContext: weeklyEditorial('rateContext', asOf),
    spread: spread === null ? [] : weeklyEditorial('spread', asOf),
    nfci: hasNfci ? weeklyEditorial('nfci', asOf) : [],
    facilities: weeklyEditorial('facilities', asOf),
  };
  if (asOf === OCTOBER_WEEK_TWO && weeks === 4) return {
    rateContext: octoberWeekTwoEditorial('rateContext', asOf),
    spread: spread === null ? [] : octoberWeekTwoEditorial('spread', asOf),
    nfci: hasNfci ? octoberWeekTwoEditorial('nfci', asOf) : [],
    facilities: octoberWeekTwoEditorial('facilities', asOf),
  };
  const texts: string[] = [];
  if (asOf === '2026-10-07' && weeks === 4) texts.push(
    '이번 주 스프레드는 -2bp로 9월 말 0bp에서 소폭 내려왔습니다. 다만 10월 6일에도 다시 0bp를 찍었고, 9월 중순의 -5bp 수준보다는 높은 수치가 유지되고 있습니다.',
    '배경으로 함께 볼 것은 연준의 RMP를 통한 추가 지준 공급이 8월 중순부터 멈췄다는 점입니다. 같은 기간 재무부는 단기채 비중을 줄이고 중장기채가 늘어나는 구성을 보였습니다. 다만 이 변화가 스프레드 상승에 얼마나 반영되는지는 별도로 확인해봐야 합니다.',
  );
  if (asOf === FUNDING_EDITORIAL.asOf && weeks === FUNDING_EDITORIAL.weeks && spread === 0) texts.push(
    '현재 SOFR-IORB 스프레드는 0으로 돈이 넘치지도, 부족하지도 않은 구간입니다. 다만 시장에서는 이를 "위험 직전 신호"로 받아들이기도 합니다.',
    '분기말이나 세금 납부일에 하루 이틀 튀는 것은 흔하지만, 며칠씩 0.05%p 넘게 이어지면 유동성이 실제로 모자란다는 신호입니다.',
  );
  const showEditorial = asOf === FUNDING_EDITORIAL.asOf && weeks === FUNDING_EDITORIAL.weeks && hasNfci;
  const facilitiesTexts = asOf === '2026-10-07' && weeks === 4 ? [
    '레포 창구는 12억 달러에서 0.02억 달러로 복귀했습니다. 분기 말에 국채를 담보로 하루 빌리던 수요가 예상대로 대부분 사라진 것으로 보입니다.',
    '그런데 할인 창구는 반대입니다. 87억 달러에서 약 100억 달러까지 늘었습니다.',
    '지난주에 “분기말 이후 되돌아오는지 보자”고 했던 부분은 이렇게 업데이트합니다. 레포는 되돌아왔고, 은행의 직접 차입은 더 늘었습니다. 다만 약 100억 달러는 전체 지급준비금의 약 0.33%입니다. 연준이 은행들에 할인창구를 유동성 관리 수단으로 활용할 수 있도록 평소 이용 준비를 갖추라고 권장해 온 점도 함께 고려해야 합니다. (즉, 이용 관행의 변화가 차입 증가에 영향을 줬을 가능성이 있음)',
  ] : showEditorial ? FUNDING_EDITORIAL.paragraphs.slice(1) : [];
  const paragraphs = (items: readonly string[]): ChapterParagraph[] => items.map(text => ({ kind: 'analysis', text }));
  const rateContext: ChapterParagraph[] = asOf === '2026-10-07' && weeks === 4 ? [{
    kind: 'analysis',
    text: '연준은 9월에 기준금리를 25bp 올렸습니다. IORB가 3.65%에서 3.90%로 높아졌고, SOFR도 함께 올라 단기 자금을 빌리는 비용이 커졌습니다.',
    emphasis: ['연준은 9월에 기준금리를 25bp 올렸습니다.'],
  }] : [];
  return {
    rateContext,
    spread: paragraphs(texts),
    nfci: paragraphs(showEditorial ? FUNDING_EDITORIAL.paragraphs.slice(0, 1) : []),
    facilities: paragraphs(facilitiesTexts),
  };
}

export function authoredFundingReading(asOf: string, weeks: number, spread: number | null, hasNfci: boolean): ChapterParagraph[] {
  const groups = fundingReadingByChart(asOf, weeks, spread, hasNfci);
  return [...groups.rateContext, ...groups.spread, ...groups.nfci, ...groups.facilities];
}
