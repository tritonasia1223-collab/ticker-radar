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
    return series
      .map(([date, value]) => {
        const y = Number(date.slice(0, 4)) + (Number(date.slice(5, 7)) - 1) / 12;
        return { t: y, v: value };
      })
      .filter((d) => d.t >= fromYear && d.t <= toYear && d.v != null && !Number.isNaN(d.v));
  }, [series, fromYear, toYear]);

  const empty = data.length === 0;

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
              dataKey="t" type="number" domain={[fromYear, toYear]}
              tickFormatter={(v) => String(Math.round(v))}
              tick={{ fontSize: 10 }} stroke="currentColor" className="text-muted-foreground"
              tickCount={6}
            />
            <YAxis tick={{ fontSize: 10 }} stroke="currentColor" className="text-muted-foreground" width={40} />
            <Tooltip
              contentStyle={{ fontSize: 11, borderRadius: 6 }}
              labelFormatter={(v) => `${Number(v).toFixed(1)}년`}
              formatter={(val: any) => [`${Number(val).toFixed(2)} ${panel.unit}`, panel.label]}
            />
            {panel.zeroLine ? <ReferenceLine y={0} stroke="currentColor" className="text-muted-foreground" strokeWidth={1} opacity={0.5} /> : null}
            {band ? (
              <>
                {/* 기간 음영 띠 (시작~종료) */}
                <ReferenceArea x1={band.start} x2={band.end} fill={panel.color} fillOpacity={0.12} stroke="none" />
                {/* 중앙값 점선 */}
                <ReferenceLine x={band.mid} stroke={panel.color} strokeWidth={1.5} strokeDasharray="3 3" />
              </>
            ) : (
              <ReferenceLine x={playYear} stroke={panel.color} strokeWidth={1.5} strokeDasharray="3 3" />
            )}
            {panel.kind === "area" ? (
              <Area type="monotone" dataKey="v" stroke={panel.color} fill={panel.color} fillOpacity={0.18} strokeWidth={1.5} dot={false} />
            ) : (
              <Line type="monotone" dataKey="v" stroke={panel.color} strokeWidth={1.5} dot={false} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
