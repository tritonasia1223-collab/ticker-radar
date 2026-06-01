// 내부자거래 수집 (Finnhub, 워치리스트 방식).
//   실행:  npm run collect:insider -- --days 90            (우리 종목 ∪ S&P500 백필)
//          npm run collect:insider -- --days 90 --fresh
//          npm run collect:insider -- --days 90 --max 30   (테스트: 유니버스 상위 N개만)
//
// 시장 전체 Form4 는 firehose(하루 수천건)라, 추적 종목(우리 DB 종목 + S&P500)만 Finnhub 로 백필한다.
// Finnhub 무료 60/분 → ~1.1s 간격. P=매수 / S=매도 / A·M·F·G·C=보상·기계적.
import "dotenv/config";
import { storage } from "../server/storage";
import type { InsertInsiderTrade } from "../shared/schema";

const KEY = process.env.FINNHUB_API_KEY || "";
const SP500_CSV = "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const slugify = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
function sideOf(code: string): string {
  const c = (code || "").toUpperCase();
  return c === "P" ? "buy" : c === "S" ? "sell" : c === "A" ? "award" : c === "M" ? "exercise"
    : c === "F" ? "tax" : c === "G" ? "gift" : c === "C" ? "conversion" : "other";
}
// 따옴표 인지 최소 CSV 파서 (Symbol, Security 만 필요)
function parseCsvLine(line: string): string[] {
  const out: string[] = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === "," && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur); return out;
}

interface FinRow { name: string; share: number; change: number; filingDate: string; transactionDate: string; transactionCode: string; transactionPrice: number; id: string; }
async function fetchInsider(symbol: string, from: string, to: string): Promise<FinRow[]> {
  const url = `https://finnhub.io/api/v1/stock/insider-transactions?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${KEY}`;
  const res = await fetch(url);
  if (res.status === 429) { await sleep(2000); return fetchInsider(symbol, from, to); }
  if (!res.ok) return [];
  const j = (await res.json()) as any;
  return Array.isArray(j?.data) ? j.data : [];
}

async function fetchSP500(): Promise<{ symbol: string; name: string }[]> {
  const res = await fetch(SP500_CSV);
  if (!res.ok) { console.warn("  S&P500 목록 로드 실패 → 우리 종목만"); return []; }
  const lines = (await res.text()).split(/\r?\n/).filter(Boolean);
  return lines.slice(1).map((l) => { const c = parseCsvLine(l); return { symbol: (c[0] || "").trim().toUpperCase(), name: (c[1] || "").trim() }; })
    .filter((x) => x.symbol);
}

async function main() {
  if (!KEY) { console.error("FINNHUB_API_KEY 가 .env 에 없습니다."); process.exit(1); }
  const fresh = process.argv.includes("--fresh");
  const di = process.argv.indexOf("--days"); const days = di >= 0 ? Number(process.argv[di + 1]) : 90;
  const mi = process.argv.indexOf("--max"); const max = mi >= 0 ? Number(process.argv[mi + 1]) : Infinity;
  const now = Date.now();
  const from = new Date(now - days * 86400000).toISOString().slice(0, 10);
  const to = new Date(now).toISOString().slice(0, 10);

  if (fresh) await storage.clearInsiderData();

  // 유니버스 = 정치인 거래 종목 ∪ S&P500  (SNS 매칭용 13k 사전은 제외 — 너무 큼)
  const congress = await storage.distinctTradedSymbols();
  const haveTicker = new Set((await storage.listTickers()).map((t) => t.symbol)); // 회사명 보유 여부
  const sp = await fetchSP500();
  // S&P 종목 중 tickers 에 없는 것만 회사명 채우기 (기존 종목 덮어쓰지 않음)
  for (const s of sp) if (!haveTicker.has(s.symbol)) {
    await storage.upsertTicker({ symbol: s.symbol, companyName: s.name || null, aliases: "[]", exchange: null });
  }
  const universe = [...new Set([...congress, ...sp.map((s) => s.symbol)])].slice(0, max === Infinity ? undefined : max);
  console.log(`내부자거래 수집 — 유니버스 ${universe.length}종목 · 기간 ${from}~${to}${fresh ? " · fresh" : ""}`);

  const insiderCache = new Map<string, number>();
  let inserted = 0, withData = 0;
  for (let k = 0; k < universe.length; k++) {
    const sym = universe[k];
    const rows = await fetchInsider(sym, from, to);
    if (rows.length) withData++;
    for (const r of rows) {
      const txnMs = Date.parse(r.transactionDate);
      if (!r.name || isNaN(txnMs)) continue;
      const slug = slugify(r.name);
      let insiderId = insiderCache.get(slug);
      if (insiderId === undefined) { insiderId = await storage.upsertInsider({ slug, name: r.name, createdAt: now }); insiderCache.set(slug, insiderId); }
      const shares = Math.abs(r.change ?? 0);
      const price = r.transactionPrice ?? 0;
      const trade: InsertInsiderTrade = {
        insiderId, symbol: sym, txnCode: r.transactionCode || null, side: sideOf(r.transactionCode),
        shares, price, value: Math.round(shares * price), txnDate: txnMs,
        filedDate: r.filingDate ? Date.parse(r.filingDate) || null : null,
        externalId: `fin:${r.id}:${sym}:${r.transactionCode}:${r.transactionDate}:${r.change}`,
        createdAt: now,
      };
      if (await storage.insertInsiderTradeIfNew(trade)) inserted++;
    }
    if ((k + 1) % 50 === 0) console.log(`  ${k + 1}/${universe.length} … (신규 ${inserted})`);
    await sleep(1100);
  }
  console.log(`✅ 수집 완료 — 신규 거래 ${inserted}건 · 데이터 있는 종목 ${withData} · 인사이더 ${insiderCache.size}명 (유니버스 ${universe.length})`);
  process.exit(0);
}
main().catch((e) => { console.error("수집 실패:", e); process.exit(1); });
