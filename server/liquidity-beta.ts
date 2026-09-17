// 미국 유동성(베타) — 라이브 조회 + 6시간 캐시. DB·크론에 쓰지 않는다(베타).
//   FRED 공개 CSV(키 불요)와 이미 쓰는 FiscalData auctions_query 만 사용. 정식 승격 시 server/fed.ts 레지스트리로 이관.
//   패턴은 server/treasury-transactions.ts 와 동일: 부분 실패는 errors 로 명시, 실패 응답은 캐시하지 않는다.
import { aggregateAuctions, sankeyData, type AuctionRow, type ContextKey, type LiquidityAuctions, type LiquidityContext, type Obs } from "../shared/liquidity-beta.js";

const FREDGRAPH = "https://fred.stlouisfed.org/graph/fredgraph.csv";
const FISCAL = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service";
const UA = "ticker-radar admin@tritonasia1223.com"; // FRED 매너: 식별 UA (fed-backfill 과 동일)
const TTL = 6 * 60 * 60 * 1000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

// unit: billions → ×1000 (musd 통일). percent·index 는 원값.
interface ContextSpec { key: ContextKey; id: string; unit: "billions" | "percent" | "index"; years: number }
export const CONTEXT_SERIES: ContextSpec[] = [
  { key: "m2",       id: "M2SL",           unit: "billions", years: 7 },  // 월간
  { key: "deposits", id: "DPSACBW027SBOG", unit: "billions", years: 7 },  // 주간(수요일) H.8
  { key: "sofr",     id: "SOFR",           unit: "percent",  years: 3 },  // 일간
  { key: "iorb",     id: "IORB",           unit: "percent",  years: 3 },  // 일간
  { key: "nfci",     id: "NFCI",           unit: "index",    years: 7 },  // 주간(금요일)
  { key: "hy",       id: "BAMLH0A0HYM2",   unit: "percent",  years: 7 },  // 일간, OAS %
  { key: "dfii10",   id: "DFII10",         unit: "percent",  years: 7 },  // 일간, 10년 실질금리
  { key: "dtwexbgs", id: "DTWEXBGS",       unit: "index",    years: 7 },  // 일간, 광의 달러지수
  { key: "indpro",   id: "INDPRO",         unit: "index",    years: 7 },  // 월간
  { key: "unrate",   id: "UNRATE",         unit: "percent",  years: 7 },  // 월간
  { key: "pcepilfe", id: "PCEPILFE",       unit: "index",    years: 7 },  // 월간, 근원 PCE 지수
];

export async function fetchFredCsv(id: string, cosd: string): Promise<Obs[]> {
  const resp = await fetch(`${FREDGRAPH}?id=${id}&cosd=${cosd}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12000) });
  if (!resp.ok) throw new Error(`FRED HTTP ${resp.status}`);
  const out: Obs[] = [];
  for (const line of (await resp.text()).split(/\r?\n/)) {
    const c = line.indexOf(",");
    if (c < 0) continue;
    const date = line.slice(0, c).trim(), raw = line.slice(c + 1).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue; // 헤더
    if (raw === "" || raw === ".") continue;          // FRED 결측 마커 — 0 이 아니다
    const value = Number(raw);
    if (Number.isFinite(value)) out.push({ date, value });
  }
  if (!out.length) throw new Error("FRED 관측 없음");
  return out;
}

// ── 맥락 시리즈 ──
let contextCache: { expires: number; data: LiquidityContext } | null = null;
let contextPending: Promise<LiquidityContext> | null = null;

async function collectContext(): Promise<LiquidityContext> {
  const result: LiquidityContext = { fetchedAt: new Date().toISOString(), series: {}, errors: {} };
  await Promise.all(CONTEXT_SERIES.map(async (s) => {
    const cosd = iso(new Date(Date.now() - s.years * 365 * 86_400_000));
    try {
      const obs = await fetchFredCsv(s.id, cosd);
      result.series[s.key] = s.unit === "billions" ? obs.map((o) => ({ date: o.date, value: o.value * 1000 })) : obs;
    } catch (e: any) {
      result.errors[s.key] = `${s.id}: ${String(e?.message || e)}`;
    }
  }));
  return result;
}

export async function liquidityContext(): Promise<LiquidityContext> {
  if (contextCache && contextCache.expires > Date.now()) return contextCache.data;
  if (contextPending) return contextPending;
  contextPending = collectContext().then((data) => {
    if (Object.keys(data.errors).length === 0) contextCache = { data, expires: Date.now() + TTL }; // 완전한 응답만 캐시
    return data;
  }).finally(() => { contextPending = null; });
  return contextPending;
}

// ── 입찰: 만기 → 인수 주체 ──
const AUCTION_FIELDS = "security_type,security_term,issue_date,total_accepted,primary_dealer_accepted,direct_bidder_accepted,indirect_bidder_accepted,noncomp_accepted,soma_accepted,inflation_index_security,floating_rate";
const auctionCache = new Map<number, { expires: number; data: LiquidityAuctions }>();
const auctionPending = new Map<number, Promise<LiquidityAuctions>>();

// 결제월 기준 창: months=3 이면 (이번 달 − 2)의 1일 ~ 오늘. issue_date 가 오늘 이후(미결제)인 입찰은 결과가 null 이라 자연히 제외된다.
export function auctionWindow(months: number, today = new Date()): { start: string; end: string } {
  const y = today.getUTCFullYear(), m = today.getUTCMonth();
  return { start: iso(new Date(Date.UTC(y, m - (months - 1), 1))), end: iso(today) };
}

async function fetchAuctionRows(start: string, end: string): Promise<AuctionRow[]> {
  const rows: AuctionRow[] = [];
  for (let page = 1; ; page++) {
    const params = new URLSearchParams({ fields: AUCTION_FIELDS, filter: `issue_date:gte:${start},issue_date:lte:${end}`, sort: "issue_date", "page[size]": "1000", "page[number]": String(page) });
    const resp = await fetch(`${FISCAL}/v1/accounting/od/auctions_query?${params}`, { signal: AbortSignal.timeout(12000), headers: { Accept: "application/json", "User-Agent": UA } });
    if (!resp.ok) throw new Error(`FiscalData HTTP ${resp.status}`);
    const j: any = await resp.json();
    if (!Array.isArray(j.data) || !j.meta) throw new Error("FiscalData 응답 불완전");
    rows.push(...j.data);
    if (page >= Number(j.meta["total-pages"] ?? 1)) break;
  }
  return rows;
}

async function collectAuctions(months: number): Promise<LiquidityAuctions> {
  const { start, end } = auctionWindow(months);
  const base = { months, start, end, fetchedAt: new Date().toISOString() };
  try {
    const rows = await fetchAuctionRows(start, end);
    if (!rows.length) throw new Error("해당 기간 입찰 자료 없음");
    const agg = aggregateAuctions(rows, start, end);
    return { ...base, agg, sankey: sankeyData(agg) };
  } catch (e: any) {
    return { ...base, agg: null, sankey: null, error: String(e?.message || e) };
  }
}

export async function liquidityAuctions(months: number): Promise<LiquidityAuctions> {
  if (months !== 1 && months !== 3) throw new Error("months 는 1 또는 3");
  const found = auctionCache.get(months);
  if (found && found.expires > Date.now()) return found.data;
  const ongoing = auctionPending.get(months);
  if (ongoing) return ongoing;
  const work = collectAuctions(months).then((data) => {
    if (!data.error) auctionCache.set(months, { data, expires: Date.now() + TTL });
    return data;
  }).finally(() => auctionPending.delete(months));
  auctionPending.set(months, work);
  return work;
}
