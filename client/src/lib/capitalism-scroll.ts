// 타임라인 스크롤 위치 → 시점(소수 연도). 순수 계산만 두어 테스트한다(DOM 좌표는 호출부가 넘긴다).
//   앵커 = 카드(각자 실제 날짜, top~bottom 상자). 앵커선(보드 상단에서 조금 아래)이
//   · 어떤 카드 상자 안에 있으면 → 그 카드의 시점(카드가 아무리 길어도 그 해에 머문다)
//   · 카드와 다음 카드 사이 '전환 구간'에 있으면 → 두 카드 시점 사이를 픽셀 비례로 보간
//       전환 구간은 다음 카드 top 에서 끝나고, 길이는 두 카드 사이 여백과 minTransition(기본 240px) 중 큰 쪽.
//       여백이 짧으면 앞 카드의 꼬리 안으로 들어간다 — 사건이 드문 구간(1861→1873)에서 휠 한 번에 12년이 튀지 않고,
//       다음 카드(그룹 헤더)가 앵커선에 닿는 순간 정확히 그 카드의 시점이 된다.
//   · 첫 카드 위 / 마지막 카드 아래 → 첫 / 마지막 시점
//   bottom 이 없으면 점 앵커(연도 그룹 헤더 폴백)로 취급해 예전처럼 앵커 사이 전체를 보간한다.
//   예전엔 '연도 그룹 헤더' 사이를 보간해서, 카드가 길거나 많은 그룹 안을 스크롤하는 동안 존재하지 않는 중간 연도(1873 그룹에서 1885)가 나왔다.
export interface ScrollAnchor { year: number; top: number; bottom?: number } // 뷰포트 기준 y (getBoundingClientRect)

export interface YearAtAnchorOptions {
  minTransition?: number; // 카드 사이 전환 구간의 최소 길이(px)
  epsilon?: number;       // 상자 경계의 좌표 반올림 허용(px) — 프로그램 스크롤이 그룹 top 을 앵커에 맞출 때 0.125px 오차 흡수
}

export function yearAtAnchor(anchors: ScrollAnchor[], anchorY: number, { minTransition = 240, epsilon = 1 }: YearAtAnchorOptions = {}): number | null {
  const sorted = anchors
    .filter((a) => Number.isFinite(a.year) && Number.isFinite(a.top))
    .map((a) => ({ year: a.year, top: a.top, bottom: Math.max(a.top, a.bottom ?? a.top), point: a.bottom === undefined }))
    .sort((a, b) => a.top - b.top || a.year - b.year);
  if (sorted.length === 0) return null;
  if (anchorY <= sorted[0].top + epsilon) return sorted[0].year;
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i], next = sorted[i + 1];
    if (!next) return cur.year;                                             // 마지막 카드 안·아래
    if (anchorY >= next.top - epsilon) continue;                            // 다음 카드(경계 허용 포함)에 닿았으면 다음 차례
    // 전환 시작점: 점 앵커면 cur.top(전체 보간), 상자면 여백 시작(cur.bottom)과 next.top−minTransition 중 앞선 쪽(단 cur.top 이상).
    const start = cur.point ? cur.top : Math.max(cur.top, Math.min(cur.bottom, next.top - minTransition));
    if (anchorY < start) return cur.year;                                    // 카드 안(전환 구간 전)
    const span = next.top - start;
    const t = span > 0 ? Math.min(1, Math.max(0, (anchorY - start) / span)) : 1;
    return cur.year + t * (next.year - cur.year);
  }
  return sorted[sorted.length - 1].year;
}

// 스크롤 리스너의 상태 갱신 여부. 잦은 setState 를 막는 0.01년 문턱은 두되, 표시 단위(월)가 바뀌면 — 특히 연말 카드(12-31)에서
// 연초 카드(01-01)로 넘어가 정수 연도가 달라지면 — 차이가 0.01년 미만이어도 갱신한다(라벨이 "1900년 12월"에 묶이던 문제).
export function shouldUpdatePlayYear(prev: number, next: number, threshold = 0.01): boolean {
  if (!Number.isFinite(next)) return false;
  if (!Number.isFinite(prev)) return true;
  if (Math.abs(prev - next) > threshold) return true;
  return Math.floor(prev) !== Math.floor(next) || Math.floor(prev * 12) !== Math.floor(next * 12);
}

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
