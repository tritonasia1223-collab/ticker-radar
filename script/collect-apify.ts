// 실데이터 수집 (Apify) — johnvc 의회 거래 액터를 날짜범위 청크로 호출해 적재.
//   실행:  npm run collect:congress:apify -- --days 90          (최근 90일 백필/증분)
//          npm run collect:congress:apify -- --days 90 --fresh  (정치인 데이터 비우고 새로)
//
// johnvc 액터는 House Clerk + Senate EFD 를 ticker·금액구간까지 구조화해 제공한다.
// 무료 FMP(최신 25건) 한계를 대체. 같은 스키마(political_trades) + insertPoliticalTradeIfNew(externalId dedup) 재사용.
import "dotenv/config";
import { storage } from "../server/storage";
import type { InsertPoliticalTrade } from "../shared/schema";

const TOKEN = process.env.APIFY_TOKEN || "";
const ACTOR = "johnvc~us-congress-financial-disclosures-and-stock-trading-data";
const WINDOW_DAYS = 14; // 청크 크기(액터 Max_Results 1000 안에 들도록)

interface Row {
  id: string; Ticker: string; Asset: string; Transaction_Type: string;
  Date: string; Notification_Date: string; Amount_Range: string;
  First_Name: string; Last_Name: string; State_District: string; House: string;
}

const slugify = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
function parseAmount(s: string) {
  const nums = (s || "").match(/[\d,]+/g);
  if (!nums) return { low: null as number | null, high: null as number | null };
  const v = nums.map((n) => Number(n.replace(/,/g, ""))).filter((n) => !isNaN(n));
  return { low: v[0] ?? null, high: v[1] ?? v[0] ?? null };
}
const normSide = (t: string) => (/^s/i.test(t) ? "sell" : /^e/i.test(t) ? "exchange" : "buy");
const stateOf = (sd: string) => (sd && /^[A-Za-z]{2}/.test(sd) ? sd.slice(0, 2).toUpperCase() : null);
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function runActor(start: string, end: string): Promise<Row[]> {
  const url = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${TOKEN}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Start_Date: start, End_Date: end, Max_Results: 1000 }),
  });
  if (!res.ok) throw new Error(`Apify ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function main() {
  if (!TOKEN) { console.error("APIFY_TOKEN 이 .env 에 없습니다."); process.exit(1); }
  const fresh = process.argv.includes("--fresh");
  const di = process.argv.indexOf("--days");
  const days = di >= 0 ? Number(process.argv[di + 1]) : 90;
  const now = Date.now();
  const fromMs = now - days * 86400000;

  console.log(`Apify(johnvc) 수집 — 최근 ${days}일 (${ymd(fromMs)} ~ ${ymd(now)})${fresh ? " · fresh" : ""}`);
  if (fresh) await storage.clearPoliticianData();

  const polCache = new Map<string, number>();
  const tickSeen = new Set<string>();
  let inserted = 0, skipped = 0, fetched = 0;

  for (let s = fromMs; s < now; s += WINDOW_DAYS * 86400000) {
    const start = ymd(s), end = ymd(Math.min(s + WINDOW_DAYS * 86400000, now));
    const rows = await runActor(start, end);
    fetched += rows.length;
    let win = 0;
    for (const r of rows) {
      const symbol = (r.Ticker || "").trim().toUpperCase();
      const txnMs = Date.parse(r.Date);
      if (!symbol || isNaN(txnMs)) { skipped++; continue; }

      const name = `${r.First_Name ?? ""} ${r.Last_Name ?? ""}`.trim();
      const slug = slugify(name);
      const chamber = /senate/i.test(r.House) ? "senate" : "house";
      let polId = polCache.get(slug);
      if (polId === undefined) {
        polId = await storage.upsertPolitician({
          slug, name, party: null, chamber, state: stateOf(r.State_District), bioguideId: null, createdAt: now,
        });
        polCache.set(slug, polId);
      }
      if (!tickSeen.has(symbol)) {
        tickSeen.add(symbol);
        await storage.upsertTicker({ symbol, companyName: (r.Asset || "").replace(/\s*\([A-Z.]+\)\s*$/, "") || null, aliases: "[]", exchange: null });
      }
      const { low, high } = parseAmount(r.Amount_Range);
      const trade: InsertPoliticalTrade = {
        politicianId: polId, symbol, company: r.Asset || null, side: normSide(r.Transaction_Type),
        amountLow: low, amountHigh: high, txnDate: txnMs,
        filedDate: r.Notification_Date ? Date.parse(r.Notification_Date) || null : null,
        source: "apify", verification: "pending_official",
        externalId: `apify:${r.id}`, createdAt: now,
      };
      if (await storage.insertPoliticalTradeIfNew(trade)) { inserted++; win++; }
    }
    console.log(`  ${start}~${end}: ${rows.length}건 수신 · 신규 ${win}`);
  }

  console.log(`✅ 수집 완료 — 수신 ${fetched} · 신규 거래 ${inserted}건 · 의원 ${polCache.size}명 · 종목 ${tickSeen.size} · 스킵(티커없음) ${skipped}`);
  console.log("→ 정당·위원회 보강: npm run enrich:congress");
  process.exit(0);
}

main().catch((e) => { console.error("수집 실패:", e); process.exit(1); });
