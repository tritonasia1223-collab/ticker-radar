// 미국 유동성 B안(읽기) — 천천히 읽는 페이지. 명세: docs/liquidity-read-spec.md · 목업: docs/mockup-reference.html
//   문장이 먼저, 그림은 증거. 모든 문장은 shared/liquidity-sentences 의 순수 함수가 만들고 이 파일은 그 출력만 그린다.
//   부호 규칙 하나: 초록 = 방출(순유동성 증가 기여) · 빨강 = 흡수. 본문 Δ는 전부 '순유동성에 준 영향' 부호.
//   잔고 기준 부호는 T계정 펼쳐보기 안에서만(머리에 명시, 중립색). 수준값에는 초록/빨강을 쓰지 않는다.
//   기존 /liquidity(베타)·/fed 는 그대로 두고 이 페이지는 /liquidity-read 에 따로 산다.
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea, ReferenceDot, Sankey, Layer } from "recharts";
import { apiRequest } from "@/lib/queryClient";
import { restoreMissingNumbers } from "@shared/time-series";
import { yoyMonthly, yoyWeekly, changeFrom, nearest, netLiquidity, sumAuctionsBetween, type LiquidityContext, type LiquidityAuctions, type Obs } from "@shared/liquidity-beta";
import { howMuch, whereFrom, whereTo, whoBought, whoSankey, stress, emergencyLoans, background, pickWeeks, BUCKET_LABEL, type ReadWeek, type CmpWeeks, type Contribution, type StressRow, type Bucket } from "@shared/liquidity-read";
import { s1, s2, s3, s4, s5, rowDescription, fmt, josa, type Part } from "@shared/liquidity-sentences";
import { READ_CONFIG } from "@shared/liquidity-read-config";
import type { WeekPoint } from "@/components/fed-taccount";

// ── 서버 응답 형태 ──
interface TreasuryMonth { date: string; bills: number; total: number }
interface FedMatWeek { date: string; bills: number; notesBonds: number; tips: number; total: number }
interface DailyPoint { date: string; netLiq: number; sp500: number | null }
interface Overview { weeks: WeekPoint[]; daily: DailyPoint[]; treasury?: { monthly: TreasuryMonth[]; fedWeekly: FedMatWeek[] }; updatedAt: string }

// ── 색·글꼴 토큰(명세 3.4) — 이 페이지 스코프에만 ──
const C = { bg: "#F6F4EE", card: "#FFFFFF", ink: "#1A1A18", body: "#3B3934", cap: "#5F5C54", line: "#D9D5CA", line2: "#E8E5DC", n1: "#CFCABD", n2: "#E3DFD4", n3: "#BDB8AA", n4: "#7A766C", release: "#1F7A4D", absorb: "#B3402E", over: "#E9C9C2", m2: "#3E5C76", border2: "#B9B4A6" };
const SERIF = "'Noto Serif KR', 'Apple SD Gothic Neo', serif";
const SANS = "'IBM Plex Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";
const FONT_HREF = "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600&family=Noto+Serif+KR:wght@500;700&display=swap";
const tone = (t?: Part["tone"]) => (t === "release" ? C.release : t === "absorb" ? C.absorb : undefined);
const dollars = (musd: number) => `$${fmt.amount(musd)}`;
const signedDollars = (musd: number) => `${musd < 0 && !fmt.isZeroEok(musd) ? "−" : ""}${dollars(musd)}`; // 부호 보존(추정치가 음수일 수 있는 칸)

// ── 공통 조각 ──
function Parts({ parts, strongTone = false }: { parts: Part[]; strongTone?: boolean }) {
  return <>{parts.map((p, i) => p.tone || p.strong ? <strong key={i} style={{ color: tone(p.tone), fontWeight: strongTone || p.strong ? 700 : 600 }}>{p.text}</strong> : <span key={i}>{p.text}</span>)}</>;
}
function Cap({ children, style }: { children: ReactNode; style?: React.CSSProperties }) { return <div style={{ fontSize: 14, lineHeight: 1.6, color: C.cap, ...style }}>{children}</div>; }
function Body({ children, max = 680 }: { children: ReactNode; max?: number }) { return <p style={{ fontSize: 15, lineHeight: 1.75, color: C.body, maxWidth: max, margin: 0 }}>{children}</p>; }
function Sub({ children }: { children: ReactNode }) { return <div style={{ fontSize: 15, fontWeight: 600 }}>{children}</div>; }
function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} aria-pressed={active} style={{ minHeight: 44, padding: "0 16px", fontSize: 14, fontWeight: active ? 600 : 500, color: active ? C.bg : C.ink, background: active ? C.ink : "transparent", border: `1px solid ${active ? C.ink : C.border2}`, borderRadius: 22, cursor: "pointer" }}>{children}</button>;
}
function Expander({ label, open, onToggle, children }: { label: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <button type="button" onClick={onToggle} aria-expanded={open} style={{ alignSelf: "flex-start", minHeight: 44, padding: "0 4px", fontSize: 15, fontWeight: 500, color: C.ink, background: "transparent", border: "none", borderBottom: `1px solid ${C.ink}`, display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : undefined }}><path d="M3 5l4 4 4-4"></path></svg>{label}
      </button>
      {open && <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: "24px 28px" }}>{children}</div>}
    </div>
  );
}
function Section({ id, num, title, question, children }: { id: string; num: string; title: string; question: string; children: ReactNode }) {
  return (
    <section id={id} className="grid grid-cols-1 md:grid-cols-[150px_minmax(0,1fr)] gap-y-5 md:gap-x-14" style={{ padding: "56px 0 72px", borderTop: `1px solid ${C.ink}` }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.cap }}>{num}</div>
        <div style={{ fontSize: 22, fontWeight: 600 }}>{title}</div>
        <Cap>{question}</Cap>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 36, minWidth: 0 }}>{children}</div>
    </section>
  );
}
function H2({ children }: { children: ReactNode }) { return <h2 className="text-[26px] md:text-[34px]" style={{ fontFamily: SERIF, fontWeight: 700, lineHeight: 1.45, margin: 0 }}>{children}</h2>; }

// 02·03 기여 막대 — 0 축을 음수 최대값에 맞춰 동적으로 놓는 좌우 발산 막대
function ContribBars({ rows, N }: { rows: { name: string; desc: string; value: number; total?: boolean }[]; N: number }) {
  const maxNeg = Math.max(0, ...rows.map((r) => -Math.min(0, r.value))), maxPos = Math.max(0, ...rows.map((r) => Math.max(0, r.value)));
  const span = maxNeg + maxPos || 1, zero = (maxNeg / span) * 100;
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <Cap style={{ paddingBottom: 10 }}>유동성에 준 영향 · {N}주 · <span style={{ color: C.release }}>초록 = 방출(시중에 풀림)</span> · <span style={{ color: C.absorb }}>빨강 = 흡수(시중에서 빠짐)</span></Cap>
      {rows.map((r) => {
        const w = (Math.abs(r.value) / span) * 100, color = r.total ? C.ink : fmt.isZeroEok(r.value) ? C.n3 : r.value > 0 ? C.release : C.absorb; // '0억'으로 표시되는 값은 중립
        return (
          <div key={r.name} className="grid grid-cols-[1fr_auto] md:grid-cols-[220px_minmax(0,1fr)_96px] gap-x-4 gap-y-2 items-center" style={{ padding: "16px 0", borderTop: r.total ? `2px solid ${C.ink}` : `1px solid ${C.line}` }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}><span style={{ fontSize: 17, fontWeight: 600 }}>{r.name}</span>{r.desc && <Cap style={{ lineHeight: 1.5 }}>{r.desc}</Cap>}</div>
            <div className="col-span-2 md:col-span-1" style={{ position: "relative", height: 40 }}>
              <div style={{ position: "absolute", left: `${zero}%`, top: 0, width: 1, height: 40, background: C.ink }} />
              <div style={{ position: "absolute", left: r.value >= 0 ? `${zero}%` : `${zero - w}%`, top: 4, width: `${w}%`, height: 32, background: color, borderRadius: r.value >= 0 ? "0 6px 6px 0" : "6px 0 0 6px" }} />
            </div>
            <div className="text-left md:text-right" style={{ fontSize: 20, fontWeight: 600, color: r.total ? C.ink : color, whiteSpace: "nowrap" }}>{fmt.signedEok(r.value)}</div>
          </div>
        );
      })}
    </div>
  );
}

// 02 펼쳐보기 — 중립 T계정. 잔고 기준, 색은 중립 5단만. 얇은 띠는 안에 글자를 못 넣으므로 옆 표의 스와치가 라벨을 맡는다(Codex F2).
const NEUTRAL = ["#7A766C", "#9C978A", "#BDB8AA", "#CFCABD", "#E3DFD4"];
interface TRow { label: string; side: "asset" | "liab"; color: string; v: number; p: number }
const liveLoans = (w: WeekPoint) => w.discount + w.repo + w.swap + (Number.isFinite(w.btfp) ? w.btfp : 0);
function taccountRows(sel: WeekPoint, prev: WeekPoint): TRow[] {
  const a = (label: string, i: number, v: number, p: number): TRow => ({ label, side: "asset", color: NEUTRAL[i], v, p });
  const l = (label: string, i: number, v: number, p: number): TRow => ({ label, side: "liab", color: NEUTRAL[i], v, p });
  const otherA = (w: WeekPoint) => Math.max(0, w.total - w.treast - w.mbs - w.agency - liveLoans(w));
  return [
    a("국채(SOMA)", 0, sel.treast, prev.treast), a("MBS", 1, sel.mbs, prev.mbs), a("기관채", 2, sel.agency, prev.agency), a("대출·스왑", 3, liveLoans(sel), liveLoans(prev)), a("기타 자산", 4, otherA(sel), otherA(prev)),
    l("지급준비금", 0, sel.reserves, prev.reserves), l("역레포", 1, sel.rrp, prev.rrp), l("TGA", 2, sel.tga, prev.tga), l("현금통화", 3, sel.currency, prev.currency), l("기타 부채·자본", 4, Math.max(0, sel.liabResidual), Math.max(0, prev.liabResidual)),
  ];
}
function NeutralStack({ rows, total, align }: { rows: TRow[]; total: number; align: "left" | "right" }) {
  const H = 280;
  return (
    <div style={{ display: "flex", flexDirection: "column", height: H, borderRadius: 8, overflow: "hidden", minWidth: 0 }}>
      {rows.map((r) => {
        const h = Number.isFinite(r.v) && total > 0 ? Math.max(0, (r.v / total) * H) : 0;
        const dark = r.color === NEUTRAL[0] || r.color === NEUTRAL[1];
        return <div key={r.label} title={`${r.label} ${dollars(r.v)}`} style={{ height: h, background: r.color, color: dark ? "#FFFFFF" : C.ink, display: "flex", alignItems: "center", justifyContent: align === "left" ? "flex-start" : "flex-end", padding: "0 10px", overflow: "hidden", fontSize: 12, whiteSpace: "nowrap", borderTop: "1px solid rgba(0,0,0,0.08)" }}>{h >= 26 ? `${r.label} ${dollars(r.v)}` : ""}</div>;
      })}
    </div>
  );
}
function NeutralTAccount({ rows, total }: { rows: TRow[]; total: number }) {
  return (
    <div className="grid grid-cols-2 gap-3" style={{ minWidth: 0 }}>
      <div><Cap style={{ paddingBottom: 6 }}>자산 <b style={{ color: C.ink }}>{dollars(total)}</b></Cap><NeutralStack rows={rows.filter((r) => r.side === "asset")} total={total} align="left" /></div>
      <div><Cap style={{ paddingBottom: 6, textAlign: "right" }}>부채·자본 <b style={{ color: C.ink }}>{dollars(total)}</b></Cap><NeutralStack rows={rows.filter((r) => r.side === "liab")} total={total} align="right" /></div>
    </div>
  );
}

// 05 눈금 — 경계선이 그려진 가로 눈금 + 점
function GaugeRow({ r }: { r: StressRow }) {
  const val = r.value, has = val != null && Number.isFinite(val);
  const fmtVal = !has ? "" : r.unit === "bp" ? fmt.bp(val!) : r.unit === "idx" ? val!.toFixed(2) : r.unit === "pctp" ? `${val!.toFixed(2)}%p` : dollars(val!);
  const pos = has ? Math.min(1, Math.max(0, (val! - r.min) / (r.max - r.min || 1))) : 0;
  const tPos = r.threshold != null ? Math.min(1, Math.max(0, (r.threshold - r.min) / (r.max - r.min || 1))) : null;
  const fmtT = r.threshold == null ? "" : r.unit === "bp" ? String(r.threshold) : r.unit === "musd" ? dollars(r.threshold) : String(r.threshold);
  const fmtEdge = (v: number) => (r.unit === "bp" ? fmt.bp(v) : r.unit === "pctp" ? `${v}%p` : r.unit === "musd" ? dollars(v) : v.toFixed(1));
  return (
    <div className="grid grid-cols-1 md:grid-cols-[250px_minmax(0,1fr)_90px] gap-x-6 gap-y-2 md:items-center" style={{ padding: "22px 0", borderTop: `1px solid ${C.line}` }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 17, fontWeight: 600, color: has ? C.ink : C.cap }}>{r.name}</span>
        <Cap style={{ lineHeight: 1.5 }}>{r.desc}{r.note ? ` · ${r.note}` : ""}</Cap>
      </div>
      {!has ? (
        <Cap>준비 중 — 데이터 연결 후 표시됩니다</Cap>
      ) : tPos == null ? (
        <Cap>경계선 설정 대기 — 값과 기준일만 표시합니다</Cap>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ position: "relative", height: 24 }}>
            <div style={{ position: "absolute", left: 0, top: 9, width: `${tPos * 100}%`, height: 6, background: C.n2, borderRadius: "3px 0 0 3px" }} />
            <div style={{ position: "absolute", left: `${tPos * 100}%`, top: 9, width: `${(1 - tPos) * 100}%`, height: 6, background: C.over, borderRadius: "0 3px 3px 0" }} />
            <div style={{ position: "absolute", left: `${tPos * 100}%`, top: 0, width: 2, height: 24, background: C.ink }} />
            <div style={{ position: "absolute", left: `${pos * 100}%`, top: 3, width: 18, height: 18, borderRadius: 9, background: r.breached ? C.absorb : C.release, marginLeft: -9 }} title={r.breached ? "경계선 위" : "경계선 아래"} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: C.cap }}><span>{fmtEdge(r.min)}</span><span>경계 {fmtT}</span><span>{fmtEdge(r.max)}</span></div>
        </div>
      )}
      {has && <div className="text-left md:text-right" style={{ display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontSize: 20, fontWeight: 600 }}>{fmtVal}{(val! < r.min || val! > r.max) && tPos != null ? " (눈금 밖)" : ""}</span><span style={{ fontSize: 14, color: C.cap }}>{r.date ? fmt.dateKo(r.date) : ""}</span></div>}
    </div>
  );
}

// 04 생키 — 중립색만. 최소 굵기 2px.
const BUCKET_FILL: Record<Bucket, string> = { bills: C.n3, nb: C.n4, tips: C.ink };
function ReadSankeyNode(props: any) {
  const { x, y, width, height, index, payload } = props;
  const left = payload.side === "bucket";
  return (
    <Layer key={`n${index}`}>
      <rect x={x} y={y} width={width} height={Math.max(height, 2)} fill={C.ink} />
      <text x={left ? x - 12 : x + width + 12} y={y + Math.max(height, 2) / 2} textAnchor={left ? "end" : "start"} dominantBaseline="middle" fontSize={14} fill={C.ink} fontFamily={SANS}>
        <tspan fontWeight={600}>{payload.name}</tspan><tspan fill={C.cap} dx={left ? 0 : 8} x={left ? x - 12 : undefined} dy={left ? 18 : 0}>{dollars(payload.value)}</tspan>
      </text>
    </Layer>
  );
}
function ReadSankeyLink(props: any) {
  const { sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, index, payload } = props;
  const w = Math.max(linkWidth, 2), fill = BUCKET_FILL[payload?.source?.key as Bucket] ?? C.n3;
  const d = `M${sourceX},${sourceY + w / 2} C${sourceControlX},${sourceY + w / 2} ${targetControlX},${targetY + w / 2} ${targetX},${targetY + w / 2} L${targetX},${targetY - w / 2} C${targetControlX},${targetY - w / 2} ${sourceControlX},${sourceY - w / 2} ${sourceX},${sourceY - w / 2} Z`;
  return <path key={`l${index}`} d={d} fill={fill} fillOpacity={0.55} stroke="none"><title>{`${payload?.source?.name} → ${payload?.target?.name} ${dollars(payload?.value ?? 0)}`}</title></path>;
}

export default function LiquidityRead() {
  useEffect(() => { // 이 페이지 스코프의 글꼴만 추가로 로드
    if (document.querySelector(`link[href="${FONT_HREF}"]`)) return;
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = FONT_HREF; document.head.appendChild(l);
  }, []);
  const overview = useQuery<Overview>({ queryKey: ["/api/fed/overview"], queryFn: async () => restoreMissingNumbers<Overview>(await apiRequest("GET", "/api/fed/overview").then((r) => r.json())) });
  const context = useQuery<LiquidityContext>({ queryKey: ["/api/liquidity/context"], queryFn: async () => apiRequest("GET", "/api/liquidity/context").then((r) => r.json()), staleTime: 6 * 60 * 60 * 1000 });
  const [auctionMode, setAuctionMode] = useState<"all" | "nobills" | "1m">("all");
  const months = auctionMode === "1m" ? 1 : 3;
  const auctions = useQuery<LiquidityAuctions>({ queryKey: ["/api/liquidity/auctions", months, 0], queryFn: async () => apiRequest("GET", `/api/liquidity/auctions?months=${months}`).then((r) => r.json()), staleTime: 6 * 60 * 60 * 1000 });
  const auctionsPrev = useQuery<LiquidityAuctions>({ queryKey: ["/api/liquidity/auctions", months, 1], queryFn: async () => apiRequest("GET", `/api/liquidity/auctions?months=${months}&offset=1`).then((r) => r.json()), staleTime: 6 * 60 * 60 * 1000 });

  const [idx, setIdx] = useState(-1);
  const [cmp, setCmp] = useState<CmpWeeks>(4);
  const [range, setRange] = useState<"5y" | "2y">("5y");
  const [sp, setSp] = useState(false);
  const [openT, setOpenT] = useState(false);
  const [openM, setOpenM] = useState(false);
  const cfg = READ_CONFIG;

  const weeks: ReadWeek[] = overview.data?.weeks ?? [];
  const curIdx = idx < 0 ? weeks.length - 1 : Math.min(idx, weeks.length - 1);
  const selDate = weeks.length ? weeks[curIdx].date : "";
  const { sel, prev } = useMemo(() => pickWeeks(weeks, selDate, cmp), [weeks, selDate, cmp]);
  const ctx = context.data?.series ?? {};
  const monthly = overview.data?.treasury?.monthly ?? [];
  const monthlyTotal: Obs[] = useMemo(() => monthly.filter((m) => Number.isFinite(m.total)).map((m) => ({ date: m.date, value: m.total })), [monthly]);
  const monthlyBills: Obs[] = useMemo(() => monthly.filter((m) => Number.isFinite(m.bills)).map((m) => ({ date: m.date, value: m.bills })), [monthly]);
  const fedWeekly = overview.data?.treasury?.fedWeekly ?? [];

  const how = sel ? howMuch(weeks, sel, prev, cmp, ctx.m2 ?? [], cfg.FLAT_PCT) : null; // 비교 주가 없어도 수준은 낸다
  const expectedPrev = sel ? new Date(Date.parse(sel.date) - cmp * 7 * 86_400_000).toISOString().slice(0, 10) : "";
  const noPrev = `${cmp}주 전(${expectedPrev ? fmt.dateKo(expectedPrev) : ""}) 관측이 없어 이번 주는 비교하지 않았습니다.`;
  const noPrevBlock = `${cmp}주 전(${expectedPrev ? fmt.dateKo(expectedPrev) : ""}) 관측이 없어 이 칸의 변화는 계산하지 않았습니다. 다른 주를 고르면 다시 계산합니다.`;
  const from = sel && prev ? whereFrom(prev, sel, cfg.DOMINANT_SHARE) : null;
  const to = sel && prev ? whereTo(prev, sel, ctx.deposits ?? [], monthlyBills, cfg.RESERVES_ZONES) : null;
  const agg = auctions.data?.agg ?? null, prevAgg = auctionsPrev.data?.agg ?? null;
  const who = agg ? whoBought(agg, prevAgg, monthlyTotal, monthlyBills, auctionMode === "nobills") : null;
  const sank = who ? whoSankey(who) : null;
  const latestWeek = weeks.length ? weeks[weeks.length - 1] : null;
  const st = stress(ctx.sofr ?? [], ctx.iorb ?? [], ctx.nfci ?? [], ctx.hy ?? [], latestWeek ? { ...emergencyLoans(latestWeek), date: latestWeek.date } : null, cfg);
  const bg = background(ctx);

  const S1 = how ? s1(how) : null, S2 = from ? s2(from, cmp, how?.flat) : null, S3 = to ? s3(to) : null, S4 = who ? s4(who) : null, S5 = s5(st);

  // 그림 C 데이터: 전년비(5년), 연도 눈금은 연 1회, 기저효과 주석
  const yoyData = useMemo(() => {
    if (!weeks.length || !sel) return { rows: [] as { date: string; nl: number; m2: number; sp: number }[], ticks: [] as string[], notes: [] as { date: string; text: string }[], spLast: null as string | null };
    const nlObs: Obs[] = weeks.map((w) => ({ date: w.date, value: netLiquidity(w) })).filter((o) => Number.isFinite(o.value));
    const spObs: Obs[] = (overview.data?.daily ?? []).filter((d) => d.sp500 != null && Number.isFinite(d.sp500)).map((d) => ({ date: d.date, value: d.sp500 as number }));
    const start = new Date(Date.parse(sel.date) - 5 * 365 * 86_400_000).toISOString().slice(0, 10);
    // S&P 는 그 주에 관측(±4일)이 있을 때만 — 마지막 관측(8/31) 이후 주차에 마지막 값을 끌고 가면 수평선이 생긴다(Codex F5).
    const spAt = (date: string) => { const to = nearest(spObs, date, 4); return to ? changeFrom(spObs, to.date, 364, 4)?.pct ?? NaN : NaN; };
    const rows = weeks.filter((w) => w.date >= start && w.date <= sel.date).map((w) => ({ date: w.date, nl: yoyWeekly(nlObs, w.date)?.pct ?? NaN, m2: yoyMonthly(ctx.m2 ?? [], w.date)?.pct ?? NaN, sp: spAt(w.date) }));
    const seen = new Set<string>(); const ticks = rows.filter((r) => { const y = r.date.slice(0, 4); if (seen.has(y)) return false; seen.add(y); return true; }).map((r) => r.date);
    // 기저효과: 전년비가 한 주 사이 5%p 이상 급변했고, 1년 전 같은 주에 수준이 한 주 사이 2% 이상 급변한 경우
    const byDate = new Map(nlObs.map((o) => [o.date, o.value]));
    const notes: { date: string; text: string }[] = [];
    for (let i = 1; i < rows.length && notes.length < 3; i++) {
      if (!Number.isFinite(rows[i].nl) || !Number.isFinite(rows[i - 1].nl) || Math.abs(rows[i].nl - rows[i - 1].nl) < 5) continue;
      const y1 = new Date(Date.parse(rows[i].date) - 364 * 86_400_000).toISOString().slice(0, 10), y0 = new Date(Date.parse(rows[i - 1].date) - 364 * 86_400_000).toISOString().slice(0, 10);
      const a = byDate.get(y0), b = byDate.get(y1);
      if (a && b && Math.abs(b - a) / a >= 0.02) notes.push({ date: rows[i].date, text: rows[i].date.startsWith("2024-03") ? "1년 전 SVB 사태 때 급증한 수치와 비교돼 생긴 낙차" : "1년 전 급변과 비교돼 생긴 기저효과" });
    }
    if (!notes.some((n) => n.date.startsWith("2024-03"))) { const r = rows.find((x) => x.date >= "2024-03-06" && x.date <= "2024-03-20"); if (r) notes.push({ date: r.date, text: "1년 전 SVB 사태 때 급증한 수치와 비교돼 생긴 낙차" }); }
    return { rows, ticks, notes, spLast: spObs.length ? spObs[spObs.length - 1].date : null }; // 기준일은 값이 있는 마지막 관측(Codex 2차 F2)
  }, [weeks, sel, ctx.m2, overview.data?.daily]);
  const chartRows = range === "2y" && sel ? yoyData.rows.filter((r) => r.date >= new Date(Date.parse(sel.date) - 2 * 365 * 86_400_000).toISOString().slice(0, 10)) : yoyData.rows;
  const chartTicks = yoyData.ticks.filter((t) => chartRows.some((r) => r.date === t));

  // 만기별 표(펼쳐보기) — 보유 관측 구간에 맞춰 인수를 다시 합산(베타와 같은 규칙)
  const life = useMemo(() => {
    if (!agg) return null;
    const winStart = fedWeekly.find((w) => w.date >= agg.start) ?? null, winEnd = [...fedWeekly].reverse().find((w) => w.date <= agg.end) ?? null;
    if (!winStart || !winEnd || winStart.date >= winEnd.date) return null;
    const b = (ms: Parameters<typeof sumAuctionsBetween>[1]) => sumAuctionsBetween(agg.rows, ms, winStart.date, winEnd.date);
    return { from: winStart.date, to: winEnd.date, rows: [
      { label: BUCKET_LABEL.bills, ...b(["bills"]), held: winEnd.bills, dHeld: winEnd.bills - winStart.bills },
      { label: BUCKET_LABEL.nb, ...b(["notes", "bonds", "frn"]), held: winEnd.notesBonds, dHeld: winEnd.notesBonds - winStart.notesBonds },
      { label: BUCKET_LABEL.tips, ...b(["tips"]), held: winEnd.tips, dHeld: winEnd.tips - winStart.tips },
    ] };
  }, [agg, fedWeekly]);
  const somaExact = (date?: string) => (date ? fedWeekly.find((w) => w.date === date) ?? null : null);
  const somaSel = somaExact(sel?.date), somaPrev = somaExact(prev?.date);

  if (overview.isLoading) return <div style={{ background: C.bg, minHeight: "100vh", padding: 40, color: C.cap, fontFamily: SANS }}>불러오는 중…</div>;
  if (overview.isError || !latestWeek) return <div style={{ background: C.bg, minHeight: "100vh", padding: 40, fontFamily: SANS }} role="alert">유동성 데이터를 불러오지 못했습니다. <button className="underline" onClick={() => void overview.refetch()}>다시 불러오기</button></div>;
  const selW = weeks[curIdx];

  // 결측 사유를 구분한다(Codex 2차 F4): 비교 주 관측 부재 / 입찰 조회 실패 / (05 는 문장 모듈이 자료·설정 부재를 구분)
  const summaryRows: { id: string; label: string; parts: Part[] }[] = [
    { id: "s1", label: "얼마나", parts: S1?.summary ?? [{ text: "이번 주 관측이 없습니다." }] },
    { id: "s2", label: "어디서", parts: S2?.summary ?? [{ text: noPrev }] },
    { id: "s3", label: "어디로", parts: S3?.summary ?? [{ text: noPrev }] },
    { id: "s4", label: "누가 샀나", parts: S4 ? [{ text: S4.summary }] : [{ text: auctions.isLoading ? "입찰 자료를 불러오는 중입니다." : "입찰 자료를 불러오지 못해 이번 주는 표시하지 않았습니다." }] },
    { id: "s5", label: "탈은 없나", parts: [{ text: S5.summary }] },
  ];
  const m2Now = how?.m2Yoy?.to ?? (sel && ctx.m2 ? [...ctx.m2].reverse().find((o) => o.date <= sel.date) ?? null : null); // 선택 주 이하 최신 M2 — 전년비가 없어도 잔액은 보인다(Codex 4차 F1)

  return (
    <div style={{ background: C.bg, color: C.ink, fontFamily: SANS, minHeight: "100vh", fontVariantNumeric: "tabular-nums", wordBreak: "keep-all" }}>
      <div className="px-4 md:px-10" style={{ maxWidth: 1040 + 80, margin: "0 auto", paddingTop: 40, paddingBottom: 96 }}>

        {/* 머리 */}
        <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-5" style={{ paddingBottom: 28 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: "0.08em", color: C.cap }}>미국 유동성 B안 · 주간</div>
            <h1 style={{ fontFamily: SERIF, fontSize: 30, fontWeight: 700, lineHeight: 1.3, margin: 0 }}>{fmt.weekTitle(selW.date)}</h1>
            <Cap>{fmt.dateKo(selW.date)} 기준 · 연준 H.4.1 · 매주 목요일 갱신</Cap>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setIdx(Math.max(0, curIdx - 1))} disabled={curIdx <= 0} aria-label="이전 주" style={{ minHeight: 44, minWidth: 44, border: `1px solid ${C.border2}`, borderRadius: 22, background: "transparent", color: C.ink, opacity: curIdx <= 0 ? 0.3 : 1, cursor: "pointer" }}>◀</button>
            <button type="button" onClick={() => setIdx(Math.min(weeks.length - 1, curIdx + 1))} disabled={curIdx >= weeks.length - 1} aria-label="다음 주" style={{ minHeight: 44, minWidth: 44, border: `1px solid ${C.border2}`, borderRadius: 22, background: "transparent", color: C.ink, opacity: curIdx >= weeks.length - 1 ? 0.3 : 1, cursor: "pointer" }}>▶</button>
            {curIdx < weeks.length - 1 && <Pill active={false} onClick={() => setIdx(-1)}>이번 주로</Pill>}
            <span style={{ fontSize: 14, color: C.cap, paddingLeft: 8 }}>비교 기준</span>
            <Pill active={cmp === 4} onClick={() => setCmp(4)}>4주 전</Pill>
            <Pill active={cmp === 13} onClick={() => setCmp(13)}>13주 전</Pill>
          </div>
        </header>

        {/* 요약 */}
        <nav aria-label="이번 주 요약" style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: "12px 24px", marginBottom: 24 }}>
          {summaryRows.map((r, i) => (
            <a key={r.id} href={`#${r.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(r.id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }} className="flex flex-col md:flex-row md:items-baseline gap-1 md:gap-7" style={{ padding: "20px 0", textDecoration: "none", color: C.ink, borderBottom: i < summaryRows.length - 1 ? `1px solid ${C.line2}` : undefined }}>
              <span style={{ width: 72, flexShrink: 0, fontSize: 14, fontWeight: 600, color: C.cap }}>{r.label}</span>
              <span className="text-[19px] md:text-[22px]" style={{ flexGrow: 1, fontFamily: SERIF, fontWeight: 500, lineHeight: 1.5 }}>
                <Parts parts={r.parts} strongTone />
              </span>
            </a>
          ))}
        </nav>
        <Cap style={{ paddingBottom: 24 }}>매주 오는 분은 여기까지. 아래는 각 문장의 근거입니다.</Cap>

        {/* 01 얼마나 */}
        <Section id="s1" num="01" title="얼마나" question="지금 시장에 돈이 얼마나 풀려 있나">
          {!how || !S1 ? <Cap>이번 주 관측이 없습니다.</Cap> : (<>
            <H2><Parts parts={S1.headline} /></H2>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Sub>연준이 만든 돈 {fmt.jo(how.total)}조 달러 중, 묶여 있는 돈을 빼면</Sub>
              <div style={{ display: "flex", gap: 3, height: 84 }}>
                <div style={{ width: `${(how.nl / how.total) * 100}%`, background: C.ink, color: C.bg, borderRadius: "8px 0 0 8px", padding: "14px 18px", boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: "space-between", minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>시장에 도는 돈 (순유동성)</span>
                  <span style={{ fontSize: 24, fontWeight: 600 }}>{dollars(how.nl)}</span>
                </div>
                <div style={{ width: `${(how.tga / how.total) * 100}%`, background: C.n1 }} title={`TGA ${dollars(how.tga)}`} />
                <div style={{ flexGrow: 1, background: C.n2, borderRadius: "0 8px 8px 0" }} title={`역레포 ${dollars(how.rrp)}`} />
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 20px", fontSize: 14, color: C.body, justifyContent: "flex-end" }}>
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}><span style={{ width: 12, height: 12, background: C.n1, borderRadius: 2 }} />TGA {dollars(how.tga)}</span>
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}><span style={{ width: 12, height: 12, background: C.n2, border: `1px solid ${C.border2}`, boxSizing: "border-box", borderRadius: 2 }} />역레포 {dollars(how.rrp)}</span>
              </div>
              <Body>TGA(재무부가 연준에 둔 계좌)와 역레포에 든 돈은 연준 안에 묶여 시장에서 돌지 않습니다. 그래서 뺍니다. 공식 통계가 아니라 시장에서 쓰는 근사치입니다.</Body>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Sub>이 정도면 큰 변화인가</Sub>
              <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: "16px 8px 8px", height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={how.history} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <XAxis dataKey="date" tickFormatter={(d) => fmt.monthKo(String(d))} minTickGap={40} tick={{ fontSize: 13, fill: C.cap }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={(v) => `$${(v / 1e6).toFixed(1)}조`} domain={["auto", "auto"]} tick={{ fontSize: 13, fill: C.cap }} axisLine={false} tickLine={false} width={64} />
                    <Tooltip contentStyle={{ fontSize: 13, borderRadius: 8, fontFamily: SANS }} formatter={(v: any) => [dollars(v), "순유동성"]} labelFormatter={(l) => fmt.dateKo(String(l))} />
                    {prev && <ReferenceArea x1={how.prevDate} x2={how.date} fill={how.dNl >= 0 ? C.release : C.absorb} fillOpacity={0.12} />}
                    <Line dataKey="nl" stroke={C.ink} strokeWidth={2} dot={false} isAnimationActive={false} />
                    {prev && <ReferenceDot x={how.prevDate} y={how.nlPrev} r={5} fill={C.ink} stroke={C.bg} strokeWidth={2} />}
                    <ReferenceDot x={how.date} y={how.nl} r={6} fill={prev ? (how.dNl >= 0 ? C.release : C.absorb) : C.ink} stroke={C.bg} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {!prev ? <Cap>{noPrevBlock}</Cap> : how.pctl ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ position: "relative", height: 12, background: C.n2, borderRadius: 6 }}>
                    <div style={{ position: "absolute", left: "50%", top: -4, width: 1, height: 20, background: C.cap }} />
                    <div style={{ position: "absolute", left: `${how.pctl.pos * 100}%`, top: -5, width: 22, height: 22, marginLeft: -11, borderRadius: 11, background: how.dNl >= 0 ? C.release : C.absorb, border: `3px solid ${C.bg}`, boxSizing: "border-box" }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: C.cap }}><span>지난 5년 중 가장 큰 감소</span><span>변화 없음</span><span>가장 큰 증가</span></div>
                  <Body>{S1.band}</Body>
                </div>
              ) : <Cap>준비 중 — 5년치 비교 표본이 모이면 표시됩니다</Cap>}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <Sub>순유동성과 M2 — 연준이 푼 밑돈과, 사람들이 실제로 쥔 돈</Sub>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: "22px 24px", display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}><span style={{ width: 22, height: 0, borderTop: `3px solid ${C.ink}` }} /><span style={{ fontSize: 15, fontWeight: 600 }}>순유동성</span></div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}><span style={{ fontSize: 28, fontWeight: 600 }}>{dollars(how.nl)}</span><span style={{ fontSize: 15, color: C.body }}>전년비 {how.nlYoy ? fmt.pct(how.nlYoy.pct) : "—"}</span></div>
                  <Cap>연준이 금융권에 공급한 밑돈. 은행과 시장 사이에서만 돕니다. {fmt.dateKo(how.date)} · 주간</Cap>
                </div>
                <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: "22px 24px", display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}><span style={{ width: 22, height: 0, borderTop: `3px dashed ${C.m2}` }} /><span style={{ fontSize: 15, fontWeight: 600 }}>M2</span></div>
                  {m2Now ? <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}><span style={{ fontSize: 28, fontWeight: 600 }}>{dollars(m2Now.value)}</span><span style={{ fontSize: 15, color: C.body }}>전년비 {how.m2Yoy ? fmt.pct(how.m2Yoy.pct) : "—"}</span></div> : <Cap>준비 중 — M2 자료 연결 후 표시됩니다{context.isError ? " " : ""}{context.isError && <button className="underline" onClick={() => void context.refetch()}>다시 불러오기</button>}</Cap>}
                  <Cap>가계와 기업이 쥔 돈. 현금, 예금, 개인 MMF를 합친 것. {m2Now ? `${fmt.monthKo(m2Now.date)} · ` : ""}월간</Cap>
                </div>
              </div>
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <Cap>1년 전 대비 증감률 · 규모가 달라 증감률로 비교</Cap>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Pill active={range === "5y"} onClick={() => setRange("5y")}>5년</Pill>
                  <Pill active={range === "2y"} onClick={() => setRange("2y")}>최근 2년 확대</Pill>
                  <Pill active={sp} onClick={() => setSp((v) => !v)}>S&amp;P 500 겹치기{sp ? " ✓" : ""}</Pill>
                </div>
              </div>
              <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: "20px 12px 8px", height: 320 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartRows} margin={{ top: 28, right: sp ? 8 : 16, left: 0, bottom: 0 }}>
                    <XAxis dataKey="date" ticks={chartTicks} tickFormatter={(d) => String(d).slice(0, 4)} tick={{ fontSize: 13, fill: C.cap }} axisLine={false} tickLine={{ stroke: C.border2 }} />
                    <YAxis yAxisId="left" tickFormatter={(v) => `${v}%`} tick={{ fontSize: 13, fill: C.cap }} axisLine={false} tickLine={false} width={48} />
                    {sp && <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${v}%`} tick={{ fontSize: 13, fill: C.n4 }} axisLine={false} tickLine={false} width={48} />}
                    <Tooltip contentStyle={{ fontSize: 13, borderRadius: 8, fontFamily: SANS }} formatter={(v: any, n: any) => [Number.isFinite(v) ? fmt.pct(v) : "—", n]} labelFormatter={(l) => fmt.dateKo(String(l))} />
                    <ReferenceLine yAxisId="left" y={0} stroke={C.ink} />
                    <ReferenceLine yAxisId="left" x={how.date} stroke={C.cap} strokeDasharray="3 3" />
                    {yoyData.notes.filter((n) => chartRows.some((r) => r.date === n.date)).map((n) => <ReferenceLine key={n.date} yAxisId="left" x={n.date} stroke={C.cap} label={{ value: n.text, position: "top", fontSize: 12, fill: C.body, fontFamily: SANS }} />)}
                    <Line yAxisId="left" dataKey="m2" name="M2" stroke={C.m2} strokeWidth={2.5} strokeDasharray="7 5" dot={false} isAnimationActive={false} connectNulls={false} />
                    <Line yAxisId="left" dataKey="nl" name="순유동성" stroke={C.ink} strokeWidth={2.5} dot={false} isAnimationActive={false} connectNulls={false} />
                    {sp && <Line yAxisId="right" dataKey="sp" name="S&P 500" stroke={C.n4} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} />}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {sp && yoyData.spLast && <Cap>S&amp;P 500 은 일간 자료가 {fmt.dateKo(yoyData.spLast)}까지 있어 그 뒤는 비어 있습니다.</Cap>}
              {S1.m2note && <Body>{S1.m2note}</Body>}
            </div>
          </>)}
        </Section>

        {/* 02 어디서 */}
        <Section id="s2" num="02" title="어디서" question="누가 이 변화를 만들었나">
          {!from || !S2 || !sel || !prev ? <Cap>{noPrevBlock}</Cap> : (<>
            <H2><Parts parts={S2.headline} /></H2>
            <ContribBars N={cmp} rows={[
              ...from.contributions.map((c: Contribution) => ({ name: c.key === "tga" ? "재무부" : c.key === "rrp" ? "역레포" : "연준", desc: rowDescription(c, from.fedDetail), value: c.effect })),
              { name: "합계", desc: "", value: from.dNl, total: true },
            ]} />
            <div className="flex flex-col md:flex-row gap-4 md:gap-7" style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: "28px 32px" }}>
              <div style={{ width: 150, flexShrink: 0, display: "flex", flexDirection: "column", gap: 8 }}><span style={{ fontSize: 14, fontWeight: 600, color: C.cap }}>이어질까</span><span style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.4 }}>{S2.verdictTitle}</span></div>
              <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
                <Body max={9999}>{S2.verdictBody}</Body>
                {cfg.TGA_TARGET != null && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ position: "relative", height: 12, background: C.n2, borderRadius: 6 }}>
                      <div style={{ position: "absolute", left: 0, top: 0, width: `${Math.min(100, (from.tga / Math.max(cfg.TGA_TARGET, from.tga)) * 100)}%`, height: 12, background: C.cap, borderRadius: 6 }} />
                      <div style={{ position: "absolute", left: `${Math.min(100, (cfg.TGA_TARGET / Math.max(cfg.TGA_TARGET, from.tga)) * 100)}%`, top: -5, width: 2, height: 22, background: C.ink }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: C.cap }}><span>TGA 현재 {dollars(from.tga)}</span><span>재무부 목표 잔고 {dollars(cfg.TGA_TARGET)}</span></div>
                  </div>
                )}
              </div>
            </div>
            <Expander label="연준 대차대조표(T계정) 전체 펼치기" open={openT} onToggle={() => setOpenT((v) => !v)}>
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                <Cap>잔고 증감 기준 · 부채 항목 감소 = 방출. 아래 표의 부호는 위 본문과 달리 잔고 기준이며 색을 쓰지 않습니다.</Cap>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" style={{ minWidth: 0 }}>
                  <NeutralTAccount rows={taccountRows(sel as WeekPoint, prev as WeekPoint)} total={sel.total} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14, minWidth: 0 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: "0 12px", color: C.cap, borderBottom: `1px solid ${C.line}`, paddingBottom: 6 }}><span>항목</span><span>{fmt.dateKo(sel.date)} 잔고</span><span>{cmp}주 Δ</span></div>
                    {taccountRows(sel as WeekPoint, prev as WeekPoint).map((r, i, arr) => (<Fragment key={r.label}>
                      {i === 5 && <div key="total" style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: "0 12px", padding: "6px 0", borderBottom: `2px solid ${C.ink}`, fontWeight: 600 }}><span>총자산</span><span>{dollars(sel.total)}</span><span style={{ color: C.body, fontWeight: 400 }}>{fmt.signedEok(sel.total - prev.total)}</span></div>}
                      <div key={r.label} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: "0 12px", padding: "6px 0", borderBottom: i === arr.length - 1 ? undefined : `1px solid ${C.line2}` }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}><span style={{ width: 12, height: 12, flexShrink: 0, background: r.color, borderRadius: 2, border: "1px solid rgba(0,0,0,0.12)", boxSizing: "border-box" }} />{r.label}</span>
                        <span>{Number.isFinite(r.v) ? dollars(r.v) : "—"}</span><span style={{ color: C.body }}>{Number.isFinite(r.v - r.p) ? fmt.signedEok(r.v - r.p) : "—"}</span>
                      </div>
                    </Fragment>))}
                    {somaSel && (
                      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                        <Cap>국채(SOMA) 만기별 · {fmt.dateKo(somaSel.date)}{somaPrev ? ` · Δ는 ${cmp}주` : prev ? ` · ${cmp}주 전 보유 관측이 없어 Δ 생략` : ""}</Cap>
                        {([["단기 Bills", somaSel.bills, somaPrev?.bills], ["중장기 Notes·Bonds·FRN", somaSel.notesBonds, somaPrev?.notesBonds], ["TIPS", somaSel.tips, somaPrev?.tips]] as [string, number, number | undefined][]).map(([k, v, p]) => (
                          <div key={k} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: "0 16px", padding: "4px 0" }}><span>{k}</span><span>{dollars(v)}</span><span style={{ color: C.body }}>{p != null && Number.isFinite(v - p) ? fmt.signedEok(v - p) : ""}</span></div>
                        ))}
                      </div>
                    )}
                    <Cap style={{ marginTop: 8 }}>{Number.isFinite(sel.btfp) ? "" : "대출·스왑에서 BTFP(2024년 종료)는 제외."}</Cap>
                  </div>
                </div>
              </div>
            </Expander>
          </>)}
        </Section>

        {/* 03 어디로 */}
        <Section id="s3" num="03" title="어디로" question="늘어난 돈이 어디에 쌓였나">
          {!to || !S3 ? <Cap>{noPrevBlock}</Cap> : (<>
            <H2><Parts parts={S3.headline} /></H2>
            {to.sameSign ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", gap: 3, height: 64 }}>
                  <div style={{ width: `${(Math.abs(to.dReserves) / (Math.abs(to.dReserves) + Math.abs(to.dOther) || 1)) * 100}%`, background: to.dReserves >= 0 ? C.release : C.absorb, color: "#FFFFFF", borderRadius: "8px 0 0 8px", padding: "0 18px", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "space-between", minWidth: 0, gap: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>은행 지급준비금</span><span style={{ fontSize: 20, fontWeight: 600, whiteSpace: "nowrap" }}>{fmt.signedEok(to.dReserves)}</span>
                  </div>
                  <div style={{ flexGrow: 1, background: C.n1, borderRadius: "0 8px 8px 0" }} />
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", fontSize: 14, color: C.body }}>현금통화·기타 {fmt.signedEok(to.dOther)}</div>
              </div>
            ) : (
              <ContribBars N={cmp} rows={[{ name: "은행 지급준비금", desc: "", value: to.dReserves }, { name: "현금통화·기타", desc: "", value: to.dOther }, { name: "합계", desc: "", value: to.dNl, total: true }]} />
            )}
            <Body>지급준비금은 은행이 연준에 넣어둔 돈입니다. 은행끼리 결제하고 대출을 내줄 때 쓰는 밑천이라, 이 돈이 넉넉한지가 자금시장 안정을 좌우합니다.</Body>
            {to.zone && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <Sub>지금 지급준비금 {dollars(to.reserves)}는 넉넉한 수준인가</Sub>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ position: "relative", height: 44 }}>
                    <div style={{ position: "absolute", left: 0, top: 16, width: "100%", height: 12, display: "flex", gap: 3 }}><div style={{ width: "30%", background: C.absorb, borderRadius: "6px 0 0 6px" }} /><div style={{ width: "25%", background: C.n1 }} /><div style={{ flexGrow: 1, background: C.release, borderRadius: "0 6px 6px 0" }} /></div>
                    <div style={{ position: "absolute", left: `${to.zone.pos * 100}%`, top: 9, width: 26, height: 26, marginLeft: -13, borderRadius: 13, background: C.ink, border: `3px solid ${C.bg}`, boxSizing: "border-box" }} />
                  </div>
                  <div style={{ display: "flex", fontSize: 14, color: C.cap }}><span style={{ width: "30%" }}>빠듯 · 금리가 튀기 쉬움</span><span style={{ width: "25%" }}>경계 {to.zone.unit === "gdp_pct" ? `${to.zone.tight}~${to.zone.ample}%` : `${dollars(to.zone.tight)}~${dollars(to.zone.ample)}`}</span><span style={{ flexGrow: 1, textAlign: "right" }}>넉넉</span></div>
                </div>
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingTop: 28, borderTop: `1px dashed ${C.border2}` }}>
              <div className="flex flex-col md:flex-row md:justify-between md:items-baseline gap-2"><span style={{ fontSize: 14, fontWeight: 600, color: C.cap }}>참고 · 같은 시기 다른 곳의 잔액</span><Cap>기간과 층위가 달라 위 숫자와 더하지 않습니다</Cap></div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: "20px 22px", display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>은행 예금</span>
                  {to.deposits ? <><span style={{ fontSize: 22, fontWeight: 600 }}>{fmt.signedEok(to.deposits.delta)}</span><Cap style={{ lineHeight: 1.5 }}>{fmt.dateKo(to.deposits.from.date)} → {fmt.dateKo(to.deposits.to.date)} · H.8 주간</Cap></> : <Cap>준비 중 — 이 구간의 주간 관측이 없습니다</Cap>}
                </div>
                <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: "20px 22px", display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>단기 국채 잔액</span>
                  {to.bills ? <><span style={{ fontSize: 22, fontWeight: 600 }}>{fmt.signedEok(to.bills.delta)}</span><Cap style={{ lineHeight: 1.5 }}>{fmt.monthKo(to.bills.from.date)} → {fmt.monthKo(to.bills.to.date)} · 월간. 돈이 앉은 곳이 아니라 돈을 빨아들이는 쪽</Cap></> : <Cap>준비 중 — 이 구간의 월간 관측이 없습니다</Cap>}
                </div>
              </div>
            </div>
          </>)}
        </Section>

        {/* 04 누가 샀나 */}
        <Section id="s4" num="04" title="누가 샀나" question="재무부가 찍은 국채를 누가 받아갔나">
          {auctions.isLoading ? <Cap>불러오는 중…</Cap> : !who || !S4 || !sank ? (
            <Cap>준비 중 — 입찰 자료를 불러오지 못했습니다{auctions.data?.errors.auctions ? ` (${auctions.data.errors.auctions})` : ""}. <button className="underline" onClick={() => void auctions.refetch()}>다시 불러오기</button></Cap>
          ) : (<>
            <H2>{S4.headline.join(" ")}</H2>
            <Body>재무부가 TGA를 다시 채우려면 국채를 더 찍어야 합니다. 그 국채를 누가 받아주느냐에 따라 돈이 흡수되는 곳이 달라집니다. 딜러가 떠안는 몫이 커지면 시장이 소화하기 버겁다는 신호입니다.</Body>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <Cap>{fmt.dateKo(who.start)} ~ {fmt.dateKo(who.end)} 결제분 · 입찰 {who.counted}건{who.excludeBills ? " · 단기채 제외" : ""}</Cap>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Pill active={auctionMode === "all"} onClick={() => setAuctionMode("all")}>전체</Pill>
                  <Pill active={auctionMode === "nobills"} onClick={() => setAuctionMode("nobills")}>단기채 빼고 보기</Pill>
                  <Pill active={auctionMode === "1m"} onClick={() => setAuctionMode("1m")}>최근 1개월</Pill>
                </div>
              </div>
              <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: "24px 12px", overflowX: "auto" }}>
                <div style={{ minWidth: 640, height: 360 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <Sankey data={sank} nodeWidth={14} nodePadding={22} linkCurvature={0.5} iterations={32} margin={{ top: 24, right: 200, bottom: 8, left: 210 }} node={<ReadSankeyNode />} link={<ReadSankeyLink />}>
                      <Tooltip contentStyle={{ fontSize: 13, borderRadius: 8, fontFamily: SANS }} formatter={(v: any) => [dollars(v), "낙찰"]} />
                    </Sankey>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {([["간접 입찰", "해외 중앙은행, 펀드처럼 딜러를 거쳐 응찰하는 곳. 실수요에 가장 가깝습니다."], ["프라이머리 딜러", "연준과 직접 거래하는 대형 은행·증권사. 입찰에 의무로 참여해 남는 물량을 떠안습니다."], ["직접 입찰", "딜러를 거치지 않고 직접 응찰하는 기관."], ["연준 SOMA", "연준이 만기 돌아온 보유분만큼 다시 받아가는 몫. 새 돈이 아닙니다."]] as [string, string][]).map(([k, v]) => (
                <div key={k} className="flex flex-col md:flex-row gap-1 md:gap-5" style={{ padding: "12px 0", borderTop: `1px solid ${C.line}`, fontSize: 15, lineHeight: 1.6 }}><span style={{ width: 130, flexShrink: 0, fontWeight: 600 }}>{k}</span><span style={{ color: C.body }}>{v}</span></div>
              ))}
              <div style={{ borderTop: `1px solid ${C.line}` }} />
            </div>
            <div className="flex flex-col md:flex-row gap-4 md:gap-7" style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: "28px 32px" }}>
              <div style={{ width: 150, flexShrink: 0, display: "flex", flexDirection: "column", gap: 8 }}><span style={{ fontSize: 14, fontWeight: 600, color: C.cap }}>읽을 때 주의</span><span style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.4 }}>{S4?.caution}</span></div>
              <Body max={9999}>단기채는 몇 주마다 만기가 돌아와 다시 찍습니다. 그래서 발행액 대부분은 기존 빚을 갈아 끼운 것입니다. {who.netIssuance ? <>같은 시기 실제로 늘어난 국채는 <strong>{fmt.signedAmount(who.netIssuance.delta)} 달러</strong>({fmt.monthKo(who.netIssuance.from.date)}→{fmt.monthKo(who.netIssuance.to.date)} 월간 잔액 기준)이고{who.billsNet ? <>, 그중 단기채가 {fmt.signedAmount(who.billsNet.delta)} 달러입니다.</> : "."}</> : "같은 시기의 월간 잔액 자료가 아직 없어 순증액은 다음 갱신 때 표시됩니다."}</Body>
            </div>
            <Expander label="만기별 표 펼치기 — 발행 · 연준 인수 · 연준 보유 변화 · 만기상환" open={openM} onToggle={() => setOpenM((v) => !v)}>
              {!life ? <Cap>준비 중 — 입찰 창 안에 보유 관측이 두 개 이상 없어 표를 만들 수 없습니다</Cap> : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <Cap>발행·연준 인수·보유 변화 모두 H.4.1 보유 관측 구간 {fmt.dateKo(life.from)} → {fmt.dateKo(life.to)} 기준. 발행은 보고 총액, 만기상환은 인수 − 보유 변화의 추정치(음수면 입찰 인수보다 보유가 더 늘어난 것).</Cap>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", minWidth: 560, fontSize: 14, borderCollapse: "collapse" }}>
                      <thead><tr style={{ color: C.cap }}>{["만기", "발행", "연준 인수", "연준 보유", "보유 변화", "만기상환(추정)"].map((h, i) => <th key={h} style={{ textAlign: i ? "right" : "left", fontWeight: 500, padding: "6px 0", borderBottom: `1px solid ${C.line}` }}>{h}</th>)}</tr></thead>
                      <tbody>{life.rows.map((r) => (
                        <tr key={r.label} style={{ borderBottom: `1px solid ${C.line2}` }}>
                          <td style={{ padding: "8px 0" }}>{r.label}</td>
                          <td style={{ textAlign: "right" }}>{Number.isFinite(r.issued) ? dollars(r.issued) : <span style={{ color: C.cap }}>준비 중</span>}</td>
                          <td style={{ textAlign: "right" }}>{Number.isFinite(r.soma) ? dollars(r.soma) : <span style={{ color: C.cap }}>준비 중</span>}</td>
                          <td style={{ textAlign: "right" }}>{Number.isFinite(r.held) ? dollars(r.held) : "—"}</td>
                          <td style={{ textAlign: "right" }}>{Number.isFinite(r.dHeld) ? fmt.signedEok(r.dHeld) : "—"}</td>
                          <td style={{ textAlign: "right", color: C.body }}>{Number.isFinite(r.soma) && Number.isFinite(r.dHeld) ? signedDollars(r.soma - r.dHeld) : "—"}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </div>
              )}
            </Expander>
          </>)}
        </Section>

        {/* 05 탈은 없나 */}
        <Section id="s5" num="05" title="탈은 없나" question="돈이 모자라다는 신호가 있나">
          <H2>{S5.headline.join(" ")}</H2>
          <div style={{ display: "flex", flexDirection: "column", borderBottom: `1px solid ${C.line}` }}>{st.rows.map((r) => <GaugeRow key={r.key} r={r} />)}</div>
          {context.isError && <Cap>맥락 지표를 불러오지 못했습니다. <button className="underline" onClick={() => void context.refetch()}>다시 불러오기</button></Cap>}
        </Section>

        {/* 배경 */}
        <footer className="grid grid-cols-1 md:grid-cols-[150px_minmax(0,1fr)] gap-y-4 md:gap-x-14" style={{ padding: "48px 0 0", borderTop: `1px solid ${C.ink}` }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}><span style={{ fontSize: 14, fontWeight: 600, color: C.cap }}>배경</span><Cap>유동성 바깥의 가격과 경기</Cap></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-x-5">
              {bg.map((b) => {
                const monthlyKey = b.key === "indpro" || b.key === "unrate" || b.key === "pce";
                const val = b.value == null ? null : b.kind === "pct2" ? `${b.value.toFixed(2)}%` : b.kind === "pct1" ? `${b.value.toFixed(1)}%` : fmt.pct(b.value);
                return (
                  <div key={b.key} style={{ display: "flex", flexDirection: "column", gap: 4, padding: "16px 0", borderTop: `1px solid ${C.line}` }}>
                    <span style={{ fontSize: 14, color: C.cap }}>{b.label}</span>
                    {val ? <span style={{ fontSize: 20, fontWeight: 600 }}>{val}</span> : <span style={{ fontSize: 14, color: C.cap }}>준비 중</span>}
                    <span style={{ fontSize: 14, color: C.cap }}>{b.date ? (monthlyKey ? fmt.monthKo(b.date) : fmt.dateKo(b.date)) : ""}</span>
                  </div>
                );
              })}
            </div>
            <Cap style={{ lineHeight: 1.7, paddingTop: 20 }}>출처: 연준 H.4.1 · H.8, 재무부 MSPD · 입찰 결과(FiscalData), 시카고 연은, FRED. 이 페이지의 문장은 데이터에서 규칙으로 자동 생성되며 투자 판단을 담지 않습니다.</Cap>
          </div>
        </footer>
      </div>
    </div>
  );
}
