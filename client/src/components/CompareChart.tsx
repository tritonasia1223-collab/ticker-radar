import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import { lineSegments, simplifyExtrema, moveRange, zoomRange, calendarTicks, type ComparePoint, type SavedInsight, type TrendSection } from "../../../shared/cap-comparison";
import type { CompareSeriesDef, SpreadData } from "@/lib/comparison-series";
import { frameMeasurement } from "@/lib/capitalism-layout";

import { ComparisonTimeNavigation } from "./ComparisonTimeNavigation";
export interface ChartSeries { def: CompareSeriesDef; points: ComparePoint[] }
export type ChartTool = "move" | "date" | "period";
type Domain = [number, number];
type HistoryEvent = { id: string; date: string; title: string };
const DAY = 86400000;
const fmt = (v: number) => v.toLocaleString("ko", { maximumFractionDigits: 2 });
export const iso = (time: number) => new Date(time).toISOString().slice(0, 10);
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

export const CompareChart = memo(function CompareChart({ series, range, extent, indexed, onRange, phases, events, onEvents, simplifyMonths, notes, selectedNote, onNote, onCreate, tool, onCancelTool, resetAxes, layoutKey, spread, onRemoveSpread }: {
  spread: SpreadData | null; onRemoveSpread: () => void;
  series: ChartSeries[]; range: Domain; extent: Domain; indexed: boolean; onRange: (value: Domain) => void;
  phases: TrendSection[]; events: HistoryEvent[]; onEvents: (ids: string[]) => void; simplifyMonths: number;
  notes: SavedInsight[]; selectedNote: string | null; onNote: (id: string) => void;
  onCreate: (date: string, endDate: string | null) => void; tool: ChartTool; onCancelTool: () => void; resetAxes: number; layoutKey: string;
}) {
  const host = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(900), [chartHeight, setChartHeight] = useState(530);
  const [cursor, setCursor] = useState<number | null>(null), [preview, setPreview] = useState<Domain | null>(null);
  const [jumpTime, setJumpTime] = useState<number | null>(null);
  useEffect(() => { if (jumpTime === null) return; const timer = setTimeout(() => setJumpTime(null), 5000); return () => clearTimeout(timer); }, [jumpTime]);
  const [domains, setDomains] = useState<Record<string, Domain>>({});
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const drag = useRef<{ px: number; py: number; time: number; range: Domain; part: string; domain?: Domain; key?: string; tool: ChartTool } | null>(null);
  const clip = useId().replaceAll(":", ""), [from, to] = range;
  const identity = (indexed ? "index:" : "raw:") + series.map(s => s.def.id).join(",");
  useEffect(() => { setDomains({}); }, [resetAxes, identity]);
  useEffect(() => { setGroupIds([]); }, [from, to]);
  useEffect(() => { drag.current = null; setPreview(null); }, [tool]);
  useEffect(() => {
    const el = host.current; if (!el) return;
    const m = frameMeasurement(() => { setWidth(Math.max(420, el.clientWidth)); setChartHeight(clamp(window.innerHeight - Math.max(0, el.getBoundingClientRect().top) - (spread ? 240 : 200), spread ? 460 : 330, 800)); });
    const ro = new ResizeObserver(m.schedule); ro.observe(el); window.addEventListener("resize", m.schedule); m.schedule();
    return () => { ro.disconnect(); window.removeEventListener("resize", m.schedule); m.dispose(); };
  }, [layoutKey, !!spread]);
  const left = 65, right = width - 65, span = right - left;
  const axisBottom = chartHeight - (events.length ? 85 : 43);
  const plotTop = 76, plotBottom = axisBottom - (spread ? 175 : 0), plotHeight = plotBottom - plotTop, spreadTop = plotBottom + 48;
  const x = (time: number) => left + (time - from) / (to - from) * span;
  const ticks = calendarTicks(range, span);
  const spreadShape = useMemo(() => {
    if (!spread) return null;
    const points = spread.points.filter(p => p.time >= from && p.time <= to), values = points.map(p => p.value);
    const min = Math.min(0, ...values), max = Math.max(0, ...values), pad = (max - min) * .1 || .5;
    const lo = min - pad, hi = max + pad, y = (v: number) => axisBottom - (v - lo) / (hi - lo) * (axisBottom - spreadTop);
    return { points, lo, hi, y, paths: lineSegments(points, 1).map(g => g.map((p, i) => (i ? "L" : "M") + x(p.time) + "," + y(p.value)).join(" ")) };
  }, [spread, from, to, width, axisBottom, spreadTop]);
  const shapes = useMemo(() => {
    const visible = series.map(s => ({ ...s, points: s.points.filter(p => p.time >= from && p.time <= to) }));
    const values = indexed ? visible.flatMap(s => s.points.map(p => p.value)) : [];
    return visible.map(s => {
      const vs = indexed ? values : s.points.map(p => p.value), key = indexed ? "index" : s.def.id;
      let lo = vs.length ? Math.min(...vs) : 0, hi = vs.length ? Math.max(...vs) : 1;
      const pad = (hi - lo) * .08 || Math.abs(hi) * .05 || 1; lo -= pad; hi += pad;
      if (domains[key]) [lo, hi] = domains[key];
      const y = (v: number) => plotBottom - (v - lo) / (hi - lo) * plotHeight;
      return { ...s, lo, hi, key, y, paths: lineSegments(s.points, s.def.cadence).map(g => simplifyExtrema(g, simplifyMonths)).map(g => ({ points: g, d: g.map((p, i) => (i ? "L" : "M") + x(p.time).toFixed(2) + "," + y(p.value).toFixed(2)).join(" ") })) };
    });
  }, [series, from, to, width, plotBottom, indexed, simplifyMonths, domains]);
  const badges = useMemo(() => {
    const groups: { px: number; items: SavedInsight[] }[] = [];
    for (const n of notes.filter(n => Date.parse(n.endDate ?? n.date) >= from && Date.parse(n.date) <= to).sort((a, b) => a.date.localeCompare(b.date))) {
      const px = clamp(x(Date.parse(n.date)), left, right - 140), last = groups.at(-1);
      if (last && px - last.px < 148) last.items.push(n);
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
    e.preventDefault();
    const { px, py } = coordinates(e.clientX, e.clientY);
    const side = py <= plotBottom ? (px < left ? shapes[0] : px > right && !indexed ? shapes[1] : undefined) : undefined;
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
  return <div ref={host} className="relative min-w-[420px]" data-testid="compare-chart">
    <div className="flex min-h-9 items-center justify-between gap-2 border-b px-3 py-2 text-[10px] text-muted-foreground">
      <span>{tool === "date" ? "차트에서 날짜를 클릭하세요 · Esc 취소" : tool === "period" ? "차트에서 시작부터 끝까지 드래그하세요 · Esc 취소" : "드래그 이동 · 휠 확대 · 축 드래그로 축척 조절"}</span>
      <div className="flex shrink-0 gap-2"><button aria-label="기간 확대" onClick={() => zoom(.7)} className="rounded border px-2">＋</button><button aria-label="기간 축소" onClick={() => zoom(1.4)} className="rounded border px-2">－</button><button className="rounded border px-2" onClick={() => setDomains({})}>세로축 자동</button></div>
    </div>
    <svg ref={svg} width="100%" height={chartHeight} viewBox={"0 0 " + width + " " + chartHeight} className="touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500/30" tabIndex={0} aria-label="시간 기준 인사이트와 거시지표 비교 그래프"
      onKeyDown={e => {
        if ((e.target as Element).closest("[data-chart-control]")) return;
        if (["ArrowLeft", "ArrowRight", "+", "=", "-", "Escape"].includes(e.key)) e.preventDefault();
        if (e.key === "Escape") { drag.current = null; setPreview(null); setGroupIds([]); onCancelTool(); }
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") onRange(moveRange(range, (to - from) * (e.key === "ArrowLeft" ? -.1 : .1), extent));
        if (e.key === "+" || e.key === "=") zoom(.7); if (e.key === "-") zoom(1.4);
      }}
      onDoubleClick={e => { const { px } = coordinates(e.clientX, e.clientY); if (px < left || px > right) setDomains({}); else if (tool === "move") onRange(extent); }}
      onPointerDown={e => {
        if (e.button !== 0 || (e.target as Element).closest("[data-chart-control]")) return;
        setGroupIds([]);
        const { px, py } = coordinates(e.clientX, e.clientY);
        if (py < plotTop) return;
        const side = py <= plotBottom ? (px < left ? shapes[0] : px > right && !indexed ? shapes[1] : undefined) : undefined;
        const part = side ? "value" : py > axisBottom ? "time" : px >= left && px <= right ? "plot" : "none";
        if (part === "none") return;
        e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { px, py, time: timeAt(px), range, part, domain: side ? [side.lo, side.hi] : undefined, key: side?.key, tool };
        if (part === "plot" && tool === "period") setPreview([timeAt(px), timeAt(px)]);
      }}
      onPointerMove={e => {
        const { px, py } = coordinates(e.clientX, e.clientY); setCursor(timeAt(px));
        const d = drag.current; if (!d) return;
        if (d.part === "value" && d.domain && d.key) { const center = (d.domain[0] + d.domain[1]) / 2, half = (d.domain[1] - d.domain[0]) / 2 * Math.exp(clamp((py - d.py) * .01, -5, 5)); setDomains(v => ({ ...v, [d.key!]: [center - half, center + half] })); }
        else if (d.part === "time") onRange(zoomRange(d.range, d.time, Math.exp(clamp((px - d.px) * .005, -5, 5)), extent));
        else if (d.tool === "move") onRange(moveRange(d.range, -(px - d.px) / span * (d.range[1] - d.range[0]), extent));
        else if (d.tool === "period") setPreview([Math.min(d.time, timeAt(px)), Math.max(d.time, timeAt(px))]);
      }}
      onPointerUp={e => release(e)} onPointerCancel={e => release(e, true)} onLostPointerCapture={() => { drag.current = null; setPreview(null); }} onPointerLeave={() => setCursor(null)}>
      <defs><clipPath id={clip}><rect x={left} y={plotTop} width={span} height={plotHeight} /></clipPath><clipPath id={clip + "-spread"}><rect x={left} y={spreadTop} width={span} height={Math.max(0, axisBottom - spreadTop)} /></clipPath></defs>
      <rect x={left} y={plotTop} width={span} height={plotHeight} fill="transparent" style={{ cursor: tool === "move" ? "grab" : "crosshair" }} />
      <rect x={0} y={plotTop} width={left} height={plotHeight} fill="transparent" style={{ cursor: "ns-resize" }} />
      <rect x={right} y={plotTop} width={width - right} height={plotHeight} fill="transparent" style={{ cursor: indexed ? "default" : "ns-resize" }} />
      <rect x={left} y={axisBottom} width={span} height={35} fill="transparent" style={{ cursor: "ew-resize" }} />
      <g clipPath={"url(#" + clip + ")"} pointerEvents="none" data-testid="trend-sections">{phases.filter(p => p.to >= from && p.from <= to).map(p => {
        const a = Math.max(left, x(p.from)), b = Math.min(right, x(p.to)), color = p.direction === "up" ? "#10b981" : p.direction === "down" ? "#f43f5e" : "#94a3b8";
        return <g key={p.from}><rect x={a} y={plotTop} width={Math.max(0, b - a)} height={plotHeight} fill={color} opacity={.075} /><rect x={a} y={plotTop} width={Math.max(0, b - a)} height={3} fill={color} opacity={.45} /></g>;
      })}</g>
      {ticks.map(t => <g key={t.time} pointerEvents="none"><line x1={x(t.time)} x2={x(t.time)} y1={plotTop} y2={axisBottom} stroke="currentColor" opacity={.07} /><text x={x(t.time)} y={axisBottom + 23} textAnchor="middle" fontSize={10} fill="currentColor" opacity={.65}>{t.label}</text></g>)}
      {Array.from({ length: 5 }, (_, i) => <g key={i} pointerEvents="none"><line x1={left} x2={right} y1={plotBottom - i / 4 * plotHeight} y2={plotBottom - i / 4 * plotHeight} stroke="currentColor" opacity={.07} />{shapes.slice(0, indexed ? 1 : 2).map((s, side) => <text key={s.def.id} x={side ? right + 7 : left - 7} y={plotBottom - i / 4 * plotHeight + 4} textAnchor={side ? "start" : "end"} fontSize={10} fill={indexed ? "currentColor" : s.def.color}>{fmt(s.lo + (s.hi - s.lo) * i / 4)}</text>)}</g>)}
      <text x={left} y={plotTop - 10} fontSize={10} fill="currentColor" opacity={.55}>{indexed ? "기준월=100" : (shapes[0]?.def.label ?? "") + " · " + (shapes[0]?.def.unit ?? "")}</text>
      {!indexed && shapes[1] && <text x={right} y={plotTop - 10} textAnchor="end" fontSize={10} fill={shapes[1].def.color}>{shapes[1].def.label} · {shapes[1].def.unit}</text>}
      <g clipPath={"url(#" + clip + ")"} pointerEvents="none">
        {active && <g data-testid="insight-highlight"><rect x={Math.max(left, x(Date.parse(active.date)))} y={plotTop} width={Math.max(2, Math.min(right, x(Date.parse(active.endDate ?? active.date))) - Math.max(left, x(Date.parse(active.date))))} height={plotHeight} fill="#0ea5e9" opacity={.075} />{[active.date, ...(active.endDate ? [active.endDate] : [])].map((d, i) => <line key={i} x1={x(Date.parse(d))} x2={x(Date.parse(d))} y1={plotTop} y2={plotBottom} stroke="#0ea5e9" strokeDasharray="4 4" opacity={.7} />)}</g>}
        {preview && <rect x={x(preview[0])} y={plotTop} width={Math.max(2, x(preview[1]) - x(preview[0]))} height={plotHeight} fill="#0ea5e9" opacity={.15} />}
        {shapes.map(s => <g key={s.def.id} data-testid={"compare-series-" + s.def.id}>{s.paths.map((g, i) => g.points.length === 1 ? <circle key={i} cx={x(g.points[0].time)} cy={s.y(g.points[0].value)} r={2} fill={s.def.color} /> : <path key={i} d={g.d} stroke={s.def.color} fill="none" strokeWidth={1.8} />)}</g>)}
      </g>
      {!shapes.some(s => s.points.length) && <text x={width / 2} y={plotTop + plotHeight / 2} textAnchor="middle" fontSize={12} fill="currentColor" opacity={.6}>이 구간에 표시할 관측값이 없습니다.</text>}
      {spread && spreadShape && <g data-testid="spread-chart">
        <line x1={left} x2={right} y1={spreadTop - 30} y2={spreadTop - 30} stroke="currentColor" opacity={.15} />
        <text x={left} y={spreadTop - 12} fontSize={10} fill="#8b5cf6">{spread.label} · %p</text>
        <g role="button" tabIndex={0} data-chart-control="true" aria-label="스프레드 차트 제거" onClick={onRemoveSpread} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRemoveSpread(); } }} style={{ cursor: "pointer" }}><rect x={right - 25} y={spreadTop - 27} width={25} height={24} fill="transparent" /><text x={right - 10} y={spreadTop - 12} textAnchor="middle" fontSize={13} fill="currentColor">×</text></g>
        <g pointerEvents="none" clipPath={"url(#" + clip + "-spread)"}>
          <rect x={left} y={spreadTop} width={span} height={spreadShape.y(0) - spreadTop} fill="#10b981" opacity={.04} />
          <rect x={left} y={spreadShape.y(0)} width={span} height={axisBottom - spreadShape.y(0)} fill="#f43f5e" opacity={.04} />
          {active && <rect x={Math.max(left, x(Date.parse(active.date)))} y={spreadTop} width={Math.max(2, Math.min(right, x(Date.parse(active.endDate ?? active.date))) - Math.max(left, x(Date.parse(active.date))))} height={axisBottom - spreadTop} fill="#0ea5e9" opacity={.08} />}
          <line x1={left} x2={right} y1={spreadShape.y(0)} y2={spreadShape.y(0)} stroke="currentColor" opacity={.3} strokeDasharray="4 4" />
          {spreadShape.paths.map((d, i) => <path key={i} d={d} fill="none" stroke="#8b5cf6" strokeWidth={1.8} />)}
          {spreadShape.points.map(p => <circle key={p.month} cx={x(p.time)} cy={spreadShape.y(p.value)} r={1.3} fill="#8b5cf6" />)}
        </g>
        {[spreadShape.lo, 0, spreadShape.hi].map((v, i) => <text key={i} x={left - 7} y={spreadShape.y(v) + 3} textAnchor="end" fontSize={9} fill="#8b5cf6">{fmt(v)}</text>)}
        {!spreadShape.points.length && <text x={width / 2} y={(axisBottom + spreadTop) / 2} textAnchor="middle" fontSize={11} fill="currentColor">이 구간에 두 금리의 공통 관측값이 없습니다.</text>}
      </g>}
      {jumpTime !== null && jumpTime >= from && jumpTime <= to && <g pointerEvents="none" data-testid="date-jump-marker"><line x1={x(jumpTime)} x2={x(jumpTime)} y1={plotTop} y2={axisBottom} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 3" /><text x={clamp(x(jumpTime), left + 35, right - 35)} y={plotTop + 15} textAnchor="middle" fontSize={10} fill="#d97706">{iso(jumpTime)}</text></g>}
      {cursor !== null && <line x1={x(cursor)} x2={x(cursor)} y1={plotTop} y2={axisBottom} stroke="currentColor" strokeDasharray="3 4" opacity={.3} pointerEvents="none" />}
      {active?.caption && <foreignObject x={clamp(x(Date.parse(active.date)) + 12, left + 8, right - Math.min(240, span - 16))} y={plotTop + 14} width={Math.min(240, span - 16)} height={110} data-chart-control="true"><div className="max-h-[100px] overflow-auto rounded-lg border border-sky-500/25 bg-card/95 px-3 py-2 text-xs leading-5 shadow-sm" data-testid="insight-caption">{active.caption}</div></foreignObject>}
      {!badges.length && <text x={left} y={30} fontSize={11} fill="currentColor" opacity={.45}>시간축에 인사이트를 남겨보세요</text>}
      {badges.map(group => { const n = group.items.find(n => n.id === selectedNote) ?? group.items[0], activeGroup = group.items.some(n => n.id === selectedNote); const open = () => { if (group.items.length === 1) onNote(n.id); else setGroupIds(group.items.map(n => n.id)); }; return <g key={group.items[0].id} role="button" tabIndex={0} data-chart-control="true" aria-label={"인사이트: " + group.items.map(n => n.title).join(", ")} data-testid={"insight-badge-" + group.items[0].id} onClick={open} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } }} style={{ cursor: "pointer" }}>
        <title>{group.items.map(n => n.date + " · " + n.title).join("\n")}</title><rect x={group.px} y={16} width={140} height={28} rx={14} className={activeGroup ? "fill-sky-500" : "fill-card"} stroke="#0ea5e9" strokeOpacity={activeGroup ? 1 : .4} /><circle cx={group.px + 12} cy={30} r={3} fill={activeGroup ? "white" : "#0ea5e9"} /><text x={group.px + 22} y={34} fontSize={10} fill={activeGroup ? "white" : "currentColor"}>{n.title.slice(0, group.items.length > 1 ? 9 : 12)}{n.title.length > (group.items.length > 1 ? 9 : 12) ? "…" : ""}{group.items.length > 1 ? " +" + (group.items.length - 1) : ""}</text>
        {n.endDate && group.items.length === 1 && <text x={group.px + 5} y={56} fontSize={9} fill="currentColor" opacity={.55}>{n.date.slice(0, 7)} ~ {n.endDate.slice(0, 7)}</text>}
      </g>; })}
      {!!eventGroups.length && <g data-testid="history-events">{eventGroups.map(g => <g key={g.items[0].id} role="button" tabIndex={0} data-chart-control="true" aria-label={"경제사: " + g.items.map(e => e.title).join(", ")} onClick={() => onEvents(g.items.map(e => e.id))} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onEvents(g.items.map(e => e.id)); } }} style={{ cursor: "pointer" }}><title>{g.items.map(e => e.date + " · " + e.title).join("\n")}</title><rect x={g.px} y={axisBottom + 38} width={115} height={22} rx={4} fill="#d97706" fillOpacity={.1} /><text x={g.px + 6} y={axisBottom + 53} fontSize={9} fill="currentColor">{g.items[0].title.slice(0, 8)}{g.items[0].title.length > 8 ? "…" : ""}{g.items.length > 1 ? " +" + (g.items.length - 1) : ""}</text></g>)}</g>}
    </svg>
    {!!groupIds.length && <div className="absolute left-16 top-16 z-20 max-h-64 w-64 overflow-auto rounded-lg border bg-card p-2 shadow-lg" role="dialog" aria-label="이 시기의 인사이트"><div className="mb-1 flex items-center justify-between px-2 text-xs"><b>이 시기의 인사이트</b><button aria-label="배지 목록 닫기" onClick={() => setGroupIds([])}>✕</button></div>{notes.filter(n => groupIds.includes(n.id)).map(n => <button key={n.id} className="block w-full rounded p-2 text-left text-xs hover:bg-muted" onClick={() => { onNote(n.id); setGroupIds([]); }}><span className="mb-1 block text-[10px] text-muted-foreground">{n.date}</span>{n.title}</button>)}</div>}
    <div className="flex min-h-[62px] flex-wrap content-start gap-x-4 gap-y-1 border-t px-4 py-2 text-[11px] tabular-nums" data-testid="compare-values"><b className="w-full">{cursorMonth ?? "마우스를 올려 같은 월의 값을 비교하세요"}</b>{cursorMonth && series.map(s => { const p = s.points.find(p => p.month === cursorMonth); return <span key={s.def.id} style={{ color: s.def.color }}>{s.def.label}: {p ? fmt(p.raw) + " " + s.def.unit + (indexed ? " · 지수 " + fmt(p.value) : "") + " (관측일 " + p.date + ")" : "이 월 표시값 없음"}</span>; })}</div>
    {spread && <div className="border-t px-4 py-1.5 text-[11px] text-violet-500" data-testid="spread-values">{(() => { const p = spread.points.find(p => p.month === cursorMonth); return p ? spread.aLabel + " " + fmt(p.a) + "% − " + spread.bLabel + " " + fmt(p.b) + "% = " + fmt(p.raw) + "%p (" + fmt(p.raw * 100) + "bp) · 관측일 A " + p.aDate + " / B " + p.bDate : spread.label + " · " + (cursorMonth ? "이 월 공통 관측값 없음" : "원래 금리의 차이 · 위 차트와 시간축 공유"); })()}</div>}
    <ComparisonTimeNavigation extent={extent} range={range} onRange={onRange} onJump={setJumpTime} />
  </div>;
});
