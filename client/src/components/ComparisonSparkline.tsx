import { oneDecimal } from "@/lib/comparison-period-change";
import { periodSparkline } from "@/lib/comparison-sparkline";

export function ComparisonSparkline({ chart, label, color }: { chart: NonNullable<ReturnType<typeof periodSparkline>>; label: string; color?: string }) {
  const { first, last, turning } = chart;
  return <div data-testid="period-sparkline" className="mt-1" style={{ color: color ?? "currentColor" }}>
    <div className="relative h-[76px]">
      <svg viewBox="0 0 280 76" preserveAspectRatio="none" className="block h-full w-full overflow-visible" role="img" aria-label={`${label}: ${first.point.date} ${oneDecimal(first.point.raw)}에서 ${last.point.date} ${oneDecimal(last.point.raw)}${turning ? `, 구간 ${turning.kind === "high" ? "최고" : "최저"} ${oneDecimal(turning.point.raw)}` : ""}`}>
        {chart.zeroY !== null && <line x1={8} x2={272} y1={chart.zeroY} y2={chart.zeroY} stroke="currentColor" opacity={.18} strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />}
        {chart.segments.map((g, i) => g.points.length === 1 ? <circle key={i} cx={g.points[0].x} cy={g.points[0].y} r={2} fill="currentColor" /> : <path key={i} d={g.d} data-cadence={g.dashed ? "annual" : "regular"} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={g.dashed ? "4 3" : undefined} vectorEffect="non-scaling-stroke" />)}
        {[first, last].map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={2.5} fill="currentColor"><title>{p.point.date} · {oneDecimal(p.point.raw)}</title></circle>)}
        {turning && <circle cx={turning.x} cy={turning.y} r={2.5} fill="currentColor"><title>{turning.point.date} · {oneDecimal(turning.point.raw)}</title></circle>}
      </svg>
      {turning && <span className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap text-[11px] font-medium leading-4 tabular-nums text-foreground/75" style={{ left: `${turning.x / 280 * 100}%`, top: turning.y + (turning.kind === "high" ? -19 : 4) }}>{oneDecimal(turning.point.raw)}</span>}
    </div>
    <div className="flex justify-between gap-2 px-1 text-[13px] leading-5 tabular-nums"><span className="text-muted-foreground" title={`첫 관측값 · ${first.point.date}`}><span className="sr-only">시작 </span>{oneDecimal(first.point.raw)}</span><span className="font-medium text-foreground" title={`마지막 관측값 · ${last.point.date}`}><span className="sr-only">끝 </span>{oneDecimal(last.point.raw)}</span></div>
  </div>;
}
