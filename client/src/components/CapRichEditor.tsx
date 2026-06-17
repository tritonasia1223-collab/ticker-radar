// 인라인 리치텍스트 에디터: 텍스트를 드래그 선택하면 색상/하이라이트 팝업 툴바가 떠서
// 선택 구간에 표식을 적용한다. 내부적으로 contentEditable + data-mark span 사용,
// 외부로는 [[키|텍스트]] 마커 문자열을 주고받는다(value/onChange).
import { useRef, useEffect, useState, useCallback } from "react";
import { MARK_STYLES, MARK_BY_KEY, parseRich } from "@/lib/capitalism-richtext";

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
    if (seg.mark && MARK_BY_KEY[seg.mark]) {
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
      if (mark && MARK_BY_KEY[mark]) {
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

export function CapRichEditor({
  value, onChange, placeholder, rows = 2, autoFocus = false, onBlur,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  onBlur?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [toolbar, setToolbar] = useState<{ x: number; y: number } | null>(null);
  const composingRef = useRef(false);

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
  function applyMark(key: string | null) {
    const el = ref.current;
    if (!el) return;
    const off = selectionOffsets(el);
    if (!off) return;
    const { start, end } = off;

    // 현재 내용 → 글자 단위 (char, mark) 배열로 평탄화.
    const raw = serializeEl(el);
    const segs = parseRich(raw);
    // 오프셋이 UTF-16 코드유닛 기준(selectionOffsets와 일치)이므로 코드유닛 단위로 분해.
    const chars: { ch: string; mark?: string }[] = [];
    for (const s of segs) {
      for (let k = 0; k < s.text.length; k++) chars.push({ ch: s.text[k], mark: s.mark });
    }
    // 선택 구간에 새 마크 적용(또는 해제).
    for (let i = start; i < end && i < chars.length; i++) {
      chars[i].mark = key && MARK_BY_KEY[key] ? key : undefined;
    }
    // 글자 배열 → 마커 문자열 재직렬화(연속 동일 마크 묶음).
    let out = "";
    let i = 0;
    while (i < chars.length) {
      const mk = chars[i].mark;
      let j = i;
      let buf = "";
      while (j < chars.length && chars[j].mark === mk) { buf += chars[j].ch; j++; }
      out += mk && MARK_BY_KEY[mk] ? `[[${mk}|${buf}]]` : buf;
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

  const isEmpty = !value || parseRich(value).every((s) => !s.text);

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
        onBlur={() => { emit(); onBlur?.(); }}
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
          <span className="mx-0.5 h-4 w-px bg-border" />
          <button
            type="button"
            title="선택 구간 표식 제거"
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
    </div>
  );
}
