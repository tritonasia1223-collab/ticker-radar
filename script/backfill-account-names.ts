// Backfill account display names (e.g. @blazingbees → "katoo") for accounts that don't
// have one yet. New collections capture the name automatically (apify.ts / threads.ts);
// this one-off fills the accounts already synced before that was added.
//
//   npm run backfill:names
//
// X: apidojo tweet-scraper → item.author.name. Threads: threads-scraper → item.fullName.
import "dotenv/config";
import postgres from "postgres";

const TOKEN = process.env.APIFY_TOKEN || "";
const BASE = "https://api.apify.com/v2";
const X_ACTOR = "apidojo~tweet-scraper";
const TH_ACTOR = "automation-lab~threads-scraper";

async function runActor(actor: string, input: any): Promise<any[]> {
  const url = `${BASE}/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(TOKEN)}&clean=true`;
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  if (!r.ok) throw new Error(`${actor} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json() as Promise<any[]>;
}

async function run() {
  if (!TOKEN) { console.error("APIFY_TOKEN 가 .env 에 없습니다."); process.exit(1); }
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  const accts = (await sql`select id, handle, platform, display_name from accounts`) as any[];
  const need = accts.filter((a) => !a.display_name);
  console.log(`이름 없는 계정 ${need.length}/${accts.length}개 백필 시도 …`);

  const nameByHandle = new Map<string, string>(); // handle(lower) -> display name

  // --- X ---
  const xH = need.filter((a) => a.platform !== "threads").map((a) => a.handle);
  if (xH.length) {
    console.log(`[x] ${xH.length}개 핸들 조회 …`);
    const items = await runActor(X_ACTOR, {
      searchTerms: xH.map((h) => `from:${h} -filter:replies`), sort: "Latest", maxItems: xH.length * 12,
    });
    for (const it of items) {
      const h = String(it.author?.userName || "").toLowerCase();
      const name = String(it.author?.name || "").trim();
      if (h && name && !nameByHandle.has(h)) nameByHandle.set(h, name);
    }
  }

  // --- Threads (chunk to stay under the 300s run-sync limit) ---
  const tH = need.filter((a) => a.platform === "threads").map((a) => a.handle);
  for (let i = 0; i < tH.length; i += 3) {
    const batch = tH.slice(i, i + 3);
    console.log(`[threads] ${batch.join(", ")} …`);
    const items = await runActor(TH_ACTOR, { mode: "posts", usernames: batch, maxPosts: 1 });
    for (const it of items) {
      const h = String(it.username || "").toLowerCase();
      const name = String(it.fullName || "").trim();
      if (h && name && !nameByHandle.has(h)) nameByHandle.set(h, name);
    }
  }

  let updated = 0;
  for (const a of need) {
    const name = nameByHandle.get(a.handle.toLowerCase());
    if (name) { await sql`update accounts set display_name = ${name} where id = ${a.id}`; updated++; console.log(`  @${a.handle} → ${name}`); }
  }
  console.log(`✅ ${updated}개 이름 채움 (못 찾음 ${need.length - updated}개)`);
  await sql.end();
}

run().catch((e) => { console.error(e); process.exit(1); });
