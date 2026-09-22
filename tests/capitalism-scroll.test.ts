import { describe, expect, it } from "vitest";
import { buildCardAnchors, yearAtAnchor, type ScrollAnchor } from "../client/src/lib/capitalism-scroll";

describe("연도 그룹 → 카드 앵커", () => {
  it("그룹 상단(헤더·여백)은 첫 카드에 속하고, 나머지 카드는 제 상자 그대로", () => {
    const anchors = buildCardAnchors([
      { top: 0, cards: [{ year: 1862.5, top: 60, bottom: 2400 }] },
      { top: 2900, cards: [{ year: 1873, top: 2960, bottom: 7200 }, { year: 1873.99, top: 7300, bottom: 10000 }] },
    ]);
    expect(anchors).toEqual([
      { year: 1862.5, top: 0, bottom: 2400 },
      { year: 1873, top: 2900, bottom: 7200 },
      { year: 1873.99, top: 7300, bottom: 10000 },
    ]);
    // 1873 헤더가 앵커선에 걸린 순간부터 1873 — 이전엔 1862→1873 보간값(1864 안팎)이 나왔다
    expect(yearAtAnchor(anchors, 2901)).toBe(1873);
    expect(yearAtAnchor(anchors, 2950)).toBe(1873);
    // 1862 카드 아래 ~ 1873 헤더 위 빈 공간에서만 보간
    expect(yearAtAnchor(anchors, 2650)).toBeCloseTo((1862.5 + 1873) / 2, 6);
    expect(buildCardAnchors([{ top: 10, cards: [] }])).toEqual([]);
  });
});

describe("타임라인 스크롤 → 시점", () => {
  // 1873년 긴 카드 2장(각 3,000px, 사이 100px) 뒤에 300px 연결 구간, 그다음 1890년 카드.
  const cards: ScrollAnchor[] = [
    { year: 1873.2, top: 0, bottom: 3000 },
    { year: 1873.7, top: 3100, bottom: 6100 },
    { year: 1890.1, top: 6400, bottom: 8000 },
  ];

  it("카드 상자 안에서는 그 카드의 시점에 고정된다 — 길이가 7,000px 이어도 1885 같은 중간 연도가 나오지 않는다", () => {
    for (const y of [0, 120, 1500, 2999]) expect(yearAtAnchor(cards, y), `y=${y}`).toBe(1873.2);
    for (const y of [3100, 4500, 6099]) expect(yearAtAnchor(cards, y), `y=${y}`).toBe(1873.7);
    for (const y of [6400, 7000, 7999]) expect(yearAtAnchor(cards, y), `y=${y}`).toBe(1890.1);
  });

  it("카드 사이 빈 구간에서만 두 시점 사이를 비례 보간한다", () => {
    expect(yearAtAnchor(cards, 3050)).toBeCloseTo(1873.45, 6);            // 같은 해 카드 사이
    expect(yearAtAnchor(cards, 6250)).toBeCloseTo((1873.7 + 1890.1) / 2, 6); // 1873 → 1890 연결 구간 절반
    expect(yearAtAnchor(cards, 6399)).toBeLessThan(1890.1);
  });

  it("첫 카드 위·마지막 카드 아래는 첫·마지막 시점, 앵커가 없거나 값이 깨지면 null", () => {
    expect(yearAtAnchor(cards, -50)).toBe(1873.2);
    expect(yearAtAnchor(cards, 9000)).toBe(1890.1);
    expect(yearAtAnchor([], 100)).toBeNull();
    expect(yearAtAnchor([{ year: NaN, top: 0, bottom: 10 }], 5)).toBeNull();
  });

  it("bottom 이 없는 점 앵커(연도 그룹 헤더 폴백)는 예전처럼 앵커 사이를 보간한다", () => {
    const groups: ScrollAnchor[] = [{ year: 1861, top: 0 }, { year: 1873, top: 600 }, { year: 1890, top: 1800 }];
    expect(yearAtAnchor(groups, 300)).toBeCloseTo(1867, 6);
    expect(yearAtAnchor(groups, 1200)).toBeCloseTo(1881.5, 6);
    expect(yearAtAnchor(groups, 600)).toBe(1873);
  });

  it("겹치거나 top 이 같은 상자가 있어도 0 나눗셈 없이 앞 카드를 택한다", () => {
    const side: ScrollAnchor[] = [{ year: 1900.1, top: 100, bottom: 500 }, { year: 1900.5, top: 100, bottom: 700 }, { year: 1910, top: 900, bottom: 1000 }];
    expect(yearAtAnchor(side, 300)).toBe(1900.1);
    expect(yearAtAnchor(side, 600)).toBe(1900.5);  // 첫 상자는 끝났고 둘째 상자 안
    expect(yearAtAnchor(side, 800)).toBeCloseTo(1905.25, 6); // 700~900 사이 절반
  });
});
