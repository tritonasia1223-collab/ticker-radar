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

  // 선택 구간에 표식 적용/해제. key=null 이면 표식 제거.
  function applyMark(key: string | null) {
    const el = ref.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return;
    const text = range.toString();
    if (!text) return;

    // 선택 영역 삭제 후, 표식 span(또는 평문)으로 치환.
    range.deleteContents();
    let inserted: Node;
    if (key && MARK_BY_KEY[key]) {
      const span = document.createElement("span");
      span.setAttribute("data-mark", key);
      Object.assign(span.style, MARK_BY_KEY[key].style as Record<string, string | number>);
      span.textContent = text;
      inserted = span;
    } else {
      inserted = document.createTextNode(text);
    }
    range.insertNode(inserted);

    // 인접 평문 노드 병합 정리(중첩 span 방지 위해 normalize).
    el.normalize();
    // 선택 해제 + 반영
    sel.removeAllRanges();
    setToolbar(null);
    emit();
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
            title="표식 제거"
            className="h-5 px-1 rounded-sm text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted"
            onClick={() => applyMark(null)}
          >
            지움
          </button>
        </div>
      ) : null}
    </div>
  );
}
