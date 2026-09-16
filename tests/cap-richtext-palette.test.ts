import { describe, expect, it } from "vitest";
import { MARK_STYLES, MARK_BY_KEY, parseRich, serializeRich } from "../client/src/lib/capitalism-richtext";

// 팔레트는 실제 화면에서 눈으로 맞춰 확정한 값이다. 여기에 고정해 두어
// 대비 수치 같은 기준으로 누가 임의로 다시 조정하는 것을 막는다.
// 색을 바꾸려면 이 표부터 고친다 — 그게 곧 "의도한 변경"이라는 표시다.
const PALETTE = [
  { key: "hl-y", kind: "hl", swatch: "#facc15", value: "rgba(250,204,21,0.32)" },
  { key: "hl-g", kind: "hl", swatch: "#4ade80", value: "rgba(74,222,128,0.30)" },
  { key: "hl-b", kind: "hl", swatch: "#60a5fa", value: "rgba(96,165,250,0.30)" },
  { key: "hl-p", kind: "hl", swatch: "#f472b6", value: "rgba(244,114,182,0.32)" },
  { key: "hl-v", kind: "hl", swatch: "#8b5cf6", value: "rgba(139,92,246,0.28)" },
  { key: "c-r", kind: "c", swatch: "#ff2e2e", value: "#ff2e2e" },
  { key: "c-b", kind: "c", swatch: "#146aff", value: "#146aff" },
  { key: "c-g", kind: "c", swatch: "#008738", value: "#008738" },
  { key: "c-o", kind: "c", swatch: "#ff7a00", value: "#ff7a00" },
  { key: "c-v", kind: "c", swatch: "#8c4aff", value: "#8c4aff" },
] as const;

describe("자본주의 리치텍스트 팔레트", () => {
  // 키 문자열은 이미 저장된 [[키|텍스트]] 마커가 가리키는 대상이다. 바뀌면 저장된 표식이 전부 깨진다.
  // 순서는 툴바 버튼 위치이고, 값은 확정된 색이다. 셋 다 한 번에 고정한다.
  it("팔레트가 확정된 키·순서·색 그대로다", () => {
    expect(MARK_STYLES.map((m) => m.key)).toEqual(PALETTE.map((p) => p.key));
    for (const p of PALETTE) {
      const m = MARK_BY_KEY[p.key];
      expect(m.kind, p.key).toBe(p.kind);
      expect(m.swatch, p.key).toBe(p.swatch);
      expect(p.kind === "hl" ? m.style.background : m.style.color, p.key).toBe(p.value);
    }
  });

  // 새 키(hl-v/c-v)는 소문자+하이픈이라 기존 TOKEN 정규식이 수정 없이 받는다.
  it("마커가 파싱·직렬화 왕복에서 손실되지 않는다", () => {
    const raw = "평시 [[c-v|청보라 글자]] 와 [[hl-v|청보라 형광]] 과 [[hl-y|노랑]] 끝";
    const segs = parseRich(raw);
    expect(segs.map((s) => s.mark).filter(Boolean)).toEqual(["c-v", "hl-v", "hl-y"]);
    expect(serializeRich(segs)).toBe(raw);
  });

  // 새 키를 모르는 구버전 클라이언트가 열었을 때의 동작. 표식은 잃어도 글은 남아야 한다.
  it("모르는 키를 만나도 텍스트는 보존된다", () => {
    const segs = parseRich("앞 [[c-zz|알 수 없는 색]] 뒤");
    expect(segs.map((s) => s.text).join("")).toBe("앞 알 수 없는 색 뒤");
    expect(segs.every((s) => s.mark === undefined)).toBe(true);
  });
});
