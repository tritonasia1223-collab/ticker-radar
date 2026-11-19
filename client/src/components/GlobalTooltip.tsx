import { useEffect, useLayoutEffect, useRef, useState } from "react";

// 사이트 전역 툴팁 — 브라우저 기본 title 팝업 대신 통일된 깔끔한 팝오버 하나로.
// Layout 에 1회 마운트. 어떤 요소든 title(또는 data-tip) 속성을 hover 하면
// 네이티브 툴팁을 억제하고(title→data-native-title 로 스태시) 스타일 팝오버를 띄운다.
// 지도 커서 추적 툴팁(World 의 setTip)은 동일 시각 토큰(TIP_CLASS)을 공유.
export const TIP_CLASS =
  "rounded-lg border border-border bg-popover/95 px-2.5 py-1.5 text-[11px] font-normal leading-snug text-popover-foreground/80 shadow-lg backdrop-blur-sm";

const GAP = 8, MARGIN = 8;

type Snap = { top: number; bottom: number; left: number; width: number };

export default function GlobalTooltip() {
  const [tip, setTip] = useState<{ text: string; r: Snap } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; caret: number; placement: "top" | "bottom" } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<Element | null>(null);

  useEffect(() => {
    // 이미 뜬 뒤엔 title 이 벗겨지므로(data-native-title 로 스태시) 셀렉터에 그것도 포함해야 재hover·해제가 잡힘.
    const SEL = "[title], [data-tip], [data-native-title]";
    const readText = (el: Element): string | null => {
      const dt = el.getAttribute("data-tip");
      if (dt && dt.trim()) return dt;
      const t = el.getAttribute("title");
      if (t && t.trim()) { el.setAttribute("data-native-title", t); el.removeAttribute("title"); return t; }
      const s = el.getAttribute("data-native-title");
      return s && s.trim() ? s : null;
    };
    const hide = () => { targetRef.current = null; setTip(null); setPos(null); };
    const showFor = (el: Element) => {
      const text = readText(el);
      if (!text) return;
      targetRef.current = el;
      const b = el.getBoundingClientRect();
      setPos(null);
      setTip({ text, r: { top: b.top, bottom: b.bottom, left: b.left, width: b.width } });
    };
    const onOver = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.(SEL);
      if (!el || el === targetRef.current) return;
      showFor(el);
    };
    // 해제는 셀렉터 재매칭이 아니라 현재 대상 요소 기준으로 판정(title 이 벗겨져 있어도 안전).
    const onOut = (e: Event) => {
      if (!targetRef.current) return;
      const rt = (e as MouseEvent).relatedTarget as Node | null;
      if (rt && targetRef.current.contains(rt)) return; // 대상 내부로 이동 → 유지
      hide();
    };
    document.addEventListener("mouseover", onOver, true);
    document.addEventListener("mouseout", onOut, true);
    document.addEventListener("focusin", onOver, true);
    document.addEventListener("focusout", onOut, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide, true);
    return () => {
      document.removeEventListener("mouseover", onOver, true);
      document.removeEventListener("mouseout", onOut, true);
      document.removeEventListener("focusin", onOver, true);
      document.removeEventListener("focusout", onOut, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide, true);
    };
  }, []);

  useLayoutEffect(() => {
    if (!tip || !boxRef.current) return;
    const box = boxRef.current.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const cx = tip.r.left + tip.r.width / 2;
    let placement: "top" | "bottom" = tip.r.top >= box.height + GAP + MARGIN ? "top" : "bottom";
    if (placement === "bottom" && tip.r.bottom + GAP + box.height > vh - MARGIN && tip.r.top >= box.height + GAP + MARGIN) placement = "top";
    const left = Math.max(MARGIN, Math.min(cx - box.width / 2, vw - MARGIN - box.width));
    const top = placement === "top" ? tip.r.top - GAP - box.height : tip.r.bottom + GAP;
    const caret = Math.max(12, Math.min(cx - left, box.width - 12));
    setPos({ left, top, caret, placement });
  }, [tip]);

  if (!tip) return null;
  const ready = pos != null;
  return (
    <div
      ref={boxRef}
      role="tooltip"
      className={`pointer-events-none fixed z-[9999] max-w-[260px] ${TIP_CLASS}`}
      style={{
        left: ready ? pos!.left : -9999,
        top: ready ? pos!.top : -9999,
        whiteSpace: "pre-line",
        wordBreak: "keep-all",
        opacity: ready ? 1 : 0,
        transform: ready ? "translateY(0)" : "translateY(2px)",
        transition: "opacity .1s ease, transform .1s ease",
      }}
    >
      {tip.text}
      {ready && (
        <span
          className="absolute h-2 w-2 rotate-45 bg-popover"
          style={
            pos!.placement === "top"
              ? { left: pos!.caret - 4, bottom: -4, borderRight: "1px solid hsl(var(--border))", borderBottom: "1px solid hsl(var(--border))" }
              : { left: pos!.caret - 4, top: -4, borderLeft: "1px solid hsl(var(--border))", borderTop: "1px solid hsl(var(--border))" }
          }
        />
      )}
    </div>
  );
}
