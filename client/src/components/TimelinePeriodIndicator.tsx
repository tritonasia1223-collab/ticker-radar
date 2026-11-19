import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from "react";
import type { TimelineEvent, TimelineLane } from "@/data/international-timeline";
import { eventLanes } from "@/lib/international-timeline-lanes";
import { periodEnd, periodExtent, type PeriodSlice } from "@/lib/international-timeline-period";

export const TimelinePeriodContext = createContext<{ mobile: boolean; tapped: string | null; setTapped: Dispatch<SetStateAction<string | null>> }>({ mobile: false, tapped: null, setTapped: () => {} });
export const usePeriodInteraction = () => useContext(TimelinePeriodContext);

export function useTimelinePeriod(events: TimelineEvent[], slices: PeriodSlice[], lanes: TimelineLane[]) {
  const boardRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [tapped, setTapped] = useState<string | null>(null);
  const keyboard = useRef(false);
  const [mobile, setMobile] = useState(() => window.matchMedia("(hover: none)").matches);
  useEffect(() => {
    const media = window.matchMedia("(hover: none)");
    const change = () => { setMobile(media.matches); setHovered(null); setFocused(null); setTapped(null); };
    media.addEventListener("change", change);
    const key = (e: KeyboardEvent) => { if (e.key === "Tab") keyboard.current = true; };
    const pointer = () => { keyboard.current = false; };
    window.addEventListener("keydown", key);
    window.addEventListener("pointerdown", pointer);
    return () => { media.removeEventListener("change", change); window.removeEventListener("keydown", key); window.removeEventListener("pointerdown", pointer); };
  }, []);
  // Filtering/unmounting an active card must not leave a stranded indicator.
  useEffect(() => {
    const present = (id: string | null) => id && events.some(e => e.id === id && periodEnd(e));
    if (!present(hovered)) setHovered(null);
    if (!present(focused)) setFocused(null);
    if (!present(tapped)) setTapped(null);
  }, [events, hovered, focused, tapped]);
  const activeId = mobile ? tapped ?? focused : hovered ?? focused;
  const event = events.find(e => e.id === activeId && periodEnd(e));
  const extent = useMemo(() => event ? periodExtent(event, slices) : null, [event, slices]);
  const color = event ? event.scope === "global" ? "shock" : eventLanes(event).length > 1 ? "eu" : eventLanes(event)[0] : "us";
  const [geometry, setGeometry] = useState<{ top: number; left: number; width: number; height: number; missingEnd: boolean; endLabel: string; color: string } | null>(null);
  const [measuredId, setMeasuredId] = useState<string | null>(null);
  const laneKey = lanes.join(",");
  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board || !event || !extent) { setMeasuredId(null); return; }
    let frame = 0;
    const measure = () => {
      const first = board.querySelector<HTMLElement>(`[data-period-row="${CSS.escape(extent.first)}"]`);
      const last = board.querySelector<HTMLElement>(`[data-period-row="${CSS.escape(extent.last)}"]`);
      const visibleLanes = event.scope === "global" ? lanes : lanes.filter(lane => eventLanes(event).includes(lane));
      const columns = visibleLanes.map(lane => board.querySelector<HTMLElement>(`[data-region-heading="${lane}"]`)).filter((node): node is HTMLElement => !!node);
      if (!first || !last || !columns.length) { setMeasuredId(null); return; }
      const root = board.getBoundingClientRect();
      const start = first.getBoundingClientRect();
      const finish = last.getBoundingClientRect();
      const left = columns[0].getBoundingClientRect().left - root.left - 9;
      const right = columns.at(-1)!.getBoundingClientRect().right - root.left + 9;
      setGeometry({ top: start.top - root.top, left, width: right - left, height: finish.bottom - start.top, missingEnd: extent.missingEnd, endLabel: extent.endLabel, color });
      setMeasuredId(event.id);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    measure();
    const resize = new ResizeObserver(schedule);
    resize.observe(board);
    board.querySelectorAll("[data-period-row]").forEach(row => resize.observe(row));
    window.addEventListener("resize", schedule);
    return () => { cancelAnimationFrame(frame); resize.disconnect(); window.removeEventListener("resize", schedule); };
  }, [event, extent, laneKey, color]);

  const periodId = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>("[data-period-event]")?.dataset.periodEvent ?? null : null;
  const handlers = {
    onPointerDown: () => { if (mobile) setFocused(null); },
    onPointerOver: (e: React.PointerEvent) => { if (!mobile && e.pointerType !== "touch") setHovered(periodId(e.target)); },
    onPointerOut: (e: React.PointerEvent) => { if (!mobile && e.pointerType !== "touch" && periodId(e.target) !== periodId(e.relatedTarget)) setHovered(periodId(e.relatedTarget)); },
    onFocusCapture: (e: React.FocusEvent) => { if (!mobile || keyboard.current) setFocused(periodId(e.target)); },
    onBlurCapture: (e: React.FocusEvent) => { setFocused(!mobile || keyboard.current ? periodId(e.relatedTarget) : null); },
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Escape") { setHovered(null); setFocused(null); setTapped(null); } },
  };
  const overlay = <div aria-hidden="true" data-testid="period-indicator" data-visible={!!event && measuredId === event.id} data-missing-end={geometry?.missingEnd ?? false}
    className="it-period-indicator" style={{ top: geometry?.top ?? 0, left: geometry?.left ?? 0, width: geometry?.width ?? 0, height: geometry?.height ?? 0, "--it-period-color": `var(--it-${geometry?.color ?? color})` } as CSSProperties}>
    {geometry?.missingEnd && <span className="it-period-end"><span className="it-period-arrow">↓</span>{geometry.endLabel}</span>}
  </div>;
  const gutterStyle = (key: string): CSSProperties | undefined => extent?.keys.includes(key) ? { "--it-gutter-period": `var(--it-${color})` } as CSSProperties : undefined;
  return { boardRef, handlers, overlay, gutterStyle, interaction: { mobile, tapped, setTapped } };
}
