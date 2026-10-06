// 미국 유동성 B안 — 상단 문장형 리뷰와 하단 지표 해설. 작성 규칙: docs/LIQUIDITY-REVIEW-RULES.md
//   상단은 변화·수치·의미 순서로 요약하고, 하단은 계산 근거와 해설을 표시한다.
//   부호 규칙 하나: 초록 = 방출(순유동성 증가 기여) · 빨강 = 흡수. 본문 Δ는 전부 '순유동성에 준 영향' 부호.
//   잔고 기준 부호는 T계정 펼쳐보기 안에서만(머리에 명시, 중립색). 수준값에는 초록/빨강을 쓰지 않는다.
//   기존 /liquidity(베타)·/fed 는 그대로 두고 이 페이지는 /liquidity-read 에 따로 산다.
import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Sankey, Layer } from "recharts";
import { apiRequest } from "@/lib/queryClient";
import { restoreMissingNumbers } from "@shared/time-series";
import { yoyMonthly, yoyWeekly, changeFrom, nearest, netLiquidity, sumAuctionsBetween, type LiquidityContext, type LiquidityAuctions, type Obs } from "@shared/liquidity-beta";
import { howMuch, whereFrom, whereTo, whoBought, whoSankey, stress, emergencyLoans, background, pickWeeks, BUCKET_LABEL, type ReadWeek, type CmpWeeks, type Contribution, type StressRow, type Bucket } from "@shared/liquidity-read";
import { s1, s2, s3, s4, s5, rowDescription, fmt, josa, type Part } from "@shared/liquidity-sentences";
import { bondReading } from "@shared/credit/bond-reading";
import { reservesGdp } from "@shared/reserves-gdp";
import { m2Composition } from "@shared/m2-composition";
import { READ_CONFIG } from "@shared/liquidity-read-config";
import type { WeekPoint } from "@/components/fed-taccount";
import { useCreditReading, CreditSummary, CreditReadingGroup, CreditScenarioReading, creditChapterForState } from "@/components/credit/CreditReading";
import { liquidityChapters } from "@shared/liquidity-chapters";
import { readingGroups } from "@shared/credit/reading";
import { TreasuryOwnership } from "@/components/TreasuryOwnership";
import { LiquidityDashboard } from "@/components/LiquidityDashboard";
import { FundingRateChart } from "@/components/credit/FundingRateChart";
import { Tooltip as HelpTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// ── 서버 응답 형태 ──
interface TreasuryMonth { date: string; bills: number; total: number }
interface FedMatWeek { date: string; bills: number; notesBonds: number; tips: number; total: number }
interface DailyPoint { date: string; netLiq: number; sp500: number | null }
interface Overview { weeks: WeekPoint[]; daily: DailyPoint[]; treasury?: { monthly: TreasuryMonth[]; fedWeekly: FedMatWeek[] }; updatedAt: string }

// ── 색·글꼴 토큰(명세 3.4) — 이 페이지 스코프에만 ──
const C = { bg: "#F6F4EE", card: "#FFFFFF", ink: "#1A1A18", body: "#3B3934", cap: "#5F5C54", line: "#D9D5CA", line2: "#E8E5DC", n1: "#CFCABD", n2: "#E3DFD4", n3: "#BDB8AA", n4: "#7A766C", release: "#1F7A4D", absorb: "#B3402E", over: "#E9C9C2", m2: "#3E5C76", border2: "#B9B4A6" };
// 범주(잔고 항목·만기·지수) 구분용 색. 초록·빨강 계열은 쓰지 않는다 — 그 둘은 방출·흡수 판정 전용.
const HUE = { blue: "#3E5C76", sky: "#6A9BC3", ochre: "#C89B3C", purple: "#7B5EA7", brown: "#8C6A4F", slate: "#7C8A9E" };
const isDark = (hex: string) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255) < 150; }; // 어두운 배경이면 흰 글자
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
function Cap({ children, style }: { children: ReactNode; style?: React.CSSProperties }) { return <div style={{ fontSize: 13, lineHeight: 1.6, color: C.cap, ...style }}>{children}</div>; }
function Body({ children, max = 680 }: { children: ReactNode; max?: number }) { return <p style={{ fontSize: 14, lineHeight: 1.75, color: C.body, maxWidth: max, margin: 0 }}>{children}</p>; }
function Sub({ children }: { children: ReactNode }) { return <div style={{ fontSize: 14, fontWeight: 600 }}>{children}</div>; }
function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} aria-pressed={active} style={{ minHeight: 36, padding: "0 16px", fontSize: 13, fontWeight: active ? 600 : 500, color: active ? C.bg : C.ink, background: active ? C.ink : "transparent", border: `1px solid ${active ? C.ink : C.border2}`, borderRadius: 22, cursor: "pointer" }}>{children}</button>;
}
function Expander({ label, open, onToggle, children, transparent = false }: { label: string; open: boolean; onToggle: () => void; children: ReactNode; transparent?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <button type="button" onClick={onToggle} aria-expanded={open} style={{ alignSelf: "flex-start", minHeight: 36, padding: "0 4px", fontSize: 14, fontWeight: 500, color: C.ink, background: "transparent", border: "none", borderBottom: `1px solid ${C.ink}`, display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : undefined }}><path d="M3 5l4 4 4-4"></path></svg>{label}
      </button>
      {open && <div style={{ background: transparent ? "transparent" : C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: "24px 28px" }}>{children}</div>}
    </div>
  );
}
// 행 격자 — 왼쪽 여백 칸(라벨, lg 이상에서 스티키·본문에 붙여 오른쪽 정렬) + 가운데 본문 칸(최대 900px) + 오른쪽 여백 칸.
// 라벨이 본문 폭을 잡아먹지 않고, 본문은 남는 폭의 가운데에 선다. lg 미만에서는 라벨이 본문 위로 올라간다.
const ROW_GRID = "grid grid-cols-1 lg:grid-cols-[minmax(190px,1fr)_minmax(0,900px)_minmax(0,1fr)] xl:grid-cols-[minmax(220px,1fr)_minmax(0,900px)_minmax(0,1fr)] gap-y-3 lg:gap-x-8";
const STICKY_TOP = "var(--liquidity-sticky-top, 84px)";
function Row({ id, as = "section", aside, children }: { id?: string; as?: "section" | "footer"; aside: ReactNode; children: ReactNode }) {
  const Tag = as;
  return (
    <Tag id={id} className={ROW_GRID} style={{ scrollMarginTop: STICKY_TOP }}>
      <div className="border-t border-[#1A1A18] pt-7 lg:border-t-0 lg:justify-self-end lg:w-[190px] xl:w-[220px]">
        <div className="lg:sticky" style={{ top: STICKY_TOP }}>{aside}</div>
      </div>
      <div className="lg:pt-7 lg:border-t lg:border-[#1A1A18]" style={{ minWidth: 0, paddingBottom: 48, display: "flex", flexDirection: "column", gap: 28 }}>{children}</div>
    </Tag>
  );
}
function Section({ id, num, title, answer, children }: { id: string; num: string; title: string; answer: string; children: ReactNode }) {
  return (
    <Row id={id} aside={
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.cap }}>{num}</div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{title}</div>
        <div data-testid={`chapter-answer-${id}`} style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13, lineHeight: 1.85, color: C.body, marginTop: 6, wordBreak: "keep-all", textWrap: "pretty", overflowWrap: "break-word" }}>
          {answer.split(/(?<=[.!?])\s+/).filter(Boolean).map((sentence, n) => <p key={n} style={{ margin: 0 }}>{sentence}</p>)}
        </div>
      </div>
    }>{children}</Row>
  );
}
function H2({ children }: { children: ReactNode }) { return <h2 className="text-[20px] md:text-[24px]" style={{ fontFamily: SERIF, fontWeight: 700, lineHeight: 1.45, margin: 0 }}>{children}</h2>; }
interface LiquidityPiePart { label: string; value: number; color: string }
function LiquidityPie({ title, total, displayTotal = total, maxTotal, formula, parts, note, empty }: { title: string; total: number | null; displayTotal?: number | null; maxTotal: number; formula: ReactNode; parts: LiquidityPiePart[]; note: ReactNode; empty?: string }) {
  const [active, setActive] = useState<number | null>(null);
  const [formulaOpen, setFormulaOpen] = useState(false);
  const tooltipId = useId();
  const sum = parts.reduce((acc, part) => acc + part.value, 0);
  const valid = total != null && total > 0 && sum > 0 && parts.every(part => Number.isFinite(part.value) && part.value >= 0);
  useEffect(() => setActive(null), [total, sum]);
  let start = -Math.PI;
  const sectors = valid ? parts.map((part, index) => {
    const angle = part.value / sum * Math.PI * 2, end = start + angle;
    const point = (a: number) => `${150 + 140 * Math.cos(a)},${150 + 140 * Math.sin(a)}`;
    const path = angle >= Math.PI * 2 - 1e-8
      ? "M 10,150 A 140,140 0 1 1 290,150 A 140,140 0 1 1 10,150 Z"
      : `M 150,150 L ${point(start)} A 140,140 0 ${angle > Math.PI ? 1 : 0} 1 ${point(end)} Z`;
    start = end;
    return { ...part, index, path };
  }).filter(part => part.value > 0) : [];
  const selected = active == null ? null : sectors.find(part => part.index === active);
  return <div style={{ display: "grid", gridTemplateRows: "subgrid", gridRow: "span 3", minWidth: 0 }}>
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 15, fontWeight: 500 }}>{title}
        <TooltipProvider delayDuration={150}>
          <HelpTooltip open={formulaOpen} onOpenChange={setFormulaOpen}>
            <TooltipTrigger asChild>
              <button type="button" aria-label={`${title} 계산식`} onClick={() => setFormulaOpen(true)} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, padding: 0, borderRadius: "50%", border: `1px solid ${C.border2}`, background: "transparent", color: C.cap, fontSize: 12, cursor: "help" }}>?</button>
            </TooltipTrigger>
            <TooltipContent side="top" align="start" collisionPadding={16} style={{ maxWidth: "min(360px, calc(100vw - 32px))", background: C.card, color: C.body, borderColor: C.line, fontFamily: SANS, fontSize: 13, lineHeight: 1.75, wordBreak: "keep-all" }}>{formula}</TooltipContent>
          </HelpTooltip>
        </TooltipProvider>
      </div>
      <H2>{displayTotal != null ? `${fmt.jo(displayTotal)}조 달러` : "—"}</H2>
    </div>
    <div onPointerLeave={event => { if (event.pointerType !== "touch") setActive(null); }} style={{ position: "relative", width: "100%", maxWidth: 300, aspectRatio: "1", justifySelf: "center", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {valid ? <svg viewBox="0 0 300 300" role="group" aria-label={`${title} 구성비`} style={{ width: `${Math.sqrt(total! / maxTotal) * 100}%`, overflow: "visible" }}>
        <style>{`.liquidity-pie-sector { transition: transform 150ms ease, filter 150ms ease; } @media (prefers-reduced-motion: reduce) { .liquidity-pie-sector { transition: none; } }`}</style>
        {/* 시각 효과와 고정된 입력 영역을 분리해 확대 중 경계에서 깜빡이지 않게 한다. */}
        {[...sectors.filter(part => part.index !== active), ...sectors.filter(part => part.index === active)].map(part => <path key={part.label} d={part.path} fill={part.color} className="liquidity-pie-sector" aria-hidden="true" pointerEvents="none"
          style={{ transformOrigin: "150px 150px", transform: part.index === active ? "scale(1.035)" : "scale(1)", filter: part.index === active ? `drop-shadow(0 0 6px ${part.color}66)` : "none" }} />)}
        {sectors.map(part => <path key={part.label} d={part.path} fill="transparent" role="button" tabIndex={0}
          aria-label={`${part.label} ${dollars(part.value)} · ${(part.value / sum * 100).toFixed(1)}%`} aria-describedby={part.index === active ? tooltipId : undefined}
          onPointerEnter={event => { if (event.pointerType !== "touch") setActive(part.index); }}
          onPointerDown={event => { if (event.pointerType === "touch") setActive(value => value === part.index ? null : part.index); }}
          onFocus={() => setActive(part.index)} onBlur={() => setActive(null)}
          onKeyDown={event => { if (event.key === "Escape") setActive(null); else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setActive(value => value === part.index ? null : part.index); } }}
          style={{ cursor: "pointer" }} />)}
      </svg> : <Cap>{empty ?? "구성 자료가 없어 파이를 표시하지 않았습니다."}</Cap>}
      {selected && <div id={tooltipId} role="tooltip" style={{ position: "absolute", bottom: 4, left: "50%", transform: "translateX(-50%)", maxWidth: "100%", width: "max-content", pointerEvents: "none", zIndex: 2, background: C.card, border: `1px solid ${C.line}`, boxShadow: "0 4px 16px #1A1A1814", borderRadius: 8, padding: "10px 14px", fontSize: 13, lineHeight: 1.6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 600 }}><span style={{ width: 9, height: 9, background: selected.color, borderRadius: 2, flexShrink: 0 }} />{selected.label}</div>
        <div>{dollars(selected.value)} <span style={{ color: C.cap, marginLeft: 8 }}>{(selected.value / sum * 100).toFixed(1)}%</span></div>
      </div>}
    </div>
    <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 14, alignSelf: "start" }}>
      {valid && <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {parts.map(part => <div key={part.label} style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "3px 10px", fontSize: 13, color: C.body }}>
          <span style={{ display: "flex", alignItems: "center", gap: 7, flex: "1 1 auto" }}><span aria-hidden="true" style={{ width: 9, height: 9, flexShrink: 0, borderRadius: 2, background: part.color }} />{part.label}</span>
          <span style={{ whiteSpace: "nowrap" }}>{dollars(part.value)} <span style={{ color: C.cap, marginLeft: 5 }}>{(part.value / sum * 100).toFixed(1)}%</span></span>
        </div>)}
      </div>}
      <Cap style={{ fontSize: 12, color: "#918D83", marginTop: 12 }}>{note}</Cap>
    </div>
  </div>;
}
// 그림 C 기저효과 표식 — 글을 선 위에 쓰면 겹치므로 번호만 찍고 설명은 아래 목록에 둔다. 이웃한 표식은 두 줄로 어긋나게.
function NoteMarker({ x, y, n, row }: { x: number; y: number; n: number; row: number }) {
  return (
    <g transform={`translate(${x},${y - 10 - row * 22})`}>
      <circle r={9} fill={C.card} stroke={C.ink} strokeWidth={1.2} />
      <text textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={600} fill={C.ink} fontFamily={SANS}>{n}</text>
    </g>
  );
}

// 기여 막대: 02는 중앙 0축·좌우 동일 축척, 03은 기존 범위 맞춤 축척.
function ContribBars({ rows, N, centered = false }: { rows: { name: string; desc: string; value: number; total?: boolean }[]; N: number; centered?: boolean }) {
  const maxNeg = Math.max(0, ...rows.map((r) => -Math.min(0, r.value))), maxPos = Math.max(0, ...rows.map((r) => Math.max(0, r.value)));
  const span = (centered ? 2 * Math.max(maxNeg, maxPos) : maxNeg + maxPos) || 1, zero = centered ? 50 : (maxNeg / span) * 100;
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <Cap style={{ paddingBottom: 10 }}>유동성에 준 영향 · {N}주 · <span style={{ color: C.release }}>초록 = 방출(시중에 풀림)</span> · <span style={{ color: C.absorb }}>빨강 = 흡수(시중에서 빠짐)</span></Cap>
      {rows.map((r) => {
        const w = (Math.abs(r.value) / span) * 100, color = r.total && !centered ? C.ink : fmt.isZeroEok(r.value) ? C.n3 : r.value > 0 ? C.release : C.absorb; // '0억'으로 표시되는 값은 중립
        return (
          <div key={r.name} className="grid grid-cols-[1fr_auto] md:grid-cols-[240px_minmax(0,1fr)_80px] gap-x-4 gap-y-2 items-center" style={{ padding: "16px 0", borderTop: r.total ? `2px solid ${C.ink}` : `1px solid ${C.line}` }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}><span style={{ fontSize: 15, fontWeight: 600 }}>{r.name}</span>{r.desc && <Cap style={{ lineHeight: 1.65, whiteSpace: "pre-line" }}>{r.desc}</Cap>}</div>
            <div className="col-span-2 md:col-span-1" style={{ position: "relative", height: 40 }}>
              <div style={{ position: "absolute", left: `${zero}%`, top: 0, width: 1, height: 40, borderLeft: centered ? `1px dashed ${C.cap}` : undefined, background: centered ? undefined : C.ink, zIndex: 1 }} />
              <div style={{ position: "absolute", left: r.value >= 0 ? `${zero}%` : `${zero - w}%`, top: 4, width: `${w}%`, height: 32, background: color, borderRadius: r.value >= 0 ? "0 6px 6px 0" : "6px 0 0 6px" }} />
            </div>
            <div className="text-left md:text-right" style={{ fontSize: 17, fontWeight: 600, color, whiteSpace: "nowrap" }}>{fmt.signedEok(r.value)}</div>
          </div>
        );
      })}
    </div>
  );
}

// 02 펼쳐보기 — T계정. 잔고 기준. 항목 구분은 초록·빨강이 아닌 색(HUE)으로 하고, 얇은 띠는 안에 글자를 못 넣으므로 옆 표의 스와치가 라벨을 맡는다(Codex F2).
// 자산: 국채·MBS·기관채·대출스왑·기타 / 부채: 지급준비금·역레포·TGA·현금통화·기타 — TGA·역레포는 01 그림 A 와 같은 색
const ASSET_HUES = [HUE.blue, HUE.sky, HUE.slate, HUE.brown, HUE.ochre];
const LIAB_HUES = [HUE.blue, HUE.purple, HUE.ochre, HUE.sky, HUE.slate];
interface TRow { label: string; side: "asset" | "liab"; color: string; v: number; p: number }
const liveLoans = (w: WeekPoint) => w.discount + w.repo + w.swap + (Number.isFinite(w.btfp) ? w.btfp : 0);
function taccountRows(sel: WeekPoint, prev: WeekPoint): TRow[] {
  const a = (label: string, i: number, v: number, p: number): TRow => ({ label, side: "asset", color: ASSET_HUES[i], v, p });
  const l = (label: string, i: number, v: number, p: number): TRow => ({ label, side: "liab", color: LIAB_HUES[i], v, p });
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
        const dark = isDark(r.color);
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
        <span style={{ fontSize: 15, fontWeight: 600, color: has ? C.ink : C.cap }}>{r.name}</span>
        <Cap style={{ lineHeight: 1.5 }}>{r.desc}{r.note ? ` · ${r.note}` : ""}</Cap>
      </div>
      {!has ? (
        <Cap>준비 중 — 데이터 연결 후 표시됩니다</Cap>
      ) : tPos == null ? (
        <Cap>판정 기준 미설정</Cap>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ position: "relative", height: 24 }}>
            <div style={{ position: "absolute", left: 0, top: 9, width: `${tPos * 100}%`, height: 6, background: C.n2, borderRadius: "3px 0 0 3px" }} />
            <div style={{ position: "absolute", left: `${tPos * 100}%`, top: 9, width: `${(1 - tPos) * 100}%`, height: 6, background: C.over, borderRadius: "0 3px 3px 0" }} />
            <div style={{ position: "absolute", left: `${tPos * 100}%`, top: 0, width: 2, height: 24, background: C.ink }} />
            <div style={{ position: "absolute", left: `${pos * 100}%`, top: 3, width: 18, height: 18, borderRadius: 9, background: r.breached ? C.absorb : C.release, marginLeft: -9 }} title={r.breached ? "경계선 위" : "경계선 아래"} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: C.cap }}><span>{fmtEdge(r.min)}</span><span>경계 {fmtT}</span><span>{fmtEdge(r.max)}</span></div>
        </div>
      )}
      {has && <div className="text-left md:text-right" style={{ display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontSize: 17, fontWeight: 600 }}>{fmtVal}{(val! < r.min || val! > r.max) && tPos != null ? " (눈금 밖)" : ""}</span><span style={{ fontSize: 13, color: C.cap }}>{r.date ? fmt.dateKo(r.date) : ""}</span></div>}
    </div>
  );
}

// 04 생키 — 띠와 만기 노드는 만기 묶음 색(HUE), 입찰자 노드는 먹색. 최소 굵기 2px.
const BUCKET_FILL: Record<Bucket, string> = { bills: HUE.sky, nb: HUE.blue, tips: HUE.ochre };
function ReadSankeyNode(props: any) {
  const { x, y, width, height, index, payload } = props;
  const left = payload.side === "bucket";
  return (
    <Layer key={`n${index}`}>
      <rect x={x} y={y} width={width} height={Math.max(height, 2)} fill={left ? (BUCKET_FILL[payload.key as Bucket] ?? C.ink) : C.ink} />
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
  return <path key={`l${index}`} d={d} fill={fill} fillOpacity={0.5} stroke="none" />;
}

export default function LiquidityRead() {
  const [headerNode, setHeaderNode] = useState<HTMLElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState(64);
  useLayoutEffect(() => {
    if (!headerNode) return;
    const sticky = window.matchMedia("(min-width: 768px)");
    const measure = () => setHeaderHeight(sticky.matches ? Math.ceil(headerNode.getBoundingClientRect().height) : 0);
    // 버튼 줄바꿈·화면 폭·글꼴 로딩으로 달라지는 상단 바의 실제 높이를 따른다.
    const observer = new ResizeObserver(measure);
    observer.observe(headerNode);
    sticky.addEventListener("change", measure);
    measure();
    return () => { observer.disconnect(); sticky.removeEventListener("change", measure); };
  }, [headerNode]);
  useEffect(() => { // 이 페이지 스코프의 글꼴만 추가로 로드
    if (document.querySelector(`link[href="${FONT_HREF}"]`)) return;
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = FONT_HREF; document.head.appendChild(l);
  }, []);
  const overview = useQuery<Overview>({ queryKey: ["/api/fed/overview"], queryFn: async () => restoreMissingNumbers<Overview>(await apiRequest("GET", "/api/fed/overview").then((r) => r.json())) });
  const context = useQuery<LiquidityContext>({ queryKey: ["/api/liquidity/context"], queryFn: async () => apiRequest("GET", "/api/liquidity/context").then((r) => r.json()), staleTime: 6 * 60 * 60 * 1000 });
  const [auctionMode, setAuctionMode] = useState<"all" | "nobills">("all");

  const [idx, setIdx] = useState(-1);
  const [cmp, setCmp] = useState<CmpWeeks>(4);
  const months = cmp === 4 ? 1 : 3;
  const [range, setRange] = useState<"5y" | "2y">("5y");
  const [sp, setSp] = useState(false);
  const [openT, setOpenT] = useState(false);
  const [openM, setOpenM] = useState(false);
  const [openComparison, setOpenComparison] = useState(false);
  const cfg = READ_CONFIG;

  const weeks: ReadWeek[] = overview.data?.weeks ?? [];
  const curIdx = idx < 0 ? weeks.length - 1 : Math.min(idx, weeks.length - 1);
  const selDate = weeks.length ? weeks[curIdx].date : "";
  const credit = useCreditReading(selDate);
  const auctions = useQuery<LiquidityAuctions>({ queryKey: ["/api/liquidity/auctions", cmp, 0, selDate], enabled: !!selDate, queryFn: async () => apiRequest("GET", `/api/liquidity/auctions?months=${months}&weeks=${cmp}&asOf=${selDate}`).then((r) => r.json()), staleTime: 6 * 60 * 60 * 1000 });
  const auctionsPrev = useQuery<LiquidityAuctions>({ queryKey: ["/api/liquidity/auctions", cmp, 1, selDate], enabled: !!selDate, queryFn: async () => apiRequest("GET", `/api/liquidity/auctions?months=${months}&weeks=${cmp}&offset=1&asOf=${selDate}`).then((r) => r.json()), staleTime: 6 * 60 * 60 * 1000 });
  const debt = useQuery<import("@shared/treasury-flow").TreasuryFlowResponse>({ queryKey: ["/api/liquidity/treasury-flow", cmp, selDate], enabled: !!selDate, queryFn: async () => apiRequest("GET", `/api/liquidity/treasury-flow?weeks=${cmp}&asOf=${selDate}`).then(r => r.json()), staleTime: 6 * 60 * 60 * 1000 });
  const { sel, prev } = useMemo(() => pickWeeks(weeks, selDate, cmp), [weeks, selDate, cmp]);
  const ctx = useMemo(() => Object.fromEntries(Object.entries(context.data?.series ?? {}).map(([key, points]) => [key, points.filter(p => p.date <= selDate)])) as LiquidityContext["series"], [context.data, selDate]);
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
  const overviewWho = agg ? whoBought(agg, prevAgg, [], [], false) : null;
  const sank = who ? whoSankey(who) : null;
  const latestWeek = weeks.length ? weeks[weeks.length - 1] : null;
  const st = stress(ctx.sofr ?? [], ctx.iorb ?? [], ctx.nfci ?? [], ctx.hy ?? [], sel ? { ...emergencyLoans(sel), date: sel.date } : null, cfg);
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
  const chartNotes = yoyData.notes.filter((n) => chartRows.some((r) => r.date === n.date)); // 그림 C 에 실제로 있는 주만
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

  const m2Now = how?.m2Yoy?.to ?? (sel && ctx.m2 ? [...ctx.m2].reverse().find((o) => o.date <= sel.date) ?? null : null); // 선택 주 이하 최신 M2 — 전년비가 없어도 잔액은 보인다(Codex 4차 F1)

  const m2Parts = m2Composition(ctx, m2Now);
  const reserveRatio = sel ? reservesGdp(sel.reserves, sel.date, ctx.gdp ?? []) : null;
  const chapters = liquidityChapters(how, from, to, who, st, cmp);

  return (
    <div style={{ "--liquidity-sticky-top": `${headerHeight + 20}px`, background: C.bg, color: C.ink, fontFamily: SANS, minHeight: "100vh", fontVariantNumeric: "tabular-nums", wordBreak: "keep-all" } as React.CSSProperties}>
      <div className="px-4 md:px-10" style={{ maxWidth: 1280 + 80, margin: "0 auto", paddingTop: 24, paddingBottom: 96 }}>

        {/* 머리띠 — md 이상에서 스크롤을 따라오는 스티키. 배경을 깔아 본문이 비치지 않게 한다. */}
        <header ref={setHeaderNode} className="md:sticky md:top-0 z-20 flex flex-col md:flex-row md:items-center md:justify-between gap-3" style={{ background: C.bg, padding: "12px 0", marginBottom: 20, borderBottom: `1px solid ${C.line}` }}>
          <div className="flex flex-col md:flex-row md:items-baseline gap-1 md:gap-4" style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", color: C.cap, whiteSpace: "nowrap" }}>미국 유동성 B안 · 주간</div>
            <h1 style={{ fontFamily: SERIF, fontSize: 20, fontWeight: 700, lineHeight: 1.3, margin: 0, whiteSpace: "nowrap" }}>{fmt.weekTitle(selW.date)}</h1>
            <Cap>{fmt.dateKo(selW.date)} 기준 · 유동성 주간 / 신용 지표별 주기</Cap>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setIdx(Math.max(0, curIdx - 1))} disabled={curIdx <= 0} aria-label="이전 주" style={{ minHeight: 36, minWidth: 36, border: `1px solid ${C.border2}`, borderRadius: 22, background: "transparent", color: C.ink, opacity: curIdx <= 0 ? 0.3 : 1, cursor: "pointer" }}>◀</button>
            <button type="button" onClick={() => setIdx(Math.min(weeks.length - 1, curIdx + 1))} disabled={curIdx >= weeks.length - 1} aria-label="다음 주" style={{ minHeight: 36, minWidth: 36, border: `1px solid ${C.border2}`, borderRadius: 22, background: "transparent", color: C.ink, opacity: curIdx >= weeks.length - 1 ? 0.3 : 1, cursor: "pointer" }}>▶</button>
            {curIdx < weeks.length - 1 && <Pill active={false} onClick={() => setIdx(-1)}>이번 주로</Pill>}
            <span style={{ fontSize: 13, color: C.cap, paddingLeft: 8 }}>비교 기준</span>
            <Pill active={cmp === 4} onClick={() => setCmp(4)}>1달(4주 전)</Pill>
            <Pill active={cmp === 13} onClick={() => setCmp(13)}>1분기(13주 전)</Pill>
          </div>
        </header>

        {/* 요약 — 본문 칸과 같은 격자에 놓아 가운데 정렬 */}
        <div className={ROW_GRID}>
        <div className="lg:justify-self-end lg:w-[190px] xl:w-[220px] lg:pt-6"><div className="lg:sticky" style={{ top: STICKY_TOP }}>
          <h2 className="text-base font-semibold">개요</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-[#918D83]">각 항목의 근거와 데이터는 아래에서 확인</p>
        </div></div>
        <div style={{ minWidth: 0 }}>
        <LiquidityDashboard how={how} from={from} to={to} who={overviewWho} flow={debt.data?.flow ?? null} flowLoading={debt.isLoading} flowError={debt.data?.error ?? (debt.isError ? "국채 자료 조회 실패" : null)} stress={st} riskHeadline={credit.query.isLoading ? "신용 자료를 확인하고 있습니다." : credit.query.isError || credit.query.data?.error || credit.query.data?.configChanged ? "선택 시점의 신용 상태를 확인하지 못했습니다." : bondReading(credit.data, credit.outcome).overview} alerts={<CreditSummary state={credit} weeks={cmp} />} />
        </div></div>

        {/* 01 얼마나 */}
        <Section id="s1" num="01" title="얼마나" answer={chapters.s1}>
          {!how || !S1 ? <Cap>이번 주 관측이 없습니다.</Cap> : (<>
            <H2>순유동성과 M2</H2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-9 gap-y-5">
              <LiquidityPie title="순유동성" total={how.total} displayTotal={how.nl} maxTotal={Math.max(how.total, m2Now?.value ?? 0)}
                formula={<>순유동성(근사치) = 연준이 만든 돈 {fmt.jo(how.total)}조 달러 − TGA ({dollars(how.tga)}) − 역레포 ({dollars(how.rrp)})</>}
                parts={[{ label: "순유동성", value: how.nl, color: C.ink }, { label: "TGA", value: how.tga, color: HUE.ochre }, { label: "역레포", value: how.rrp, color: HUE.purple }]}
                note={<>원 전체: 연준 자산 · 검은 부분: 순유동성</>} />
              <LiquidityPie title="M2" total={m2Now?.value ?? null} maxTotal={Math.max(how.total, m2Now?.value ?? 0)}
                formula={<>M2 = 현금 + 요구불예금 + 저축·기타 유동성예금 + 소액 정기예금 + 개인 MMF</>}
                parts={m2Parts?.parts.map((part, i) => ({ label: part.label, value: part.value, color: [HUE.blue, HUE.sky, HUE.slate, HUE.ochre, HUE.purple][i] })) ?? []}
                empty={context.isFetching ? "M2 구성 자료를 불러오는 중…" : "같은 기준월의 구성 자료가 완전하지 않아 구성비를 표시하지 않았습니다."}
                note={<>{m2Now ? `${m2Now.date.slice(0, 4)}년 ${fmt.monthKo(m2Now.date)} · ` : ""}월간 · 정기예금·개인 MMF는 은퇴계좌 제외</>} />
            </div>

            <Expander label={`순유동성·M2 증감률 비교 ${openComparison ? "접기" : "펼치기"}`} open={openComparison} onToggle={() => setOpenComparison(v => !v)}>
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
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
                  <LineChart data={chartRows} margin={{ top: 56, right: sp ? 8 : 16, left: 0, bottom: 0 }}>
                    <XAxis dataKey="date" ticks={chartTicks} tickFormatter={(d) => String(d).slice(0, 4)} tick={{ fontSize: 13, fill: C.cap }} axisLine={false} tickLine={{ stroke: C.border2 }} />
                    <YAxis yAxisId="left" tickFormatter={(v) => `${v}%`} tick={{ fontSize: 13, fill: C.cap }} axisLine={false} tickLine={false} width={48} />
                    {sp && <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${v}%`} tick={{ fontSize: 13, fill: HUE.ochre }} axisLine={false} tickLine={false} width={48} />}
                    <Tooltip contentStyle={{ fontSize: 13, borderRadius: 8, fontFamily: SANS }} formatter={(v: any, n: any) => [Number.isFinite(v) ? fmt.pct(v) : "—", n]} labelFormatter={(l) => fmt.dateKo(String(l))} />
                    <ReferenceLine yAxisId="left" y={0} stroke={C.ink} />
                    <ReferenceLine yAxisId="left" x={how.date} stroke={C.cap} strokeDasharray="3 3" />
                    {chartNotes.map((n, i) => <ReferenceLine key={n.date} yAxisId="left" x={n.date} stroke={C.cap} strokeDasharray="2 3" label={(p: any) => <NoteMarker x={p.viewBox.x} y={p.viewBox.y} n={i + 1} row={i % 2} />} />)}
                    <Line yAxisId="left" dataKey="m2" name="M2" stroke={C.m2} strokeWidth={2.5} strokeDasharray="7 5" dot={false} isAnimationActive={false} connectNulls={false} />
                    <Line yAxisId="left" dataKey="nl" name="순유동성" stroke={C.ink} strokeWidth={2.5} dot={false} isAnimationActive={false} connectNulls={false} />
                    {sp && <Line yAxisId="right" dataKey="sp" name="S&P 500" stroke={HUE.ochre} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} />}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {chartNotes.length > 0 && <Cap style={{ display: "flex", flexWrap: "wrap", gap: "4px 18px" }}>{chartNotes.map((n, i) => <span key={n.date}><b style={{ color: C.ink }}>{i + 1}</b> {n.date.slice(0, 4)}년 {fmt.monthKo(n.date)} — {n.text}</span>)}</Cap>}
              {sp && yoyData.spLast && <Cap>S&amp;P 500 은 일간 자료가 {fmt.dateKo(yoyData.spLast)}까지 있어 그 뒤는 비어 있습니다.</Cap>}
              {S1.m2note && <Body>{S1.m2note}</Body>}
            </div>
            </Expander>
          </>)}
        </Section>

        {/* 02 어디서 */}
        <Section id="s2" num="02" title="어디서" answer={chapters.s2}>
          {!from || !S2 || !sel || !prev ? <Cap>{noPrevBlock}</Cap> : (<>
            <H2>{!Number.isFinite(from.dNl) || fmt.isZeroEok(from.dNl) ? "유동성 증감을 항목별로 보면" : <>{from.dNl > 0 ? "풀린" : "흡수된"} <span style={{ color: from.dNl > 0 ? C.release : C.absorb }}>{fmt.eok(from.dNl)}억 달러</span>를 분해해보면</>}</H2>
            <ContribBars N={cmp} centered rows={[
              ...from.ranked.map((c: Contribution) => ({ name: c.key === "tga" ? "재무부" : c.key === "rrp" ? "역레포" : "연준", desc: rowDescription(c, from.fedDetail) + (c.key === "tga" ? `\nTGA 잔액 ${fmt.eok(prev.tga)}억 → ${fmt.eok(sel.tga)}억` : c.key === "rrp" ? `\n역레포 잔액 ${fmt.eok(prev.rrp)}억 → ${fmt.eok(sel.rrp)}억` : ""), value: c.effect })),
              { name: "합계", desc: "", value: from.dNl, total: true },
            ]} />
            <Expander label="연준 대차대조표(T계정) 전체 펼치기" open={openT} onToggle={() => setOpenT((v) => !v)}>
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                <Cap>잔고 증감 기준 · 부채 항목 감소 = 유동성 증가</Cap>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" style={{ minWidth: 0 }}>
                  <NeutralTAccount rows={taccountRows(sel as WeekPoint, prev as WeekPoint)} total={sel.total} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, minWidth: 0 }}>
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
        <Section id="s3" num="03" title="어디로" answer={chapters.s3}>
          {!to || !S3 ? <Cap>{noPrevBlock}</Cap> : (<>
            <H2><Parts parts={S3.headline} /></H2>
            {to.sameSign ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", gap: 3, height: 64 }}>
                  <div style={{ width: `${(Math.abs(to.dReserves) / (Math.abs(to.dReserves) + Math.abs(to.dOther) || 1)) * 100}%`, background: to.dReserves >= 0 ? C.release : C.absorb, color: "#FFFFFF", borderRadius: "8px 0 0 8px", padding: "0 18px", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "space-between", minWidth: 0, gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>은행 지급준비금</span><span style={{ fontSize: 17, fontWeight: 600, whiteSpace: "nowrap" }}>{fmt.signedEok(to.dReserves)}</span>
                  </div>
                  <div style={{ flexGrow: 1, background: C.n1, borderRadius: "0 8px 8px 0" }} />
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", fontSize: 13, color: C.body }}>현금통화·기타 {fmt.signedEok(to.dOther)}</div>
              </div>
            ) : (
              <ContribBars N={cmp} rows={[{ name: "은행 지급준비금", desc: "", value: to.dReserves }, { name: "현금통화·기타", desc: "", value: to.dOther }, { name: "합계", desc: "", value: to.dNl, total: true }]} />
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Body>현재 은행 지급준비금은 {fmt.jo(to.reserves)}조 달러{reserveRatio ? `로, 명목 GDP의 ${reserveRatio.pct.toFixed(1)}%입니다.` : "입니다."}</Body>
              <Cap style={{ color: "#918D83" }}>{reserveRatio ? `지준 ${sel?.date} · GDP ${reserveRatio.quarter} (계절조정·연율). 관측 기간 기준·사후 수정치 포함.` : context.isFetching ? "GDP 대비 비율을 불러오는 중입니다." : "비교 가능한 GDP 자료가 없어 비율을 표시하지 않았습니다."}</Cap>
              <Cap style={{ color: "#918D83" }}>GDP 대비 약 9%는 월러 연준 이사가 제시한 지준의 참고 수준이며, 공식 안전선은 아닙니다. <a href="https://www.federalreserve.gov/newsevents/speech/waller20250710a.htm" target="_blank" rel="noreferrer" className="underline underline-offset-2">2025년 7월 발언</a></Cap>
            </div>
            {to.zone && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <Sub>지금 지급준비금 {dollars(to.reserves)}는 넉넉한 수준인가</Sub>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ position: "relative", height: 44 }}>
                    <div style={{ position: "absolute", left: 0, top: 16, width: "100%", height: 12, display: "flex", gap: 3 }}><div style={{ width: "30%", background: C.absorb, borderRadius: "6px 0 0 6px" }} /><div style={{ width: "25%", background: C.n1 }} /><div style={{ flexGrow: 1, background: C.release, borderRadius: "0 6px 6px 0" }} /></div>
                    <div style={{ position: "absolute", left: `${to.zone.pos * 100}%`, top: 9, width: 26, height: 26, marginLeft: -13, borderRadius: 13, background: C.ink, border: `3px solid ${C.bg}`, boxSizing: "border-box" }} />
                  </div>
                  <div style={{ display: "flex", fontSize: 13, color: C.cap }}><span style={{ width: "30%" }}>빠듯 · 금리가 튀기 쉬움</span><span style={{ width: "25%" }}>경계 {to.zone.unit === "gdp_pct" ? `${to.zone.tight}~${to.zone.ample}%` : `${dollars(to.zone.tight)}~${dollars(to.zone.ample)}`}</span><span style={{ flexGrow: 1, textAlign: "right" }}>넉넉</span></div>
                </div>
              </div>
            )}
          </>)}
        </Section>

        {/* 04 누가 샀나 */}
        <Section id="s4" num="04" title="누가 샀나" answer={chapters.s4}>
          {auctions.isLoading ? <Cap>불러오는 중…</Cap> : !who || !S4 || !sank ? (
            <Cap>준비 중 — 입찰 자료를 불러오지 못했습니다{auctions.data?.errors.auctions ? ` (${auctions.data.errors.auctions})` : ""}. <button className="underline" onClick={() => void auctions.refetch()}>다시 불러오기</button></Cap>
          ) : (<>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <Cap>{fmt.dateKo(who.start)} ~ {fmt.dateKo(who.end)} 결제분 · 입찰 {who.counted}건{who.excludeBills ? " · 단기채 제외" : ""}</Cap>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Pill active={auctionMode === "all"} onClick={() => setAuctionMode("all")}>전체</Pill>
                  <Pill active={auctionMode === "nobills"} onClick={() => setAuctionMode("nobills")}>단기채 빼고 보기</Pill>
                  <Cap>상단 기준 · 최근 {cmp}주</Cap>
                </div>
              </div>
              <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: "24px 12px", overflowX: "auto" }}>
                <div style={{ minWidth: 640, height: 360 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <Sankey data={sank} nodeWidth={14} nodePadding={22} linkCurvature={0.5} iterations={32} margin={{ top: 24, right: 200, bottom: 8, left: 210 }} node={<ReadSankeyNode />} link={<ReadSankeyLink />} />
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
            <p data-testid="treasury-issuance-note" style={{ margin: 0, fontSize: 12, lineHeight: 1.7, color: "#918D83" }}>
              참고 · {S4?.caution}. 단기채는 만기가 돌아오면 다시 발행하므로 발행액에는 기존 빚을 갈아 끼운 물량이 포함됩니다. {debt.data?.flow ? <>같은 {cmp}주간 전체 시장성 국채 순증감은 {fmt.signedAmount(debt.data.flow.net)} 달러, 단기채 순증감은 {fmt.signedAmount(debt.data.flow.billsNet)} 달러입니다. 재무부 일일 발행·상환 및 물가 조정 기준입니다.</> : "선택 기간의 순증감 자료를 확인 중입니다."}
            </p>
            <Expander transparent label="만기별 표 펼치기 — 발행 · 연준 인수 · 연준 보유 변화 · 만기상환" open={openM} onToggle={() => setOpenM((v) => !v)}>
              {!life ? <Cap>준비 중 — 입찰 창 안에 보유 관측이 두 개 이상 없어 표를 만들 수 없습니다</Cap> : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <Cap>발행·연준 인수·보유 변화 모두 H.4.1 보유 관측 구간 {fmt.dateKo(life.from)} → {fmt.dateKo(life.to)} 기준. 발행은 보고 총액, 만기상환은 인수 − 보유 변화의 추정치(음수면 입찰 인수보다 보유가 더 늘어난 것).</Cap>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", minWidth: 560, fontSize: 13, borderCollapse: "collapse" }}>
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

        <Row id="treasury-holders" aside={<div className="flex flex-col gap-1"><div style={{ fontSize: 16, fontWeight: 600 }}>누가 들고 있나</div><Cap>국채 보유 주체와<br />스테이블코인 발행사</Cap></div>}>
          <TreasuryOwnership asOf={selDate} />
        </Row>

        {/* 05 탈은 없나 */}
        <Section id="s5" num="05" title="탈은 없나" answer={context.isLoading ? "자금시장 자료를 확인하고 있습니다." : context.isError ? "자금시장 자료를 불러오지 못했습니다." : chapters.s5}>
          <H2>{S5.headline.join(" ")}</H2>
          <div style={{ display: "flex", flexDirection: "column", borderBottom: `1px solid ${C.line}` }}>{st.rows.map((r) => <GaugeRow key={r.key} r={r} />)}</div>
          <FundingRateChart sofr={ctx.sofr ?? []} iorb={ctx.iorb ?? []} asOf={selDate} weeks={cmp} />
          <button type="button" onClick={() => document.getElementById("read-hy_oas")?.scrollIntoView({ behavior: "smooth", block: "start" })} className="underline text-left" style={{ fontSize: 13, color: C.cap }}>HY 시장금리·위험 프리미엄의 상세 그래프로 이동 ↓</button>
          {context.isError && <Cap>맥락 지표를 불러오지 못했습니다. <button className="underline" onClick={() => void context.refetch()}>다시 불러오기</button></Cap>}
        </Section>

        {readingGroups.map((group, n) => <Section key={group.id} id={group.id} num={String(n + 6).padStart(2, "0")} title={group.title} answer={creditChapterForState(group.id, credit, cmp).text}>
          <CreditReadingGroup group={group} state={credit} weeks={cmp} />
        </Section>)}
        <Section id="credit-scenarios" num="10" title="함께 읽으면" answer={creditChapterForState("credit-scenarios", credit, cmp).text}>
          <CreditScenarioReading state={credit} />
          <Cap>과거 조회: 관측일 기준 · 사후 공시·수정치 포함. 신용 조건 판정: 고정된 4주·13주 규칙. 그래프 비교: 상단 선택 기간.</Cap>
        </Section>

        {/* 배경 */}
        <Row as="footer" aside={<div style={{ display: "flex", flexDirection: "column", gap: 6 }}><span style={{ fontSize: 16, fontWeight: 600 }}>배경</span><Cap>유동성 바깥의 가격과 경기</Cap></div>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-x-5">
              {bg.map((b) => {
                const monthlyKey = b.key === "indpro" || b.key === "unrate" || b.key === "pce";
                const val = b.value == null ? null : b.kind === "pct2" ? `${b.value.toFixed(2)}%` : b.kind === "pct1" ? `${b.value.toFixed(1)}%` : fmt.pct(b.value);
                return (
                  <div key={b.key} style={{ display: "flex", flexDirection: "column", gap: 4, padding: "16px 0", borderTop: `1px solid ${C.line}` }}>
                    <span style={{ fontSize: 13, color: C.cap }}>{b.label}</span>
                    {val ? <span style={{ fontSize: 17, fontWeight: 600 }}>{val}</span> : <span style={{ fontSize: 13, color: C.cap }}>준비 중</span>}
                    <span style={{ fontSize: 13, color: C.cap }}>{b.date ? (monthlyKey ? fmt.monthKo(b.date) : fmt.dateKo(b.date)) : ""}</span>
                  </div>
                );
              })}
            </div>
            <Cap style={{ lineHeight: 1.7, paddingTop: 20 }}>출처: 연준 H.4.1 · H.8, 재무부 MSPD · 입찰 결과(FiscalData), 시카고 연은, FRED.</Cap>
          </div>
        </Row>
      </div>
    </div>
  );
}
