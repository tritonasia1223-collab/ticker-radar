// 타임라인 스크롤 위치 → 시점(소수 연도). 순수 계산만 두어 테스트한다(DOM 좌표는 호출부가 넘긴다).
//   앵커 = 카드(각자 실제 날짜, top~bottom 상자). 앵커선(보드 상단에서 조금 아래)이
//   · 어떤 카드 상자 안에 있으면 → 그 카드의 시점(카드가 아무리 길어도 그 해에 머문다)
//   · 카드와 다음 카드 사이 빈 구간에 있으면 → 두 카드 시점 사이를 픽셀 비례로 보간(사건이 드문 구간의 부드러운 이동)
//   · 첫 카드 위 / 마지막 카드 아래 → 첫 / 마지막 시점
//   bottom 이 없으면 점 앵커(연도 그룹 헤더 폴백)로 취급해 예전처럼 앵커 사이만 보간한다.
//   예전엔 '연도 그룹 헤더' 사이를 보간해서, 카드가 길거나 많은 그룹 안을 스크롤하는 동안 존재하지 않는 중간 연도(1873 그룹에서 1885)가 나왔다.
export interface ScrollAnchor { year: number; top: number; bottom?: number } // 뷰포트 기준 y (getBoundingClientRect)

// 연도 그룹(헤더 포함 상자) 안의 카드 상자들 → 앵커. 그룹 상단(헤더·여백)부터 첫 카드 아래까지는 첫 카드에 속하게
// 첫 카드의 top 을 그룹 top 까지 끌어올린다 — 헤더가 보이는 동안 이전 그룹과의 보간값(1873 헤더에서 1864)이 나오지 않게.
export interface GroupBoxes { top: number; cards: { year: number; top: number; bottom: number }[] }
export function buildCardAnchors(groups: GroupBoxes[]): ScrollAnchor[] {
  const out: ScrollAnchor[] = [];
  for (const g of groups) {
    g.cards.forEach((c, i) => out.push({ year: c.year, top: i === 0 ? Math.min(g.top, c.top) : c.top, bottom: c.bottom }));
  }
  return out;
}

export function yearAtAnchor(anchors: ScrollAnchor[], anchorY: number): number | null {
  const sorted = anchors
    .filter((a) => Number.isFinite(a.year) && Number.isFinite(a.top))
    .map((a) => ({ year: a.year, top: a.top, bottom: Math.max(a.top, a.bottom ?? a.top) }))
    .sort((a, b) => a.top - b.top || a.year - b.year);
  if (sorted.length === 0) return null;
  if (anchorY <= sorted[0].top) return sorted[0].year;
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i], next = sorted[i + 1];
    if (anchorY >= cur.top && anchorY < cur.bottom) return cur.year;          // 카드 안
    if (!next) return cur.year;                                               // 마지막 카드 아래
    if (anchorY >= cur.bottom && anchorY < next.top) {                        // 카드 사이 빈 구간
      const span = next.top - cur.bottom;
      const t = span > 0 ? (anchorY - cur.bottom) / span : 0;
      return cur.year + t * (next.year - cur.year);
    }
  }
  return sorted[sorted.length - 1].year;
}
