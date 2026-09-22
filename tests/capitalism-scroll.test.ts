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
    expect(yearAtAnchor(anchors, 2901)).toBe(1873);   // 1873 헤더가 앵커선에 걸린 순간부터 1873
    expect(yearAtAnchor(anchors, 2950)).toBe(1873);
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

  it("카드 상자 안(전환 구간 전)에서는 그 카드의 시점에 고정된다 — 길이가 7,000px 이어도 1885 같은 중간 연도가 나오지 않는다", () => {
    for (const y of [0, 120, 1500, 2859]) expect(yearAtAnchor(cards, y), `y=${y}`).toBe(1873.2);
    for (const y of [3100, 4500, 5900]) expect(yearAtAnchor(cards, y), `y=${y}`).toBe(1873.7);
    for (const y of [6400, 7000, 7999, 9000]) expect(yearAtAnchor(cards, y), `y=${y}`).toBe(1890.1);
  });

  it("전환 구간(다음 카드 top 앞 최소 240px)에서만 두 시점 사이를 비례 보간한다", () => {
    // 1873.2 → 1873.7: 여백 100px < 240 → 전환은 2860~3100
    expect(yearAtAnchor(cards, 2860)).toBeCloseTo(1873.2, 6);
    expect(yearAtAnchor(cards, 2980)).toBeCloseTo(1873.45, 6);
    // 1873.7 → 1890.1: 여백 300px ≥ 240 → 전환은 여백 그대로 6100~6400
    expect(yearAtAnchor(cards, 6099)).toBe(1873.7);
    expect(yearAtAnchor(cards, 6250)).toBeCloseTo((1873.7 + 1890.1) / 2, 6);
    expect(yearAtAnchor(cards, 6398)).toBeLessThan(1890.1);
  });

  it("사건이 드문 구간: 여백이 26px 뿐이어도 12년이 최소 240px 에 걸쳐 이어진다(휠 40px ≈ 2년)", () => {
    const sparse: ScrollAnchor[] = [{ year: 1861, top: 0, bottom: 1000 }, { year: 1873, top: 1026, bottom: 3000 }];
    expect(yearAtAnchor(sparse, 700)).toBe(1861);
    const a = yearAtAnchor(sparse, 946)!, b = yearAtAnchor(sparse, 986)!;
    expect(b - a).toBeCloseTo(12 * (40 / 240), 6);
    expect(yearAtAnchor(sparse, 1024.5)).toBeLessThan(1873);
    expect(yearAtAnchor(sparse, 1025)).toBe(1873); // 다음 카드 top−1px 는 경계 허용(epsilon) 안 → 그 카드의 시점
    expect(yearAtAnchor(sparse, 1026)).toBe(1873);
  });

  it("경계 좌표 반올림 허용: 다음 카드 top 보다 1px 안쪽에 있어도 그 카드의 시점(슬라이더 왕복 1873→1873)", () => {
    expect(yearAtAnchor(cards, 6399.875)).toBe(1890.1);
    expect(yearAtAnchor(cards, 6399)).toBe(1890.1);
    expect(yearAtAnchor(cards, 6398.9)).toBeLessThan(1890.1);
    expect(yearAtAnchor(cards, -0.5)).toBe(1873.2);
  });

  it("앵커가 없거나 값이 깨지면 null", () => {
    expect(yearAtAnchor([], 100)).toBeNull();
    expect(yearAtAnchor([{ year: NaN, top: 0, bottom: 10 }], 5)).toBeNull();
  });

  it("bottom 이 없는 점 앵커(연도 그룹 헤더 폴백)는 예전처럼 앵커 사이 전체를 보간한다", () => {
    const groups: ScrollAnchor[] = [{ year: 1861, top: 0 }, { year: 1873, top: 600 }, { year: 1890, top: 1800 }];
    expect(yearAtAnchor(groups, 300)).toBeCloseTo(1867, 6);
    expect(yearAtAnchor(groups, 1200)).toBeCloseTo(1881.5, 6);
    expect(yearAtAnchor(groups, 600)).toBe(1873);
    expect(yearAtAnchor(groups, 5000)).toBe(1890);
  });

  it("겹치거나 top 이 같은 상자가 있어도 0 나눗셈 없이 처리한다", () => {
    const side: ScrollAnchor[] = [{ year: 1900.1, top: 100, bottom: 500 }, { year: 1900.5, top: 100, bottom: 700 }, { year: 1910, top: 900, bottom: 1000 }];
    expect(yearAtAnchor(side, 300)).toBe(1900.5);       // 두 상자가 같은 top → 둘째 상자 차례(앞 상자는 next.top 에 닿아 건너뜀)
    expect(yearAtAnchor(side, 600)).toBeCloseTo(1900.5 + (1910 - 1900.5) * (0 / 240), 6); // 전환 시작(660) 전
    expect(yearAtAnchor(side, 780)).toBeCloseTo(1900.5 + (1910 - 1900.5) * ((780 - 660) / 240), 6);
    expect(Number.isFinite(yearAtAnchor(side, 899)!)).toBe(true);
  });
});
