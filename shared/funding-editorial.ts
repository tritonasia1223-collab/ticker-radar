import type { ChapterParagraph } from './credit/chapter-reading.js';

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
  const texts: string[] = [];
  if (asOf === FUNDING_EDITORIAL.asOf && weeks === FUNDING_EDITORIAL.weeks && spread === 0) texts.push(
    '현재 SOFR-IORB 스프레드는 0으로 돈이 넘치지도, 부족하지도 않은 구간입니다. 다만 시장에서는 이를 "위험 직전 신호"로 받아들이기도 합니다.',
    '분기말이나 세금 납부일에 하루 이틀 튀는 것은 흔하지만, 며칠씩 0.05%p 넘게 이어지면 유동성이 실제로 모자란다는 신호입니다.',
  );
  const showEditorial = asOf === FUNDING_EDITORIAL.asOf && weeks === FUNDING_EDITORIAL.weeks && hasNfci;
  const paragraphs = (items: readonly string[]): ChapterParagraph[] => items.map(text => ({ kind: 'analysis', text }));
  return {
    spread: paragraphs(texts),
    nfci: paragraphs(showEditorial ? FUNDING_EDITORIAL.paragraphs.slice(0, 1) : []),
    facilities: paragraphs(showEditorial ? FUNDING_EDITORIAL.paragraphs.slice(1) : []),
  };
}

export function authoredFundingReading(asOf: string, weeks: number, spread: number | null, hasNfci: boolean): ChapterParagraph[] {
  const groups = fundingReadingByChart(asOf, weeks, spread, hasNfci);
  return [...groups.spread, ...groups.nfci, ...groups.facilities];
}
