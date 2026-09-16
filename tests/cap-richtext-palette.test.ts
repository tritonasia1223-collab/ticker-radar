import { describe, expect, it } from "vitest";
import { MARK_STYLES, MARK_BY_KEY, parseRich, serializeRich } from "../client/src/lib/capitalism-richtext";

// 이 화면은 라이트 모드로만 렌더된다(darkMode:["class"] 인데 dark 클래스를 붙이는 곳이 없음).
// 따라서 대비 기준 배경은 흰색이고, 본문 글자색은 --foreground 이다.
const WHITE = [255, 255, 255] as const;
const FOREGROUND = [23, 23, 23] as const; // --foreground 0 0% 9%
const AA_BODY = 4.5;
// 대비 기준을 강제할 색. 빨강·주황은 사용자가 실제 가독성을 확인해 원래 값으로 되돌렸으므로 제외한다.
const AA_REQUIRED = ["c-g", "c-b", "c-v"] as const;

const toRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const luminance = (rgb: readonly number[]) => {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: readonly number[], b: readonly number[]) => {
  const [l1, l2] = [luminance(a), luminance(b)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};
const hue = (hex: string) => {
  const [r, g, b] = toRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (Math.round(h * 60) + 360) % 360;
};
// 두 색상각의 최단 거리(0~180). 육안 구분 가능성 판정용.
const hueGap = (a: string, b: string) => {
  const d = Math.abs(hue(a) - hue(b)) % 360;
  return d > 180 ? 360 - d : d;
};
// rgba(r,g,b,a) 를 흰 배경 위에 합성한 실제 표시색.
const compositeOnWhite = (rgba: string): [number, number, number] => {
  const m = rgba.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
  if (!m) throw new Error(`형광펜 배경을 해석할 수 없음: ${rgba}`);
  const [r, g, b, a] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  return [r, g, b].map((v, i) => Math.round(a * v + (1 - a) * WHITE[i])) as [number, number, number];
};

const highlights = MARK_STYLES.filter((m) => m.kind === "hl");
const textColors = MARK_STYLES.filter((m) => m.kind === "c");

describe("자본주의 리치텍스트 팔레트", () => {
  it("형광펜과 글자색이 각각 5개다", () => {
    expect(highlights).toHaveLength(5);
    expect(textColors).toHaveLength(5);
    expect(MARK_STYLES).toHaveLength(10);
  });

  // 키가 바뀌면 이미 저장된 [[키|텍스트]] 마커가 통째로 깨진다. 색상값은 바꿔도 키는 불변이어야 한다.
  it("기존 8개 마크 키가 그대로 보존된다", () => {
    for (const key of ["hl-y", "hl-g", "hl-b", "hl-p", "c-r", "c-b", "c-g", "c-o"]) {
      expect(MARK_BY_KEY[key], `기존 키 ${key} 가 사라졌다`).toBeDefined();
    }
  });

  it("대비 기준 적용 대상 글자색이 WCAG AA 본문을 만족한다", () => {
    for (const key of AA_REQUIRED) {
      const m = MARK_BY_KEY[key];
      const color = m.style.color as string;
      expect(contrast(toRgb(color), WHITE), `${m.label} ${color}`).toBeGreaterThanOrEqual(AA_BODY);
    }
  });

  // 빨강·주황은 수치상 4.5:1 미만이지만 사용자가 "원래도 잘 보였다"고 확인해 되돌린 값이다.
  // 값을 고정해 두어야 "대비가 낮으니 고치자"는 회귀가 다시 들어오지 않는다.
  it("사용자가 확인한 빨강·주황 원래 값이 유지된다", () => {
    expect(MARK_BY_KEY["c-r"].style.color).toBe("#ff2e2e");
    expect(MARK_BY_KEY["c-o"].style.color).toBe("#ff7a00");
  });

  // 회귀 방지: 이전 초록 #12c75a 는 2.25:1 로 흰 배경에서 거의 안 보였다.
  it("초록 글자색이 이전 값보다 뚜렷하게 진해졌다", () => {
    const before = contrast(toRgb("#12c75a"), WHITE);
    const after = contrast(toRgb(MARK_BY_KEY["c-g"].style.color as string), WHITE);
    expect(before).toBeLessThan(AA_BODY);
    expect(after).toBeGreaterThan(before * 2);
  });

  it("형광펜 위에 얹힌 본문 텍스트가 읽힌다", () => {
    for (const m of highlights) {
      const bg = compositeOnWhite(m.style.background as string);
      expect(contrast(FOREGROUND, bg), `${m.label}`).toBeGreaterThanOrEqual(AA_BODY);
    }
  });

  it("새 청보라가 기존 분홍·파랑과 색상각으로 구분된다", () => {
    expect(hueGap("#8b5cf6", "#f472b6")).toBeGreaterThanOrEqual(35); // 형광: 청보라 vs 분홍
    expect(hueGap("#8b5cf6", "#60a5fa")).toBeGreaterThanOrEqual(35); // 형광: 청보라 vs 파랑
    expect(hueGap(MARK_BY_KEY["c-v"].style.color as string, MARK_BY_KEY["c-b"].style.color as string))
      .toBeGreaterThanOrEqual(35); // 글자: 청보라 vs 파랑
  });

  // 모든 스와치가 서로 구분되어야 툴바에서 고를 수 있다.
  it("같은 그룹 안에서 스와치 색이 중복되지 않는다", () => {
    for (const group of [highlights, textColors]) {
      expect(new Set(group.map((m) => m.swatch)).size).toBe(group.length);
    }
  });

  // 새 키는 소문자+하이픈이라 기존 TOKEN 정규식이 수정 없이 받아들인다.
  it("새 키가 정규식 수정 없이 파싱·직렬화 왕복된다", () => {
    const raw = "평시 [[c-v|청보라 글자]] 와 [[hl-v|청보라 형광]] 끝";
    const segs = parseRich(raw);
    expect(segs.map((s) => s.mark)).toContain("c-v");
    expect(segs.map((s) => s.mark)).toContain("hl-v");
    expect(serializeRich(segs)).toBe(raw);
  });

  // 구버전 클라이언트가 새 키를 만나면 표식은 잃어도 텍스트는 남아야 한다(무단 삭제 금지).
  it("모르는 키를 만나도 텍스트는 보존된다", () => {
    const segs = parseRich("앞 [[c-zz|알 수 없는 색]] 뒤");
    expect(segs.map((s) => s.text).join("")).toBe("앞 알 수 없는 색 뒤");
    expect(segs.every((s) => s.mark === undefined)).toBe(true);
  });
});
