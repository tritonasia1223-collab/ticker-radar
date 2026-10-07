import type { ChapterParagraph } from './credit/chapter-reading.js';

// 사용자가 검토한 특정 주차의 편집 문안.
export const FUNDING_EDITORIAL = {
  asOf: '2026-09-30',
  weeks: 4,
  paragraphs: [
    '금융여건은 아직 완화적이지만, 조이는 방향으로 돌아섰습니다. 금융여건 지수는 −0.55로 과거 중앙값(−0.48)보다 낮은데, 9월 초 −0.56을 바닥으로 3주째 오르고 있습니다.',
    '같은 기간 연준 창구를 찾은 자금도 4주간 47억 달러 늘어 101억 달러가 됐습니다. 대부분 할인창구(+35억 달러)이고, 레포 12억 달러는 분기말 하루 수요로 보입니다. 지급준비금의 0.35% 수준이라 규모 자체는 경고가 아닙니다.',
    '확인할 것은 10월 초에 이 숫자가 되돌아오는지입니다. 되돌아오면 분기말 소음이고, 할인창구가 99억 달러(2025년 12월 고점)를 넘어 유지되면 일부 은행의 자금 사정이 실제로 빡빡해졌다는 신호입니다.',
  ],
} as const;

export function authoredFundingReading(asOf: string, weeks: number, spread: number | null, hasNfci: boolean): ChapterParagraph[] {
  const texts: string[] = [];
  if (spread === 0) texts.push(
    '현재 SOFR-IORB 스프레드는 0으로 돈이 넘치지도, 부족하지도 않은 균형 구간 입니다.',
    '단, 시장 참여자들은 이를 "위험 직전 신호"로 받아들이기도 합니다.',
  );
  if (asOf === FUNDING_EDITORIAL.asOf && weeks === FUNDING_EDITORIAL.weeks && hasNfci) texts.push(...FUNDING_EDITORIAL.paragraphs);
  return texts.map(text => ({ kind: 'analysis', text }));
}
