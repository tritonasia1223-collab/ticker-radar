// 자본주의 타임라인 — 인라인 리치텍스트(단어 색상/하이라이트).
// DB 스키마 변경 없이 text 필드 안에 마커를 직렬화한다.
//   형식: [[키|텍스트]]   예) [[hl-y|중요]] , [[c-r|폭락]]
// 키 종류:
//   hl-*  : 형광펜(배경 하이라이트)   hl-y(노랑) hl-g(초록) hl-b(파랑) hl-p(분홍)
//   c-*   : 글자색                    c-r(빨강) c-b(파랑) c-g(초록) c-o(주황)
// 알 수 없는 키는 무시(원문 텍스트만 표시)하여 안전하게 폴백.

export interface MarkStyle {
  key: string;
  label: string;     // 툴바 표시용
  kind: "hl" | "c";  // 하이라이트 | 글자색
  swatch: string;    // 툴바 스와치 색
  // 렌더 시 적용할 인라인 스타일
  style: React.CSSProperties;
}

// 다크/라이트 모두에서 읽히도록 형광펜은 반투명, 글자색은 채도 높은 색.
export const MARK_STYLES: MarkStyle[] = [
  { key: "hl-y", label: "노랑 형광", kind: "hl", swatch: "#facc15", style: { background: "rgba(250,204,21,0.32)", borderRadius: 3, padding: "0 2px" } },
  { key: "hl-g", label: "초록 형광", kind: "hl", swatch: "#4ade80", style: { background: "rgba(74,222,128,0.30)", borderRadius: 3, padding: "0 2px" } },
  { key: "hl-b", label: "파랑 형광", kind: "hl", swatch: "#60a5fa", style: { background: "rgba(96,165,250,0.30)", borderRadius: 3, padding: "0 2px" } },
  { key: "hl-p", label: "분홍 형광", kind: "hl", swatch: "#f472b6", style: { background: "rgba(244,114,182,0.32)", borderRadius: 3, padding: "0 2px" } },
  { key: "c-r", label: "빨강 글자", kind: "c", swatch: "#f87171", style: { color: "#f87171", fontWeight: 600 } },
  { key: "c-b", label: "파랑 글자", kind: "c", swatch: "#60a5fa", style: { color: "#60a5fa", fontWeight: 600 } },
  { key: "c-g", label: "초록 글자", kind: "c", swatch: "#4ade80", style: { color: "#4ade80", fontWeight: 600 } },
  { key: "c-o", label: "주황 글자", kind: "c", swatch: "#fb923c", style: { color: "#fb923c", fontWeight: 600 } },
];

export const MARK_BY_KEY: Record<string, MarkStyle> = Object.fromEntries(
  MARK_STYLES.map((m) => [m.key, m])
);

export interface RichSeg {
  text: string;
  mark?: string; // MARK_STYLES key
}

const TOKEN = /\[\[([a-z-]+)\|([^\]]*)\]\]/g;

// 마커 문자열 → 세그먼트 배열 (렌더용).
export function parseRich(raw: string): RichSeg[] {
  if (!raw) return [{ text: "" }];
  const segs: RichSeg[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(raw)) !== null) {
    if (m.index > last) segs.push({ text: raw.slice(last, m.index) });
    const key = m[1];
    const inner = m[2];
    if (MARK_BY_KEY[key]) segs.push({ text: inner, mark: key });
    else segs.push({ text: inner }); // 알 수 없는 키는 표식 없이 텍스트만
    last = m.index + m[0].length;
  }
  if (last < raw.length) segs.push({ text: raw.slice(last) });
  if (segs.length === 0) segs.push({ text: "" });
  return segs;
}

// 세그먼트 배열 → 마커 문자열 (저장용).
export function serializeRich(segs: RichSeg[]): string {
  return segs
    .map((s) => (s.mark && MARK_BY_KEY[s.mark] ? `[[${s.mark}|${s.text}]]` : s.text))
    .join("");
}

// 평문(마커 제거) — 검색/길이 계산 등에 사용.
export function plainText(raw: string): string {
  return parseRich(raw).map((s) => s.text).join("");
}
