// 단일 거시지표 패널 (small multiple). 슬라이더 현재 연도를 ReferenceLine 으로 강조.
import { useMemo } from "react";
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis,
  Tooltip, ReferenceLine, ReferenceArea, CartesianGrid,
} from "recharts";
import type { PanelDef } from "@/lib/capitalism-config";

type Point = [string, number]; // [date, value]

export function CapChartPanel({
  panel, series, fromYear, toYear, playYear, band,
}: {
  panel: PanelDef;
  series: Point[] | undefined;
  fromYear: number;
  toYear: number;
  playYear: number;
  // active 사건이 기간 이벤트일 때 음영 밴드(시작~종료) + 중앙값. 단일 이벤트면 null.
  band?: { start: number; end: number; mid: number } | null;
}) {
  const data = useMemo(() => {
    if (!series) return [];
    const all = series
      .map(([date, value]) => {
        const y = Number(date.slice(0, 4)) + (Number(date.slice(5, 7)) - 1) / 12;
        return { t: y, v: value };
      })
      .filter((d) => d.v != null && !Number.isNaN(d.v));
    // 창 경계 바깥 한 점씩 포함해 라인이 창 끝까지 자연스럽게 이어지게 한다(잘림 방지).
    const inFrom = all.findIndex((d) => d.t >= fromYear);
    if (inFrom === -1) return [];
    let lo = inFrom > 0 ? inFrom - 1 : 0;
    let hi = all.length - 1;
    for (let i = all.length - 1; i >= 0; i--) { if (all[i].t <= toYear) { hi = i < all.length - 1 ? i + 1 : i; break; } }
    return all.slice(lo, hi + 1);
  }, [series, fromYear, toYear]);

  const empty = data.length === 0;

  // Y축 도메인: zeroLine 지표(GDP·CPI·무역수지 등 0이 기준인 것)는 0 포함 자동,
  // 그 외(달러지수·금리·통화량 등 0과 멀리 떨어진 지표)는 보이는 구간 min~max에 여백을 준 자동 범위.
  const yDomain = useMemo<[number | string, number | string]>(() => {
    if (data.length === 0) return ["auto", "auto"];
    // zeroLine 지표: 0을 반드시 포함(음/양 구분·영역 채우기 기준선 유지)
    // 현재 창(fromYear~toYear) 안의 점만 Y범위에 반영 → 스크롤 시 Y축도 보이는 구간에 맞춰 자연스럽게 조정됨.
    const vis = data.filter((d) => d.t >= fromYear && d.t <= toYear);
    const pts = vis.length > 0 ? vis : data;
    if (panel.zeroLine) {
      let mn = 0, mx = 0;
      for (const d of pts) { if (d.v < mn) mn = d.v; if (d.v > mx) mx = d.v; }
      return [mn, "auto"];
    }
    let lo = Infinity, hi = -Infinity;
    for (const d of pts) { if (d.v < lo) lo = d.v; if (d.v > hi) hi = d.v; }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return ["auto", "auto"];
    if (lo === hi) { const p = Math.abs(lo) * 0.05 || 1; return [lo - p, hi + p]; }
    const pad = (hi - lo) * 0.08;
    // 스냅 단위를 범위에 비례해 키워(작은 구간면 5, 큰 구간면 10·20...) 창 이동 시 Y축 끝값이 잠깐에 튀는 것을 줄인다.
    const range = hi - lo + pad * 2;
    const step = range > 60 ? 20 : range > 30 ? 10 : 5;
    const niceLo = Math.floor((lo - pad) / step) * step;
    const niceHi = Math.ceil((hi + pad) / step) * step;
    return [niceLo, niceHi];
  }, [data, panel.zeroLine, fromYear, toYear]);

  return (
    <div className="rounded-lg border border-border bg-card/40 p-3" data-testid={`panel-${panel.id}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: panel.color }} />
          <span className="text-[13px] font-medium">{panel.label}</span>
        </div>
        <span className="text-[10.5px] text-muted-foreground tabular-nums">{panel.unit} · {panel.start}~</span>
      </div>
      {empty ? (
        <div className="h-[120px] flex items-center justify-center text-[11.5px] text-muted-foreground">
          이 구간 데이터 없음
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={120}>
          <ComposedChart data={data} margin={{ top: 4, right: 6, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="currentColor" className="text-border" opacity={0.4} />
            <XAxis
              dataKey="t" type="number" domain={[fromYear, toYear]} allowDataOverflow
              tickFormatter={(v) => String(Math.round(v))}
              tick={{ fontSize: 10 }} stroke="currentColor" className="text-muted-foreground"
              tickCount={6}
            />
            <YAxis domain={yDomain} allowDataOverflow tick={{ fontSize: 10 }} stroke="currentColor" className="text-muted-foreground" width={40} />
            <Tooltip
              contentStyle={{ fontSize: 11, borderRadius: 6 }}
              labelFormatter={(v) => `${Number(v).toFixed(1)}년`}
              formatter={(val: any) => [`${Number(val).toFixed(2)} ${panel.unit}`, panel.label]}
            />
            {panel.zeroLine ? <ReferenceLine y={0} stroke="currentColor" className="text-muted-foreground" strokeWidth={1} opacity={0.5} /> : null}
            {/* 기간 사건이면 시작~종료 구간 음영(그 구간을 지날 때만 색칠로 보임). 단일 사건이면 음영 없음. */}
            {band ? (
              <ReferenceArea x1={band.start} x2={band.end} fill={panel.color} fillOpacity={0.12} stroke="none" />
            ) : null}
            {/* 점선은 기간/단일 구분 없이 항상 현재 재생 시점(playYear)에 = 그래프 정가운데에 고정. */}
            <ReferenceLine x={playYear} stroke={panel.color} strokeWidth={1.5} strokeDasharray="3 3" />
            {panel.kind === "area" ? (
              <Area type="monotone" dataKey="v" stroke={panel.color} fill={panel.color} fillOpacity={0.18} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            ) : (
              <Line type="monotone" dataKey="v" stroke={panel.color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
