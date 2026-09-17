// 미국 유동성(베타) — 순수 계산. 서버(API 조립)와 클라이언트(띠·표·생키)가 함께 쓴다.
// 원칙: 결측은 NaN 또는 제외, 0 대체 없음. 금액은 million USD. 날짜는 'YYYY-MM-DD'.
// 기존 shared/time-series 와 같은 규칙 — 비교 시점은 행 수가 아니라 날짜로 찾는다.

export interface Obs { date: string; value: number }

const DAY = 86_400_000;
export const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

// 오름차순 관측에서 date 이하 마지막 관측. 없으면 null.
export function atOrBefore(obs: Obs[], date: string): Obs | null {
  let found: Obs | null = null;
  for (const o of obs) { if (o.date <= date) found = o; else break; }
  return found;
}

// target ±toleranceDays 안에서 가장 가까운 관측. 없으면 null.
export function nearest(obs: Obs[], target: string, toleranceDays: number): Obs | null {
  let best: Obs | null = null, bd = Infinity;
  for (const o of obs) {
    const d = Math.abs(daysBetween(o.date, target));
    if (d < bd) { bd = d; best = o; }
  }
  return best && bd <= toleranceDays ? best : null;
}

// 기간 변화: date 이하 최신 관측(to) 과 그로부터 days 일 전 근처 관측(from). 둘 다 있어야 계산.
export interface Change { from: Obs; to: Obs; delta: number; pct: number }
export function changeFrom(obs: Obs[], date: string, days: number, toleranceDays: number): Change | null {
  const to = atOrBefore(obs, date);
  if (!to) return null;
  const from = nearest(obs, isoDate(Date.parse(to.date) - days * DAY), toleranceDays);
  if (!from) return null;
  return { from, to, delta: to.value - from.value, pct: from.value === 0 ? NaN : (to.value / from.value - 1) * 100 };
}
// 전년비. 월간은 같은 달(±16일), 주간은 52주(364일, 요일 유지 ±4일), 일간은 365일(±4일).
export const yoyMonthly = (obs: Obs[], date: string) => changeFrom(obs, date, 365, 16);
export const yoyWeekly = (obs: Obs[], date: string) => changeFrom(obs, date, 364, 4);
export const yoyDaily = (obs: Obs[], date: string) => changeFrom(obs, date, 365, 4);

// 분기 법인세 납부일(4·6·9·12월 15일)이 [from, to] 안에 있으면 그 날짜들. TGA 급증의 계절 요인 표기용.
// 항등식을 깨뜨리는 제외·보정에는 쓰지 않는다 — 표기만.
export function taxDatesWithin(from: string, to: string): string[] {
  const out: string[] = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
    for (const m of ["04", "06", "09", "12"]) {
      const d = `${y}-${m}-15`;
      if (d >= from && d <= to) out.push(d);
    }
  }
  return out;
}

// ── 띠: 얼마나 → 어디서 → 어디로 (H.4.1 항등식) ──
// 순유동성 = 총자산 − TGA − 역레포.  Δ순유동성 = Δ자산 − ΔTGA − Δ역레포 (정확).
// 지급준비금 = 순유동성 − 현금통화 − 기타부채·자본.  Δ지급준비금 = Δ순유동성 − Δ현금통화 − Δ기타 (정확).
export interface BandWeek { date: string; total: number; tga: number; rrp: number; reserves: number; currency: number; liabResidual: number }
export interface BandStep { key: "assets" | "tga" | "rrp"; label: string; own: number; effect: number }
export interface LiquidityBand {
  from: string; to: string;
  netLiqPrev: number; netLiqNow: number; dNetLiq: number;
  steps: BandStep[];                       // 어디서 — effect 합 == dNetLiq
  dReserves: number; dCurrency: number; dOther: number;
  bridge: number;                          // dNetLiq − dReserves == dCurrency + dOther
  taxDates: string[];
}
export const netLiquidity = (w: BandWeek) => w.total - w.tga - w.rrp;
export function liquidityBand(prev: BandWeek, now: BandWeek): LiquidityBand {
  const dAssets = now.total - prev.total, dTga = now.tga - prev.tga, dRrp = now.rrp - prev.rrp;
  const netLiqPrev = netLiquidity(prev), netLiqNow = netLiquidity(now);
  const steps: BandStep[] = [
    { key: "assets", label: "연준 자산", own: dAssets, effect: dAssets },
    { key: "tga", label: "TGA", own: dTga, effect: -dTga },
    { key: "rrp", label: "역레포", own: dRrp, effect: -dRrp },
  ];
  const dReserves = now.reserves - prev.reserves;
  const dCurrency = now.currency - prev.currency, dOther = now.liabResidual - prev.liabResidual;
  const dNetLiq = netLiqNow - netLiqPrev;
  return { from: prev.date, to: now.date, netLiqPrev, netLiqNow, dNetLiq, steps, dReserves, dCurrency, dOther, bridge: dNetLiq - dReserves, taxDates: taxDatesWithin(prev.date, now.date) };
}

// ── 입찰: 만기 종류 → 인수 주체 (FiscalData auctions_query, 결제일 = issue_date 기준) ──
export type Maturity = "bills" | "notes" | "bonds" | "tips" | "frn";
export type Bidder = "soma" | "dealer" | "direct" | "indirect" | "noncomp";
export const MATURITIES: Maturity[] = ["bills", "notes", "bonds", "tips", "frn"];
export const BIDDERS: Bidder[] = ["soma", "dealer", "direct", "indirect", "noncomp"];
export const MATURITY_LABEL: Record<Maturity, string> = { bills: "단기채 Bills", notes: "중기채 Notes", bonds: "장기채 Bonds", tips: "물가연동 TIPS", frn: "변동금리 FRN" };
export const BIDDER_LABEL: Record<Bidder, string> = { soma: "연준 SOMA", dealer: "프라이머리 딜러", direct: "직접 입찰", indirect: "간접 입찰", noncomp: "비경쟁·기타" };

// security_type + 플래그 → 만기 버킷. FiscalData 는 TIPS 를 Note/Bond 에 inflation_index_security=Yes,
// FRN 을 Note 에 floating_rate=Yes 로 표시한다(security_type 만으로는 못 가른다). CMB 는 단기채. 모르는 값은 null.
const isYes = (v: unknown) => String(v ?? "").trim().toLowerCase() === "yes";
export function maturityOf(securityType: string, flags?: { tips?: unknown; frn?: unknown }): Maturity | null {
  if (isYes(flags?.tips)) return "tips";
  if (isYes(flags?.frn)) return "frn";
  switch (securityType) {
    case "Bill": case "CMB": return "bills";
    case "Note": return "notes";
    case "Bond": return "bonds";
    default: return null;
  }
}

export interface AuctionRow {
  security_type: string; issue_date: string;
  total_accepted: unknown; primary_dealer_accepted: unknown; direct_bidder_accepted: unknown;
  indirect_bidder_accepted: unknown; noncomp_accepted: unknown; soma_accepted: unknown;
  inflation_index_security?: unknown; floating_rate?: unknown;   // "Yes" | "No"
}
export interface AuctionAgg {
  start: string; end: string;
  matrix: Record<Maturity, Record<Bidder, number>>;   // musd, 귀속된 낙찰액
  attributed: Record<Maturity, number>;                // = Σ matrix[m][*]
  reported: Record<Maturity, number>;                  // = Σ total_accepted (귀속 합과 대조용)
  counted: number;                                     // 집계된 입찰 수
  skipped: number;                                     // 결과 미공표(null)·형식 오류로 제외된 입찰 수
  unknownTypes: string[];                              // 매핑 안 된 security_type
}
// "null"·빈값·비수치는 결측 — 0이 아니다. 결측이면 NaN 을 돌려 호출자가 행 전체를 제외한다.
export function auctionAmount(value: unknown): number {
  if (value === null || value === undefined) return NaN;
  const s = String(value).trim();
  if (s === "" || s.toLowerCase() === "null") return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
const zeroMatrix = () => Object.fromEntries(MATURITIES.map((m) => [m, Object.fromEntries(BIDDERS.map((b) => [b, 0]))])) as Record<Maturity, Record<Bidder, number>>;
const zeroTotals = () => Object.fromEntries(MATURITIES.map((m) => [m, 0])) as Record<Maturity, number>;

export function aggregateAuctions(rows: AuctionRow[], start: string, end: string): AuctionAgg {
  const matrix = zeroMatrix(), attributed = zeroTotals(), reported = zeroTotals();
  let counted = 0, skipped = 0;
  const unknown = new Set<string>();
  for (const r of rows) {
    const issue = String(r.issue_date ?? "");
    if (issue < start || issue > end) continue;
    const m = maturityOf(String(r.security_type ?? ""), { tips: r.inflation_index_security, frn: r.floating_rate });
    if (!m) { unknown.add(String(r.security_type)); continue; }
    const total = auctionAmount(r.total_accepted);
    const parts: Record<Bidder, number> = {
      soma: auctionAmount(r.soma_accepted), dealer: auctionAmount(r.primary_dealer_accepted),
      direct: auctionAmount(r.direct_bidder_accepted), indirect: auctionAmount(r.indirect_bidder_accepted),
      noncomp: auctionAmount(r.noncomp_accepted),
    };
    // 총액 또는 귀속 항목 중 하나라도 결측이면 그 입찰은 통째로 제외 — 일부만 더하면 합이 거짓이 된다.
    if (!Number.isFinite(total) || !BIDDERS.every((b) => Number.isFinite(parts[b]))) { skipped++; continue; }
    for (const b of BIDDERS) { const v = parts[b] / 1e6; matrix[m][b] += v; attributed[m] += v; }
    reported[m] += total / 1e6;
    counted++;
  }
  return { start, end, matrix, attributed, reported, counted, skipped, unknownTypes: [...unknown].sort() };
}

// Recharts <Sankey> 입력. 값 0 인 노드·링크는 그리지 않는다. 좌: 만기, 우: 인수 주체.
export interface SankeyNode { name: string; key: string; side: "maturity" | "bidder" }
export interface SankeyLink { source: number; target: number; value: number }
export function sankeyData(agg: AuctionAgg): { nodes: SankeyNode[]; links: SankeyLink[] } {
  const mats = MATURITIES.filter((m) => agg.attributed[m] > 0);
  const bidders = BIDDERS.filter((b) => mats.some((m) => agg.matrix[m][b] > 0));
  const nodes: SankeyNode[] = [
    ...mats.map((m) => ({ name: MATURITY_LABEL[m], key: m, side: "maturity" as const })),
    ...bidders.map((b) => ({ name: BIDDER_LABEL[b], key: b, side: "bidder" as const })),
  ];
  const links: SankeyLink[] = [];
  mats.forEach((m, i) => bidders.forEach((b, j) => {
    const v = agg.matrix[m][b];
    if (v > 0) links.push({ source: i, target: mats.length + j, value: v });
  }));
  return { nodes, links };
}

// ── 맥락 띠 판정 ──
export type Band = "자료 부족" | "평상시" | "경계" | "위기";
const band = (v: number, caution: number, alert: number): Band =>
  !Number.isFinite(v) ? "자료 부족" : v >= alert ? "위기" : v >= caution ? "경계" : "평상시";
// SOFR − IORB (bp). 준비금이 '충분'에서 '빠듯'으로 넘어가면 제일 먼저 벌어진다. 임계는 반증 테스트 전 초기 상수.
export const SPREAD_CAUTION_BP = 10, SPREAD_ALERT_BP = 25;
export const spreadBand = (bp: number) => band(bp, SPREAD_CAUTION_BP, SPREAD_ALERT_BP);
// 연준 긴급대출(할인창구+BTFP+레포+스왑, musd). 기존 /fed 위기감지기와 같은 임계.
export const LOANS_CAUTION = 50_000, LOANS_ALERT = 200_000;
export const loansBand = (musd: number) => band(musd, LOANS_CAUTION, LOANS_ALERT);
// NFCI: 0 = 장기 평균. 양수 = 평균보다 긴축(지수 정의). +0.5 는 초기 상수.
export const nfciBand = (v: number) => band(v, 0, 0.5);

// ── API 페이로드 ──
export type ContextKey = "m2" | "deposits" | "sofr" | "iorb" | "nfci" | "hy" | "dfii10" | "dtwexbgs" | "indpro" | "unrate" | "pcepilfe";
export interface LiquidityContext {
  fetchedAt: string;
  series: Partial<Record<ContextKey, Obs[]>>;   // 금액 시리즈(m2·deposits)는 musd, 나머지는 원단위(%·지수)
  errors: Partial<Record<ContextKey, string>>;
}
export interface LiquidityAuctions {
  months: number; start: string; end: string; fetchedAt: string;
  agg: AuctionAgg | null;
  sankey: { nodes: SankeyNode[]; links: SankeyLink[] } | null;
  error?: string;
}
