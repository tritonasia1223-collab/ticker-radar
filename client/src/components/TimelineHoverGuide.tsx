import { useEffect, useState, type RefObject } from "react";
import { timelineHoverPath } from "@/lib/timeline-hover-path";

/** One lightweight overlay for the board; never changes event layout or saved data. */
export function TimelineHoverGuide({ boardRef }: { boardRef: RefObject<HTMLDivElement> }) {
  const [guide, setGuide] = useState<{ path: string; color: string } | null>(null);
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    let active: HTMLElement | null = null;
    let label: HTMLElement | null = null;
    let row: HTMLElement | null = null;
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (!active?.isConnected || !row?.isConnected) { activate(null); return; }
      // Annual context has no month label to connect to.
      if (!label || row.classList.contains("it-annual-slice")) { setGuide(null); return; }
      const origin = board.getBoundingClientRect();
      const target = active.getBoundingClientRect();
      const date = label.getBoundingClientRect();
      const bounds = row.getBoundingClientRect();
      const x1 = date.right - origin.left + 5;
      const y1 = date.top - origin.top + date.height / 2;
      const x2 = target.left - origin.left - 8;
      const y2 = target.top - origin.top + Math.min(11, target.height / 2);
      // Empty lanes do not obstruct the direct connection; only occupied blocks do.
      const obstacles = Array.from(row.querySelectorAll<HTMLElement>(".it-event, .it-europe-shared, .it-annual-card"))
        .filter(element => element !== active && !element.contains(active))
        .map(element => element.getBoundingClientRect())
        .filter(rect => rect.width > 0 && rect.height > 0)
        .map(rect => ({ left: rect.left - origin.left, right: rect.right - origin.left, top: rect.top - origin.top, bottom: rect.bottom - origin.top }));
      const railY = bounds.top - origin.top + 4;
      setGuide({ path: timelineHoverPath({ x: x1, y: y1 }, { x: x2 + 6, y: y2 }, obstacles, railY), color: getComputedStyle(active).getPropertyValue("--it-event").trim() || "var(--it-soft)" });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const resize = new ResizeObserver(schedule);
    const activate = (next: HTMLElement | null) => {
      if (next === active) return;
      active?.removeAttribute("data-hover-active");
      label?.removeAttribute("data-hover-month");
      resize.disconnect();
      active = next;
      row = next?.closest<HTMLElement>("[data-period-row]") ?? null;
      label = row?.querySelector<HTMLElement>("[data-month-label]") ?? null;
      if (!active || !row) { setGuide(null); return; }
      active.setAttribute("data-hover-active", "true");
      label?.setAttribute("data-hover-month", "true");
      resize.observe(board);
      resize.observe(row);
      resize.observe(active);
      measure();
    };
    const entry = (target: EventTarget | null) => target instanceof Element && board.contains(target)
      ? target.closest<HTMLElement>(".it-description")?.closest<HTMLElement>(".it-event") ?? null : null;
    const over = (e: PointerEvent) => { if (e.pointerType !== "touch") activate(entry(e.target)); };
    const out = (e: PointerEvent) => { if (e.pointerType !== "touch") activate(entry(e.relatedTarget)); };
    const clear = () => activate(null);
    board.addEventListener("pointerover", over);
    board.addEventListener("pointerout", out);
    board.addEventListener("pointerleave", clear);
    window.addEventListener("blur", clear);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      active?.removeAttribute("data-hover-active");
      label?.removeAttribute("data-hover-month");
      board.removeEventListener("pointerover", over);
      board.removeEventListener("pointerout", out);
      board.removeEventListener("pointerleave", clear);
      window.removeEventListener("blur", clear);
    };
  }, [boardRef]);
  return <svg className="it-hover-guide" aria-hidden="true" data-testid="timeline-hover-guide" data-visible={!!guide}>
    {guide && <path d={guide.path} style={{ stroke: guide.color }} />}
  </svg>;
}
