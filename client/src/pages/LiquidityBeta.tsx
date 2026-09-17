// 미국 유동성(베타) — 얼마나 → 어디서 → 어디로를 한 흐름으로.
//   띠: 순유동성(얼마나) → H.4.1 항등식 워터폴(어디서) → 같은 기간 저수지 변화(어디로). 세 열이 한 숫자로 이어진다.
//   깊이: 5년 전년비 차트 · 연준 T계정(기존 컴포넌트 순수 재사용) · 재무부 만기별 발행→인수자 생키 + 생애주기 표.
//   맥락: 맨 아래 얇은 띠 — 숫자와 점만, 판정·차트 없음.
//   데이터: 기존 /api/fed/overview(DB) + /api/liquidity/context·auctions(라이브 조회+캐시, DB 미사용). 결측은 0 이 아니다.
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Sankey, Layer, Rectangle } from "recharts";
import { apiRequest } from "@/lib/queryClient";
import { restoreMissingNumbers, weeksBefore } from "@shared/time-series";
import {
  liquidityBand, netLiquidity, yoyMonthly, yoyWeekly, changeFrom, stockChangeBetween, latestCommon, roundAdditive, sumAuctionsBetween,
  spreadBand, spreadBp, loansBand, nfciBand,
  type LiquidityContext, type LiquidityAuctions, type Obs, type Band, type Maturity, type Bidder, type LiquidityBand,
} from "@shared/liquidity-beta";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TAccount, asMoney, signed, weekLabel, A_SOMA, L_RES, TB, POS, NEG, type WeekPoint } from "@/components/fed-taccount";

// ── 서버 응답 형태 ──
interface TreasuryMonth { date: string; bills: number; netBills: number; total: number }
interface FedMatWeek { date: string; bills: number; notesBonds: number; tips: number; total: number }
interface DailyPoint { date: string; netLiq: number; sp500: number | null }
interface Overview { weeks: WeekPoint[]; daily: DailyPoint[]; treasury?: { monthly: TreasuryMonth[]; fedWeekly: FedMatWeek[] }; updatedAt: string }

const AMBER = "#f59e0b", GREY = "#94a3b8";
const bandDot = (b: Band) => (b === "위기" ? NEG : b === "경계" ? AMBER : b === "평상시" ? POS : GREY);
const fmtDate = (d?: string) => (d ? d.slice(2).replace(/-/g, ".") : "—");
const fmtPct = (v: number, digits = 1) => (Number.isFinite(v) ? `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}%` : "—");
const fmtNum = (v: number, digits = 2, unit = "") => (Number.isFinite(v) ? `${v.toFixed(digits)}${unit}` : "—");
const latest = (obs?: Obs[]) => (obs && obs.length ? obs[obs.length - 1] : null);
// 띠 전용 0.1억 표기. asMoney(억 정수)로는 149M×3 이 "$1억+$1억+$1억=$4억"으로 읽혀 항등식이 깨져 보인다(Codex F4).
const fmtEok = (v: number) => (Number.isFinite(v) ? `${v < 0 ? "−" : "+"}$${(Math.abs(v) / 100).toFixed(1)}억` : "—");
const MAT_COLOR: Record<Maturity, string> = { bills: TB.bill, notes: TB.note, bonds: TB.bond, tips: TB.tips, frn: TB.frn };
const BIDDER_COLOR: Record<Bidder, string> = { soma: A_SOMA, dealer: "#475569", direct: "#64748b", indirect: "#94a3b8", noncomp: "#cbd5e1" };

function Note({ children }: { children: ReactNode }) { return <div className="text-[11px] text-muted-foreground leading-snug">{children}</div>; }
function Pill({ options, value, onChange }: { options: { k: string; label: string }[]; value: string; onChange: (k: any) => void }) {
  return (
    <div className="flex rounded-full border border-border overflow-hidden text-[11px]">
      {options.map((o) => <button key={o.k} type="button" onClick={() => onChange(o.k)} className={`px-2.5 py-0.5 ${value === o.k ? "bg-muted font-semibold" : "text-muted-foreground hover:bg-muted/50"}`}>{o.label}</button>)}
    </div>
  );
}

// ── 어디서: 항등식 워터폴 (세 항목 → 순유동성 변화) ──
function BandWaterfall({ band, disp }: { band: LiquidityBand; disp: { parts: number[]; total: number } }) {
  const cum: number[] = [0];
  for (const s of band.steps) cum.push(cum[cum.length - 1] + s.effect);
  const lo = Math.min(0, ...cum), hi = Math.max(0, ...cum), span = Math.max(hi - lo, 1);
  const top = 12, bottom = 96, y = (v: number) => top + ((hi - v) / span) * (bottom - top);
  const colW = 100, barW = 56, x0 = 12;
  const cols = [...band.steps.map((s, i) => ({ label: s.label, own: s.own, a: cum[i], b: cum[i + 1], color: s.effect >= 0 ? POS : NEG, total: false, shown: disp.parts[i] })),
    { label: "= 순유동성 변화", own: band.dNetLiq, a: 0, b: band.dNetLiq, color: "hsl(var(--foreground))", total: true, shown: disp.total }];
  const W = x0 + colW * cols.length;
  const sub = (k: string, own: number) => k === "연준 자산" ? (own >= 0 ? `매입 ${asMoney(own)}` : `QT 만기상환 ${asMoney(own)}`)
    : k === "TGA" ? (own >= 0 ? `발행>지출 ${asMoney(own)} 흡수` : `지출>발행 ${asMoney(-own)} 방출`)
    : k === "역레포" ? (own >= 0 ? `MMF 예치 ${asMoney(own)} 흡수` : `MMF 인출 ${asMoney(-own)} 방출`) : "";
  return (
    <svg viewBox={`0 0 ${W} 132`} className="w-full" style={{ maxHeight: 150 }}>
      <line x1={0} y1={y(0)} x2={W} y2={y(0)} stroke="hsl(var(--border))" strokeDasharray="4 4" />
      {cols.map((c, i) => {
        const cx = x0 + colW * i + colW / 2, yA = y(Math.max(c.a, c.b)), yB = y(Math.min(c.a, c.b));
        const h = Math.max(yB - yA, 1.5);
        return (
          <g key={c.label}>
            {i < cols.length - 1 && !c.total && <line x1={cx + barW / 2} y1={y(c.b)} x2={cx + colW - barW / 2} y2={y(c.b)} stroke="hsl(var(--muted-foreground))" strokeWidth={0.6} strokeDasharray="3 3" opacity={0.6} />}
            <rect x={cx - barW / 2} y={yA} width={barW} height={h} rx={2} fill={c.color} opacity={c.total ? 0.92 : 0.85} />
            <text x={cx} y={c.b - c.a >= 0 ? yA - 3 : yB + 10} textAnchor="middle" fontSize={10} fontWeight={700} fill={c.total ? "hsl(var(--foreground))" : c.color}>{fmtEok(c.shown)}</text>
            <text x={cx} y={112} textAnchor="middle" fontSize={9.5} fontWeight={600} fill="hsl(var(--foreground))">{c.label}</text>
            <text x={cx} y={124} textAnchor="middle" fontSize={8.5} fill="hsl(var(--muted-foreground))">{c.total ? `${weekLabel(band.from)} → ${weekLabel(band.to)}` : sub(c.label, c.own)}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ── 어디로: 저수지 잔액 변화 (가운데 0, 좌 감소 / 우 증가) ──
function ReservoirBars({ rows }: { rows: { label: string; value: number; sub: string; strong?: boolean; placeholder?: boolean }[] }) {
  const max = Math.max(1, ...rows.filter((r) => Number.isFinite(r.value)).map((r) => Math.abs(r.value)));
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[92px_minmax(0,1fr)_78px] items-center gap-2">
          <div className={`text-[11px] font-semibold ${r.placeholder ? "text-muted-foreground/60" : ""}`}>{r.label}</div>
          {r.placeholder ? <div className="h-3.5 rounded border border-dashed border-border" /> : (
            <div className="relative h-3.5 rounded bg-muted">
              <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
              {Number.isFinite(r.value) && (
                <div className="absolute inset-y-0" style={{
                  left: r.value < 0 ? `${50 - (Math.abs(r.value) / max) * 48}%` : "50%", width: `${(Math.abs(r.value) / max) * 48}%`,
                  background: r.strong ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))", borderRadius: 3, opacity: r.strong ? 0.92 : 0.65,
                }} />
              )}
            </div>
          )}
          <div className="text-right">
            <div className={`text-[12px] font-semibold tabular-nums ${r.placeholder ? "text-muted-foreground/60" : ""}`}>{r.placeholder ? "출처 확정 후" : Number.isFinite(r.value) ? fmtEok(r.value) : "자료 부족"}</div>
            <div className="text-[9.5px] text-muted-foreground leading-none">{r.sub}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── 생키 노드·링크 (Recharts Sankey 커스텀) ──
function SankeyNodeShape(props: any) {
  const { x, y, width, height, index, payload } = props;
  const left = payload.side === "maturity";
  const color = left ? MAT_COLOR[payload.key as Maturity] : BIDDER_COLOR[payload.key as Bidder];
  return (
    <Layer key={`n${index}`}>
      <Rectangle x={x} y={y} width={width} height={height} fill={color} fillOpacity={0.95} radius={2} />
      <text x={left ? x - 6 : x + width + 6} y={y + height / 2} textAnchor={left ? "end" : "start"} dominantBaseline="middle" fontSize={11} fill="hsl(var(--foreground))">
        <tspan fontWeight={600}>{payload.name}</tspan> <tspan fill="hsl(var(--muted-foreground))" fontSize={10}>{asMoney(payload.value)}</tspan>
      </text>
    </Layer>
  );
}
function SankeyLinkShape(props: any) {
  const { sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, index, payload } = props;
  const color = MAT_COLOR[payload?.source?.key as Maturity] ?? "#94a3b8";
  const d = `M${sourceX},${sourceY + linkWidth / 2} C${sourceControlX},${sourceY + linkWidth / 2} ${targetControlX},${targetY + linkWidth / 2} ${targetX},${targetY + linkWidth / 2}`
    + ` L${targetX},${targetY - linkWidth / 2} C${targetControlX},${targetY - linkWidth / 2} ${sourceControlX},${sourceY - linkWidth / 2} ${sourceX},${sourceY - linkWidth / 2} Z`;
  return <path key={`l${index}`} d={d} fill={color} fillOpacity={0.28} stroke="none" />;
}

export default function LiquidityBeta() {
  const overview = useQuery<Overview>({
    queryKey: ["/api/fed/overview"],
    queryFn: async () => restoreMissingNumbers<Overview>(await apiRequest("GET", "/api/fed/overview").then((r) => r.json())),
  });
  const context = useQuery<LiquidityContext>({
    queryKey: ["/api/liquidity/context"],
    queryFn: async () => apiRequest("GET", "/api/liquidity/context").then((r) => r.json()),
    staleTime: 6 * 60 * 60 * 1000,
  });
  const [months, setMonths] = useState<3 | 1>(3);
  const auctions = useQuery<LiquidityAuctions>({
    queryKey: ["/api/liquidity/auctions", months],
    queryFn: async () => apiRequest("GET", `/api/liquidity/auctions?months=${months}`).then((r) => r.json()),
    staleTime: 6 * 60 * 60 * 1000,
  });

  const [idx, setIdx] = useState<number>(-1);
  const [cmp, setCmp] = useState<4 | 13>(4);
  const [spOverlay, setSpOverlay] = useState(false);

  const weeks = overview.data?.weeks ?? [];
  const curIdx = idx < 0 ? weeks.length - 1 : Math.min(idx, weeks.length - 1);
  const sel = weeks.length ? weeks[curIdx] : null;
  const prev = sel ? weeksBefore(weeks, sel.date, cmp) : undefined;
  const band = sel && prev ? liquidityBand(prev, sel) : null;
  const ctx = context.data?.series ?? {};
  const ctxErr = context.data?.errors ?? {};
  const ctxFailed = context.isError; // 요청 자체 실패(HTTP 5xx 등) — 부분 실패(errors)와 별개로 안내·재시도(Codex 2차 F2)

  // 얼마나: M2 전년비(월간, 선택 주 이하 최신 달)
  const m2Yoy = sel ? yoyMonthly(ctx.m2 ?? [], sel.date) : null;
  // 어디로: 띠와 같은 두 시점(prev.date → sel.date)의 잔액 변화. 목표일에서 허용 범위(예금 7일·월간 35일)를 넘거나
  //   구간 안에 관측이 없으면 결측 — 최신 관측에서 기간을 다시 재지 않는다(Codex F1).
  const depChg = sel && prev ? stockChangeBetween(ctx.deposits ?? [], prev.date, sel.date, 7) : null;
  const monthly = overview.data?.treasury?.monthly ?? [];
  const billsObs: Obs[] = monthly.filter((m) => Number.isFinite(m.bills)).map((m) => ({ date: m.date, value: m.bills }));
  const billsChg = sel && prev ? stockChangeBetween(billsObs, prev.date, sel.date, 35) : null;
  // F4: 띠의 표시값 — 0.1억 단위, 드리프트는 최대 항목에 흡수. 얼마나·어디서·어디로가 같은 표시값을 공유한다.
  const bandDisp = band ? roundAdditive(band.steps.map((s) => s.effect), band.dNetLiq, 10) : null;
  const reservesDisp = band ? Math.round(band.dReserves / 10) * 10 : NaN;
  const bridgeDisp = bandDisp ? bandDisp.total - reservesDisp : NaN;
  // 연준 SOMA 만기별(주간) — 선택 주·비교 주의 '정확한' 관측만 쓴다. 없으면 결측(이전 주로 대체하면 라벨이 거짓이 된다, Codex 3차 F2).
  const fedWeekly = overview.data?.treasury?.fedWeekly ?? [];
  const somaExact = (date?: string) => (date ? fedWeekly.find((w) => w.date === date) ?? null : null);
  const somaSel = somaExact(sel?.date), somaPrev = somaExact(prev?.date);
  // 생애주기용 보유 관측 구간: 입찰 창 안의 첫 수요일 이상 ~ 마지막 수요일 이하. 인수도 이 구간 (첫, 마지막] 로 다시 합산한다.
  const somaFirstOnOrAfter = (date: string) => fedWeekly.find((w) => w.date >= date) ?? null;
  const somaLastOnOrBefore = (date: string) => [...fedWeekly].reverse().find((w) => w.date <= date) ?? null;

  // 5년 차트: 주간 순유동성 전년비 · M2 전년비(월간→주 매핑) · S&P 전년비(일간→주 매핑, 토글)
  const chart = useMemo(() => {
    if (!weeks.length) return [];
    const netObs: Obs[] = weeks.map((w) => ({ date: w.date, value: netLiquidity(w) })).filter((o) => Number.isFinite(o.value));
    const spObs: Obs[] = (overview.data?.daily ?? []).filter((d) => d.sp500 != null && Number.isFinite(d.sp500)).map((d) => ({ date: d.date, value: d.sp500 as number }));
    const start = new Date(Date.parse(weeks[weeks.length - 1].date) - 5 * 365 * 86_400_000).toISOString().slice(0, 10);
    return weeks.filter((w) => w.date >= start).map((w) => ({
      date: w.date,
      netLiq: yoyWeekly(netObs, w.date)?.pct ?? NaN,
      m2: yoyMonthly(ctx.m2 ?? [], w.date)?.pct ?? NaN,
      sp: changeFrom(spObs, w.date, 364, 4)?.pct ?? NaN,
    }));
  }, [weeks, overview.data?.daily, ctx.m2]);

  // 맥락(최신 관측 기준)
  // SOFR 는 익일 발표, IORB 는 당일 — 최신 '공통' 관측일에서만 차감한다(Codex F2: 9/15 SOFR − 9/17 IORB 가 −26bp 로 보였음).
  const pair = latestCommon(ctx.sofr ?? [], ctx.iorb ?? []);
  const sofr = pair?.a ?? null;
  const spreadValue = pair ? spreadBp(pair.a.value, pair.b.value) : NaN;
  const loansLatest = weeks.length ? weeks[weeks.length - 1] : null;
  const hy = latest(ctx.hy), nfci = latest(ctx.nfci), dfii = latest(ctx.dfii10), unrate = latest(ctx.unrate);
  const dxy3m = ctx.dtwexbgs ? changeFrom(ctx.dtwexbgs, latest(ctx.dtwexbgs)!.date, 91, 5) : null;
  const indproYoy = ctx.indpro ? yoyMonthly(ctx.indpro, latest(ctx.indpro)!.date) : null;
  const pceYoy = ctx.pcepilfe ? yoyMonthly(ctx.pcepilfe, latest(ctx.pcepilfe)!.date) : null;

  // 생애주기 표 — SOMA 3버킷(단기 / 중장기 N·B·FRN / TIPS) 기준. 발행·인수는 입찰 집계, 보유는 fedWeekly.
  const agg = auctions.data?.agg ?? null;
  const life = useMemo(() => {
    if (!agg) return null;
    // 기간 정렬(Codex 3차 F1): 보유 변화는 H.4.1 수요일 스냅샷 (winStart → winEnd), 발행·인수는 그 사이 (winStart, winEnd] 에
    //   결제된 입찰만. 입찰 창 끝(오늘)과 마지막 스냅샷 사이의 인수분은 아직 보유에 안 잡혔으므로 넣지 않는다.
    const winStart = somaFirstOnOrAfter(agg.start), winEnd = somaLastOnOrBefore(agg.end);
    if (!winStart || !winEnd || winStart.date >= winEnd.date) return { rows: [], from: winStart?.date, to: winEnd?.date, unavailable: true as const };
    // 발행 = 보고 총액(미분류 포함, Codex F5). 구간 안에 집계된 입찰이 0 건이면 0 이 아니라 결측(Codex F3).
    const bucket = (ms: Maturity[]) => sumAuctionsBetween(agg.rows, ms, winStart.date, winEnd.date);
    const rows: { label: string; color: string; n: number; issued: number; soma: number; held: number; dHeld: number }[] = [
      { label: "단기 Bills", color: TB.bill, ...bucket(["bills"]), held: winEnd.bills, dHeld: winEnd.bills - winStart.bills },
      { label: "중장기 Notes·Bonds·FRN", color: TB.note, ...bucket(["notes", "bonds", "frn"]), held: winEnd.notesBonds, dHeld: winEnd.notesBonds - winStart.notesBonds },
      { label: "TIPS", color: TB.tips, ...bucket(["tips"]), held: winEnd.tips, dHeld: winEnd.tips - winStart.tips },
    ];
    return { rows, from: winStart.date, to: winEnd.date, unavailable: false as const };
  }, [agg, fedWeekly]);
  const reportedTotal = agg ? Object.values(agg.reported).reduce((s, v) => s + v, 0) : 0;
  const attributedTotal = agg ? Object.values(agg.attributed).reduce((s, v) => s + v, 0) : 0;

  if (overview.isLoading) return <div className="p-6 space-y-4"><Skeleton className="h-52 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (overview.isError) return <div className="p-6 text-sm" role="alert">유동성 데이터를 불러오지 못했습니다. <button className="underline" onClick={() => void overview.refetch()}>다시 불러오기</button></div>;
  if (!sel) return <div className="p-6 text-sm text-muted-foreground">데이터가 없습니다.</div>;

  return (
    <div className="p-4 md:p-6 space-y-3 max-w-6xl mx-auto">
      {/* 헤더 — 주 선택 + 비교 기간 */}
      <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap">
        <h1 className="text-base font-bold shrink-0">미국 유동성 <span className="text-[11px] font-semibold text-amber-700 align-middle">베타</span></h1>
        <span className="text-[11px] text-muted-foreground">얼마나 → 어디서 → 어디로 · H.4.1 주간 · 기존 페이지는 그대로</span>
        <span className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={() => setIdx(Math.max(0, curIdx - 1))} disabled={curIdx <= 0} aria-label="이전 주" className="px-1 text-[13px] text-foreground/70 hover:text-foreground disabled:opacity-25">◀</button>
          <span className="text-[11.5px] font-semibold tabular-nums">{sel.date.slice(0, 4)}년 {weekLabel(sel.date)} <span className="font-normal text-muted-foreground">({sel.date})</span></span>
          <button type="button" onClick={() => setIdx(Math.min(weeks.length - 1, curIdx + 1))} disabled={curIdx >= weeks.length - 1} aria-label="다음 주" className="px-1 text-[13px] text-foreground/70 hover:text-foreground disabled:opacity-25">▶</button>
          {curIdx < weeks.length - 1 && <button type="button" onClick={() => setIdx(-1)} className="rounded border border-amber-500/50 text-amber-700 px-1.5 py-0.5 text-[10.5px] hover:bg-amber-500/10">현재로</button>}
          <Pill options={[{ k: "4", label: "4주 전 대비" }, { k: "13", label: "13주 전 대비" }]} value={String(cmp)} onChange={(k) => setCmp(Number(k) as 4 | 13)} />
        </span>
      </div>

      {/* ── 띠: 얼마나 → 어디서 → 어디로 ── */}
      <Card className="p-4">
        {!band ? (
          <div className="text-[12px] text-muted-foreground">{cmp}주 전({prev ? prev.date : "관측 없음"}) 비교 시점의 관측이 없어 띠를 그릴 수 없습니다. 다른 주를 선택하세요.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[220px_24px_minmax(0,1fr)_24px_300px] gap-x-4 gap-y-4 xl:gap-x-0 items-stretch">
            {/* 얼마나 */}
            <div className="flex flex-col gap-2 md:order-1 xl:order-none">
              <div><div className="text-[13px] font-bold">얼마나</div><Note>지금 얼마나 풀려 있나</Note></div>
              <div>
                <Note>순유동성 · 연준 자산 − TGA − 역레포</Note>
                <div className="text-[30px] font-bold leading-none tabular-nums mt-0.5">{asMoney(band.netLiqNow)}</div>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-[15px] font-semibold tabular-nums" style={{ color: band.dNetLiq >= 0 ? POS : NEG }}>{fmtEok(bandDisp!.total)}</span>
                  <Note>{cmp}주 변화{band.taxDates.length ? <span className="text-amber-700"> · 세금일 포함({band.taxDates.map((d) => d.slice(5).replace("-", "/")).join(", ")})</span> : null}</Note>
                </div>
              </div>
              <div className="border-t border-border pt-2 flex items-baseline gap-2">
                <Note>M2 전년비</Note>
                <span className="text-[14px] font-semibold tabular-nums">{m2Yoy ? fmtPct(m2Yoy.pct) : "—"}</span>
                <Note>{m2Yoy ? `월간 · ${m2Yoy.to.date.slice(0, 7)}` : ctxErr.m2 || ctxFailed ? "자료 부족" : "…"}</Note>
              </div>
            </div>
            <div className="hidden xl:flex items-center justify-center border-l border-border text-muted-foreground">›</div>
            {/* 어디서 */}
            <div className="flex flex-col gap-1.5 md:order-3 md:col-span-2 xl:order-none xl:col-span-1 xl:px-3">
              <div><div className="text-[13px] font-bold">어디서</div><Note>무엇이 {fmtEok(bandDisp!.total)}를 만들었나 — H.4.1 항등식 · 표시는 0.1억, 반올림 차이는 최대 항목에 흡수</Note></div>
              <BandWaterfall band={band} disp={bandDisp!} />
            </div>
            <div className="hidden xl:flex items-center justify-center border-l border-border text-muted-foreground">›</div>
            {/* 어디로 */}
            <div className="flex flex-col gap-2 md:order-2 xl:order-none xl:pl-3">
              <div><div className="text-[13px] font-bold">어디로</div><Note>같은 기간, 돈이 앉은 곳 — 잔액 변화</Note></div>
              <ReservoirBars rows={[
                { label: "지급준비금", value: reservesDisp, sub: `${fmtDate(band.from)}→${fmtDate(band.to)} · 항등식`, strong: true },
                { label: "은행 예금", value: depChg ? depChg.delta : NaN, sub: depChg ? `${fmtDate(depChg.from.date)}→${fmtDate(depChg.to.date)} · H.8 주간` : ctxErr.deposits || ctxFailed ? "자료 부족" : "H.8 주간 · 구간 관측 없음" },
                { label: "단기채 잔액", value: billsChg ? billsChg.delta : NaN, sub: billsChg ? `${billsChg.from.date.slice(0, 7)}→${billsChg.to.date.slice(0, 7)} · MSPD 월간` : "MSPD 월간 · 구간 내 관측 없음" },
                { label: "MMF 잔고", value: NaN, sub: "", placeholder: true },
              ]} />
              <Note>지급준비금 = 순유동성 변화 − 현금통화·기타({fmtEok(bridgeDisp)}) — 항등식으로 이어짐. 예금·단기채는 같은 두 시점의 잔액 변화를 나란히 둔 것, 합산하지 않음.</Note>
            </div>
          </div>
        )}
      </Card>

      {/* ── 얼마나 · 5년 ── */}
      <Card className="p-3.5">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
          <div className="text-sm font-semibold">얼마나 — 5년 <span className="text-[11px] font-normal text-muted-foreground">순유동성 · M2 · 전년비 %</span></div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="inline-block w-4 h-0.5" style={{ background: L_RES }} />순유동성</span>
            <span className="flex items-center gap-1"><span className="inline-block w-4 h-0.5 bg-muted-foreground" />M2</span>
            <button type="button" onClick={() => setSpOverlay((v) => !v)} className={`rounded-full border px-2 py-0.5 ${spOverlay ? "bg-muted font-semibold text-foreground" : "border-border/60"}`}>S&amp;P 500 겹치기 {spOverlay ? "켬" : "끔"}</button>
          </div>
        </div>
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="date" tickFormatter={(d) => String(d).slice(0, 4)} minTickGap={48} tick={{ fontSize: 10, fill: "currentColor" }} axisLine={false} tickLine={false} className="text-muted-foreground" />
              <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10, fill: "currentColor" }} axisLine={false} tickLine={false} width={40} className="text-muted-foreground" />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: any, n: any) => [Number.isFinite(v) ? fmtPct(v) : "—", n]} labelFormatter={(l) => `${weekLabel(String(l))} (${l})`} />
              <ReferenceLine y={0} stroke="hsl(var(--border))" />
              <ReferenceLine x={sel.date} stroke={NEG} strokeOpacity={0.5} strokeDasharray="3 3" />
              <Line dataKey="netLiq" name="순유동성 전년비" stroke={L_RES} strokeWidth={1.8} dot={false} isAnimationActive={false} connectNulls={false} />
              <Line dataKey="m2" name="M2 전년비" stroke="hsl(var(--muted-foreground))" strokeWidth={1.6} dot={false} isAnimationActive={false} connectNulls={false} />
              {spOverlay && <Line dataKey="sp" name="S&P 500 전년비" stroke="#b3b3b3" strokeWidth={1.4} strokeDasharray="5 3" dot={false} isAnimationActive={false} connectNulls={false} />}
            </LineChart>
          </ResponsiveContainer>
        </div>
        {(ctxErr.m2 || ctxFailed) && <Note>M2 자료를 불러오지 못했습니다{ctxErr.m2 ? `(${ctxErr.m2})` : ""}. <button className="underline" onClick={() => void context.refetch()}>다시 불러오기</button></Note>}
      </Card>

      {/* ── 깊이: 연준 T계정 | 재무부 생키 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-stretch">
        <Card className="p-3.5">
          <div className="mb-2 text-sm font-semibold">어디서 · 연준 — T계정 <span className="text-[11px] font-normal text-muted-foreground">{weekLabel(sel.date)} · 구성비 · 기존 컴포넌트</span></div>
          <TAccount w={sel} />
          {/* 비교기간 Δ + SOMA 만기별 3줄 — 컴포넌트 밖에서 렌더(순수 재사용) */}
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] tabular-nums">
            {prev ? ([["국채(SOMA)", sel.treast - prev.treast], ["MBS", sel.mbs - prev.mbs], ["대출·스왑", sel.loans - prev.loans], ["총자산", sel.total - prev.total],
              ["지급준비금", sel.reserves - prev.reserves], ["역레포", sel.rrp - prev.rrp], ["TGA", sel.tga - prev.tga], ["현금통화", sel.currency - prev.currency]] as [string, number][])
              .map(([k, v]) => <div key={k} className="flex justify-between border-b border-border/40 py-0.5"><span className="text-muted-foreground">{k} {cmp}주 Δ</span><b style={{ color: Number.isFinite(v) ? (v >= 0 ? POS : NEG) : undefined }}>{Number.isFinite(v) ? signed(v) : "자료 부족"}</b></div>)
              : <Note>비교 시점 관측이 없어 Δ를 계산할 수 없습니다.</Note>}
          </div>
          {sel && !somaSel && <Note>국채(SOMA) 만기별 · {sel.date} 보유 관측 없음 — 자료 부족</Note>}
          {somaSel && (
            <div className="mt-2 text-[11px] tabular-nums">
              <Note>국채(SOMA) 만기별 · {somaSel.date}{somaPrev ? ` · Δ는 ${cmp}주(${fmtDate(somaPrev.date)}→${fmtDate(somaSel.date)})` : prev ? ` · ${cmp}주 전(${fmtDate(prev.date)}) 보유 관측 없음 — Δ 자료 부족` : ""}</Note>
              <div className="grid grid-cols-3 gap-2 mt-0.5">
                {([["단기 Bills", somaSel.bills, somaPrev?.bills, TB.bill], ["중장기 N·B·FRN", somaSel.notesBonds, somaPrev?.notesBonds, TB.note], ["TIPS", somaSel.tips, somaPrev?.tips, TB.tips]] as [string, number, number | undefined, string][]).map(([k, v, p, c]) => (
                  <div key={k} className="rounded border border-border/60 px-2 py-1">
                    <div className="flex items-center gap-1 text-muted-foreground"><span className="inline-block w-2 h-2 rounded-sm" style={{ background: c }} />{k}</div>
                    <div className="font-semibold">{Number.isFinite(v) ? asMoney(v) : "자료 부족"} {p != null && Number.isFinite(v - p) && <span className="font-normal" style={{ color: v - p >= 0 ? POS : NEG }}>{signed(v - p)}</span>}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card className="p-3.5 flex flex-col">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
            <div className="text-sm font-semibold">어디서 · 재무부 — 누가 국채를 받았나 <span className="text-[11px] font-normal text-muted-foreground">입찰 낙찰 · 결제일 기준</span></div>
            <Pill options={[{ k: "3", label: "3개월" }, { k: "1", label: "1개월" }]} value={String(months)} onChange={(k) => setMonths(Number(k) as 3 | 1)} />
          </div>
          {auctions.isLoading ? <Skeleton className="h-[260px] w-full" /> : !auctions.data || auctions.data.errors.auctions || !auctions.data.sankey ? (
            <div className="text-[12px] text-muted-foreground py-6">입찰 자료를 불러오지 못했습니다{auctions.data?.errors.auctions ? ` (${auctions.data.errors.auctions})` : ""}. <button className="underline" onClick={() => void auctions.refetch()}>다시 불러오기</button></div>
          ) : auctions.data.sankey.links.length === 0 ? (
            <div className="text-[12px] text-muted-foreground py-6">{auctions.data.start} ~ {auctions.data.end} 집계 가능한 입찰이 없습니다{agg && agg.skipped ? <> — <b className="text-amber-700">{agg.skipped}건 제외</b>(결과 미공표 · 0 으로 치지 않음)</> : null}{agg && agg.unknownTypes.length ? <> · 미매핑 종류: {agg.unknownTypes.join(", ")}</> : null}.</div>
          ) : (
            <>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <Sankey data={auctions.data.sankey} nodeWidth={10} nodePadding={18} linkCurvature={0.5} iterations={32} margin={{ top: 8, right: 120, bottom: 8, left: 120 }}
                    node={<SankeyNodeShape />} link={<SankeyLinkShape />}>
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: any) => [asMoney(v), "낙찰"]} />
                  </Sankey>
                </ResponsiveContainer>
              </div>
              <Note>
                {auctions.data.start} ~ {auctions.data.end} · 입찰 {agg!.counted}건 집계{agg!.skipped ? <> · <b className="text-amber-700">{agg!.skipped}건 제외</b>(결과 미공표·0으로 치지 않음)</> : null}
                {reportedTotal > 0 && Math.abs(reportedTotal - attributedTotal) / reportedTotal > 0.001 ? <> · 보고 총액 {asMoney(reportedTotal)} 중 귀속 {(attributedTotal / reportedTotal * 100).toFixed(1)}% (나머지 FIMA 등 미분류)</> : null}
                {agg!.unknownTypes.length ? <> · 미매핑 종류: {agg!.unknownTypes.join(", ")}</> : null}
              </Note>
            </>
          )}
          {/* 생애주기 표 — SOMA 3버킷 */}
          {life && life.unavailable && (
            <div className="mt-3"><Note>만기별 생애주기 · 입찰 창({auctions.data?.start}~{auctions.data?.end}) 안에 H.4.1 보유 관측이 두 개 이상 없어 기간을 맞출 수 없습니다 — 표를 계산하지 않습니다.</Note></div>
          )}
          {life && !life.unavailable && (
            <div className="mt-3">
              <Note>만기별 생애주기 · 발행·인수·보유 변화 모두 H.4.1 보유 관측 구간 <b className="text-foreground">{life.from} → {life.to}</b> 기준 (입찰은 그 사이 결제분만 — 위 생키의 창 {auctions.data?.start}~{auctions.data?.end} 와 다를 수 있음)</Note>
              <table className="mt-1 w-full text-[11px] tabular-nums">
                <thead><tr className="text-muted-foreground"><th className="text-left font-medium py-0.5">만기</th><th className="text-right font-medium">발행</th><th className="text-right font-medium">연준 인수</th><th className="text-right font-medium">연준 보유</th><th className="text-right font-medium">보유 변화</th><th className="text-right font-medium">만기상환(추정)</th></tr></thead>
                <tbody>
                  {life.rows.map((r) => (
                    <tr key={r.label} className="border-t border-border/40">
                      <td className="py-1 flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm" style={{ background: r.color }} />{r.label}</td>
                      <td className="text-right">{Number.isFinite(r.issued) ? asMoney(r.issued) : <span className="text-muted-foreground">자료 부족</span>}</td>
                      <td className="text-right" style={{ color: A_SOMA }}>{Number.isFinite(r.soma) ? asMoney(r.soma) : <span className="text-muted-foreground">자료 부족</span>}</td>
                      <td className="text-right">{Number.isFinite(r.held) ? asMoney(r.held) : "자료 부족"}</td>
                      <td className="text-right">{Number.isFinite(r.dHeld) ? signed(r.dHeld) : "자료 부족"}</td>
                      <td className="text-right text-muted-foreground">{Number.isFinite(r.soma) && Number.isFinite(r.dHeld) ? asMoney(r.soma - r.dHeld) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Note>발행 = 보고 총액(total_accepted, 미분류 포함) · 연준 인수 = SOMA 낙찰 · 만기상환(추정) = 연준 인수 − 보유 변화(CUSIP 만기 집계가 아닌 근사치). 집계 입찰이 0 건인 만기는 자료 부족.</Note>
            </div>
          )}
        </Card>
      </div>

      {/* ── 맥락 띠 — 숫자와 점만 ── */}
      <Card className="p-3 border-dashed">
        <div className="flex items-center gap-x-4 gap-y-1.5 flex-wrap text-[11px]">
          <span className="font-semibold">맥락</span>
          <span className="text-muted-foreground">최신 관측</span>
          <span className="w-px h-3.5 bg-border" />
          <span className="font-semibold text-muted-foreground">경고</span>
          {([
            ["SOFR−IORB", Number.isFinite(spreadValue) ? `${spreadValue >= 0 ? "+" : "−"}${Math.abs(spreadValue)}bp` : "자료 부족", sofr?.date, spreadBand(spreadValue)],
            ["긴급대출", loansLatest && Number.isFinite(loansLatest.loans) ? asMoney(loansLatest.loans) : "자료 부족", loansLatest?.date, loansBand(loansLatest?.loans ?? NaN)],
            ["HY 스프레드", hy ? `${hy.value.toFixed(2)}%p` : "자료 부족", hy?.date, null],
            ["NFCI", nfci ? fmtNum(nfci.value, 2) : "자료 부족", nfci?.date, nfciBand(nfci?.value ?? NaN)],
          ] as [string, string, string | undefined, Band | null][]).map(([k, v, d, b]) => (
            <span key={k} className="flex items-center gap-1.5">
              {b && <span className="inline-block w-2 h-2 rounded-full" style={{ background: bandDot(b) }} title={b} />}
              <span className="text-muted-foreground">{k}</span><b className="tabular-nums">{v}</b><span className="text-[9.5px] text-muted-foreground">{fmtDate(d)}</span>
            </span>
          ))}
          <span className="w-px h-3.5 bg-border" />
          <span className="font-semibold text-muted-foreground">가격</span>
          <span className="flex items-center gap-1.5"><span className="text-muted-foreground">실질금리 10년</span><b className="tabular-nums">{dfii ? `${dfii.value.toFixed(2)}%` : "자료 부족"}</b><span className="text-[9.5px] text-muted-foreground">{fmtDate(dfii?.date)}</span></span>
          <span className="flex items-center gap-1.5"><span className="text-muted-foreground">광의달러 3개월</span><b className="tabular-nums">{dxy3m ? fmtPct(dxy3m.pct) : "자료 부족"}</b><span className="text-[9.5px] text-muted-foreground">{fmtDate(dxy3m?.to.date)}</span></span>
          <span className="w-px h-3.5 bg-border" />
          <span className="font-semibold text-muted-foreground">사이클</span>
          <span className="flex items-center gap-1.5"><span className="text-muted-foreground">산업생산 전년비</span><b className="tabular-nums">{indproYoy ? fmtPct(indproYoy.pct) : "자료 부족"}</b><span className="text-[9.5px] text-muted-foreground">{fmtDate(indproYoy?.to.date)}</span></span>
          <span className="flex items-center gap-1.5"><span className="text-muted-foreground">실업률</span><b className="tabular-nums">{unrate ? `${unrate.value.toFixed(1)}%` : "자료 부족"}</b><span className="text-[9.5px] text-muted-foreground">{fmtDate(unrate?.date)}</span></span>
          <span className="flex items-center gap-1.5"><span className="text-muted-foreground">근원 PCE 전년비</span><b className="tabular-nums">{pceYoy ? fmtPct(pceYoy.pct) : "자료 부족"}</b><span className="text-[9.5px] text-muted-foreground">{fmtDate(pceYoy?.to.date)}</span></span>
          {(ctxFailed || Object.keys(ctxErr).length > 0) && <span className="ml-auto text-amber-700" role="alert">{ctxFailed ? "맥락 지표 요청 실패" : `일부 지표 조회 실패(${Object.keys(ctxErr).join(", ")})`} <button className="underline" onClick={() => void context.refetch()}>다시 불러오기</button></span>}
        </div>
      </Card>
    </div>
  );
}
