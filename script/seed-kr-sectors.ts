// Populate ticker_sectors for KR stocks from Naver 증권 "업종"(WICS industry) pages.
// Naver groups every listed stock into exactly one 업종 (반도체와반도체장비, 자동차 …),
// which is MECE — perfect as the treemap backbone. Korean labels match the reference map.
//
//   npm run seed:kr-sectors
//
// Flow: fetch the 업종 list (≈79) → for each, fetch its detail page and read the member
// 6-digit codes → upsert {symbol: code, sector: 업종} into ticker_sectors. Re-runnable.
import "dotenv/config";
import postgres from "postgres";

const UA = { headers: { "User-Agent": "Mozilla/5.0", Referer: "https://finance.naver.com/" } };
const dec = (buf: ArrayBuffer) => new TextDecoder("euc-kr").decode(buf);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, UA);
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return dec(await res.arrayBuffer());
}

async function run() {
  console.log("[naver] fetching 업종 list …");
  const listHtml = await fetchText("https://finance.naver.com/sise/sise_group.naver?type=upjong");
  const groups = [...listHtml.matchAll(/sise_group_detail\.naver\?type=upjong&no=(\d+)"[^>]*>([^<]+)</g)]
    .map((m) => ({ no: m[1], name: m[2].trim() }));
  if (groups.length < 50) throw new Error(`parsed too few 업종 (${groups.length}) — Naver format may have changed`);
  console.log(`[naver] ${groups.length} 업종`);

  // symbol -> 업종 (first 업종 wins; Naver assigns each stock one 업종 so collisions are rare)
  const sectorBySymbol = new Map<string, string>();
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const html = await fetchText(`https://finance.naver.com/sise/sise_group_detail.naver?type=upjong&no=${g.no}`);
    const codes = [...html.matchAll(/\/item\/main\.naver\?code=(\d{6})"/g)].map((m) => m[1]);
    let added = 0;
    for (const c of codes) if (!sectorBySymbol.has(c)) { sectorBySymbol.set(c, g.name); added++; }
    if ((i + 1) % 10 === 0 || i === groups.length - 1) console.log(`  ${i + 1}/${groups.length} … ${g.name} (+${added})`);
    await sleep(150); // be polite to Naver
  }

  const rows = [...sectorBySymbol].map(([symbol, sector]) => ({ symbol, sector }));
  console.log(`[naver] mapped ${rows.length} KR stocks → 업종`);
  if (rows.length < 1000) throw new Error(`mapped too few stocks (${rows.length})`);

  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await sql`
      insert into ticker_sectors ${sql(chunk, "symbol", "sector")}
      on conflict (symbol) do update set sector = excluded.sector`;
    console.log(`  upserted …${Math.min(i + CHUNK, rows.length)}/${rows.length}`);
  }
  const cov = await sql`select count(*)::int n from ticker_sectors where sector is not null`;
  console.log("✅ done — ticker_sectors with sector:", cov[0].n);
  await sql.end();
}

run().catch((e) => { console.error(e); process.exit(1); });
