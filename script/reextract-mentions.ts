// Re-extract ticker mentions from ALL stored tweets with the current matcher and
// insert any that are missing. Use after expanding the ticker dictionary (e.g. KR
// stocks) so previously-collected tweets surface in surge without re-collecting.
//
//   npm run reextract
//
// Idempotent: existing (tweet, symbol, source) mentions are skipped.
import "dotenv/config";
import postgres from "postgres";
import { storage } from "../server/storage.js";
import { buildNameMatcher, extractMentions } from "../server/extract.js";

const CHUNK = 1000;

async function run() {
  const matcher = buildNameMatcher(await storage.listTickers());
  console.log(`matcher: ${matcher.aliases.length} aliases, ${matcher.codes.size} KR codes`);

  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  const tweets = await sql`select tweet_id, account_id, handle, text, tweeted_at from tweets`;
  console.log(`re-extracting from ${tweets.length} tweets …`);

  const rows: { tweet_id: string; symbol: string; account_id: number; handle: string; source: string; tweeted_at: number }[] = [];
  for (const t of tweets) {
    for (const mm of extractMentions(t.text, matcher)) {
      rows.push({ tweet_id: t.tweet_id, symbol: mm.symbol, account_id: t.account_id, handle: t.handle, source: mm.source, tweeted_at: Number(t.tweeted_at) });
    }
  }
  console.log(`extracted ${rows.length} mention rows; upserting …`);

  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const r = await sql`
      insert into mentions ${sql(chunk, "tweet_id", "symbol", "account_id", "handle", "source", "tweeted_at")}
      on conflict do nothing returning id`;
    inserted += r.length;
  }
  const byMarket = await sql`
    select t.market, count(*)::int n from mentions m
    join tickers t on t.symbol = m.symbol group by t.market`;
  console.log(`✅ done — ${inserted} new mentions. mentions by market:`, byMarket);
  await sql.end();
}

run().catch((e) => { console.error(e); process.exit(1); });
