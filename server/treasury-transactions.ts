import type { TreasuryTransactions } from "../shared/treasury-transactions.js";

type Row = Record<string, unknown>;
const FISCAL = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service";
const NYFED = "https://markets.newyorkfed.org/api";
const DAY = 86_400_000;
const cache = new Map<string, { expires: number; data: TreasuryTransactions }>();
const pending = new Map<string, Promise<TreasuryTransactions>>();

export function amount(value: unknown): number {
  if (value === null || value === undefined || String(value).trim() === "" || String(value).toLowerCase() === "null") throw new Error("공식 거래 결과 미공표");
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error("공식 금액 형식 오류");
  return result;
}
const iso = (date: Date) => date.toISOString().slice(0, 10);
export function monthBounds(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month < "2014-01" || month > new Date().toISOString().slice(0, 7)) throw new Error("유효하지 않은 조회 월");
  const [year, m] = month.split("-").map(Number);
  return { start: `${month}-01`, end: iso(new Date(Date.UTC(year, m, 0))) };
}
async function json(url: string): Promise<any> {
  const response = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`공식 자료 HTTP ${response.status}`);
  return response.json();
}
async function fiscal(path: string, filter: string, fields?: string, sort?: string): Promise<Row[]> {
  const params = new URLSearchParams({ filter, "page[size]": "1000" });
  if (fields) params.set("fields", fields);
  if (sort) params.set("sort", sort);
  const j = await json(`${FISCAL}/${path}?${params}`);
  if (!Array.isArray(j.data) || !j.meta || Number(j.meta["total-pages"]) > 1) throw new Error("공식 자료 응답 불완전");
  return j.data;
}

export function parseDts(rows: Row[]): NonNullable<TreasuryTransactions["treasury"]> {
  const market = rows.filter(r => r.security_market === "Marketable");
  const asOf = market.map(r => String(r.record_date)).sort().at(-1);
  if (!asOf) throw new Error("해당 월 발행·상환 자료 없음");
  const last = market.filter(r => r.record_date === asOf);
  const accepted = new Set(["Bills", "Notes", "Bonds", "Inflation-Protected Securities Increment", "Federal Financing Bank"]);
  if (last.some(r => !accepted.has(String(r.security_type)) || !["Issues", "Redemptions"].includes(String(r.transaction_type)))) throw new Error("DTS 분류 변경: 집계 확인 필요");
  for (const kind of ["Issues", "Redemptions"]) for (const type of ["Bills", "Notes", "Bonds"]) {
    if (!last.some(r => r.transaction_type === kind && r.security_type === type)) throw new Error("DTS 월말 항목 누락");
  }
  if (!last.some(r => r.security_type === "Inflation-Protected Securities Increment")) throw new Error("DTS 물가보정 항목 누락");
  let issues = 0, inflation = 0, redemptions = 0;
  for (const row of last) {
    if (row.security_type === "Federal Financing Bank") continue; // not in existing MSPD five-category total
    const value = amount(row.transaction_mtd_amt); // DTS IIIA face value, already millions
    if (row.security_type === "Inflation-Protected Securities Increment") inflation += row.transaction_type === "Issues" ? value : -value;
    else if (row.transaction_type === "Issues") issues += value;
    else redemptions += value;
  }
  return { asOf, issues, inflation, redemptions };
}

export function parseBuybacks(rows: Row[], start: string, end: string): NonNullable<TreasuryTransactions["buybacks"]> {
  const out = { cashManagement: 0, liquiditySupport: 0, other: 0, total: 0, count: 0 };
  for (const r of rows) {
    const date = String(r.settlement_date);
    if (date < start || date > end) continue;
    const value = amount(r.total_par_amt_accepted) / 1e6; // accepted, NOT announced ceiling
    if (value < 0) throw new Error("바이백 금액 오류");
    if (r.operation_type === "Cash Management") out.cashManagement += value;
    else if (r.operation_type === "Liquidity Support") out.liquiditySupport += value;
    else out.other += value;
    out.total += value; out.count++;
  }
  return out;
}

export function parseFedOperations(rows: Row[], start: string, end: string) {
  let purchases = 0, sales = 0, operations = 0;
  for (const r of rows) {
    const date = String(r.settlementDate);
    if (date < start || date > end) continue;
    const value = amount(r.totalParAmtAccepted) / 1e6;
    if (value < 0) throw new Error("연준 거래 금액 오류");
    if (r.operationDirection === "P") purchases += value;
    else if (r.operationDirection === "S") sales += value;
    else throw new Error("연준 거래 방향 확인 필요");
    operations++;
  }
  return { purchases, sales, operations };
}

// Previous Wednesday's CUSIP holdings estimate the face amount maturing during
// the next seven days. Each maturity belongs to exactly one window.
export function maturityWindows(start: string, end: string) {
  const first = new Date(`${start}T00:00:00Z`);
  const back = (first.getUTCDay() - 3 + 7) % 7 || 7;
  first.setUTCDate(first.getUTCDate() - back);
  const out: { asOf: string; from: string; through: string }[] = [];
  for (let ms = +first; iso(new Date(ms)) < end; ms += 7 * DAY) {
    out.push({ asOf: iso(new Date(ms)), from: [start, iso(new Date(ms + DAY))].sort().at(-1)!, through: [end, iso(new Date(ms + 7 * DAY))].sort()[0] });
  }
  return out;
}
export function parseMaturities(rows: Row[], window: ReturnType<typeof maturityWindows>[number]) {
  if (!rows.length || rows.some(r => r.asOfDate !== window.asOf)) throw new Error("SOMA 보유 기준일 불일치");
  const seen = new Set<string>(); let total = 0;
  for (const row of rows) {
    const maturity = String(row.maturityDate);
    if (maturity < window.from || maturity > window.through) continue;
    const cusip = String(row.cusip);
    if (seen.has(cusip)) throw new Error("SOMA 종목 중복");
    seen.add(cusip);
    total += amount(row.parValue) / 1e6;
  }
  return total;
}

async function fetchFed(start: string, end: string) {
  const operationStart = iso(new Date(+new Date(`${start}T00:00:00Z`) - 7 * DAY));
  const [ops, auctions, maturities] = await Promise.all([
    json(`${NYFED}/tsy/all/results/details/search.json?startDate=${operationStart}&endDate=${end}&securityType=treasury`).then(j => {
      if (!Array.isArray(j.treasury?.auctions)) throw new Error("연준 거래 응답 불완전");
      return parseFedOperations(j.treasury.auctions, start, end);
    }),
    fiscal("v1/accounting/od/auctions_query", `issue_date:gte:${start},issue_date:lte:${end}`, "issue_date,cusip,soma_accepted"),
    Promise.all(maturityWindows(start, end).map(async w => {
      const j = await json(`${NYFED}/soma/tsy/get/asof/${w.asOf}.json`);
      if (!Array.isArray(j.soma?.holdings)) throw new Error("SOMA 보유 응답 불완전");
      return parseMaturities(j.soma.holdings, w);
    })),
  ]);
  if (!auctions.length) throw new Error("연준 재투자 자료 없음");
  const rollovers = auctions.reduce((sum, row) => sum + amount(row.soma_accepted) / 1e6, 0);
  return { ...ops, rollovers, maturities: maturities.reduce((a, b) => a + b, 0) };
}

async function collect(month: string): Promise<TreasuryTransactions> {
  const { start, end } = monthBounds(month);
  const tail = iso(new Date(+new Date(`${end}T00:00:00Z`) - 7 * DAY));
  const result: TreasuryTransactions = { month, fetchedAt: new Date().toISOString(), treasury: null, buybacks: null, fed: null, errors: {} };
  // Partial source failures do not hide independently available observations.
  await Promise.all([
    fiscal("v1/accounting/dts/public_debt_transactions", `security_market:eq:Marketable,record_date:gte:${tail},record_date:lte:${end}`, undefined, "-record_date")
      .then(rows => { result.treasury = parseDts(rows); }).catch(() => { result.errors.treasury = "발행·상환 공식 자료를 확인할 수 없습니다."; }),
    fiscal("v1/accounting/od/buybacks_operations", `settlement_date:gte:${start},settlement_date:lte:${end}`)
      .then(rows => { result.buybacks = parseBuybacks(rows, start, end); }).catch(() => { result.errors.buybacks = "바이백 공식 결과를 확인할 수 없습니다."; }),
    fetchFed(start, end).then(fed => { result.fed = fed; }).catch(() => { result.errors.fed = "연준 거래·재투자·만기도래 자료를 확인할 수 없습니다."; }),
  ]);
  return result;
}

export async function treasuryTransactions(month: string): Promise<TreasuryTransactions> {
  monthBounds(month);
  const found = cache.get(month);
  if (found && found.expires > Date.now()) return found.data;
  const ongoing = pending.get(month);
  if (ongoing) return ongoing;
  const work = collect(month).then(data => {
    // Cache complete responses only: the retry button can immediately retry failures.
    if (Object.keys(data.errors).length === 0) {
      if (cache.size >= 60) cache.delete(cache.keys().next().value!);
      cache.set(month, { data, expires: Date.now() + 6 * 60 * 60 * 1000 });
    }
    return data;
  }).finally(() => pending.delete(month));
  pending.set(month, work);
  return work;
}
