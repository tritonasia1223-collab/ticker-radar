import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { prependHistory, ratioSeries, rebaseFactor, type Point } from "../shared/capitalism-refresh";

describe("과거 확장 — 순수 함수", () => {
  const stored: Point[] = [["1948-01-01", 10], ["1948-02-01", 11], ["1948-03-01", 12]];

  it("prependHistory: 저장 첫 관측일 이전만 앞에 붙이고 기존 포인트는 그대로", () => {
    const history: Point[] = [["1947-11-01", 8], ["1947-12-01", 9], ["1948-01-01", 99], ["1948-02-01", 98], ["1946-01-01", 7]];
    const r = prependHistory(stored, history);
    expect(r.points).toEqual([["1946-01-01", 7], ["1947-11-01", 8], ["1947-12-01", 9], ...stored]);
    expect(r.added).toBe(3); expect(r.from).toBe("1946-01-01"); expect(r.to).toBe("1947-12-01");
    // 멱등: 다시 붙이면 0
    expect(prependHistory(r.points, history).added).toBe(0);
  });

  it("prependHistory: from·until(배타)·factor·decimals 를 적용한다", () => {
    const history: Point[] = [["1900-01-01", 1.234], ["1910-01-01", 2.345], ["1920-01-01", 3.456], ["1930-01-01", 4.567]];
    const r = prependHistory(stored, history, { from: "1910-01-01", until: "1930-01-01", factor: 2, decimals: 1 });
    expect(r.points.slice(0, 2)).toEqual([["1910-01-01", 4.7], ["1920-01-01", 6.9]]);
    expect(r.added).toBe(2);
    expect(prependHistory(stored, [["1947-01-01", NaN]]).added).toBe(0); // 결측은 채우지 않는다
    expect(prependHistory([], history).points).toEqual(history); // 저장분이 없으면 전부
  });

  it("rebaseFactor: 접합점에 가까운 겹침의 중앙값, 겹침 부족이면 null", () => {
    const base: Point[] = Array.from({ length: 30 }, (_, i) => [`19${57 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`, 100 + i]);
    const ext: Point[] = base.map(([d, v], i) => [d, (v / 2) * (i === 5 ? 1.1 : 1)]); // 한 점만 튐 → 중앙값이 흡수
    ext.unshift(["1950-01-01", 20]);
    const r = rebaseFactor(base, ext, { maxOverlap: 24 });
    expect(r).not.toBeNull(); expect(r!.factor).toBeCloseTo(2, 6); expect(r!.overlap).toBe(24); expect(r!.spread).toBeCloseTo(1.1, 6);
    expect(rebaseFactor(base.slice(0, 5), ext)).toBeNull();
    expect(rebaseFactor(base, ext.map(([d]) => [d, 0]))).toBeNull(); // 0 은 비율을 못 만든다
    // 짝수 표본: 가운데 두 값의 평균(비율 1..12 → 6.5), 홀수 표본: 가운데 값(1..13 → 7)
    const even: Point[] = Array.from({ length: 12 }, (_, i) => [`2000-${String(i + 1).padStart(2, "0")}-01`, i + 1]);
    expect(rebaseFactor(even, even.map(([d]) => [d, 1]), { minOverlap: 12 })!.factor).toBe(6.5);
    const odd: Point[] = [...even, ["2001-01-01", 13]];
    expect(rebaseFactor(odd, odd.map(([d]) => [d, 1]), { minOverlap: 12 })!.factor).toBe(7);
  });

  it("ratioSeries: 연도로 짝을 맞추고 결과는 YYYY-01-01, 짝 없는 해는 뺀다", () => {
    const debt: Point[] = [["1929-06-29", 16.93], ["1930-06-30", 16.19], ["1931-06-30", 16.8]];
    const gdp: Point[] = [["1929-01-01", 104.556], ["1930-01-01", 92.16]];
    expect(ratioSeries(debt, gdp, 2)).toEqual([["1929-01-01", 16.19], ["1930-01-01", 17.57]]);
  });
});

describe("과거 확장 — 저장된 데이터와 출처 메타데이터의 정합", () => {
  const series = JSON.parse(readFileSync("client/src/data/capitalism-series.json", "utf8")) as Record<string, Point[]>;
  const sources = JSON.parse(readFileSync("client/src/data/capitalism-series-sources.json", "utf8")) as Record<string, { modernFrom: string; segments: { from: string; to: string; source: string; method: string }[] }>;

  it("모든 시리즈는 날짜 오름차순이고 중복 날짜가 없다", () => {
    for (const [key, pts] of Object.entries(series)) {
      for (let i = 1; i < pts.length; i++) expect(pts[i - 1][0] < pts[i][0], `${key} ${pts[i - 1][0]} < ${pts[i][0]}`).toBe(true);
      for (const [, v] of pts) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("출처 메타데이터: modernFrom 은 실제 관측일, 구간은 [첫 관측일, modernFrom) 을 빈틈·겹침 없이 덮는다", () => {
    for (const [key, meta] of Object.entries(sources)) {
      const pts = series[key];
      expect(pts, key).toBeDefined();
      const dates = pts.map(([d]) => d);
      expect(dates.includes(meta.modernFrom), `${key} modernFrom ${meta.modernFrom}`).toBe(true);
      expect(meta.segments.length).toBeGreaterThan(0);
      const segs = [...meta.segments].sort((a, b) => a.from.localeCompare(b.from));
      expect(segs[0].from).toBe(dates[0]);
      for (let i = 0; i < segs.length; i++) {
        expect(dates.includes(segs[i].from), `${key} seg from ${segs[i].from}`).toBe(true);
        expect(dates.includes(segs[i].to), `${key} seg to ${segs[i].to}`).toBe(true);
        expect(segs[i].from <= segs[i].to).toBe(true);
        // 다음 구간(또는 현행 구간)의 시작은 이 구간 끝 바로 다음 관측일
        const next = i + 1 < segs.length ? segs[i + 1].from : meta.modernFrom;
        expect(dates[dates.indexOf(segs[i].to) + 1], `${key} 구간 ${i} 끝 다음`).toBe(next);
      }
    }
  });

  it("확장된 시리즈의 첫 관측일과 마지막 관측일이 기대와 같다", () => {
    const first: Record<string, string> = { inflation: "1914-01-01", gdp_growth: "1930-01-01", unrate: "1929-04-01", fedfunds: "1914-11-01", gs10: "1925-01-01", tb3ms: "1857-01-01", monbase: "1918-01-01", sp500: "1897-01-01", debt_gdp: "1929-01-01", gold: "1833-01-01" };
    for (const [key, date] of Object.entries(first)) expect(series[key][0][0], key).toBe(date);
    expect(series.mktcap[0][0]).toBe("1945-10-01"); // 확장하지 않은 지표는 그대로
    expect(series.m2[0][0]).toBe("1959-01-01");
  });
});
