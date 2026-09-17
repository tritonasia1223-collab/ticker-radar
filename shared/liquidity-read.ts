// 미국 유동성(읽기) — 계산 계층. 화면에 나가는 모든 값은 자기 기준일을 들고 다니고, 결측은 null/NaN 이며 0 으로 메우지 않는다.
// 부호 규칙 하나: 본문의 모든 Δ는 '순유동성에 준 영향'(방출 +, 흡수 −). 잔고 기준 부호는 T계정 펼쳐보기 안에서만.
// 항등식(검산 완료, shared/liquidity-beta 재사용):
//   순유동성 NL = 총자산 − TGA − 역레포 · ΔNL = Δ자산 − ΔTGA − Δ역레포 · Δ지급준비금 = ΔNL − Δ현금통화 − Δ기타
import { weeksBefore } from "./time-series.js";
import {
  atOrBefore, yoyMonthly, yoyWeekly, changeFrom, latestCommon, spreadBp, stockChangeBetween, netLiquidity,
  BIDDERS, type Obs, type Change, type StockChange, type AuctionAgg, type Bidder, type Maturity,
} from "./liquidity-beta.js";
import type { ReadConfig, ReservesZones } from "./liquidity-read-config.js";

export interface ReadWeek {
  date: string; total: number; tga: number; rrp: number; reserves: number; currency: number; liabResidual: number;
  treast: number; mbs: number; discount: number; btfp: number; repo: number; swap: number;
}
export type CmpWeeks = 4 | 13;
const DAY = 86_400_000;
const isoShift = (date: string, days: number) => new Date(Date.parse(date) + days * DAY).toISOString().slice(0, 10);

// ── 01 얼마나 ──
export interface Percentile { p: number; side: "상위" | "하위"; pos: number; min: number; max: number; n: number }
export interface HowMuch {
  date: string; prevDate: string; cmpWeeks: CmpWeeks;
  nl: number; nlPrev: number; dNl: number; dNlPct: number; flat: boolean;
  total: number; tga: number; rrp: number;
  pctl: Percentile | null;
  nlYoy: Change | null; m2Yoy: Change | null;
  history: { date: string; nl: number }[];   // 최근 1년 수준(그림 B)
}
// 최근 5년 동안의 모든 N주 변화 분포에서 이번 ΔNL 의 자리. 표본이 20개 미만이면 null.
export function percentileOfChange(weeks: ReadWeek[], sel: ReadWeek, cmpWeeks: CmpWeeks, dNl: number): Percentile | null {
  const from = isoShift(sel.date, -5 * 365);
  const samples: number[] = [];
  for (const w of weeks) {
    if (w.date < from || w.date > sel.date) continue;
    const p = weeksBefore(weeks, w.date, cmpWeeks);
    if (!p) continue;
    const d = netLiquidity(w) - netLiquidity(p);
    if (Number.isFinite(d)) samples.push(d);
  }
  if (samples.length < 20 || !Number.isFinite(dNl)) return null;
  const n = samples.length, min = Math.min(...samples), max = Math.max(...samples);
  if (dNl >= 0) {
    const above = samples.filter((s) => s > dNl).length;
    const pos = max > 0 ? 0.5 + 0.5 * Math.min(1, dNl / max) : 0.5;
    return { p: Math.max(1, Math.round(((above + 1) / n) * 100)), side: "상위", pos, min, max, n };
  }
  const below = samples.filter((s) => s < dNl).length;
  const pos = min < 0 ? 0.5 - 0.5 * Math.min(1, dNl / min) : 0.5;
  return { p: Math.max(1, Math.round(((below + 1) / n) * 100)), side: "하위", pos, min, max, n };
}

export function howMuch(weeks: ReadWeek[], sel: ReadWeek, prev: ReadWeek, cmpWeeks: CmpWeeks, m2: Obs[], flatPct: number): HowMuch {
  const nl = netLiquidity(sel), nlPrev = netLiquidity(prev), dNl = nl - nlPrev;
  const dNlPct = nlPrev ? (dNl / nlPrev) * 100 : NaN;
  const nlObs: Obs[] = weeks.map((w) => ({ date: w.date, value: netLiquidity(w) })).filter((o) => Number.isFinite(o.value));
  const yearAgo = isoShift(sel.date, -365);
  return {
    date: sel.date, prevDate: prev.date, cmpWeeks, nl, nlPrev, dNl, dNlPct,
    flat: Number.isFinite(dNlPct) && Math.abs(dNlPct) < flatPct,
    total: sel.total, tga: sel.tga, rrp: sel.rrp,
    pctl: percentileOfChange(weeks, sel, cmpWeeks, dNl),
    nlYoy: yoyWeekly(nlObs, sel.date), m2Yoy: yoyMonthly(m2, sel.date),
    history: nlObs.filter((o) => o.date >= yearAgo && o.date <= sel.date).map((o) => ({ date: o.date, nl: o.value })),
  };
}

// ── 02 어디서 ──
export type FromKey = "tga" | "rrp" | "fed";
export interface Contribution { key: FromKey; subject: string; own: number; effect: number }
export interface FedDetail { key: "treast" | "mbs" | "other"; label: string; value: number }
export type Verdict = "oneoff" | "persistent" | "depends" | "mixed";
export interface WhereFrom {
  dNl: number; contributions: Contribution[]; ranked: Contribution[]; identityError: number;
  fedDetail: FedDetail[]; dominant: FromKey | null; dominantShare: number; verdict: Verdict;
  tga: number; rrp: number;
}
export const SUBJECT: Record<FromKey, string> = { tga: "재무부", rrp: "MMF", fed: "연준" };
export function whereFrom(prev: ReadWeek, now: ReadWeek, dominantShare: number): WhereFrom {
  const dTotal = now.total - prev.total, dTga = now.tga - prev.tga, dRrp = now.rrp - prev.rrp;
  const dNl = netLiquidity(now) - netLiquidity(prev);
  const contributions: Contribution[] = [
    { key: "tga", subject: SUBJECT.tga, own: dTga, effect: -dTga },
    { key: "rrp", subject: SUBJECT.rrp, own: dRrp, effect: -dRrp },
    { key: "fed", subject: SUBJECT.fed, own: dTotal, effect: dTotal },
  ];
  const identityError = Math.abs(contributions.reduce((s, c) => s + c.effect, 0) - dNl);
  if (identityError > 1) console.warn(`[liquidity-read] 02 항등식 불일치: Σ기여 − ΔNL = ${identityError.toFixed(3)} musd`);
  const dTreast = now.treast - prev.treast, dMbs = now.mbs - prev.mbs, dOtherAsset = dTotal - dTreast - dMbs;
  const fedRaw: FedDetail[] = [
    { key: "treast", label: dTreast < 0 ? "국채 만기상환" : "국채 매입", value: dTreast },
    { key: "mbs", label: dMbs < 0 ? "MBS 상환" : "MBS 매입", value: dMbs },
    { key: "other", label: "기타 자산", value: dOtherAsset },
  ];
  const fedDetail = fedRaw.filter((d) => Number.isFinite(d.value)).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const ranked = [...contributions].sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
  const gross = contributions.reduce((s, c) => s + Math.abs(c.effect), 0);
  const sameDir = contributions.filter((c) => dNl !== 0 && Math.sign(c.effect) === Math.sign(dNl));
  const lead = sameDir.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect))[0];
  const share = lead && gross ? Math.abs(lead.effect) / gross : 0;
  const dominant = lead && share >= dominantShare ? lead.key : null;
  const verdict: Verdict = dominant === "tga" ? "oneoff" : dominant === "fed" ? "persistent" : dominant === "rrp" ? "depends" : "mixed";
  return { dNl, contributions, ranked, identityError, fedDetail, dominant, dominantShare: share, verdict, tga: now.tga, rrp: now.rrp };
}

// ── 03 어디로 ──
export interface ZonePos { value: number; unit: "musd" | "gdp_pct"; pos: number; zone: "tight" | "middle" | "ample"; tight: number; ample: number }
export interface WhereTo {
  dNl: number; dReserves: number; dOther: number; resShare: number; sameSign: boolean; identityError: number;
  reserves: number; deposits: StockChange | null; bills: StockChange | null; zone: ZonePos | null;
}
export function reservesZone(reserves: number, zones: ReservesZones | null): ZonePos | null {
  if (!zones || !Number.isFinite(reserves)) return null;
  const value = zones.unit === "gdp_pct" ? (zones.gdpMusd ? (reserves / zones.gdpMusd) * 100 : NaN) : reserves;
  if (!Number.isFinite(value)) return null;
  const { tight, ample } = zones;
  // 눈금은 목업처럼 빠듯 30% · 경계 25% · 넉넉 45% 로 나누고 각 구간 안에서 선형.
  let pos: number, zone: ZonePos["zone"];
  if (value < tight) { pos = 0.3 * Math.max(0, value / tight); zone = "tight"; }
  else if (value < ample) { pos = 0.3 + 0.25 * ((value - tight) / (ample - tight)); zone = "middle"; }
  else { pos = 0.55 + 0.45 * Math.min(1, (value - ample) / Math.max(ample, 1)); zone = "ample"; }
  return { value, unit: zones.unit, pos, zone, tight, ample };
}
export function whereTo(prev: ReadWeek, now: ReadWeek, deposits: Obs[], billsMonthly: Obs[], zones: ReservesZones | null): WhereTo {
  const dNl = netLiquidity(now) - netLiquidity(prev);
  const dReserves = now.reserves - prev.reserves;
  const dOther = (now.currency - prev.currency) + (now.liabResidual - prev.liabResidual);
  const identityError = Math.abs(dReserves + dOther - dNl);
  if (identityError > 1) console.warn(`[liquidity-read] 03 항등식 불일치: Δ준비금 + Δ기타 − ΔNL = ${identityError.toFixed(3)} musd`);
  return {
    dNl, dReserves, dOther, resShare: dNl !== 0 ? dReserves / dNl : NaN,
    sameSign: dReserves === 0 || dOther === 0 || Math.sign(dReserves) === Math.sign(dOther), identityError,
    reserves: now.reserves,
    deposits: stockChangeBetween(deposits, prev.date, now.date, 7),
    bills: stockChangeBetween(billsMonthly, prev.date, now.date, 35),
    zone: reservesZone(now.reserves, zones),
  };
}

// ── 04 누가 샀나 ──
export type Bucket = "bills" | "nb" | "tips";
export const BUCKETS: Bucket[] = ["bills", "nb", "tips"];
export const BUCKET_LABEL: Record<Bucket, string> = { bills: "단기채 Bills", nb: "중장기 Notes·Bonds·FRN", tips: "물가연동 TIPS" };
export const BUCKET_OF: Record<Maturity, Bucket> = { bills: "bills", notes: "nb", bonds: "nb", frn: "nb", tips: "tips" };
export const BIDDER_NAME: Record<Bidder, string> = { indirect: "간접 입찰", dealer: "프라이머리 딜러", direct: "직접 입찰", soma: "연준 SOMA", noncomp: "비경쟁·기타" };
export const BIDDER_SUBJECT: Record<Bidder, string> = { indirect: "간접 입찰자", dealer: "프라이머리 딜러", direct: "직접 입찰자", soma: "연준", noncomp: "비경쟁·기타 입찰자" };
export const BIDDER_ORDER: Bidder[] = ["indirect", "dealer", "direct", "soma", "noncomp"];
export interface WhoBought {
  start: string; end: string; counted: number; excludeBills: boolean;
  totalReported: number; totalAttributed: number;
  byBidder: Record<Bidder, number>; byBucket: Record<Bucket, number>; matrix: Record<Bucket, Record<Bidder, number>>;
  top: { bidder: Bidder; value: number; share: number } | null; majority: boolean;
  dealerShare: number; dealerSharePrev: number | null; dealerJump: boolean;
  netIssuance: StockChange | null; billsNet: StockChange | null;
}
const emptyBidders = () => Object.fromEntries(BIDDERS.map((b) => [b, 0])) as Record<Bidder, number>;
function fold(agg: AuctionAgg, excludeBills: boolean) {
  const matrix = Object.fromEntries(BUCKETS.map((k) => [k, emptyBidders()])) as Record<Bucket, Record<Bidder, number>>;
  const byBidder = emptyBidders(); const byBucket = { bills: 0, nb: 0, tips: 0 } as Record<Bucket, number>;
  let totalReported = 0, totalAttributed = 0;
  for (const m of Object.keys(agg.matrix) as Maturity[]) {
    const k = BUCKET_OF[m];
    if (excludeBills && k === "bills") continue;
    for (const b of BIDDERS) { const v = agg.matrix[m][b]; matrix[k][b] += v; byBidder[b] += v; byBucket[k] += v; totalAttributed += v; }
    totalReported += agg.reported[m];
  }
  return { matrix, byBidder, byBucket, totalReported, totalAttributed };
}
export function whoBought(agg: AuctionAgg, prevAgg: AuctionAgg | null, monthlyTotal: Obs[], monthlyBills: Obs[], excludeBills = false): WhoBought {
  const cur = fold(agg, excludeBills);
  const topBidder = BIDDER_ORDER.reduce<Bidder | null>((best, b) => (best === null || cur.byBidder[b] > cur.byBidder[best] ? b : best), null);
  const top = topBidder && cur.totalReported > 0 ? { bidder: topBidder, value: cur.byBidder[topBidder], share: cur.byBidder[topBidder] / cur.totalReported } : null;
  const dealerShare = cur.totalReported > 0 ? cur.byBidder.dealer / cur.totalReported : NaN;
  const prev = prevAgg ? fold(prevAgg, excludeBills) : null;
  const dealerSharePrev = prev && prev.totalReported > 0 ? prev.byBidder.dealer / prev.totalReported : null;
  return {
    start: agg.start, end: agg.end, counted: agg.counted, excludeBills,
    ...cur, top, majority: !!top && top.share >= 0.5,
    dealerShare, dealerSharePrev, dealerJump: dealerSharePrev != null && Number.isFinite(dealerShare) && dealerShare - dealerSharePrev >= 0.05,
    netIssuance: stockChangeBetween(monthlyTotal, agg.start, agg.end, 35),
    billsNet: stockChangeBetween(monthlyBills, agg.start, agg.end, 35),
  };
}
export interface ReadSankey { nodes: { name: string; key: string; side: "bucket" | "bidder"; value: number }[]; links: { source: number; target: number; value: number }[] }
export function whoSankey(who: WhoBought): ReadSankey {
  const buckets = BUCKETS.filter((k) => who.byBucket[k] > 0);
  const bidders = BIDDER_ORDER.filter((b) => who.byBidder[b] > 0);
  const nodes = [
    ...buckets.map((k) => ({ name: BUCKET_LABEL[k], key: k, side: "bucket" as const, value: who.byBucket[k] })),
    ...bidders.map((b) => ({ name: BIDDER_NAME[b], key: b, side: "bidder" as const, value: who.byBidder[b] })),
  ];
  const links: ReadSankey["links"] = [];
  buckets.forEach((k, i) => bidders.forEach((b, j) => { const v = who.matrix[k][b]; if (v > 0) links.push({ source: i, target: buckets.length + j, value: v }); }));
  return { nodes, links };
}

// ── 05 탈은 없나 ──
export interface StressRow {
  key: "spread" | "nfci" | "hy" | "loans"; name: string; desc: string; unit: "bp" | "idx" | "pctp" | "musd";
  value: number | null; date: string | null; min: number; max: number; threshold: number | null; breached: boolean | null; note?: string;
}
export interface Stress { rows: StressRow[]; evaluated: StressRow[]; breached: StressRow[] }
// 긴급대출 = 할인창구 + 레포 + 스왑 (+ BTFP 가 관측되면 포함). BTFP 는 2024년 종료돼 FRED 시리즈가 멈췄으므로
// 관측이 없으면 '결측'이 아니라 '종료'로 보고 제외한다(구현 세션 0장 조사에서 확정).
export function emergencyLoans(w: ReadWeek): { value: number; btfpEnded: boolean } {
  const live = w.discount + w.repo + w.swap;
  const btfpEnded = !Number.isFinite(w.btfp);
  return { value: btfpEnded ? live : live + w.btfp, btfpEnded };
}
export function stress(sofr: Obs[], iorb: Obs[], nfci: Obs[], hy: Obs[], loans: { value: number; date: string; btfpEnded: boolean } | null, cfg: ReadConfig): Stress {
  const pair = latestCommon(sofr, iorb);
  const bp = pair ? spreadBp(pair.a.value, pair.b.value) : null;
  const n = nfci.length ? nfci[nfci.length - 1] : null;
  const h = hy.length ? hy[hy.length - 1] : null;
  const judge = (v: number | null, t: number | null) => (v == null || t == null || !Number.isFinite(v) ? null : v > t);
  const rows: StressRow[] = [
    { key: "spread", name: "초단기 금리 압력", desc: "SOFR − IORB. 0 위로 올라가면 은행들이 돈을 구하기 어렵다는 뜻", unit: "bp", value: bp, date: pair?.date ?? null, min: -10, max: 10, threshold: 0, breached: judge(bp, 0) },
    { key: "nfci", name: "금융여건 종합", desc: "시카고 연은 NFCI. 0 위면 평소보다 돈줄이 빡빡함", unit: "idx", value: n?.value ?? null, date: n?.date ?? null, min: -1, max: 1, threshold: 0, breached: judge(n?.value ?? null, 0) },
    { key: "hy", name: "부실기업 자금 조달", desc: "하이일드 스프레드. 벌어질수록 시장이 부도를 걱정함", unit: "pctp", value: h?.value ?? null, date: h?.date ?? null, min: 2, max: 10, threshold: cfg.HY_THRESHOLD, breached: judge(h?.value ?? null, cfg.HY_THRESHOLD) },
    { key: "loans", name: "연준 긴급대출", desc: "은행이 연준 창구에서 급전을 빌린 규모", unit: "musd", value: loans && Number.isFinite(loans.value) ? loans.value : null, date: loans?.date ?? null, min: 0, max: cfg.EMERGENCY_LOAN_THRESHOLD ? cfg.EMERGENCY_LOAN_THRESHOLD * 2 : 0, threshold: cfg.EMERGENCY_LOAN_THRESHOLD, breached: judge(loans?.value ?? null, cfg.EMERGENCY_LOAN_THRESHOLD), note: loans?.btfpEnded ? "BTFP(2024년 종료) 제외" : undefined },
  ];
  const evaluated = rows.filter((r) => r.breached !== null);
  return { rows, evaluated, breached: evaluated.filter((r) => r.breached) };
}

// ── 배경 띠 ──
export interface BgItem { key: string; label: string; value: number | null; date: string | null; kind: "pct2" | "pctchg" | "pct1" }
export function background(ctx: { dfii10?: Obs[]; dtwexbgs?: Obs[]; indpro?: Obs[]; unrate?: Obs[]; pcepilfe?: Obs[] }): BgItem[] {
  const last = (o?: Obs[]) => (o && o.length ? o[o.length - 1] : null);
  const dfii = last(ctx.dfii10), un = last(ctx.unrate);
  const dxy = ctx.dtwexbgs && ctx.dtwexbgs.length ? changeFrom(ctx.dtwexbgs, ctx.dtwexbgs[ctx.dtwexbgs.length - 1].date, 91, 5) : null;
  const ind = ctx.indpro && ctx.indpro.length ? yoyMonthly(ctx.indpro, ctx.indpro[ctx.indpro.length - 1].date) : null;
  const pce = ctx.pcepilfe && ctx.pcepilfe.length ? yoyMonthly(ctx.pcepilfe, ctx.pcepilfe[ctx.pcepilfe.length - 1].date) : null;
  return [
    { key: "dfii10", label: "실질금리 10년", value: dfii?.value ?? null, date: dfii?.date ?? null, kind: "pct2" },
    { key: "dxy", label: "달러 3개월 변화", value: dxy?.pct ?? null, date: dxy?.to.date ?? null, kind: "pctchg" },
    { key: "indpro", label: "산업생산 전년비", value: ind?.pct ?? null, date: ind?.to.date ?? null, kind: "pctchg" },
    { key: "unrate", label: "실업률", value: un?.value ?? null, date: un?.date ?? null, kind: "pct1" },
    { key: "pce", label: "근원 PCE 전년비", value: pce?.pct ?? null, date: pce?.to.date ?? null, kind: "pctchg" },
  ];
}

// 선택 주와 비교 주. 비교 주는 행 수가 아니라 날짜로 찾는다(정확한 수요일이 없으면 undefined).
export function pickWeeks(weeks: ReadWeek[], selDate: string, cmpWeeks: CmpWeeks): { sel: ReadWeek | null; prev: ReadWeek | null } {
  const sel = weeks.find((w) => w.date === selDate) ?? null;
  return { sel, prev: sel ? weeksBefore(weeks, sel.date, cmpWeeks) ?? null : null };
}
export { atOrBefore };
