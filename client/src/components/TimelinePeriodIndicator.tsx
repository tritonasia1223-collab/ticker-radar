import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { TimelineEvent, TimelineLane } from "@/data/international-timeline";
import { eventLanes } from "@/lib/international-timeline-lanes";
import { periodEnd, periodExtent, type PeriodSlice } from "@/lib/international-timeline-period";

export function useTimelinePeriod(events: TimelineEvent[], slices: PeriodSlice[], lanes: TimelineLane[]) {
  const boardRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  // Filtering/unmounting an active card must not leave a stranded indicator.
  useEffect(() => {
    const present = (id: string | null) => id && events.some(e => e.id === id && periodEnd(e));
    if (!present(hovered)) setHovered(null);
    if (!present(focused)) setFocused(null);
  }, [events, hovered, focused]);
  const activeId = hovered ?? focused;
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
    onPointerOver: (e: React.PointerEvent) => { if (e.pointerType !== "touch") setHovered(periodId(e.target)); },
    onPointerOut: (e: React.PointerEvent) => { if (e.pointerType !== "touch" && periodId(e.target) !== periodId(e.relatedTarget)) setHovered(periodId(e.relatedTarget)); },
    onFocusCapture: (e: React.FocusEvent) => { setFocused(periodId(e.target)); },
    onBlurCapture: (e: React.FocusEvent) => { setFocused(periodId(e.relatedTarget)); },
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Escape") { setHovered(null); setFocused(null); } },
  };
  const overlay = <div aria-hidden="true" data-testid="period-indicator" data-visible={!!event && measuredId === event.id} data-missing-end={geometry?.missingEnd ?? false}
    className="it-period-indicator" style={{ top: geometry?.top ?? 0, left: geometry?.left ?? 0, width: geometry?.width ?? 0, height: geometry?.height ?? 0, "--it-period-color": `var(--it-${geometry?.color ?? color})` } as CSSProperties}>
    {geometry?.missingEnd && <span className="it-period-end"><span className="it-period-arrow">↓</span>{geometry.endLabel}</span>}
  </div>;
  const gutterStyle = (key: string): CSSProperties | undefined => extent?.keys.includes(key) ? { "--it-gutter-period": `var(--it-${color})` } as CSSProperties : undefined;
  return { boardRef, handlers, overlay, gutterStyle };
}
