// Bulk-import US ticker → company name from the SEC's free company_tickers.json
// (~10k SEC-registered companies). Fills company_name for tickers that don't have
// one yet (e.g. RVMD, SPCE) so the 종목 발견 list shows a name, not a bare ticker.
// Existing names (incl. the congress dataset) are left untouched — the frontend
// shortens long names at render time.
//
//   npm run seed:tickers
import "dotenv/config";
import postgres from "postgres";

const SEC_URL = "https://www.sec.gov/files/company_tickers.json";
const CHUNK = 500;

async function run() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

  console.log("[sec] fetching company_tickers.json …");
  const res = await fetch(SEC_URL, {
    headers: { "User-Agent": "ticker-radar/1.0 (personal dashboard; contact tritonasia1223@gmail.com)" },
  });
  if (!res.ok) throw new Error(`SEC fetch failed: ${res.status}`);
  const json = (await res.json()) as Record<string, { ticker: string; title: string }>;

  // dedup by normalized symbol (ON CONFLICT can't touch the same row twice in one insert)
  const bySymbol = new Map<string, string>();
  for (const r of Object.values(json)) {
    if (!r.ticker || !r.title) continue;
    const symbol = r.ticker.toUpperCase().replace(/-/g, "."); // SEC "BRK-B" -> our "BRK.B"
    if (!bySymbol.has(symbol)) bySymbol.set(symbol, r.title);
  }
  console.log(`[sec] ${bySymbol.size} unique tickers`);

  // skip symbols that already have a name
  const named = new Set(
    (await sql`select symbol from tickers where company_name is not null`).map((r: any) => r.symbol),
  );
  const todo = [...bySymbol.entries()]
    .filter(([symbol]) => !named.has(symbol))
    .map(([symbol, company_name]) => ({ symbol, company_name, aliases: "[]", exchange: null as string | null }));
  console.log(`[sec] ${todo.length} to insert (skipping ${bySymbol.size - todo.length} already-named)`);

  for (let i = 0; i < todo.length; i += CHUNK) {
    const chunk = todo.slice(i, i + CHUNK);
    await sql`
      insert into tickers ${sql(chunk, "symbol", "company_name", "aliases", "exchange")}
      on conflict (symbol) do update set company_name = excluded.company_name
      where tickers.company_name is null`;
    console.log(`  …${Math.min(i + CHUNK, todo.length)}/${todo.length}`);
  }

  const cov = await sql`select count(*)::int n, count(company_name)::int named from tickers`;
  console.log(`✅ done — tickers total ${cov[0].n}, with name ${cov[0].named}`);
  await sql.end();
}

run().catch((e) => { console.error(e); process.exit(1); });
