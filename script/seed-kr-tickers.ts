// Import all KOSPI/KOSDAQ/KONEX listed companies from KRX KIND (free public list)
// as KR-market tickers, so Korean company names ("삼성전자") and 6-digit codes
// ("005930") in tweets/threads resolve to a stock.
//
//   npm run seed:kr
//
// Each row -> ticker { symbol: <6-digit code>, companyNameKo: <회사명>, market: 'kr',
// aliases: [회사명], exchange: KOSPI/KOSDAQ/KONEX }. Re-runnable (upsert).
import "dotenv/config";
import postgres from "postgres";

const KIND_URL = "https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13";
const CHUNK = 500;
const MARKET_MAP: Record<string, string> = { 유가: "KOSPI", 코스닥: "KOSDAQ", 코넥스: "KONEX" };

function cell(s: string) { return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(); }

async function run() {
  console.log("[krx] fetching KIND corp list …");
  const res = await fetch(KIND_URL);
  if (!res.ok) throw new Error(`KIND fetch failed: ${res.status}`);
  const html = new TextDecoder("euc-kr").decode(await res.arrayBuffer());

  // keys are DB column names (postgres.js maps object keys -> columns)
  const rows: { symbol: string; company_name_ko: string; company_name: null; market: string; aliases: string; exchange: string | null }[] = [];
  const seen = new Set<string>();
  for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const tds = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((t) => cell(t[1]));
    if (tds.length < 3) continue;
    const name = tds[0];
    const code = tds[2];
    if (!name || !/^\d{6}$/.test(code) || seen.has(code)) continue;
    seen.add(code);
    rows.push({
      symbol: code, company_name_ko: name, company_name: null, market: "kr",
      aliases: JSON.stringify([name.toLowerCase()]),
      exchange: MARKET_MAP[tds[1]] ?? tds[1] ?? null,
    });
  }
  console.log(`[krx] parsed ${rows.length} KR tickers`);
  if (rows.length < 1000) throw new Error("parsed too few rows — KIND format may have changed");

  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  await sql`ALTER TABLE tickers ADD COLUMN IF NOT EXISTS market text NOT NULL DEFAULT 'us'`;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await sql`
      insert into tickers ${sql(chunk, "symbol", "company_name_ko", "company_name", "market", "aliases", "exchange")}
      on conflict (symbol) do update set
        company_name_ko = excluded.company_name_ko, market = 'kr',
        aliases = excluded.aliases, exchange = excluded.exchange`;
    console.log(`  …${Math.min(i + CHUNK, rows.length)}/${rows.length}`);
  }

  const cov = await sql`select market, count(*)::int n from tickers group by market`;
  console.log("✅ done — tickers by market:", cov);
  await sql.end();
}

run().catch((e) => { console.error(e); process.exit(1); });
