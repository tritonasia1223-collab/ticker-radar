// 인라인 리치텍스트 에디터: 텍스트를 드래그 선택하면 색상/하이라이트 팝업 툴바가 떠서
// 선택 구간에 표식을 적용한다. 내부적으로 contentEditable + data-mark span 사용,
// 외부로는 [[키|텍스트]] 마커 문자열을 주고받는다(value/onChange).
import { useRef, useEffect, useState, useCallback } from "react";
import {
  MARK_STYLES, MARK_BY_KEY, parseRich, LINK_PREFIX,
  parseBulletLine, makeBulletLine, plainText, BULLET_GLYPH, BULLET_OPACITY, MAX_BULLET_LEVEL, type RichSeg,
} from "@/lib/capitalism-richtext";

// 주어진 마크 키가 적용 가능한가? 고정키(hl-*/c-*) 또는 link:<slug>.
function isKnownKey(key: string | null | undefined): key is string {
  return !!key && (key.startsWith(LINK_PREFIX) || !!MARK_BY_KEY[key]);
}
// 링크 span 스타일(편집기 내 미리보기 — 렌더러와 동일한 파란 밑줄).
const LINK_STYLE: Record<string, string> = {
  color: "#60a5fa",
  textDecoration: "underline",
  textDecorationColor: "rgba(96,165,250,0.6)",
  textUnderlineOffset: "2px",
  fontWeight: "600",
};

// 가장 가까운 세로 스크롤 조상(세로 타임라인 보드 등) — 포커스/캐럿 설정 시 점프 방지용 위치 보존 대상.
export function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const oy = getComputedStyle(node).overflowY;
    if ((oy === "auto" || oy === "scroll") && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return null;
}

// 빈 불릿 본문의 캐럿 자리표시용 제로폭 공백.
// 빈 텍스트 노드(createTextNode(""))에는 캐럿이 안정적으로 들어가지 않아
// 입력한 글자가 본문 span 밖으로 새는 문제가 있다. \u200b 한 글자를 넣어두면
// 캐럿이 그 노드 안에 안착하고, 직렬화·길이 계산에서는 모두 제거한다.
const ZWSP = "\u200b";
const stripZW = (s: string) => s.replace(/\u200b/g, "");

// 한 줄 분량의 (마크 유지) 세그먼트 조각.
interface LineSeg { text: string; mark?: string; linkSlug?: string; }

// 세그먼트 배열을 \n 기준으로 줄별 조각으로 분할(각 조각의 마크 유지).
function segsToLines(segs: RichSeg[]): LineSeg[][] {
  const lines: LineSeg[][] = [[]];
  for (const s of segs) {
    const parts = s.text.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ text: part, mark: s.mark, linkSlug: s.linkSlug });
    });
  }
  return lines;
}

// 한 조각(마크 유지) → 인라인 노드(텍스트 또는 마크 span).
function segToNode(s: LineSeg): Node {
  if (s.mark === "link" && s.linkSlug) {
    const span = document.createElement("span");
    span.setAttribute("data-mark", `${LINK_PREFIX}${s.linkSlug}`);
    Object.assign(span.style, LINK_STYLE);
    span.appendChild(document.createTextNode(s.text));
    return span;
  }
  if (s.mark && MARK_BY_KEY[s.mark]) {
    const span = document.createElement("span");
    span.setAttribute("data-mark", s.mark);
    const st = MARK_BY_KEY[s.mark].style as Record<string, string | number>;
    Object.assign(span.style, st);
    span.appendChild(document.createTextNode(s.text));
    return span;
  }
  return document.createTextNode(s.text);
}

// 줄 컨테이너 DIV 생성. 불릿이면 data-bullet-level + 좌측정렬 + ::before 기호용 마커 span.
// 불릿 기호는 contenteditable=false span 으로 넣어 사용자가 지우거나 커서가 끼지 않게 한다.
function makeLineDiv(parts: LineSeg[]): HTMLDivElement {
  const div = document.createElement("div");
  div.setAttribute("data-cap-line", "");
  // 줄 평문으로 불릿 프리픽스 판별(프리픽스는 첫 조각의 마크 없는 텍스트에 담김).
  const lineText = parts.map((p) => p.text).join("");
  const meta = parseBulletLine(lineText);
  if (meta.bullet) {
    const lvl = Math.min(meta.level, MAX_BULLET_LEVEL);
    div.setAttribute("data-bullet-level", String(lvl));
    div.style.display = "flex";
    div.style.textAlign = "left";
    div.style.alignItems = "baseline";
    div.style.gap = "0.3em";
    div.style.paddingLeft = `${lvl * 0.85}em`;
    // 레벨이 깊을수록 줄 전체(기호+본문)을 미미하게 흐릿하게.
    div.style.opacity = String(BULLET_OPACITY[lvl]);
    // 기호(편집 불가) — 직렬화 시 무시되도록 data-bullet-mark 부여.
    const g = document.createElement("span");
    g.setAttribute("data-bullet-mark", "");
    g.setAttribute("contenteditable", "false");
    g.textContent = BULLET_GLYPH[lvl];
    g.style.flex = "none";
    g.style.opacity = "0.8";
    g.style.userSelect = "none";
    div.appendChild(g);
    // 본문 래퍼(여기 텍스트가 실제 편집 대상).
    const bodyWrap = document.createElement("span");
    bodyWrap.setAttribute("data-bullet-body", "");
    bodyWrap.style.flex = "1 1 auto";
    bodyWrap.style.minWidth = "0";
    // 프리픽스 제거한 본문 조각으로 채움.
    const prefixLen = lineText.length - meta.body.length;
    let remain = prefixLen;
    for (const p of parts) {
      if (remain <= 0) { bodyWrap.appendChild(segToNode(p)); continue; }
      if (p.text.length <= remain) { remain -= p.text.length; continue; }
      bodyWrap.appendChild(segToNode({ ...p, text: p.text.slice(remain) }));
      remain = 0;
    }
    if (!bodyWrap.childNodes.length) bodyWrap.appendChild(document.createTextNode(ZWSP));
    div.appendChild(bodyWrap);
  } else {
    // 일반 줄: 가운데 정렬(부모 text-center). 빈 줄도 높이 유지 위해 <br>.
    if (parts.length) {
      for (const p of parts) div.appendChild(segToNode(p));
    } else {
      div.appendChild(document.createElement("br"));
    }
  }
  return div;
}

// 마커 문자열 → contentEditable 안에 넣을 DOM(줄별 DIV) 생성.
function renderToEl(el: HTMLElement, raw: string) {
  el.innerHTML = "";
  const lines = segsToLines(parseRich(raw));
  for (const parts of lines) el.appendChild(makeLineDiv(parts));
  if (!el.childNodes.length) el.appendChild(makeLineDiv([]));
}

// 한 요소의 인라인 내용(마크 span/텍스트/BR)만 직렬화. 불릿 기호·줄 컨테이너는 제외.
function serializeInline(parent: Node): string {
  let out = "";
  parent.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) { out += stripZW(node.textContent || ""); return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const e = node as HTMLElement;
    // 불릿 기호 span은 표시 전용 — 직렬화에서 제외.
    if (e.hasAttribute("data-bullet-mark")) return;
    const mark = e.getAttribute("data-mark");
    if (isKnownKey(mark)) { out += `[[${mark}|${e.textContent || ""}]]`; return; }
    if (e.tagName === "BR") {
      // 빈 줄 컨테이너의 단독 placeholder BR 은 줄 자리표시일 뿐 — \n 아님(줄 DIV 경계가 줄바꿈을 담당).
      // lenUntil 의 onlyChild 처리와 대칭을 맞춰야 직렬화 좌표와 오프셋 좌표가 일치한다.
      // (단독 BR 을 \n 으로 직렬화하면 빈 줄 1개가 라운드트립마다 2배로 불어나고,
      //  serializeEl().split("\n") 의 줄 인덱스가 DOM div 인덱스와 어긋나 편집이 엉뚱한 줄을 덮어쓴다.)
      const parent = e.parentNode as HTMLElement | null;
      const onlyChild = !!parent && parent.childNodes.length === 1;
      if (!onlyChild) out += "\n";
      return;
    }
    // 그 외(본문 래퍼 span 등) → 내부 재귀.
    out += serializeInline(e);
  });
  return out;
}

// 한 줄 요소(DIV 또는 기타) → 해당 줄의 마커 문자열(불릿이면 프리픽스 포함).
function serializeLineEl(e: HTMLElement): string {
  const lvlAttr = e.getAttribute("data-bullet-level");
  const body = serializeInline(e);
  if (lvlAttr !== null) {
    const lvl = Math.max(0, Math.min(parseInt(lvlAttr, 10) || 0, MAX_BULLET_LEVEL));
    return makeBulletLine(lvl, body);
  }
  return body;
}

// contentEditable DOM → 마커 문자열 직렬화.
// 최상위는 줄별 DIV(data-cap-line) 구조를 원칙으로 하되, 브라우저가 Enter 시 자체
// 생성한 DIV/BR/생텍스트도 견고하게 처리한다. 줄끼리는 \n 으로 연결.
function serializeEl(el: HTMLElement): string {
  const lines: string[] = [];
  let pending: Node[] | null = null; // 블록이 아닌 상위 인라인/텍스트 모아둔 임시 줄.
  const flushPending = () => {
    if (!pending) return;
    const wrap = document.createElement("div");
    pending.forEach((n) => wrap.appendChild(n.cloneNode(true)));
    lines.push(serializeInline(wrap));
    pending = null;
  };
  el.childNodes.forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const e = node as HTMLElement;
      if (e.tagName === "DIV" || e.tagName === "P") {
        flushPending();
        lines.push(serializeLineEl(e));
        return;
      }
      if (e.tagName === "BR") {
        flushPending();
        lines.push("");
        return;
      }
    }
    if (!pending) pending = [];
    pending.push(node);
  });
  flushPending();
  return lines.join("\n");
}

// 링크 대상 후보 카드 — 상위(페이지)에서 전달. slug/라벨(연도+제목)만 필요.
export interface LinkTarget { slug: string; year: number; title: string; }

export function CapRichEditor({
  value, onChange, placeholder, rows = 2, autoFocus = false, onBlur, linkTargets,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  onBlur?: () => void;
  // 내부 링크 기능용 카드 목록. 없거나 빈 배열이면 링크 버튼 미노출.
  linkTargets?: LinkTarget[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [toolbar, setToolbar] = useState<{ x: number; y: number } | null>(null);
  const composingRef = useRef(false);
  // 링크 카드 선택 패널 열림 여부 + 선택 구간 오프셋 보관(패널 조작 중 선택이 풀려도 복원).
  const [linkPanel, setLinkPanel] = useState(false);
  const [linkQuery, setLinkQuery] = useState("");
  const savedRangeRef = useRef<{ start: number; end: number } | null>(null);
  // onBlur 클로저가 최신 linkPanel 값을 읽도록 ref 동기화.
  const linkPanelRef = useRef(false);
  useEffect(() => { linkPanelRef.current = linkPanel; }, [linkPanel]);

  // value(외부) → DOM 초기화 (포커스 없을 때만 재렌더하여 커서 튐 방지).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement === el) return;
    renderToEl(el, value || "");
  }, [value]);

  // 자동 포커스: 인라인 편집 진입 시 바로 커서를 끝으로.
  // 포커스(preventScroll)뿐 아니라 캐럿(addRange)도 스크롤을 당기므로, 스크롤 컨테이너
  // 위치를 저장했다가 즉시 복원해 편집 진입 시 화면이 위/아래로 점프하는 것을 막는다.
  useEffect(() => {
    if (!autoFocus) return;
    const el = ref.current;
    if (!el) return;
    const scroller = findScrollParent(el);
    const prevTop = scroller?.scrollTop ?? 0;
    el.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    if (scroller && scroller.scrollTop !== prevTop) scroller.scrollTop = prevTop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    onChange(serializeEl(el));
  }, [onChange]);

  // 선택이 비어있지 않고 에디터 내부면 툴바 위치 계산(뷰포트 좌표 = fixed).
  const updateToolbar = useCallback(() => {
    const el = ref.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0 || sel.isCollapsed) { setToolbar(null); return; }
    const range = sel.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) { setToolbar(null); return; }
    const rect = range.getBoundingClientRect();
    setToolbar({ x: rect.left + rect.width / 2, y: rect.bottom });
  }, []);

  useEffect(() => {
    const handler = () => updateToolbar();
    document.addEventListener("selectionchange", handler);
    return () => document.removeEventListener("selectionchange", handler);
  }, [updateToolbar]);

  // 에디터 내부에서 선택 구간의 오프셋(시작/끝)을 구한다.
  // 좌표 모델 = "본문 텍스트(불릿 프리픽스 제외) + 줄 사이 \n" — serializeEl 의 본문 좌표와 일치.
  //   - 불릿 기호 span(data-bullet-mark) 은 길이에서 제외(탭 프리픽스는 DOM 텍스트에 없음).
  //   - 줄 컨테이너 DIV 경계마다 \n 1개, BR 도 \n 1개.
  function selectionOffsets(el: HTMLElement): { start: number; end: number } | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null;

    // 줄 DIV 의 불릿 프리픽스 길이(level + 2: 탭×level + "• "). 일반 줄은 0.
    const prefixLenOf = (lineDiv: HTMLElement): number => {
      const lv = lineDiv.getAttribute("data-bullet-level");
      if (lv === null) return 0;
      const n = Math.max(0, Math.min(parseInt(lv, 10) || 0, MAX_BULLET_LEVEL));
      return n + 2;
    };

    // 특정 (node, offset) 까지의 serializeEl 좌표 길이.
    const lenUntil = (target: Node, targetOffset: number): number => {
      let len = 0;
      let done = false;
      let seenLine = false; // 최상위 줄 DIV 를 하나라도 지났는가(첫 줄 앞 \n 억제 — len>0 대신 위치 기준)
      const walk = (n: Node) => {
        if (done) return;
        if (n.nodeType === Node.TEXT_NODE) {
          if (n === target) { len += Math.min(targetOffset, stripZW(n.textContent || "").length); done = true; return; }
          len += stripZW(n.textContent || "").length;
          return;
        }
        if (n.nodeType !== Node.ELEMENT_NODE) return;
        const e = n as HTMLElement;
        // 불릿 기호 span 은 길이 0(프리픽스는 줄 진입 시 별도 가산).
        if (e.hasAttribute("data-bullet-mark")) {
          if (n === target) { done = true; return; }
          return;
        }
        // 최상위 줄 DIV 진입: 첫 줄 제외 줄 경계 \n(첫 줄이 빈 줄이어도 일관), 불릿이면 프리픽스 길이 가산.
        if (e.parentNode === el && (e.tagName === "DIV" || e.tagName === "P")) {
          if (seenLine) len += 1;
          seenLine = true;
          len += prefixLenOf(e);
        }
        if (e.tagName === "BR") {
          if (n === target) { done = true; return; }
          // 빈 줄 DIV 안의 단독 BR 은 줄 자리표시일 뿐 — \n 아님(DIV 경계가 처리).
          const parent = e.parentNode as HTMLElement | null;
          const onlyChild = !!parent && parent.childNodes.length === 1;
          if (!onlyChild) len += 1;
          return;
        }
        if (n === target) {
          for (let i = 0; i < targetOffset && i < e.childNodes.length; i++) walk(e.childNodes[i]);
          done = true;
          return;
        }
        e.childNodes.forEach(walk);
      };
      walk(el);
      return len;
    };

    const a = lenUntil(range.startContainer, range.startOffset);
    const b = lenUntil(range.endContainer, range.endOffset);
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    if (start === end) return null;
    return { start, end };
  }

  // ──────── 말머리(불릿) 키 처리 ────────
  // serializeEl 좌표 offset 위치에 캐럿(접은 선택) 복원. renderToEl 직후 호출.
  function findInBody(host: HTMLElement, want: number): { node: Node; nodeOffset: number } | null {
    if (want < 0) return null;
    let acc = 0;
    let res: { node: Node; nodeOffset: number } | null = null;
    const walk = (n: Node) => {
      if (res) return;
      if (n.nodeType === Node.TEXT_NODE) {
        const raw = n.textContent || "";
        const len = stripZW(raw).length;
        if (want <= acc + len) {
          // ZWSP 자리표시 노드(내용이 ZWSP 뿐)면 캐럿을 노드 시작(0)에 둔다 → 입력 글자가 ZWSP 앞에 삽입.
          const off = raw.length && stripZW(raw).length === 0 ? 0 : want - acc;
          res = { node: n, nodeOffset: off };
          return;
        }
        acc += len;
        return;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) return;
      const e = n as HTMLElement;
      if (e.hasAttribute("data-bullet-mark")) return;
      if (e.tagName === "BR") { acc += 1; return; }
      e.childNodes.forEach(walk);
    };
    host.childNodes.forEach(walk);
    return res;
  }

  function setCaretAtSerializeOffset(el: HTMLElement, offset: number) {
    const sel = window.getSelection();
    if (!sel) return;
    const place = (node: Node, nodeOffset: number) => {
      const r = document.createRange();
      r.setStart(node, nodeOffset);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    };
    const lineDivs = Array.from(el.childNodes).filter(
      (n) => n.nodeType === Node.ELEMENT_NODE && ((n as HTMLElement).tagName === "DIV" || (n as HTMLElement).tagName === "P")
    ) as HTMLElement[];
    let acc = 0;
    for (let li = 0; li < lineDivs.length; li++) {
      const div = lineDivs[li];
      if (li > 0) acc += 1;
      const lvAttr = div.getAttribute("data-bullet-level");
      if (lvAttr !== null) {
        const lvl = Math.max(0, Math.min(parseInt(lvAttr, 10) || 0, MAX_BULLET_LEVEL));
        acc += lvl + 2;
      }
      const bodyHost = (div.querySelector("[data-bullet-body]") as HTMLElement) || div;
      const bodyLen = plainText(serializeInline(bodyHost)).length; // 평문 좌표(마커 [[..]] 글자수 제외)로 통일
      if (offset - acc <= bodyLen) {
        const found = findInBody(bodyHost, offset - acc);
        if (found) { place(found.node, found.nodeOffset); return; }
        place(bodyHost, bodyHost.childNodes.length);
        return;
      }
      acc += bodyLen;
    }
    const last = lineDivs[lineDivs.length - 1];
    if (last) {
      const host = (last.querySelector("[data-bullet-body]") as HTMLElement) || last;
      place(host, host.childNodes.length);
    }
  }

  // 현재 캐럿이 속한 최상위 줄 DIV 의 인덱스.
  function currentLineIndex(el: HTMLElement): number {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return -1;
    let node: Node | null = sel.getRangeAt(0).startContainer;
    while (node && node.parentNode !== el) node = node.parentNode;
    if (!node) return -1;
    return Array.from(el.childNodes).indexOf(node as ChildNode);
  }

  // 단일 (node, offset) → serializeEl 좌표.
  function caretSerializeOffsetOf(el: HTMLElement, target: Node, targetOffset: number): number {
    const prefixLenOf = (lineDiv: HTMLElement): number => {
      const lv = lineDiv.getAttribute("data-bullet-level");
      if (lv === null) return 0;
      const n = Math.max(0, Math.min(parseInt(lv, 10) || 0, MAX_BULLET_LEVEL));
      return n + 2;
    };
    let len = 0;
    let done = false;
    let seenLine = false; // 최상위 줄 DIV 를 하나라도 지났는가(첫 줄 앞 \n 억제 — len>0 대신 위치 기준)
    const walk = (n: Node) => {
      if (done) return;
      if (n.nodeType === Node.TEXT_NODE) {
        if (n === target) { len += Math.min(targetOffset, stripZW(n.textContent || "").length); done = true; return; }
        len += stripZW(n.textContent || "").length;
        return;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) return;
      const e = n as HTMLElement;
      if (e.hasAttribute("data-bullet-mark")) { if (n === target) { done = true; } return; }
      if (e.parentNode === el && (e.tagName === "DIV" || e.tagName === "P")) {
        if (seenLine) len += 1;
        seenLine = true;
        len += prefixLenOf(e);
      }
      if (e.tagName === "BR") {
        if (n === target) { done = true; return; }
        const parent = e.parentNode as HTMLElement | null;
        const onlyChild = !!parent && parent.childNodes.length === 1;
        if (!onlyChild) len += 1;
        return;
      }
      if (n === target) {
        for (let i = 0; i < targetOffset && i < e.childNodes.length; i++) walk(e.childNodes[i]);
        done = true;
        return;
      }
      e.childNodes.forEach(walk);
    };
    walk(el);
    return len;
  }

  // 현재 줄 정보(인덱스/레벨/불릿여부/본문마커/줄내 캐럿 본문오프셋/줄시작 serialize좌표).
  function lineInfo(el: HTMLElement): {
    index: number; level: number; bullet: boolean; bodyRaw: string;
    caretInBody: number; lineStartSerialize: number;
  } | null {
    const index = currentLineIndex(el);
    if (index < 0) return null;
    const raw = serializeEl(el);
    const lines = raw.split("\n");
    const lineRaw = lines[index] ?? "";
    const meta = parseBulletLine(lineRaw);
    let lineStart = 0;
    // 줄 시작 오프셋은 평문 좌표(마커 글자수 제외)로 — off(=caretSerializeOffsetOf) 와 동일 좌표계여야 caretInBody 가 맞다.
    for (let i = 0; i < index; i++) lineStart += plainText(lines[i]).length + 1;
    const sel = window.getSelection();
    let caretInBody = plainText(meta.body).length; // 평문 좌표(셀렉션 없을 때 본문 끝 폴백)
    if (sel && sel.rangeCount) {
      const off = caretSerializeOffsetOf(el, sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
      const prefixLen = lineRaw.length - meta.body.length;
      caretInBody = Math.max(0, off - lineStart - prefixLen);
    }
    return { index, level: meta.level, bullet: meta.bullet, bodyRaw: meta.body, caretInBody, lineStartSerialize: lineStart };
  }

  // 특정 줄 교체(null=제거) 후 재렌더 + 캐럿 복원.
  function replaceLine(lineIndex: number, newLineRaw: string | null, caretSerializeOffset: number) {
    const el = ref.current;
    if (!el) return;
    const lines = serializeEl(el).split("\n");
    if (newLineRaw === null) lines.splice(lineIndex, 1);
    else lines[lineIndex] = newLineRaw;
    const out = lines.join("\n");
    renderToEl(el, out);
    setCaretAtSerializeOffset(el, caretSerializeOffset);
    setToolbar(null);
    onChange(out);
  }

  // 현재 줄을 before 로 바꾸고 다음에 after 줄 삽입. 캐럿은 새 줄 본문 시작.
  function replaceLineThenInsert(lineIndex: number, beforeRaw: string, afterRaw: string, afterPrefixLen: number) {
    const el = ref.current;
    if (!el) return;
    const lines = serializeEl(el).split("\n");
    lines[lineIndex] = beforeRaw;
    lines.splice(lineIndex + 1, 0, afterRaw);
    const out = lines.join("\n");
    renderToEl(el, out);
    let caret = 0;
    for (let i = 0; i <= lineIndex; i++) caret += plainText(lines[i]).length + 1; // 평문 좌표
    caret += afterPrefixLen;
    setCaretAtSerializeOffset(el, caret);
    setToolbar(null);
    onChange(out);
  }

  // 본문 마커 문자열을 평문 오프셋에서 앞/뒤로 분할(마크 보존).
  function splitBodyAt(bodyRaw: string, plainOffset: number): { before: string; after: string } {
    const segs = parseRich(bodyRaw);
    let acc = 0;
    let before = "";
    let after = "";
    for (const s of segs) {
      const mk = s.mark === "link" && s.linkSlug ? `${LINK_PREFIX}${s.linkSlug}` : s.mark;
      const wrap = (t: string) => (isKnownKey(mk) ? `[[${mk}|${t}]]` : t);
      const segLen = s.text.length;
      if (acc + segLen <= plainOffset) {
        if (s.text) before += wrap(s.text);
      } else if (acc >= plainOffset) {
        if (s.text) after += wrap(s.text);
      } else {
        const cut = plainOffset - acc;
        const a = s.text.slice(0, cut);
        const b = s.text.slice(cut);
        if (a) before += wrap(a);
        if (b) after += wrap(b);
      }
      acc += segLen;
    }
    return { before, after };
  }

  // 키 입력 처리: '- '+스페이스 불릿화 / Tab·Shift+Tab 들여쓰기 / Backspace 불릿 해제 / Enter 이어가기.
  function handleKeyDown(ev: React.KeyboardEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el || composingRef.current) return;

    // '- ' 입력 감지: 스페이스 키 직전 줄 본문이 정확히 "-" 이면 불릿화.
    if (ev.key === " ") {
      const info = lineInfo(el);
      if (info && !info.bullet && info.bodyRaw === "-" && info.caretInBody === 1) {
        ev.preventDefault();
        // "-" 제거하고 레벨0 빈 불릿으로.
        replaceLine(info.index, makeBulletLine(0, ""), info.lineStartSerialize + 2);
        return;
      }
      return;
    }

    const info = lineInfo(el);
    if (!info) return;

    if (ev.key === "Tab") {
      ev.preventDefault();
      if (!info.bullet) {
        if (info.caretInBody === 0) {
          // 일반 줄 시작에서 Tab → 레벨0 불릿 시작(본문 유지).
          replaceLine(info.index, makeBulletLine(0, info.bodyRaw), info.lineStartSerialize + 2 + info.caretInBody);
        }
        return;
      }
      const delta = ev.shiftKey ? -1 : 1;
      const newLevel = Math.max(0, Math.min(info.level + delta, MAX_BULLET_LEVEL));
      if (newLevel === info.level) return;
      replaceLine(info.index, makeBulletLine(newLevel, info.bodyRaw), info.lineStartSerialize + (newLevel + 2) + info.caretInBody);
      return;
    }

    if (ev.key === "Backspace" && info.bullet && info.caretInBody === 0) {
      ev.preventDefault();
      if (info.level > 0) {
        const newLevel = info.level - 1;
        replaceLine(info.index, makeBulletLine(newLevel, info.bodyRaw), info.lineStartSerialize + (newLevel + 2));
      } else {
        replaceLine(info.index, info.bodyRaw, info.lineStartSerialize);
      }
      return;
    }

    if (ev.key === "Enter" && !ev.shiftKey && !ev.metaKey && !ev.ctrlKey) {
      // 불릿 줄 Enter — 같은 레벨 이어가기(빈 불릿이면 해제).
      if (info.bullet) {
        ev.preventDefault();
        if (parseRich(info.bodyRaw).every((s) => !s.text)) {
          // 빈 불릿에서 Enter → 불릿 해제(빈 평문 줄).
          replaceLine(info.index, "", info.lineStartSerialize);
          return;
        }
        const split = splitBodyAt(info.bodyRaw, info.caretInBody);
        replaceLineThenInsert(info.index, makeBulletLine(info.level, split.before), makeBulletLine(info.level, split.after), info.level + 2);
        return;
      }
      // 일반 줄 Enter — 브라우저 기본 동작에 맡기면 환경마다 깨지므로 직접 처리한다.
      //   앞부분: 일반 줄. 뒷부분: 바로 위 줄이 불릿이면 그 레벨 불릿으로, 아니면 일반 줄.
      //   (사용자 요구: "일반 줄을 나누면 뒷부분이 (직전) 불릿이 되는" 동작 유지)
      ev.preventDefault();
      const lines = serializeEl(el).split("\n");
      const prevMeta = info.index > 0 ? parseBulletLine(lines[info.index - 1] ?? "") : { bullet: false, level: 0, body: "" };
      const split = splitBodyAt(info.bodyRaw, info.caretInBody);
      if (prevMeta.bullet) {
        // 뒷부분을 직전 불릿 레벨의 불릿으로.
        replaceLineThenInsert(
          info.index,
          split.before,
          makeBulletLine(prevMeta.level, split.after),
          prevMeta.level + 2,
        );
      } else {
        // 둘 다 일반 줄.
        replaceLineThenInsert(info.index, split.before, split.after, 0);
      }
      return;
    }
  }

  // 선택 구간 [start,end) 에 표식 적용/해제. key=null 이면 표식 제거.
  // 현재 DOM을 평문+마크 세그먼트로 환산 → 선택 구간만 마크 재계산 → 마커 문자열로 직렬화 후 재렌더.
  // 이렇게 하면 이미 색/하이라이트가 입혀진 구간도 덮어쓰기·변경·해제가 모두 정확히 동작한다.
  function applyMark(key: string | null, forcedOff?: { start: number; end: number }) {
    const el = ref.current;
    if (!el) return;
    const off = forcedOff ?? selectionOffsets(el);
    if (!off) return;
    const { start, end } = off;

    // 현재 내용 → 글자 단위 (char, mark) 배열로 평탄화.
    const raw = serializeEl(el);
    const segs = parseRich(raw);
    // 오프셋이 UTF-16 코드유닛 기준(selectionOffsets와 일치)이므로 코드유닛 단위로 분해.
    const chars: { ch: string; mark?: string }[] = [];
    for (const s of segs) {
      // link 세그먼트는 slug 를 포함한 직렬화 키(link:<slug>)로 보관해야 재편집 시 slug 유지됨.
      const mk = s.mark === "link" && s.linkSlug ? `${LINK_PREFIX}${s.linkSlug}` : s.mark;
      for (let k = 0; k < s.text.length; k++) chars.push({ ch: s.text[k], mark: mk });
    }
    // 선택 구간에 새 마크 적용(또는 해제). key 는 hl-*/c-* 고정키 또는 link:<slug>.
    for (let i = start; i < end && i < chars.length; i++) {
      chars[i].mark = isKnownKey(key) ? key : undefined;
    }
    // 글자 배열 → 마커 문자열 재직렬화(연속 동일 마크 묶음).
    let out = "";
    let i = 0;
    while (i < chars.length) {
      const mk = chars[i].mark;
      let j = i;
      let buf = "";
      while (j < chars.length && chars[j].mark === mk) { buf += chars[j].ch; j++; }
      out += isKnownKey(mk) ? `[[${mk}|${buf}]]` : buf;
      i = j;
    }

    renderToEl(el, out);
    window.getSelection()?.removeAllRanges();
    setToolbar(null);
    onChange(out);
  }

  // 에디터 전체 표식 초기화(평문화). 선택 없이도 동작.
  function clearAllMarks() {
    const el = ref.current;
    if (!el) return;
    const plain = parseRich(serializeEl(el)).map((s) => s.text).join("");
    renderToEl(el, plain);
    window.getSelection()?.removeAllRanges();
    setToolbar(null);
    onChange(plain);
  }

  // 링크 버튼 클릭 → 현재 선택 구간을 보관하고 카드 선택 패널 열기.
  function openLinkPanel() {
    const el = ref.current;
    if (!el) return;
    const off = selectionOffsets(el);
    if (!off) return;
    savedRangeRef.current = off;
    setLinkQuery("");
    // ref 를 먼저 동기화: 패널 input의 autoFocus 가 유발하는 에디터 blur 가
    // 이 렌더 사이클 안에서 일어나도 onBlur 가 linkPanelRef.current===true 를 보고 커밋을 건너뛰도록 한다.
    linkPanelRef.current = true;
    setLinkPanel(true);
  }

  // 카드 선택 → 보관한 구간에 link:<slug> 마크 적용.
  function chooseLink(slug: string) {
    const off = savedRangeRef.current;
    linkPanelRef.current = false; // 포커스 복원 시 onBlur 커밋이 정상 동작하도록 먼저 해제
    setLinkPanel(false);
    setToolbar(null);
    if (off) applyMark(`${LINK_PREFIX}${slug}`, off);
    savedRangeRef.current = null;
    // 적용 후 에디터로 포커스 복원 — 이어서 편집하거나 밖을 클릭하면 정상 커밋됨.
    ref.current?.focus({ preventScroll: true });
  }

  // 링크 패널 닫기(취소) — 포커스 복원.
  function closeLinkPanel() {
    linkPanelRef.current = false;
    setLinkPanel(false);
    savedRangeRef.current = null;
    ref.current?.focus({ preventScroll: true });
  }

  const isEmpty = !value || parseRich(value).every((s) => !s.text);
  const hasLinkTargets = !!(linkTargets && linkTargets.length);
  const filteredTargets = hasLinkTargets
    ? linkTargets!.filter((t) => {
        const q = linkQuery.trim().toLowerCase();
        if (!q) return true;
        return t.title.toLowerCase().includes(q) || String(t.year).includes(q);
      })
    : [];

  return (
    <div className="relative">
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-xs leading-relaxed text-center outline-none focus:ring-1 focus:ring-primary/50 whitespace-pre-wrap break-words"
        style={{ minHeight: `${rows * 1.4 + 1}rem` }}
        onKeyDown={handleKeyDown}
        onInput={() => { if (!composingRef.current) emit(); }}
        onCompositionStart={() => { composingRef.current = true; }}
        onCompositionEnd={() => { composingRef.current = false; emit(); }}
        onBlur={() => {
          emit();
          // 링크 패널 조작 중에는 편집 종료(커밋)를 미루다 — 패널 input 포커스로 인한 의도치 않은 blur 방지.
          if (linkPanelRef.current) return;
          onBlur?.();
        }}
        data-richeditor
      />
      {isEmpty && placeholder ? (
        <span className="pointer-events-none absolute inset-x-2.5 top-2 text-center text-xs text-muted-foreground">
          {placeholder}
        </span>
      ) : null}

      {toolbar ? (
        <div
          className="fixed z-[100] flex items-center gap-1 rounded-md border border-border bg-popover px-1.5 py-1 shadow-lg"
          style={{ left: toolbar.x, top: toolbar.y + 6, transform: "translate(-50%, 0)" }}
          onMouseDown={(e) => e.preventDefault() /* 선택 유지 */}
        >
          {MARK_STYLES.map((m) => (
            <button
              key={m.key}
              type="button"
              title={m.label}
              className="h-5 w-5 rounded-sm border border-border/60 hover:scale-110 transition-transform"
              style={
                m.kind === "hl"
                  ? { background: m.swatch }
                  : { background: "transparent", color: m.swatch, fontWeight: 700, fontSize: 11, lineHeight: "1" }
              }
              onClick={() => applyMark(m.key)}
            >
              {m.kind === "c" ? "A" : ""}
            </button>
          ))}
          {hasLinkTargets ? (
            <>
              <span className="mx-0.5 h-4 w-px bg-border" />
              <button
                type="button"
                title="선택 단어에 다른 카드로 가는 링크 걸기"
                className="flex h-5 items-center gap-0.5 rounded-sm px-1 text-[10px] text-sky-400 hover:bg-muted hover:text-sky-300"
                onClick={() => openLinkPanel()}
                data-testid="mark-link"
              >
                🔗 링크
              </button>
            </>
          ) : null}
          <span className="mx-0.5 h-4 w-px bg-border" />
          <button
            type="button"
            title="선택 구간 표식 제거(링크 포함)"
            className="h-5 px-1 rounded-sm text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted"
            onClick={() => applyMark(null)}
            data-testid="mark-clear-selection"
          >
            지움
          </button>
          <button
            type="button"
            title="이 칸 전체 표식 초기화"
            className="h-5 px-1 rounded-sm text-[10px] text-muted-foreground hover:text-destructive hover:bg-muted"
            onClick={() => clearAllMarks()}
            data-testid="mark-clear-all"
          >
            전체초기화
          </button>
        </div>
      ) : null}

      {/* 카드 선택 패널 — 링크 버튼 클릭 시 표시. 점프할 카드를 고른다. */}
      {linkPanel && hasLinkTargets ? (
        <div
          className="fixed z-[110] flex w-64 flex-col rounded-md border border-border bg-popover p-2 shadow-xl"
          style={{ left: toolbar ? toolbar.x : 200, top: (toolbar ? toolbar.y : 200) + 40, transform: "translate(-50%, 0)" }}
          onMouseDown={(e) => e.preventDefault() /* 선택 유지 */}
          data-testid="link-panel"
        >
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] font-medium text-muted-foreground">어떤 카드로 연결?</span>
            <button
              type="button"
              className="text-[11px] text-muted-foreground hover:text-foreground"
              onClick={() => closeLinkPanel()}
            >
              ✕
            </button>
          </div>
          <input
            type="text"
            autoFocus
            value={linkQuery}
            onChange={(e) => setLinkQuery(e.target.value)}
            placeholder="연도·제목 검색"
            className="mb-1.5 w-full rounded border border-border bg-background px-2 py-1 text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
            data-testid="link-search"
          />
          <div className="max-h-44 overflow-y-auto">
            {filteredTargets.length === 0 ? (
              <div className="px-1 py-2 text-center text-[11px] text-muted-foreground/60">일치하는 카드 없음</div>
            ) : (
              filteredTargets.map((t) => (
                <button
                  key={t.slug}
                  type="button"
                  className="flex w-full items-baseline gap-2 rounded px-1.5 py-1 text-left hover:bg-muted"
                  onClick={() => chooseLink(t.slug)}
                  data-testid={`link-opt-${t.slug}`}
                >
                  <span className="shrink-0 text-[11px] font-semibold text-sky-400">{t.year}</span>
                  <span className="truncate text-[12px] text-foreground">{t.title}</span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
