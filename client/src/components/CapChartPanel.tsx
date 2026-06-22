// 단일 거시지표 패널 (small multiple). 슬라이더 현재 연도를 ReferenceLine 으로 강조.
import { useMemo } from "react";
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis,
  Tooltip, ReferenceLine, ReferenceArea, CartesianGrid,
} from "recharts";
import type { PanelDef } from "@/lib/capitalism-config";
import { fracYearToLabel } from "@/lib/capitalism-config";

type Point = [string, number]; // [date, value]

export function CapChartPanel({
  panel, series, fromYear, toYear, playYear, band, yMode = "full",
}: {
  panel: PanelDef;
  series: Point[] | undefined;
  fromYear: number;
  toYear: number;
  playYear: number;
  // active 사건이 기간 이벤트일 때 음영 밴드(시작~종료) + 중앙값. 단일 이벤트면 null.
  band?: { start: number; end: number; mid: number } | null;
  // Y축 범위 모드: "full"=전체 데이터 기준 고정, "window"=보이는 구간(fromYear~toYear)에 맞춰 유동 조절.
  yMode?: "full" | "window";
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
  // 그 외(달러지수·금리·통화량 등 0과 멀리 떨어진 지표)는 min~max에 여백을 준 자동 범위.
  // yMode="full": 전체 시리즈 기준 고정(창 이동해도 Y축 불변). "window": 보이는 구간만 기준(시점 따라 유동 조절).
  const yDomain = useMemo<[number | string, number | string]>(() => {
    if (!series || series.length === 0) return ["auto", "auto"];
    const vals: number[] = [];
    if (yMode === "window") {
      // 유동 모드: 현재 보이는 창(fromYear~toYear) 안의 점만으로 min/max 산출 → 시점에 따라 Y축이 따라 움직인다.
      for (const [date, value] of series) {
        if (value == null || Number.isNaN(value)) continue;
        const y = Number(date.slice(0, 4)) + (Number(date.slice(5, 7)) - 1) / 12;
        if (y >= fromYear && y <= toYear) vals.push(value);
      }
    } else {
      // 전체 범위 고정 모드: 창 무관·시리즈 전체 점을 기준으로 산출 → 창을 이동해도 Y축 불변.
      for (const [, value] of series) {
        if (value != null && !Number.isNaN(value)) vals.push(value);
      }
    }
    if (vals.length === 0) return ["auto", "auto"];
    if (panel.zeroLine) {
      // zeroLine 지표: 0을 반드시 포함 + 전체 최대/최소를 스냅.
      let mn = 0, mx = 0;
      for (const v of vals) { if (v < mn) mn = v; if (v > mx) mx = v; }
      if (mn === 0 && mx === 0) return [0, "auto"];
      const span = mx - mn;
      const stepZ = span > 60 ? 20 : span > 30 ? 10 : 5;
      return [Math.floor(mn / stepZ) * stepZ, Math.ceil(mx / stepZ) * stepZ];
    }
    let lo = Infinity, hi = -Infinity;
    for (const v of vals) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return ["auto", "auto"];
    if (lo === hi) { const p = Math.abs(lo) * 0.05 || 1; return [lo - p, hi + p]; }
    const pad = (hi - lo) * 0.08;
    const range = hi - lo + pad * 2;
    const step = range > 60 ? 20 : range > 30 ? 10 : 5;
    const niceLo = Math.floor((lo - pad) / step) * step;
    const niceHi = Math.ceil((hi + pad) / step) * step;
    return [niceLo, niceHi];
  }, [series, panel.zeroLine, yMode, fromYear, toYear]);

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
            {/* 컴팩트 툴팁 — 한 줄(연·월 + 값), 상단 고정(position.y=0)으로 가로만 커서 추적해
                데이터 라인을 가리지 않게. 패널 이름은 헤더에 이미 있어 생략(폭 축소). */}
            <Tooltip
              isAnimationActive={false}
              position={{ y: 0 }}
              cursor={{ stroke: panel.color, strokeOpacity: 0.4, strokeWidth: 1 }}
              wrapperStyle={{ zIndex: 20 }}
              content={({ active, payload, label }: any) => {
                if (!active || !payload || !payload.length) return null;
                const v = payload[0]?.value;
                if (v == null) return null;
                return (
                  <div className="pointer-events-none whitespace-nowrap rounded border border-border bg-popover/95 px-1.5 py-0.5 text-[10.5px] leading-tight text-popover-foreground shadow-sm backdrop-blur-sm">
                    <span className="text-muted-foreground tabular-nums">{fracYearToLabel(Number(label))}</span>
                    {" · "}
                    <span className="font-semibold tabular-nums" style={{ color: panel.color }}>{Number(v).toFixed(2)}</span>
                    <span className="text-muted-foreground"> {panel.unit}</span>
                  </div>
                );
              }}
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
