// Populate ticker_sectors for US stocks from the Nasdaq stock screener — a keyless bulk
// source that returns sector + industry for every NYSE/NASDAQ/AMEX listing. This replaces
// the per-symbol Finnhub enrich (which needs an API key) for the sector treemap, and gives
// one consistent US taxonomy. Re-runnable (upsert).
//
//   npm run seed:us-sectors
//
// We store the finer `industry` (Semiconductors, Banks, Biotechnology … GICS-industry level)
// rather than the coarse `sector` (Technology …) — "기술" is too broad to be useful; "반도체"
// is what we want. This matches the granularity of the Naver 업종 backbone used for KR.
// Korean labels are mapped on the client.
import "dotenv/config";
import postgres from "postgres";

const EXCHANGES = ["NASDAQ", "NYSE", "AMEX"];
const UA = { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", Accept: "application/json" } };

async function rowsFor(ex: string): Promise<any[]> {
  const url = `https://api.nasdaq.com/api/screener/stocks?tableonly=false&download=true&exchange=${ex}`;
  const res = await fetch(url, UA);
  if (!res.ok) throw new Error(`nasdaq ${ex} -> ${res.status}`);
  const j = (await res.json()) as any;
  return j?.data?.rows || [];
}

async function run() {
  const bySymbol = new Map<string, string>();
  for (const ex of EXCHANGES) {
    const rows = await rowsFor(ex);
    let n = 0;
    for (const r of rows) {
      const sym = String(r.symbol || "").trim().toUpperCase();
      // prefer the finer `industry`; fall back to the coarse `sector` when industry is blank.
      const label = String(r.industry || r.sector || "").trim();
      if (sym && label && !bySymbol.has(sym)) { bySymbol.set(sym, label); n++; }
    }
    console.log(`[nasdaq] ${ex}: ${rows.length} rows, +${n} with industry`);
  }
  const out = [...bySymbol].map(([symbol, sector]) => ({ symbol, sector }));
  console.log(`[nasdaq] ${out.length} US stocks → sector`);
  if (out.length < 3000) throw new Error(`too few rows (${out.length}) — Nasdaq format may have changed`);

  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  const CHUNK = 500;
  for (let i = 0; i < out.length; i += CHUNK) {
    const chunk = out.slice(i, i + CHUNK);
    await sql`
      insert into ticker_sectors ${sql(chunk, "symbol", "sector")}
      on conflict (symbol) do update set sector = excluded.sector`;
    if ((i / CHUNK) % 4 === 0 || i + CHUNK >= out.length) console.log(`  upserted …${Math.min(i + CHUNK, out.length)}/${out.length}`);
  }
  const cov = await sql`select count(*)::int n from ticker_sectors where sector is not null`;
  console.log("✅ done — ticker_sectors with sector:", cov[0].n);
  await sql.end();
}

run().catch((e) => { console.error(e); process.exit(1); });
