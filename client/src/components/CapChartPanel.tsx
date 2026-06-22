// 단일 거시지표 패널 (small multiple). 슬라이더 현재 연도를 ReferenceLine 으로 강조.
// 라벨 클릭 → 전체 데이터 구간(처음~끝)을 크게 보는 팝업(모달).
import { useMemo, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis,
  Tooltip, ReferenceLine, ReferenceArea, CartesianGrid,
} from "recharts";
import { Maximize2, X } from "lucide-react";
import type { PanelDef } from "@/lib/capitalism-config";
import { fracYearToLabel, krwConversion, USD_KRW } from "@/lib/capitalism-config";

// 축 눈금용 한국어 축약 표기(만/억 등). 원화 큰 값도 40px 폭에 들어가게.
const tickFmt = (v: number) => new Intl.NumberFormat("ko", { notation: "compact", maximumFractionDigits: 1 }).format(v);

type Point = [string, number]; // [date, value]

function fracOf(date: string): number {
  return Number(date.slice(0, 4)) + (Number(date.slice(5, 7)) - 1) / 12;
}

// 차트 본체 — 작은 패널과 전체보기 모달이 공유. fromYear~toYear 창 + 높이만 다르게 받는다.
function PanelChart({
  panel, series, fromYear, toYear, playYear, band, yMode, height, tickCount = 6, scale = 1, unit,
}: {
  panel: PanelDef;
  series: Point[] | undefined;
  fromYear: number;
  toYear: number;
  playYear: number;
  band?: { start: number; end: number; mid: number } | null;
  yMode: "full" | "window";
  height: number;
  tickCount?: number;
  scale?: number;   // 값 배율(원화 환산 등). 1=원본.
  unit: string;     // 표시 단위(원화 전환 시 조₩ 등).
}) {
  const data = useMemo(() => {
    if (!series) return [];
    const all = series
      .map(([date, value]) => ({ t: fracOf(date), v: value * scale }))
      .filter((d) => d.v != null && !Number.isNaN(d.v));
    // 창 경계 바깥 한 점씩 포함해 라인이 창 끝까지 자연스럽게 이어지게 한다(잘림 방지).
    const inFrom = all.findIndex((d) => d.t >= fromYear);
    if (inFrom === -1) return [];
    const lo = inFrom > 0 ? inFrom - 1 : 0;
    let hi = all.length - 1;
    for (let i = all.length - 1; i >= 0; i--) { if (all[i].t <= toYear) { hi = i < all.length - 1 ? i + 1 : i; break; } }
    return all.slice(lo, hi + 1);
  }, [series, fromYear, toYear, scale]);

  const empty = data.length === 0;

  const yDomain = useMemo<[number | string, number | string]>(() => {
    if (!series || series.length === 0) return ["auto", "auto"];
    const vals: number[] = [];
    if (yMode === "window") {
      for (const [date, value] of series) {
        if (value == null || Number.isNaN(value)) continue;
        const y = fracOf(date);
        if (y >= fromYear && y <= toYear) vals.push(value * scale);
      }
    } else {
      for (const [, value] of series) {
        if (value != null && !Number.isNaN(value)) vals.push(value * scale);
      }
    }
    if (vals.length === 0) return ["auto", "auto"];
    if (panel.zeroLine) {
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
    return [Math.floor((lo - pad) / step) * step, Math.ceil((hi + pad) / step) * step];
  }, [series, panel.zeroLine, yMode, fromYear, toYear, scale]);

  if (empty) {
    return (
      <div className="flex items-center justify-center text-[11.5px] text-muted-foreground" style={{ height }}>
        이 구간 데이터 없음
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 4, right: 6, bottom: 0, left: -16 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="currentColor" className="text-border" opacity={0.4} />
        <XAxis
          dataKey="t" type="number" domain={[fromYear, toYear]} allowDataOverflow
          tickFormatter={(v) => String(Math.round(v))}
          tick={{ fontSize: 10 }} stroke="currentColor" className="text-muted-foreground"
          tickCount={tickCount}
        />
        <YAxis domain={yDomain} allowDataOverflow tick={{ fontSize: 10 }} tickFormatter={tickFmt} stroke="currentColor" className="text-muted-foreground" width={40} />
        {/* 컴팩트 툴팁 — 한 줄(연·월 + 값), 상단 고정으로 데이터 라인을 가리지 않음. 패널 이름은 헤더에 있어 생략. */}
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
                <span className="font-semibold tabular-nums" style={{ color: panel.color }}>{Number(v).toLocaleString("ko", { maximumFractionDigits: 2 })}</span>
                <span className="text-muted-foreground"> {unit}</span>
              </div>
            );
          }}
        />
        {panel.zeroLine ? <ReferenceLine y={0} stroke="currentColor" className="text-muted-foreground" strokeWidth={1} opacity={0.5} /> : null}
        {band ? (
          <ReferenceArea x1={band.start} x2={band.end} fill={panel.color} fillOpacity={0.12} stroke="none" />
        ) : null}
        <ReferenceLine x={playYear} stroke={panel.color} strokeWidth={1.5} strokeDasharray="3 3" />
        {panel.kind === "area" ? (
          <Area type="monotone" dataKey="v" stroke={panel.color} fill={panel.color} fillOpacity={0.18} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        ) : (
          <Line type="monotone" dataKey="v" stroke={panel.color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

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
  // Y축 범위 모드: "full"=전체 데이터 기준 고정, "window"=보이는 구간에 맞춰 유동.
  yMode?: "full" | "window";
}) {
  const [expanded, setExpanded] = useState(false);
  // 원화 전환 토글(이 패널 한정). $ 단위 패널만 변환 가능.
  const [krw, setKrw] = useState(false);
  const conv = krwConversion(panel.unit);
  const scale = krw && conv ? conv.factor : 1;
  const displayUnit = krw && conv ? conv.unit : panel.unit;

  // 데이터가 존재하는 전체 구간(처음~끝 연도). 전체보기 모달의 X축 범위.
  const fullRange = useMemo<[number, number] | null>(() => {
    if (!series || series.length === 0) return null;
    let mn = Infinity, mx = -Infinity;
    for (const [date] of series) { const y = fracOf(date); if (y < mn) mn = y; if (y > mx) mx = y; }
    if (!Number.isFinite(mn)) return null;
    return [Math.floor(mn), Math.ceil(mx)];
  }, [series]);

  // 모달 열렸을 때 Esc 로 닫기.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  return (
    <div className="rounded-lg border border-border bg-card/40 p-3" data-testid={`panel-${panel.id}`}>
      <div className="flex items-center justify-between mb-1">
        {/* 라벨 클릭 → 전체 범위 그래프 팝업 */}
        <button
          type="button"
          onClick={() => fullRange && setExpanded(true)}
          disabled={!fullRange}
          className="group flex items-center gap-2 rounded text-left transition-colors hover:text-primary disabled:cursor-default"
          title="클릭하면 전체 구간 그래프를 크게 봅니다"
          data-testid={`panel-expand-${panel.id}`}
        >
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: panel.color }} />
          <span className="text-[13px] font-medium">{panel.label}</span>
          <Maximize2 className="h-3 w-3 text-muted-foreground/40 transition-colors group-hover:text-primary" />
        </button>
        {conv ? (
          <button
            type="button"
            onClick={() => setKrw((k) => !k)}
            className="rounded px-1 text-[10.5px] tabular-nums text-muted-foreground underline decoration-dotted underline-offset-2 transition-colors hover:text-primary"
            title={`클릭하면 ${krw ? "달러" : "원화"}로 전환 (고정 환율 1$=${USD_KRW.toLocaleString("ko")}원)`}
            data-testid={`panel-unit-${panel.id}`}
          >
            {displayUnit} · {panel.start}~
          </button>
        ) : (
          <span className="text-[10.5px] text-muted-foreground tabular-nums">{panel.unit} · {panel.start}~</span>
        )}
      </div>

      <PanelChart
        panel={panel} series={series}
        fromYear={fromYear} toYear={toYear}
        playYear={playYear} band={band} yMode={yMode} height={120}
        scale={scale} unit={displayUnit}
      />

      {/* 전체 범위 모달 — framer-motion transform 컨테이닝블록을 벗어나도록 포털로 body 에 렌더. */}
      {expanded && fullRange
        ? createPortal(
            <div
              className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
              onClick={() => setExpanded(false)}
              data-testid={`panel-modal-${panel.id}`}
            >
              <div
                className="w-full max-w-4xl rounded-xl border border-border bg-card p-4 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-sm" style={{ background: panel.color }} />
                    <span className="text-sm font-semibold">{panel.label}</span>
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      전체 구간 {fullRange[0]}~{fullRange[1]} · {displayUnit}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpanded(false)}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    title="닫기 (Esc)"
                    data-testid={`panel-modal-close-${panel.id}`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {/* 전체 데이터 구간 + Y축도 전체 기준 고정. 현재 슬라이더 시점은 점선으로 위치 표시. */}
                <PanelChart
                  panel={panel} series={series}
                  fromYear={fullRange[0]} toYear={fullRange[1]}
                  playYear={playYear} band={band} yMode="full" height={440} tickCount={10}
                  scale={scale} unit={displayUnit}
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
