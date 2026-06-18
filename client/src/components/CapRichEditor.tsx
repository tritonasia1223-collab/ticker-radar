// 인라인 리치텍스트 에디터: 텍스트를 드래그 선택하면 색상/하이라이트 팝업 툴바가 떠서
// 선택 구간에 표식을 적용한다. 내부적으로 contentEditable + data-mark span 사용,
// 외부로는 [[키|텍스트]] 마커 문자열을 주고받는다(value/onChange).
import { useRef, useEffect, useState, useCallback } from "react";
import { MARK_STYLES, MARK_BY_KEY, parseRich, LINK_PREFIX } from "@/lib/capitalism-richtext";

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

// \n 가 들어간 텍스트를 텍스트노드+<br> 조합으로 target에 추가.
function appendTextWithBreaks(target: HTMLElement, text: string) {
  const parts = text.split("\n");
  parts.forEach((part, i) => {
    if (i > 0) target.appendChild(document.createElement("br"));
    if (part) target.appendChild(document.createTextNode(part));
  });
}

// 마커 문자열 → contentEditable 안에 넣을 DOM(span/br) 생성.
function renderToEl(el: HTMLElement, raw: string) {
  el.innerHTML = "";
  for (const seg of parseRich(raw)) {
    if (seg.mark === "link" && seg.linkSlug) {
      // 내부 링크 — data-mark="link:<slug>" 로 저장해 직렬화 시 복원.
      const span = document.createElement("span");
      span.setAttribute("data-mark", `${LINK_PREFIX}${seg.linkSlug}`);
      Object.assign(span.style, LINK_STYLE);
      appendTextWithBreaks(span, seg.text);
      el.appendChild(span);
    } else if (seg.mark && MARK_BY_KEY[seg.mark]) {
      const span = document.createElement("span");
      span.setAttribute("data-mark", seg.mark);
      const st = MARK_BY_KEY[seg.mark].style as Record<string, string | number>;
      Object.assign(span.style, st);
      // 마크 내부에도 줄바꿈이 있을 수 있음.
      appendTextWithBreaks(span, seg.text);
      el.appendChild(span);
    } else {
      appendTextWithBreaks(el, seg.text);
    }
  }
  if (!el.childNodes.length) el.appendChild(document.createTextNode(""));
}

// contentEditable DOM → 마커 문자열 직렬화.
// 줄바꿈 처리: contentEditable은 Enter를 <div>/<br> 로 만들므로
//   - BR(data-mark 없는) → \n
//   - 블록 요소(DIV/P) → 앞 내용과 사이에 \n 삽입 후 내부 재귀 직렬화
function serializeEl(el: HTMLElement): string {
  let out = "";
  const walk = (parent: Node, topLevel: boolean) => {
    parent.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        out += node.textContent || "";
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const e = node as HTMLElement;
      const tag = e.tagName;
      const mark = e.getAttribute("data-mark");
      if (isKnownKey(mark)) {
        out += `[[${mark}|${e.textContent || ""}]]`;
        return;
      }
      if (tag === "BR") {
        out += "\n";
        return;
      }
      // 블록 요소(DIV/P)는 새 줄을 의미 — 앞에 내용이 있으면 \n 선행.
      if (tag === "DIV" || tag === "P") {
        if (out.length > 0 && !out.endsWith("\n")) out += "\n";
        walk(e, false);
        return;
      }
      // 그 외 인라인 요소(SPAN 등, 마크 아님) → 내부 재귀.
      walk(e, false);
    });
  };
  walk(el, true);
  return out;
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
  useEffect(() => {
    if (!autoFocus) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
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

  // 에디터 내부에서 선택 구간의 plain-text 오프셋(시작/끝)을 구한다.
  // 마크 span/텍스트/BR(\n) 을 순서대로 훑으면서 anchor/focus 노드 위치를 누적 길이로 환산.
  function selectionOffsets(el: HTMLElement): { start: number; end: number } | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null;

    // 특정 (node, offset) 까지의 plain-text 길이.
    const lenUntil = (target: Node, targetOffset: number): number => {
      let len = 0;
      let done = false;
      const walk = (n: Node) => {
        if (done) return;
        if (n.nodeType === Node.TEXT_NODE) {
          if (n === target) { len += targetOffset; done = true; return; }
          len += (n.textContent || "").length;
          return;
        }
        if (n.nodeType === Node.ELEMENT_NODE) {
          const e = n as HTMLElement;
          if (e.tagName === "BR") {
            if (n === target) { done = true; return; }
            len += 1; // \n
            return;
          }
          // 요소 컨테이너에 대한 offset = 자식 인덱스. 해당 자식 전까지 누적.
          if (n === target) {
            for (let i = 0; i < targetOffset && i < e.childNodes.length; i++) walk(e.childNodes[i]);
            done = true;
            return;
          }
          e.childNodes.forEach(walk);
        }
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
    ref.current?.focus();
  }

  // 링크 패널 닫기(취소) — 포커스 복원.
  function closeLinkPanel() {
    linkPanelRef.current = false;
    setLinkPanel(false);
    savedRangeRef.current = null;
    ref.current?.focus();
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
