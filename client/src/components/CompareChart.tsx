import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import { lineSegments, simplifyExtrema, moveRange, type ComparePoint, type PlacedNode, type TrendSection } from "../../../shared/cap-comparison";
import type { CompareSeriesDef } from "@/lib/comparison-series";
import { frameMeasurement } from "@/lib/capitalism-layout";

export interface ChartSeries { def: CompareSeriesDef; points: ComparePoint[] }
const DAY = 86400000;
const fmt = (v: number) => v.toLocaleString("ko", { maximumFractionDigits: 2 });
export const iso = (time: number) => new Date(time).toISOString().slice(0, 10);

export const CompareChart = memo(function CompareChart({ series, range, extent, indexed, nodes, selected, onSelect, onRange, titles, phases, events, onEvents, simplifyMonths }: {
  series: ChartSeries[]; range: [number, number]; extent: [number, number]; indexed: boolean;
  nodes: PlacedNode[]; selected: string | null; onSelect: (id: string) => void;
  onRange: (value: [number, number]) => void; titles: Record<string, string>;
  phases: TrendSection[]; events: { id: string; date: string; title: string }[]; onEvents: (ids: string[]) => void;
  simplifyMonths: number;
}) {
  const host = useRef<HTMLDivElement>(null), [width, setWidth] = useState(1000);
  const [cursor, setCursor] = useState<number | null>(null);
  const clip = useId().replaceAll(":", ""), [from, to] = range;
  useEffect(() => {
    const el = host.current; if (!el) return;
    const m = frameMeasurement(() => setWidth(w => { const next = Math.max(600, el.clientWidth); return w === next ? w : next; }));
    const ro = new ResizeObserver(m.schedule); ro.observe(el); m.schedule();
    return () => { ro.disconnect(); m.dispose(); };
  }, []);
  const left = 80, right = width - 80, span = right - left;
  const x = (time: number) => left + (time - from) / (to - from) * span;
  const layout = useMemo(() => {
    const groups = new Map<string, PlacedNode[]>();
    for (const p of nodes) if (p.date && Date.parse(p.endDate ?? p.date) >= from && Date.parse(p.date) <= to) {
      const g = groups.get(p.flowSlug) ?? []; g.push(p); groups.set(p.flowSlug, g);
    }
    let offset = 18;
    const rows: { slug: string; y: number; items: { p: PlacedNode; x: number; end: number; y: number; labelWidth: number }[] }[] = [];
    for (const [slug, items] of groups) {
      const ends: number[] = [], rowY = offset; offset += 24;
      const marks = items.sort((a, b) => a.date!.localeCompare(b.date!) || a.sortOrder - b.sortOrder).map(p => {
        const px = Math.max(left, x(Date.parse(p.date!))), end = Math.min(right, x(Date.parse(p.endDate ?? p.date!)));
        const labelWidth = Math.min(200, Math.max(65, p.title.length * 11 + 20), right - px);
        let lane = ends.findIndex(e => e + 10 <= px); if (lane < 0) lane = ends.length;
        ends[lane] = Math.max(end, px + labelWidth);
        return { p, x: px, end, y: offset + lane * 34, labelWidth };
      });
      offset += ends.length * 34 + 12; rows.push({ slug, y: rowY, items: marks });
    }
    return { rows, height: Math.max(65, offset) };
  }, [nodes, from, to, width]);
  const eventGroups = useMemo(() => {
    const groups: { x: number; items: typeof events }[] = [];
    for (const event of events.filter(e => Date.parse(e.date) >= from && Date.parse(e.date) <= to).sort((a, b) => a.date.localeCompare(b.date))) {
      const px = x(Date.parse(event.date)), last = groups.at(-1);
      if (last && Math.min(right - 132, px) - Math.min(right - 132, last.x) < 140) last.items.push(event);
      else groups.push({ x: px, items: [event] });
    }
    return groups;
  }, [events, from, to, width]);
  const eventY = layout.height + 20;
  const plotTop = layout.height + (eventGroups.length ? 96 : 34), plotBottom = plotTop + 310, height = plotBottom + 42;
  const shapes = useMemo(() => {
    const visible = series.map(s => ({ ...s, points: s.points.filter(p => p.time >= from && p.time <= to) }));
    const values = indexed ? visible.flatMap(s => s.points.map(p => p.value)) : [];
    return visible.map(s => {
      const vs = indexed ? values : s.points.map(p => p.value);
      let lo = vs.length ? Math.min(...vs) : 0, hi = vs.length ? Math.max(...vs) : 1;
      const pad = (hi - lo) * .08 || Math.abs(hi) * .05 || 1; lo -= pad; hi += pad;
      const y = (v: number) => plotBottom - (v - lo) / (hi - lo) * 310;
      return { ...s, lo, hi, y, paths: lineSegments(s.points, s.def.cadence).map(g => simplifyExtrema(g, simplifyMonths)).map(g => ({ points: g, d: g.map((p, i) => `${i ? "L" : "M"}${x(p.time).toFixed(2)},${y(p.value).toFixed(2)}`).join(" ") })) };
    });
  }, [series, from, to, width, plotBottom, indexed, simplifyMonths]);
  const highlighted = nodes.find(n => n.id === selected && n.date);
  const dateAt = (event: React.PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return Math.max(from, Math.min(to, from + ((event.clientX - box.left) * width / box.width - left) / span * (to - from)));
  };
  const cursorMonth = cursor === null ? null : iso(cursor).slice(0, 7);
  return <div ref={host} className="min-w-[600px]" data-testid="compare-chart">
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} aria-label="사건 진행과 거시지표 비교 그래프" onPointerMove={e => setCursor(dateAt(e))} onPointerLeave={() => setCursor(null)}>
      <defs><clipPath id={clip}><rect x={left} y={plotTop} width={span} height={310} /></clipPath></defs>
      <g clipPath={`url(#${clip})`} data-testid="trend-sections">{phases.filter(p => p.to >= from && p.from <= to).map(p => {
        const a = Math.max(left, x(p.from)), b = Math.min(right, x(p.to)), color = p.direction === "up" ? "#10b981" : p.direction === "down" ? "#f43f5e" : "#94a3b8";
        const label = p.direction === "up" ? "↗ 상승" : p.direction === "down" ? "↘ 하강" : "방향 미정";
        return <g key={p.from}><title>{label} 경향 · {iso(p.from)} ~ {iso(p.to)}</title><rect x={a} y={plotTop} width={Math.max(0, b - a)} height={310} fill={color} opacity={.075} /><rect x={a} y={plotTop} width={Math.max(0, b - a)} height={3} fill={color} opacity={.45} />{b - a > 65 && <text x={(a + b) / 2} y={plotTop + 18} textAnchor="middle" fill={color} fontSize={10}>{label}</text>}</g>;
      })}</g>
      {Array.from({ length: 7 }, (_, i) => {
        const time = from + (to - from) * i / 6, px = x(time);
        return <g key={i}><line x1={px} x2={px} y1={8} y2={plotBottom} stroke="currentColor" opacity={.09} /><text x={px} y={plotBottom + 24} textAnchor="middle" fontSize={11} fill="currentColor">{iso(time).slice(0, to - from > 5 * 365 * DAY ? 4 : 7)}</text></g>;
      })}
      {!layout.rows.length && <text x={left} y={30} fontSize={12} fill="currentColor" opacity={.55}>사건을 가져와 날짜를 지정하면 이 시간축에 표시됩니다.</text>}
      {layout.rows.map(row => <g key={row.slug}>
        <text x={left} y={row.y} fontSize={11} fill="currentColor" opacity={.6}>{(titles[row.slug] ?? "원본 카드 없음").slice(0, 70)}</text>
        {row.items.map(({ p, x: px, end, y, labelWidth }) => <g key={p.id} role="button" tabIndex={0} aria-label={`사건: ${p.title}`} data-testid={`event-${p.id}`} onClick={() => onSelect(p.id)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(p.id); } }} style={{ cursor: "pointer" }}>
          <title>{p.title} · {p.date}{p.endDate ? ` ~ ${p.endDate}` : ""}</title>
          {p.endDate && <line x1={px} x2={end} y1={y + 10} y2={y + 10} stroke="#38bdf8" strokeWidth={6} opacity={.35} />}
          <circle cx={px} cy={y + 10} r={4} fill="#38bdf8" />
          <rect x={Math.min(px + 8, right - Math.max(70, labelWidth))} y={y - 1} width={Math.max(70, labelWidth)} height={24} rx={5} fill={selected === p.id ? "#0369a1" : "var(--background, #132236)"} className={selected === p.id ? "" : "fill-card"} stroke="#38bdf8" strokeOpacity={.5} />
          <text x={Math.min(px + 15, right - Math.max(70, labelWidth) + 7)} y={y + 15} fontSize={11} fill={selected === p.id ? "white" : "currentColor"}>{p.title.length > 16 ? p.title.slice(0, 15) + "…" : p.title}</text>
        </g>)}
      </g>)}
      {!!eventGroups.length && <g data-testid="history-events">
        <text x={left} y={eventY - 5} fontSize={10} fill="currentColor" opacity={.6}>경제사 카드 · 가까운 사건은 묶어 표시 · 클릭하여 내용 보기</text>
        {eventGroups.map(group => <line key={group.items[0].id} x1={group.x} x2={group.x} y1={eventY + 28} y2={plotBottom} stroke="#d97706" strokeDasharray="3 5" opacity={.22} pointerEvents="none" />)}
        {eventGroups.map(group => <g key={group.items[0].id} role="button" tabIndex={0} aria-label={`경제사: ${group.items.map(e => e.title).join(", ")}`} onClick={() => onEvents(group.items.map(e => e.id))} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onEvents(group.items.map(e => e.id)); } }} style={{ cursor: "pointer" }}>
          <title>{group.items.map(e => `${e.date} · ${e.title}`).join("\n")}</title>
          {group.items.map(e => <line key={e.id} x1={x(Date.parse(e.date))} x2={x(Date.parse(e.date))} y1={eventY + 22} y2={eventY + 28} stroke="#d97706" strokeOpacity={.6} />)}
          <rect x={Math.max(left, Math.min(right - 132, group.x))} y={eventY + 3} width={132} height={22} rx={4} fill="#d97706" fillOpacity={.1} />
          <text x={Math.max(left, Math.min(right - 132, group.x)) + 5} y={eventY + 18} fontSize={10} fill="currentColor">{group.items[0].title.slice(0, group.items.length > 1 ? 9 : 12)}{group.items[0].title.length > (group.items.length > 1 ? 9 : 12) ? "…" : ""}{group.items.length > 1 ? ` +${group.items.length - 1}` : ""}</text>
        </g>)}
      </g>}
      <line x1={left} x2={right} y1={plotTop - 16} y2={plotTop - 16} stroke="currentColor" opacity={.15} />
      {highlighted && <rect x={Math.max(left, x(Date.parse(highlighted.date!)))} y={plotTop} width={Math.max(2, Math.min(right, x(Date.parse(highlighted.endDate ?? highlighted.date!))) - Math.max(left, x(Date.parse(highlighted.date!))))} height={310} fill="#38bdf8" opacity={.1} clipPath={`url(#${clip})`} />}
      {Array.from({ length: 5 }, (_, i) => <g key={i}>
        <line x1={left} x2={right} y1={plotBottom - i / 4 * 310} y2={plotBottom - i / 4 * 310} stroke="currentColor" opacity={.08} />
        {shapes.slice(0, indexed ? 1 : 2).map((s, side) => <text key={s.def.id} x={side ? right + 8 : left - 8} y={plotBottom - i / 4 * 310 + 4} textAnchor={side ? "start" : "end"} fontSize={10} fill={indexed ? "currentColor" : s.def.color}>{fmt(s.lo + (s.hi - s.lo) * i / 4)}</text>)}
      </g>)}
      <text x={left} y={plotTop - 3} fontSize={10} fill={shapes[0]?.def.color ?? "currentColor"}>{indexed ? "기준월=100" : `${shapes[0]?.def.label ?? ""} · ${shapes[0]?.def.unit ?? ""}`}</text>
      {!indexed && shapes[1] && <text x={right} y={plotTop - 3} textAnchor="end" fontSize={10} fill={shapes[1].def.color}>{shapes[1].def.label} · {shapes[1].def.unit}</text>}
      <g clipPath={`url(#${clip})`}>{shapes.map(s => <g key={s.def.id} data-testid={`compare-series-${s.def.id}`}>
        {s.paths.map((g, i) => g.points.length === 1 ? <circle key={i} cx={x(g.points[0].time)} cy={s.y(g.points[0].value)} r={2} fill={s.def.color} /> : <path key={i} d={g.d} stroke={s.def.color} fill="none" strokeWidth={2} />)}
      </g>)}</g>
      {!shapes.some(s => s.points.length) && <text x={width / 2} y={plotTop + 150} textAnchor="middle" fontSize={13} fill="currentColor">이 구간에 표시할 관측값이 없습니다.</text>}
      {cursor !== null && <line x1={x(cursor)} x2={x(cursor)} y1={5} y2={plotBottom} stroke="currentColor" strokeDasharray="4 4" opacity={.4} pointerEvents="none" />}
    </svg>
    <div className="min-h-16 flex flex-wrap gap-x-5 gap-y-1 border-t px-5 py-2 text-xs tabular-nums" data-testid="compare-values">
      <b className="w-full">{cursorMonth ?? "그래프 위에 마우스를 올려 같은 월의 값을 비교하세요"}</b>
      {cursorMonth && series.map(s => { const p = s.points.find(p => p.month === cursorMonth); return <span key={s.def.id} style={{ color: s.def.color }}>{s.def.label}: {p ? `${fmt(p.raw)} ${s.def.unit}${indexed ? ` · 지수 ${fmt(p.value)}` : ""} (관측일 ${p.date})` : "이 월 표시값 없음"}</span>; })}
    </div>
    <Navigator extent={extent} range={range} onRange={onRange} series={series[0]?.points ?? []} cadence={series[0]?.def.cadence ?? 1} simplifyMonths={simplifyMonths} />
  </div>;
});

function Navigator({ extent, range, onRange, series, cadence, simplifyMonths }: { extent: [number, number]; range: [number, number]; onRange: (r: [number, number]) => void; series: ComparePoint[]; cadence: number; simplifyMonths: number }) {
  const drag = useRef<{ x: number; range: [number, number]; part: string } | null>(null);
  const [a, b] = extent, span = b - a, px = (t: number) => (t - a) / span * 1000;
  const vals = series.map(p => p.value), lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals) : 1;
  const paths = lineSegments(series, cadence).map(g => simplifyExtrema(g, simplifyMonths)).map(g => g.map((p, i) => `${i ? "L" : "M"}${px(p.time)},${48 - (p.value - lo) / (hi - lo || 1) * 35}`).join(" "));
  return <div className="border-t px-5 pt-3 pb-4">
    <div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>전체 기간 · 양 끝을 조절하거나 선택 영역을 밀어 이동</span><button className="underline" onClick={() => onRange(extent)}>전체 보기</button></div>
    <svg viewBox="0 0 1000 60" width="100%" height={60} className="touch-none rounded bg-muted/30" aria-label="전체 기간 탐색" data-testid="compare-navigator"
      onPointerDown={e => { const box = e.currentTarget.getBoundingClientRect(); drag.current = { x: e.clientX / box.width, range, part: (e.target as Element).getAttribute("data-part") ?? "move" }; e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={e => { if (!drag.current) return; const box = e.currentTarget.getBoundingClientRect(), d = drag.current, delta = (e.clientX / box.width - d.x) * span;
        const r: [number, number] = d.part === "start" ? [Math.max(a, Math.min(d.range[1] - DAY * 31, d.range[0] + delta)), d.range[1]] : d.part === "end" ? [d.range[0], Math.min(b, Math.max(d.range[0] + DAY * 31, d.range[1] + delta))] : moveRange(d.range, delta, extent); onRange(r); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      {paths.map((d, i) => <path key={i} d={d} stroke="#38bdf8" strokeWidth={1} fill="none" opacity={.45} />)}
      <rect x={px(range[0])} y={2} width={Math.max(1, px(range[1]) - px(range[0]))} height={56} fill="#38bdf8" fillOpacity={.12} stroke="#38bdf8" data-part="move" style={{ cursor: "grab" }} />
      {(["start", "end"] as const).map((part, i) => <rect key={part} x={Math.max(0, Math.min(988, px(range[i]) - 6))} y={2} width={12} height={56} rx={3} fill="#38bdf8" data-part={part} style={{ cursor: "ew-resize" }} />)}
    </svg>
    <div className="flex justify-between text-[10px] text-muted-foreground"><span>{iso(a)}</span><span>{iso(b)}</span></div>
  </div>;
}
