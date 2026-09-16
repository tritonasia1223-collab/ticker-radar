// 자본주의 타임라인 — 인라인 리치텍스트(단어 색상/하이라이트/내부링크).
// DB 스키마 변경 없이 text 필드 안에 마커를 직렬화한다.
//   형식: [[키|텍스트]]   예) [[hl-y|중요]] , [[c-r|폭락]]
// 키 종류:
//   hl-*       : 형광펜(배경 하이라이트)   hl-y(노랑) hl-g(초록) hl-b(파랑) hl-p(분홍) hl-v(청보라)
//   c-*        : 글자색                    c-r(빨강) c-b(파랑) c-g(초록) c-o(주황) c-v(청보라)
//   link:<slug>: 내부 링크 — 클릭 시 해당 카드(slug)의 시점으로 점프. 위키 스타일 파란 밑줄.
//                예) [[link:1975-eurodollar|유로달러 폭발 시기]]
// 알 수 없는 키는 무시(원문 텍스트만 표시)하여 안전하게 폴백.

export interface MarkStyle {
  key: string;
  label: string;     // 툴바 표시용
  kind: "hl" | "c";  // 하이라이트 | 글자색
  swatch: string;    // 툴바 스와치 색
  // 렌더 시 적용할 인라인 스타일
  style: React.CSSProperties;
}

// 이 화면은 라이트 모드(흰 배경)로만 렌더된다 — tailwind darkMode:["class"] 이지만 앱 어디에서도
// dark 클래스를 붙이지 않는다. 따라서 대비 기준 배경은 흰색 #ffffff 이다.
// 형광펜은 반투명 파스텔(본문 #171717 이 위에 얹혀도 12:1 이상 유지),
// 글자색은 채도 100% 의 맑은 색(모두 흰 배경 대비 4.5:1 이상 = WCAG AA 본문 기준).
//   이전에는 글자색을 "어두운 배경에서 튀도록" 밝게 잡아, 흰 배경에서 초록 #12c75a 가 2.25:1 로 거의 안 보였다.
//   ⚠ 다크 모드를 켜게 되면 이 글자색들은 대비가 4.0~4.1 로 떨어지므로 dark: 변형을 별도로 잡아야 한다.
export const MARK_STYLES: MarkStyle[] = [
  // 형광펜 — 색상각 48°/142°/213°/329°/258° 로 서로 분리. 주석의 비율은 본문 텍스트가 위에 얹혔을 때 대비.
  { key: "hl-y", label: "노랑 형광", kind: "hl", swatch: "#facc15", style: { background: "rgba(250,204,21,0.32)", borderRadius: 3, padding: "0 2px" } },   // 15.5:1
  { key: "hl-g", label: "초록 형광", kind: "hl", swatch: "#4ade80", style: { background: "rgba(74,222,128,0.30)", borderRadius: 3, padding: "0 2px" } },   // 15.0:1
  { key: "hl-b", label: "파랑 형광", kind: "hl", swatch: "#60a5fa", style: { background: "rgba(96,165,250,0.30)", borderRadius: 3, padding: "0 2px" } },   // 13.8:1
  { key: "hl-p", label: "분홍 형광", kind: "hl", swatch: "#f472b6", style: { background: "rgba(244,114,182,0.32)", borderRadius: 3, padding: "0 2px" } },  // 13.2:1
  { key: "hl-v", label: "청보라 형광", kind: "hl", swatch: "#8b5cf6", style: { background: "rgba(139,92,246,0.28)", borderRadius: 3, padding: "0 2px" } }, // 12.5:1 · 분홍과 71°, 파랑과 45° 분리
  // 글자색 — 흰 배경 대비 4.5:1(WCAG AA 본문)을 지키는 선에서 채도를 100%까지 올려 가장 맑게 잡았다.
  // 각 색상각에서 대비 기준을 통과하는 가장 밝은 값이라, 더 맑게 하려면 대비를 4.5 아래로 내려야 한다.
  // 주황만 예외적으로 한계가 있다 — 대비를 맞추는 명도대에서 주황은 본질적으로 갈색에 가까워진다.
  // 키 순서는 기존 버튼 위치 유지를 위해 그대로 두고 신규만 뒤에 추가.
  { key: "c-r", label: "빨강 글자", kind: "c", swatch: "#e90800", style: { color: "#e90800", fontWeight: 600 } },   // 4.67:1
  { key: "c-b", label: "파랑 글자", kind: "c", swatch: "#146aff", style: { color: "#146aff", fontWeight: 600 } },   // 4.63:1
  { key: "c-g", label: "초록 글자", kind: "c", swatch: "#008738", style: { color: "#008738", fontWeight: 600 } },   // 4.64:1
  { key: "c-o", label: "주황 글자", kind: "c", swatch: "#c25400", style: { color: "#c25400", fontWeight: 600 } },   // 4.60:1
  { key: "c-v", label: "청보라 글자", kind: "c", swatch: "#8c4aff", style: { color: "#8c4aff", fontWeight: 600 } },   // 4.63:1 · 파랑과 44도 분리
];

export const MARK_BY_KEY: Record<string, MarkStyle> = Object.fromEntries(
  MARK_STYLES.map((m) => [m.key, m])
);

export interface RichSeg {
  text: string;
  mark?: string;     // MARK_STYLES key (hl-*/c-*) 또는 "link"
  linkSlug?: string; // mark==="link" 일 때 점프 대상 카드 slug
}

// 링크 접두사. slug 에는 영숫자/하이픈/언더스코어만 허용(파이프·대괄호 충돌 방지).
export const LINK_PREFIX = "link:";
// 키: hl-y, c-r 같은 고정키 또는 link:<slug>(slug는 a-z0-9-_ 만).
const TOKEN = /\[\[((?:link:[A-Za-z0-9_-]+)|[a-z-]+)\|([^\]]*)\]\]/g;

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
    if (key.startsWith(LINK_PREFIX)) {
      const slug = key.slice(LINK_PREFIX.length);
      segs.push({ text: inner, mark: "link", linkSlug: slug });
    } else if (MARK_BY_KEY[key]) {
      segs.push({ text: inner, mark: key });
    } else {
      segs.push({ text: inner }); // 알 수 없는 키는 표식 없이 텍스트만
    }
    last = m.index + m[0].length;
  }
  if (last < raw.length) segs.push({ text: raw.slice(last) });
  if (segs.length === 0) segs.push({ text: "" });
  return segs;
}

// 세그먼트 배열 → 마커 문자열 (저장용).
export function serializeRich(segs: RichSeg[]): string {
  return segs
    .map((s) => {
      if (s.mark === "link" && s.linkSlug) return `[[${LINK_PREFIX}${s.linkSlug}|${s.text}]]`;
      if (s.mark && MARK_BY_KEY[s.mark]) return `[[${s.mark}|${s.text}]]`;
      return s.text;
    })
    .join("");
}

// 평문(마커 제거) — 검색/길이 계산 등에 사용.
export function plainText(raw: string): string {
  return parseRich(raw).map((s) => s.text).join("");
}

// 마커 문자열을 평문 오프셋에서 둘로 분할(마크 보존). 멀티라인·불릿 프리픽스 모두
// 평문 글자로 카운트 → 직렬화 좌표(serializeEl/caretSerializeOffsetOf)와 동일 좌표계.
// 커서 위치에 표/이미지를 끼울 때 텍스트 블록을 before/after 로 가르는 데 사용.
export function splitRichTextAt(raw: string, plainOffset: number): { before: string; after: string } {
  const segs = parseRich(raw);
  const before: RichSeg[] = [];
  const after: RichSeg[] = [];
  let acc = 0;
  for (const s of segs) {
    const len = s.text.length;
    if (acc >= plainOffset) { after.push(s); acc += len; continue; }
    if (acc + len <= plainOffset) { before.push(s); acc += len; continue; }
    const cut = plainOffset - acc;
    before.push({ ...s, text: s.text.slice(0, cut) });
    after.push({ ...s, text: s.text.slice(cut) });
    acc += len;
  }
  return { before: serializeRich(before), after: serializeRich(after) };
}

// ─────────────────────────────────────────────────────────────────────
// 말머리(불릿) — 슬랙/노션식. 줄 단위로 동작한다.
//   저장 형식(줄 프리픽스): \t × 레벨 + "• "
//     - 레벨 0~2 (3단계). 탭 문자는 사용자가 직접 입력할 수 없어(Tab 키는 들여쓰기로 가로챔)
//       일반 텍스트와 충돌하지 않는다.
//     - 불릿 기호는 항상 "• "로 저장하고, 화면 표시 시 레벨별 기호(BULLET_GLYPH)로 치환한다.
//   이 프리픽스는 줄 시작(문자열 처음 또는 \n 직후)에만 의미를 가지며,
//   [[마크|텍스트]] 직렬화와 독립적이라 라운드트립이 안전하다.
// ─────────────────────────────────────────────────────────────────────

export const MAX_BULLET_LEVEL = 2; // 0,1,2 → 3단계
export const BULLET_CHAR = "\u2022"; // • (저장용 통일 기호)
// 화면 표시용 — 레벨별 기호(좁은 폭 고려해 3단계만).
export const BULLET_GLYPH = ["\u2022", "\u25e6", "\u25aa"]; // • ◦ ▪
// 레벨별 줄 전체 불투명도 — 모든 레벨 100%(계층 깊이에 따른 흐려짐 없음).
export const BULLET_OPACITY = [1, 1, 1];
// 줄 프리픽스 정규식: 선행 탭(레벨) + "• " (마커가 표식 span 안에 들어가는 일은 없음).
const BULLET_PREFIX = /^(\t*)\u2022 /;

export interface BulletLine {
  bullet: boolean; // 이 줄이 불릿인지
  level: number;   // 들여쓰기 레벨(0~MAX_BULLET_LEVEL), 불릿일 때만 의미
  body: string;    // 프리픽스 제거한 줄 본문(마크업 [[...]] 포함 가능)
}

// 한 줄(마크업 포함) → 불릿 메타 + 본문 분리.
export function parseBulletLine(line: string): BulletLine {
  const m = BULLET_PREFIX.exec(line);
  if (!m) return { bullet: false, level: 0, body: line };
  const level = Math.min(m[1].length, MAX_BULLET_LEVEL);
  return { bullet: true, level, body: line.slice(m[0].length) };
}

// 불릿 메타 + 본문 → 줄 프리픽스 포함 직렬화 문자열.
export function makeBulletLine(level: number, body: string): string {
  const lv = Math.max(0, Math.min(level, MAX_BULLET_LEVEL));
  return "\t".repeat(lv) + BULLET_CHAR + " " + body;
}

// ── 인라인 자동치환 커맨드 (스페이스 트리거) ────────────────────────────────
// 리치에디터(본문·인사이트)와 평문 메모(textarea) 가 같은 규칙을 쓰도록 여기 한 곳에 둔다(drift 방지).

// 숫자 → 원문자(①②③…). 지원: 0(⓪) · 1~20(①~⑳) · 21~35(㉑~㉟) · 36~50(㊱~㊿). 범위 밖은 null.
export function circledNumber(n: number): string | null {
  if (n === 0) return "⓪";                                          // ⓪
  if (n >= 1 && n <= 20) return String.fromCodePoint(0x2460 + (n - 1));  // ①~⑳
  if (n >= 21 && n <= 35) return String.fromCodePoint(0x3251 + (n - 21)); // ㉑~㉟
  if (n >= 36 && n <= 50) return String.fromCodePoint(0x32b1 + (n - 36)); // ㊱~㊿
  return null;
}

// 평문 문자열 + 캐럿 위치에서 스페이스 직전 커맨드를 치환. 매치 없으면 null.
//   "->" → "→ " · "(n)" → "원문자 ". (평문 textarea 용 — 마크 없는 순수 문자열 연산)
export function applyInlineTextCommand(text: string, caret: number): { text: string; caret: number } | null {
  const before = text.slice(0, caret);
  const after = text.slice(caret);
  if (before.endsWith("->")) {
    const head = before.slice(0, -2) + "→ ";
    return { text: head + after, caret: head.length };
  }
  const m = /\((\d{1,2})\)$/.exec(before);
  if (m) {
    const circ = circledNumber(Number(m[1]));
    if (circ) {
      const head = before.slice(0, m.index) + circ + " ";
      return { text: head + after, caret: head.length };
    }
  }
  return null;
}
