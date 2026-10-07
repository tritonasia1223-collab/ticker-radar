import type { ChapterParagraph } from './credit/chapter-reading.js';

// 사용자가 검토한 2026년 9월 말 해설. 다른 주차·비교 기간에 재사용하지 않는다.
export function amountEditorial(asOf: string, weeks: number): ChapterParagraph[] {
  if (asOf !== '2026-09-30' || weeks !== 4) return [];
  return [
    '순유동성은 줄고 M2는 늘고 있습니다. 즉, 연준과 재무부가 풀어둔 돈은 주는데, 은행이 대출로 만들어낸 쪽이 늘고 있다는 겁니다.',
    '늘어난 은행 대출이 M2를 밀어 올리고 있어서, 연준 쪽 돈이 줄어도 시중의 돈은 늘어납니다. 순유동성만 보고 "돈이 마른다"고 읽으면 절반만 본 것입니다.',
    '다만 두 흐름이 계속 따로 갈 수는 없습니다. 은행이 대출을 늘리려면 지급준비금이 받쳐줘야 하는데, 그 준비금이 최근 3년 내 낮은 구간에 와 있습니다(2.88조 달러). 여기에 9월 금리 인상이 대출 수요를 식히기 시작하면 M2 증가도 시차를 두고 꺾일 수 있습니다.',
    '또 역레포 잔고가 바닥난 것이 눈에 띕니다.\n이는 TGA가 늘면 그만큼 은행 지급준비금이 바로 줄어든다는 뜻입니다. (MMF가 국채 매입할 때 역레포 잔고를 소진하는데, 역레포 잔고가 고갈났다는 것은 국채 매입 자금을 은행 지준에서 빼간다는 뜻)',
  ].map(text => ({ kind: 'analysis', text }));
}

export function ownershipEditorial(asOf: string): ChapterParagraph[] {
  if (asOf !== '2026-09-30') return [];
  return [{ kind: 'analysis', text: '국채를 가장 많이 가진 곳은 해외 투자자지만, 지금 국채를 사주는 곳은 따로 있습니다. 해외 투자자는 전체의 32%를 들고 있는데, 지난 1년간 새로 늘어난 국채는 8%만 가져갔습니다. 반면 MMF는 보유 비중이 11%인데 증가분의 30%를 샀습니다. MMF가 최대 매수자라는 사실은 단기채 의존과 같은 이야기입니다. (MMF는 규정상 단기채만 살 수 있기 때문)' }];
}
