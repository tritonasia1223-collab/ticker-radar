// 실데이터 수집 — FMP 의원 공시(House/Senate latest)를 공유 DB(political_trades)에 적재.
//   실행:  npm run collect:congress           (증분 upsert)
//          npm run collect:congress -- --fresh (정치인 데이터 비우고 실데이터로 새로 채움)
//
// FMP 는 ticker(symbol) 를 직접 주므로 회사명→티커 매핑이 불필요하다.
// 한계: FMP 응답에 '정당'과 '위원회'가 없다 → party=null, 위원회 링크 없음.
//       (정당/위원회는 unitedstates/congress-legislators 같은 소스로 enrich 하는 게 후속 작업)
import "dotenv/config";
import { storage } from "../server/storage";
import type { InsertPoliticalTrade } from "../shared/schema";

const FMP_KEY = process.env.FMP_API_KEY || "";
const BASE = "https://financialmodelingprep.com/stable";
// FMP 무료 티어: page=0, limit<=25 만 허용(페이지네이션·대용량은 유료) → 최신 25건/원.
const LIMIT = 25;

interface FmpRow {
  symbol: string; disclosureDate: string; transactionDate: string;
  firstName: string; lastName: string; office: string; district: string;
  owner: string; assetDescription: string; assetType: string; type: string;
  amount: string; link: string;
}

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}
function parseAmount(s: string): { low: number | null; high: number | null } {
  const nums = (s || "").match(/[\d,]+/g);
  if (!nums) return { low: null, high: null };
  const v = nums.map((n) => Number(n.replace(/,/g, ""))).filter((n) => !isNaN(n));
  if (!v.length) return { low: null, high: null };
  return { low: v[0], high: v.length > 1 ? v[1] : v[0] };
}
function normSide(t: string): string {
  if (/exchange/i.test(t)) return "exchange";
  if (/sale|sold|sell/i.test(t)) return "sell";
  return "buy";
}
function stateFromDistrict(d: string): string | null {
  return d && /^[A-Za-z]{2}/.test(d) ? d.slice(0, 2).toUpperCase() : null;
}

async function fetchChamber(kind: "house" | "senate"): Promise<FmpRow[]> {
  const url = `${BASE}/${kind}-latest?page=0&limit=${LIMIT}&apikey=${encodeURIComponent(FMP_KEY)}`;
  const res = await fetch(url, { headers: { "User-Agent": "ticker-radar/congress" } });
  if (!res.ok) throw new Error(`FMP ${kind} ${res.status} ${res.statusText}`);
  const rows = (await res.json()) as FmpRow[];
  return Array.isArray(rows) ? rows : [];
}

async function main() {
  if (!FMP_KEY) { console.error("FMP_API_KEY 가 .env 에 없습니다."); process.exit(1); }
  const fresh = process.argv.includes("--fresh");
  const now = Date.now();

  console.log(`실데이터 수집 시작 (${fresh ? "fresh: 기존 정치인 데이터 초기화" : "증분 upsert"})…`);
  if (fresh) await storage.clearPoliticianData();

  const [house, senate] = await Promise.all([fetchChamber("house"), fetchChamber("senate")]);
  const records = [
    ...house.map((r) => ({ r, chamber: "house" as const })),
    ...senate.map((r) => ({ r, chamber: "senate" as const })),
  ];
  console.log(`  FMP 수신 — house ${house.length} + senate ${senate.length} = ${records.length}건`);

  const polIdCache = new Map<string, number>();
  const tickerSeen = new Set<string>();
  let inserted = 0, skipped = 0;

  for (const { r, chamber } of records) {
    const symbol = (r.symbol || "").trim().toUpperCase();
    if (!symbol || !r.transactionDate) { skipped++; continue; } // 티커 없는 자산은 건너뜀

    const name = (r.office || `${r.firstName ?? ""} ${r.lastName ?? ""}`).trim();
    const slug = slugify(name);
    let polId = polIdCache.get(slug);
    if (polId === undefined) {
      polId = await storage.upsertPolitician({
        slug, name, party: null, chamber,
        state: stateFromDistrict(r.district), bioguideId: null, createdAt: now,
      });
      polIdCache.set(slug, polId);
    }

    if (!tickerSeen.has(symbol)) {
      tickerSeen.add(symbol);
      await storage.upsertTicker({ symbol, companyName: r.assetDescription || null, aliases: "[]", exchange: null });
    }

    const { low, high } = parseAmount(r.amount);
    const txnMs = Date.parse(r.transactionDate);
    if (isNaN(txnMs)) { skipped++; continue; }
    const trade: InsertPoliticalTrade = {
      politicianId: polId,
      symbol,
      company: r.assetDescription || null,
      side: normSide(r.type),
      amountLow: low,
      amountHigh: high,
      txnDate: txnMs,
      filedDate: r.disclosureDate ? Date.parse(r.disclosureDate) || null : null,
      source: "fmp",
      verification: "pending_official",
      externalId: `fmp:${r.link}|${symbol}|${r.type}|${r.transactionDate}|${r.amount}`,
      createdAt: now,
    };
    if (await storage.insertPoliticalTradeIfNew(trade)) inserted++;
  }

  console.log(`✅ 수집 완료 — 신규 거래 ${inserted}건 · 의원 ${polIdCache.size}명 · 종목 ${tickerSeen.size} · 스킵(티커없음) ${skipped}`);
  console.log("⚠️  정당/위원회는 FMP 미제공 → 위원회 뷰를 채우려면 congress-legislators enrich 필요(후속).");
  process.exit(0);
}

main().catch((e) => { console.error("수집 실패:", e); process.exit(1); });
