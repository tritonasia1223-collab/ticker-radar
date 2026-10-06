import { tradeObservationLabel } from "../../../shared/trade-history";
import { memo, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { lineSegments, simplifyExtrema, moveRange, zoomRange, calendarTicks, type SavedInsight, type TrendSection } from "../../../shared/cap-comparison";
import type { SpreadData } from "@/lib/comparison-series";
import { frameMeasurement } from "@/lib/capitalism-layout";
import { nearbyObservation, hoverLayout } from "@/lib/comparison-hover";

import { Star } from "lucide-react";
import { ComparisonTimeNavigation } from "./ComparisonTimeNavigation";
import type { AxisSeries, ComparisonAxis } from "@/lib/comparison-axes";
export type ChartSeries = AxisSeries;
export type ChartTool = "move" | "date" | "period";
type Domain = [number, number];
type HistoryEvent = { id: string; date: string; title: string };
const DAY = 86400000;
const fmt = (v: number) => v.toLocaleString("ko", { maximumFractionDigits: 2 });
export const iso = (time: number) => new Date(time).toISOString().slice(0, 10);
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

export const CompareChart = memo(function CompareChart({ series, range, extent, axes, onRange, phases, events, onEvents, simplifyMonths, notes, selectedNote, onNote, onCreate, tool, onCancelTool, resetAxes, layoutKey, spread, onRemoveSpread, summary }: {
  summary?: ReactNode;
  spread: SpreadData | null; onRemoveSpread: () => void;
  series: ChartSeries[]; range: Domain; extent: Domain; axes: ComparisonAxis[]; onRange: (value: Domain) => void;
  phases: TrendSection[]; events: HistoryEvent[]; onEvents: (ids: string[]) => void; simplifyMonths: number;
  notes: SavedInsight[]; selectedNote: string | null; onNote: (id: string) => void;
  onCreate: (date: string, endDate: string | null) => void; tool: ChartTool; onCancelTool: () => void; resetAxes: number; layoutKey: string;
}) {
  const host = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null);
  const chartHeader = useRef<HTMLDivElement>(null), chartFooter = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900), [chartHeight, setChartHeight] = useState(530);
  const [cursor, setCursor] = useState<number | null>(null), [preview, setPreview] = useState<Domain | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number; clientX: number; clientY: number } | null>(null);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const clear = () => { setPointer(null); setCursor(null); };
    const resize = () => { setViewport({ width: window.innerWidth, height: window.innerHeight }); clear(); };
    window.addEventListener("resize", resize);
    window.addEventListener("scroll", clear, true);
    return () => { window.removeEventListener("resize", resize); window.removeEventListener("scroll", clear, true); };
  }, []);
  const [jumpTime, setJumpTime] = useState<number | null>(null);
  useEffect(() => { if (jumpTime === null) return; const timer = setTimeout(() => setJumpTime(null), 5000); return () => clearTimeout(timer); }, [jumpTime]);
  const [domains, setDomains] = useState<Record<string, Domain>>({});
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const drag = useRef<{ px: number; py: number; time: number; range: Domain; part: string; domain?: Domain; key?: string; tool: ChartTool } | null>(null);
  const clip = useId().replaceAll(":", ""), [from, to] = range;
  const identity = axes.map(a => a.key).join(",") + series.map(s => s.def.id + ":" + s.axis).join(",");
  const previousAxes = useRef<Record<string, string>>({});
  useEffect(() => { setPointer(null); setCursor(null); }, [from, to, identity, resetAxes, width, chartHeight, tool, simplifyMonths]);
  useEffect(() => { setDomains({}); }, [resetAxes]);
  useEffect(() => {
    const signatures = Object.fromEntries(axes.map(a => [a.key, series.filter(s => s.axis === a.key).map(s => s.def.id).join(",")]));
    const previous = previousAxes.current;
    setDomains(current => Object.fromEntries(Object.entries(current).filter(([key]) => signatures[key] !== undefined && previous[key] === signatures[key])));
    previousAxes.current = signatures;
  }, [identity]);
  useEffect(() => { setGroupIds([]); }, [from, to]);
  useEffect(() => { drag.current = null; setPreview(null); }, [tool]);
  useEffect(() => {
    const el = host.current; if (!el) return;
    const m = frameMeasurement(() => { setWidth(Math.max(280, el.clientWidth)); setChartHeight(clamp(window.innerHeight - Math.max(0, el.getBoundingClientRect().top) - (chartHeader.current?.offsetHeight ?? 72) - (chartFooter.current?.offsetHeight ?? 50) - 38, spread ? 460 : 330, 800)); });
    const ro = new ResizeObserver(m.schedule); ro.observe(el); if (chartHeader.current) ro.observe(chartHeader.current); if (chartFooter.current) ro.observe(chartFooter.current); window.addEventListener("resize", m.schedule); m.schedule();
    return () => { ro.disconnect(); window.removeEventListener("resize", m.schedule); m.dispose(); };
  }, [layoutKey, !!spread, !!summary]);
  const left = width < 500 ? 48 : 65, right = width - (width < 500 ? 44 : 55), span = right - left;
  const badgeWidth = Math.min(180, span);
  const axisBottom = chartHeight - (events.length ? 85 : 43);
  const plotTop = 76, plotBottom = axisBottom - (spread ? 175 : 0), plotHeight = plotBottom - plotTop, spreadTop = plotBottom + 48;
  const x = (time: number) => left + (time - from) / (to - from) * span;
  const ticks = calendarTicks(range, span);
  const spreadShape = useMemo(() => {
    if (!spread) return null;
    const points = spread.points.filter(p => p.time >= from && p.time <= to), values = points.map(p => p.value);
    const min = Math.min(0, ...values), max = Math.max(0, ...values), pad = (max - min) * .1 || .5;
    const lo = min - pad, hi = max + pad, y = (v: number) => axisBottom - (v - lo) / (hi - lo) * (axisBottom - spreadTop);
    const segments = lineSegments(points, 1);
    return { points, lo, hi, y, segments, paths: segments.map(g => g.map((p, i) => (i ? "L" : "M") + x(p.time) + "," + y(p.value)).join(" ")) };
  }, [spread, from, to, width, axisBottom, spreadTop]);
  const geometry = useMemo(() => {
    const visible = series.map(s => ({ ...s, points: s.points.filter(p => p.time >= from && p.time <= to) }));
    const axisShapes = axes.map(axis => {
      const values = visible.filter(s => s.axis === axis.key).flatMap(s => s.points.map(p => p.value));
      let lo = values.length ? Math.min(...values) : 0, hi = values.length ? Math.max(...values) : 1;
      if (!axis.normalized && !axis.independent) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
      const pad = (hi - lo) * .08 || Math.abs(hi) * .05 || 1; lo -= pad; hi += pad;
      if (!axis.independent && domains[axis.key]) [lo, hi] = domains[axis.key];
      const y = (v: number) => plotBottom - (v - lo) / (hi - lo) * plotHeight;
      return { ...axis, lo, hi, y };
    });
    const shapes = visible.map(s => {
      const axis = axisShapes.find(a => a.key === s.axis)!;
      return { ...s, ...axis, paths: lineSegments(s.points, s.def.cadence).map(original => {
        const points = simplifyExtrema(original, simplifyMonths);
        return { original, points, d: points.map((p, i) => (i ? "L" : "M") + x(p.time).toFixed(2) + "," + axis.y(p.value).toFixed(2)).join(" ") };
      }) };
    });
    return { shapes, axisShapes };
  }, [series, axes, from, to, width, plotBottom, simplifyMonths, domains]);
  const { shapes, axisShapes } = geometry;
  const labeledAxes = axisShapes.filter(a => !a.independent);
  const nearby = useMemo(() => {
    if (!pointer) return [];
    if (pointer.y >= plotTop && pointer.y <= plotBottom) return shapes.flatMap(s => {
      const hit = nearbyObservation(s.paths.map(g => ({ points: g.original, rendered: g.points })), pointer, x, s.y);
      return hit && hit.y >= plotTop && hit.y <= plotBottom ? [{ ...hit, id: s.def.id, label: s.def.label, color: s.def.color, unit: s.def.unit, indexed: s.normalized }] : [];
    });
    if (spread && spreadShape && pointer.y >= spreadTop && pointer.y <= axisBottom) {
      const hit = nearbyObservation(spreadShape.segments.map(points => ({ points, rendered: points })), pointer, x, spreadShape.y);
      if (hit) return [{ ...hit, id: "spread", label: spread.label, color: "#8b5cf6", unit: "%p", indexed: false }];
    }
    return [];
  }, [pointer, shapes, spread, spreadShape, from, to, width, plotBottom, spreadTop, axisBottom]);
  const tooltipLayout = hoverLayout(nearby.length, viewport);
  const badges = useMemo(() => {
    const groups: { px: number; items: SavedInsight[] }[] = [];
    for (const n of notes.filter(n => Date.parse(n.endDate ?? n.date) >= from && Date.parse(n.date) <= to).sort((a, b) => a.date.localeCompare(b.date))) {
      const px = clamp(x(Date.parse(n.date)), left, right - badgeWidth), last = groups.at(-1);
      if (last && px - last.px < badgeWidth + 8) last.items.push(n);
      else groups.push({ px, items: [n] });
    }
    return groups;
  }, [notes, from, to, width]);
  const eventGroups = useMemo(() => {
    const groups: { px: number; items: HistoryEvent[] }[] = [];
    for (const event of events.filter(e => Date.parse(e.date) >= from && Date.parse(e.date) <= to).sort((a, b) => a.date.localeCompare(b.date))) {
      const px = clamp(x(Date.parse(event.date)), left, right - 115), last = groups.at(-1);
      if (last && px - last.px < 125) last.items.push(event); else groups.push({ px, items: [event] });
    }
    return groups;
  }, [events, from, to, width]);
  const active = notes.find(n => n.id === selectedNote && Date.parse(n.endDate ?? n.date) >= from && Date.parse(n.date) <= to);
  const coordinates = (clientX: number, clientY: number) => {
    const box = svg.current!.getBoundingClientRect();
    return { px: (clientX - box.left) * width / box.width, py: (clientY - box.top) * chartHeight / box.height };
  };
  const timeAt = (px: number) => clamp(from + (px - left) / span * (to - from), from, to);
  const zoom = (factor: number, anchor = (from + to) / 2) => onRange(zoomRange(range, anchor, factor, extent));
  const wheel = useRef<(e: WheelEvent) => void>(() => {});
  wheel.current = e => {
    if (drag.current) return;
    setPointer(null);
    e.preventDefault();
    const { px, py } = coordinates(e.clientX, e.clientY);
    const side = py <= plotBottom ? (px < left ? labeledAxes.find(a => a.side === "left") : px > right ? labeledAxes.find(a => a.side === "right") : undefined) : undefined;
    const factor = Math.exp(clamp(e.deltaY, -100, 100) * .003);
    if (side && py >= plotTop && py <= plotBottom) {
      const anchor = side.hi - (py - plotTop) / plotHeight * (side.hi - side.lo);
      setDomains(d => ({ ...d, [side.key]: [anchor + (side.lo - anchor) * factor, anchor + (side.hi - anchor) * factor] }));
    } else if (e.shiftKey) onRange(moveRange(range, (e.deltaY || e.deltaX) / span * (to - from), extent));
    else zoom(factor, timeAt(px));
  };
  useEffect(() => { const el = svg.current!; const handle = (e: WheelEvent) => wheel.current(e); el.addEventListener("wheel", handle, { passive: false }); return () => el.removeEventListener("wheel", handle); }, []);
  const release = (e: React.PointerEvent<SVGSVGElement>, cancelled = false) => {
    const d = drag.current; drag.current = null; setPreview(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d || cancelled || d.part !== "plot") return;
    const { px } = coordinates(e.clientX, e.clientY), end = timeAt(px);
    if (d.tool === "date") onCreate(iso(d.time), null);
    else if (d.tool === "period" && Math.abs(px - d.px) > 3) onCreate(iso(Math.min(d.time, end)), iso(Math.max(d.time, end)));
  };
  const cursorMonth = cursor === null ? null : iso(cursor).slice(0, 7);
  return <div ref={host} className="relative min-w-0" data-testid="compare-chart" onPointerLeave={() => { setPointer(null); setCursor(null); }}>
    <div ref={chartHeader}>
    <div className="flex min-h-9 items-center justify-between gap-2 border-b px-3 py-2 text-[10px] text-muted-foreground">
      <span>{tool === "date" ? "차트에서 날짜를 클릭하세요 · Esc 취소" : tool === "period" ? "차트에서 시작부터 끝까지 드래그하세요 · Esc 취소" : "드래그 이동 · 휠 확대 · 축 드래그로 축척 조절"}</span>
      <div className="flex shrink-0 gap-2"><button aria-label="기간 확대" onClick={() => zoom(.7)} className="rounded border px-2">＋</button><button aria-label="기간 축소" onClick={() => zoom(1.4)} className="rounded border px-2">－</button><button className="rounded border px-2" onClick={() => setDomains({})}>세로축 자동</button></div>
    </div>
    <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-[11px] text-muted-foreground" data-testid="compare-values"><span className="w-20 shrink-0 whitespace-nowrap tabular-nums">{cursorMonth ?? "커서로 값 비교"}</span><span className="min-w-0 flex-1">선 가까이에 마우스를 올리면 주변 지표의 값을 함께 볼 수 있습니다.</span></div>
    <div className="grid grid-cols-2 gap-x-6 px-4 py-1 text-[10px] text-muted-foreground">{axes.filter(a => !a.independent).map(a => <span key={a.key} data-testid={"axis-label-" + a.side} className={a.side === "right" ? "col-start-2 text-right" : "col-start-1"}>{a.side === "left" ? "← 왼쪽" : "오른쪽 →"} · {a.label}</span>)}</div>
    </div>
    <div className="relative" onPointerMove={e => {
        const { px, py } = coordinates(e.clientX, e.clientY);
        const inside = px >= left && px <= right && py >= plotTop && py <= axisBottom && !(e.target as Element).closest("[data-chart-control]");
        setCursor(inside ? timeAt(px) : null);
        setPointer(inside && !drag.current && e.pointerType !== "touch" ? { x: px, y: py, clientX: e.clientX, clientY: e.clientY } : null);
        const d = drag.current; if (!d) return;
        if (d.part === "value" && d.domain && d.key) { const center = (d.domain[0] + d.domain[1]) / 2, half = (d.domain[1] - d.domain[0]) / 2 * Math.exp(clamp((py - d.py) * .01, -5, 5)); setDomains(v => ({ ...v, [d.key!]: [center - half, center + half] })); }
        else if (d.part === "time") onRange(zoomRange(d.range, d.time, Math.exp(clamp((px - d.px) * .005, -5, 5)), extent));
        else if (d.tool === "move") onRange(moveRange(d.range, -(px - d.px) / span * (d.range[1] - d.range[0]), extent));
        else if (d.tool === "period") setPreview([Math.min(d.time, timeAt(px)), Math.max(d.time, timeAt(px))]);
      }} onPointerLeave={() => { setPointer(null); setCursor(null); }}>
    <svg ref={svg} width="100%" height={chartHeight} viewBox={"0 0 " + width + " " + chartHeight} className="touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500/30" tabIndex={0} aria-label="시간 기준 인사이트와 거시지표 비교 그래프"
      onKeyDown={e => {
        if ((e.target as Element).closest("[data-chart-control]")) return;
        if (["ArrowLeft", "ArrowRight", "+", "=", "-", "Escape"].includes(e.key)) e.preventDefault();
        if (e.key === "Escape") { drag.current = null; setPointer(null); setPreview(null); setGroupIds([]); onCancelTool(); }
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") onRange(moveRange(range, (to - from) * (e.key === "ArrowLeft" ? -.1 : .1), extent));
        if (e.key === "+" || e.key === "=") zoom(.7); if (e.key === "-") zoom(1.4);
      }}
      onDoubleClick={e => { if ((e.target as Element).closest("[data-chart-control]")) return; const { px } = coordinates(e.clientX, e.clientY); if (px < left || px > right) setDomains({}); else if (tool === "move") onRange(extent); }}
      onPointerDown={e => {
        if (e.button !== 0 || (e.target as Element).closest("[data-chart-control]")) return;
        setPointer(null);
        setGroupIds([]);
        const { px, py } = coordinates(e.clientX, e.clientY);
        if (py < plotTop) return;
        const side = py <= plotBottom ? (px < left ? labeledAxes.find(a => a.side === "left") : px > right ? labeledAxes.find(a => a.side === "right") : undefined) : undefined;
        const part = side ? "value" : py > axisBottom ? "time" : px >= left && px <= right ? "plot" : "none";
        if (part === "none") return;
        e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { px, py, time: timeAt(px), range, part, domain: side ? [side.lo, side.hi] : undefined, key: side?.key, tool };
        if (part === "plot" && tool === "period") setPreview([timeAt(px), timeAt(px)]);
      }}
      onPointerUp={e => release(e)} onPointerCancel={e => { release(e, true); setPointer(null); setCursor(null); }} onLostPointerCapture={() => { drag.current = null; setPreview(null); }} onPointerLeave={() => { setPointer(null); setCursor(null); }}>
      <defs><clipPath id={clip}><rect x={left} y={plotTop} width={span} height={plotHeight} /></clipPath><clipPath id={clip + "-spread"}><rect x={left} y={spreadTop} width={span} height={Math.max(0, axisBottom - spreadTop)} /></clipPath></defs>
      <rect x={left} y={plotTop} width={span} height={plotHeight} fill="transparent" style={{ cursor: tool === "move" ? "grab" : "crosshair" }} />
      <rect x={0} y={plotTop} width={left} height={plotHeight} fill="transparent" style={{ cursor: "ns-resize" }} />
      <rect x={right} y={plotTop} width={width - right} height={plotHeight} fill="transparent" style={{ cursor: labeledAxes.some(a => a.side === "right") ? "ns-resize" : "default" }} />
      <rect x={left} y={axisBottom} width={span} height={35} fill="transparent" style={{ cursor: "ew-resize" }} />
      <g clipPath={"url(#" + clip + ")"} pointerEvents="none" data-testid="trend-sections">{phases.filter(p => p.to >= from && p.from <= to).map(p => {
        const a = Math.max(left, x(p.from)), b = Math.min(right, x(p.to)), color = p.direction === "up" ? "#10b981" : p.direction === "down" ? "#f43f5e" : "#94a3b8";
        return <g key={p.from}><rect x={a} y={plotTop} width={Math.max(0, b - a)} height={plotHeight} fill={color} opacity={.075} /><rect x={a} y={plotTop} width={Math.max(0, b - a)} height={3} fill={color} opacity={.45} /></g>;
      })}</g>
      {ticks.map(t => <g key={t.time} pointerEvents="none"><line x1={x(t.time)} x2={x(t.time)} y1={plotTop} y2={axisBottom} stroke="currentColor" opacity={.07} /><text x={x(t.time)} y={axisBottom + 23} textAnchor="middle" fontSize={10} fill="currentColor" opacity={.65}>{t.label}</text></g>)}
      {Array.from({ length: 5 }, (_, i) => <g key={i} pointerEvents="none"><line x1={left} x2={right} y1={plotBottom - i / 4 * plotHeight} y2={plotBottom - i / 4 * plotHeight} stroke="currentColor" opacity={.07} />{labeledAxes.map(a => <text key={a.key} data-testid={"axis-tick-" + a.side} x={a.side === "right" ? right + 7 : left - 7} y={plotBottom - i / 4 * plotHeight + 4} textAnchor={a.side === "right" ? "start" : "end"} fontSize={10} fill="currentColor">{fmt(a.lo + (a.hi - a.lo) * i / 4)}</text>)}</g>)}
      {labeledAxes.filter(a => !a.normalized && a.lo < 0 && a.hi > 0 && Array.from({ length: 5 }, (_, i) => Math.abs(a.y(0) - (plotBottom - i / 4 * plotHeight))).every(gap => gap > 14)).map(a => <text key={a.key} x={a.side === "right" ? right + 7 : left - 7} y={a.y(0) + 4} textAnchor={a.side === "right" ? "start" : "end"} fontSize={10} fill="currentColor" pointerEvents="none">0</text>)}
      <g clipPath={"url(#" + clip + ")"} pointerEvents="none">
        {active && <g data-testid="insight-highlight"><rect x={Math.max(left, x(Date.parse(active.date)))} y={plotTop} width={Math.max(2, Math.min(right, x(Date.parse(active.endDate ?? active.date))) - Math.max(left, x(Date.parse(active.date))))} height={plotHeight} fill="#f34d58" opacity={.06} />{[active.date, ...(active.endDate ? [active.endDate] : [])].map((d, i) => <line key={i} x1={x(Date.parse(d))} x2={x(Date.parse(d))} y1={plotTop} y2={plotBottom} stroke="#f34d58" strokeDasharray="4 4" opacity={.7} />)}</g>}
        {preview && <rect x={x(preview[0])} y={plotTop} width={Math.max(2, x(preview[1]) - x(preview[0]))} height={plotHeight} fill="#f34d58" opacity={.1} />}
        {/* 실제 값 축마다 0선을 한 번 그려 흑자/적자와 증가율의 부호를 표시합니다. */}
        {labeledAxes.filter(a => !a.normalized && a.lo < 0 && a.hi > 0).map(a => <line key={"zero-" + a.key} data-testid={"compare-zero-" + a.side} x1={left} x2={right} y1={a.y(0)} y2={a.y(0)} stroke="currentColor" strokeDasharray="4 4" opacity={.4} />)}
        {shapes.map(s => <g key={s.def.id} data-axis={s.side} data-axis-key={s.key} data-testid={"compare-series-" + s.def.id}>{s.paths.map((g, i) => g.points.length === 1 ? <circle key={i} cx={x(g.points[0].time)} cy={s.y(g.points[0].value)} r={2} fill={s.def.color} /> : <path key={i} d={g.d} stroke={s.def.color} fill="none" strokeWidth={1.8} />)}</g>)}
      </g>
      {!shapes.some(s => s.points.length) && <text x={width / 2} y={plotTop + plotHeight / 2} textAnchor="middle" fontSize={12} fill="currentColor" opacity={.6}>이 구간에 표시할 관측값이 없습니다.</text>}
      {spread && spreadShape && <g data-testid="spread-chart">
        <line x1={left} x2={right} y1={spreadTop - 30} y2={spreadTop - 30} stroke="currentColor" opacity={.15} />
        <text x={left} y={spreadTop - 12} fontSize={10} fill="#8b5cf6">{spread.label} · %p</text>
        <g role="button" tabIndex={0} data-chart-control="true" aria-label="스프레드 차트 제거" onClick={onRemoveSpread} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRemoveSpread(); } }} style={{ cursor: "pointer" }}><rect x={right - 25} y={spreadTop - 27} width={25} height={24} fill="transparent" /><text x={right - 10} y={spreadTop - 12} textAnchor="middle" fontSize={13} fill="currentColor">×</text></g>
        <g pointerEvents="none" clipPath={"url(#" + clip + "-spread)"}>
          <rect x={left} y={spreadTop} width={span} height={spreadShape.y(0) - spreadTop} fill="#10b981" opacity={.04} />
          <rect x={left} y={spreadShape.y(0)} width={span} height={axisBottom - spreadShape.y(0)} fill="#f43f5e" opacity={.04} />
          {active && <rect x={Math.max(left, x(Date.parse(active.date)))} y={spreadTop} width={Math.max(2, Math.min(right, x(Date.parse(active.endDate ?? active.date))) - Math.max(left, x(Date.parse(active.date))))} height={axisBottom - spreadTop} fill="#f34d58" opacity={.06} />}
          <line x1={left} x2={right} y1={spreadShape.y(0)} y2={spreadShape.y(0)} stroke="currentColor" opacity={.3} strokeDasharray="4 4" />
          {spreadShape.paths.map((d, i) => <path key={i} d={d} fill="none" stroke="#8b5cf6" strokeWidth={1.8} />)}
          {spreadShape.points.map(p => <circle key={p.month} cx={x(p.time)} cy={spreadShape.y(p.value)} r={1.3} fill="#8b5cf6" />)}
        </g>
        {[spreadShape.lo, 0, spreadShape.hi].map((v, i) => <text key={i} x={left - 7} y={spreadShape.y(v) + 3} textAnchor="end" fontSize={9} fill="#8b5cf6">{fmt(v)}</text>)}
        {!spreadShape.points.length && <text x={width / 2} y={(axisBottom + spreadTop) / 2} textAnchor="middle" fontSize={11} fill="currentColor">이 구간에 두 금리의 공통 관측값이 없습니다.</text>}
      </g>}
      {jumpTime !== null && jumpTime >= from && jumpTime <= to && <g pointerEvents="none" data-testid="date-jump-marker"><line x1={x(jumpTime)} x2={x(jumpTime)} y1={plotTop} y2={axisBottom} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 3" /><text x={clamp(x(jumpTime), left + 35, right - 35)} y={plotTop + 15} textAnchor="middle" fontSize={10} fill="#d97706">{iso(jumpTime)}</text></g>}
      {cursor !== null && <line data-testid="compare-cursor" x1={x(cursor)} x2={x(cursor)} y1={plotTop} y2={axisBottom} stroke="currentColor" strokeDasharray="3 4" opacity={.3} pointerEvents="none" />}
      {nearby.map(hit => <circle key={hit.id} data-testid={"hover-marker-" + hit.id} cx={hit.x} cy={hit.y} r={4} stroke={hit.color} strokeWidth={2} className="fill-background" pointerEvents="none" />)}
      {active?.endDate && <line x1={Math.max(left, x(Date.parse(active.date)))} x2={Math.min(right, x(Date.parse(active.endDate)))} y1={plotTop - 2} y2={plotTop - 2} stroke="#f34d58" strokeWidth={2} opacity={.55} pointerEvents="none" />}
      {active?.caption && <foreignObject x={clamp(x(Date.parse(active.date)) + 12, left + 8, right - Math.min(240, span - 16))} y={plotTop + 14} width={Math.min(240, span - 16)} height={110} data-chart-control="true"><div className="max-h-[100px] overflow-auto rounded-lg border border-red-400/20 border-l-2 border-l-red-400 bg-card/95 px-3 py-2 text-xs leading-5 shadow-sm" data-testid="insight-caption">{active.caption}</div></foreignObject>}
      {!badges.length && <text x={left} y={30} fontSize={11} fill="currentColor" opacity={.45}>시간축에 인사이트를 남겨보세요</text>}
      {badges.map(group => { const n = group.items.find(n => n.id === selectedNote) ?? group.items[0], activeGroup = group.items.some(n => n.id === selectedNote); const open = () => { if (group.items.length === 1) onNote(n.id); else setGroupIds(group.items.map(n => n.id)); }; return <g key={group.items[0].id} role="button" tabIndex={0} data-chart-control="true" aria-pressed={activeGroup} aria-label={"인사이트: " + group.items.map(n => n.title).join(", ")} data-testid={"insight-badge-" + group.items[0].id} onClick={open} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } }} style={{ cursor: "pointer" }}>
        <title>{group.items.map(n => n.date + " · " + n.title).join("\n")}</title><rect x={group.px} y={16} width={badgeWidth} height={28} rx={6} className={activeGroup ? "fill-red-400/10" : "fill-card"} stroke={activeGroup ? "#f34d58" : "currentColor"} strokeOpacity={activeGroup ? .35 : .12} /><Star x={group.px + 8} y={23} width={14} height={14} stroke="#f34d58" fill={activeGroup ? "#f34d58" : "none"} strokeWidth={1.7} /><text x={group.px + 29} y={34} fontSize={11} fontWeight={activeGroup ? 600 : 400} fill="currentColor">{n.title.slice(0, group.items.length > 1 ? 11 : 13)}{n.title.length > (group.items.length > 1 ? 11 : 13) ? "…" : ""}{group.items.length > 1 ? " +" + (group.items.length - 1) : ""}</text>
        {n.endDate && group.items.length === 1 && <text x={group.px + 5} y={56} fontSize={9} fill="currentColor" opacity={.55}>{n.date.slice(0, 7)} ~ {n.endDate.slice(0, 7)}</text>}
      </g>; })}
      {!!eventGroups.length && <g data-testid="history-events">{eventGroups.map(g => <g key={g.items[0].id} role="button" tabIndex={0} data-chart-control="true" aria-label={"경제사: " + g.items.map(e => e.title).join(", ")} onClick={() => onEvents(g.items.map(e => e.id))} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onEvents(g.items.map(e => e.id)); } }} style={{ cursor: "pointer" }}><title>{g.items.map(e => e.date + " · " + e.title).join("\n")}</title><rect x={g.px} y={axisBottom + 38} width={115} height={22} rx={4} fill="#d97706" fillOpacity={.1} /><text x={g.px + 6} y={axisBottom + 53} fontSize={9} fill="currentColor">{g.items[0].title.slice(0, 8)}{g.items[0].title.length > 8 ? "…" : ""}{g.items.length > 1 ? " +" + (g.items.length - 1) : ""}</text></g>)}</g>}
    </svg>
    {pointer && !!nearby.length && createPortal(<div role="tooltip" aria-label="커서 주변 지표 값" data-testid="compare-hover" className="pointer-events-none fixed z-50 grid grid-flow-col gap-x-4 overflow-hidden rounded-md border bg-popover p-2 text-xs text-popover-foreground shadow-md" style={{ width: tooltipLayout.width, height: tooltipLayout.height, gridTemplateColumns: `repeat(${tooltipLayout.columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${tooltipLayout.rows}, 24px)`, left: clamp(pointer.clientX + 16 + tooltipLayout.width <= viewport.width - 8 ? pointer.clientX + 16 : pointer.clientX - tooltipLayout.width - 16, 8, viewport.width - tooltipLayout.width - 8), top: clamp(pointer.clientY - 12, 8, viewport.height - tooltipLayout.height - 8) }}>
      {nearby.map(hit => <div key={hit.id} data-testid={"hover-value-" + hit.id} className="flex min-w-0 items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: hit.color }} /><span className="min-w-0 truncate">{hit.label}{tradeObservationLabel(hit.id, hit.point.date) && <small className="ml-1 text-[9px] text-muted-foreground">{tradeObservationLabel(hit.id, hit.point.date)}</small>}</span><span className="ml-auto shrink-0 font-semibold tabular-nums">{fmt(hit.point.raw)}</span>
      </div>)}
    </div>, document.body)}
    </div>
    {!!groupIds.length && <div className="absolute left-16 top-16 z-20 max-h-64 w-64 overflow-auto rounded-lg border bg-card p-2 shadow-lg" role="dialog" aria-label="이 시기의 인사이트"><div className="mb-1 flex items-center justify-between px-2 text-xs"><b>이 시기의 인사이트</b><button aria-label="배지 목록 닫기" onClick={() => setGroupIds([])}>✕</button></div>{notes.filter(n => groupIds.includes(n.id)).map(n => <button key={n.id} className="block w-full rounded p-2 text-left text-xs hover:bg-muted" onClick={() => { onNote(n.id); setGroupIds([]); }}><span className="mb-1 block text-[10px] text-muted-foreground">{n.date}</span>{n.title}</button>)}</div>}
    <div ref={chartFooter}>
    {spread && <div className="border-t px-4 py-1.5 text-[11px] text-violet-500" data-testid="spread-values">{(() => { const p = spread.points.find(p => p.month === cursorMonth); return p ? spread.aLabel + " " + fmt(p.a) + "% − " + spread.bLabel + " " + fmt(p.b) + "% = " + fmt(p.raw) + "%p (" + fmt(p.raw * 100) + "bp) · 관측일 A " + p.aDate + " / B " + p.bDate : spread.label + " · " + (cursorMonth ? "이 월 공통 관측값 없음" : "원래 금리의 차이 · 위 차트와 시간축 공유"); })()}</div>}
    {summary}
    <ComparisonTimeNavigation extent={extent} range={range} onRange={onRange} onJump={setJumpTime} />
    </div>
  </div>;
});
