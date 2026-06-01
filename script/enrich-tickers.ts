// 종목 섹터/산업 보강 — Finnhub profile2 로 ticker → industry 를 받아 ticker_sectors 에 저장.
//   실행:  npm run enrich:tickers
// 거래된 종목 중 아직 섹터가 없는 것만 조회(증분). Finnhub 무료 60/분 → ~1.1초 간격 throttle.
import "dotenv/config";
import { storage } from "../server/storage";

const KEY = process.env.FINNHUB_API_KEY || "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function industryOf(symbol: string): Promise<string | null> {
  // Finnhub 는 BRK.B 를 BRK.B 그대로 받음(점 표기). 그대로 시도.
  const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${KEY}`;
  const res = await fetch(url);
  if (res.status === 429) { await sleep(2000); return industryOf(symbol); } // rate limit 백오프
  if (!res.ok) return null;
  const j = (await res.json()) as any;
  return (j && j.finnhubIndustry) || null;
}

async function main() {
  if (!KEY) { console.error("FINNHUB_API_KEY 가 .env 에 없습니다."); process.exit(1); }
  const all = await storage.distinctTradedSymbols();
  const known = new Set((await storage.listTickerSectors()).map((t) => t.symbol));
  const todo = all.filter((s) => !known.has(s));
  console.log(`종목 ${all.length}개 중 ${todo.length}개 섹터 조회 (Finnhub, ~1.1s 간격)…`);

  let ok = 0, miss = 0;
  for (let i = 0; i < todo.length; i++) {
    const sym = todo[i];
    try {
      const ind = await industryOf(sym);
      await storage.setTickerSector(sym, ind);
      if (ind) ok++; else miss++;
    } catch { miss++; await storage.setTickerSector(sym, null); }
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${todo.length} …`);
    await sleep(1100);
  }
  console.log(`✅ 섹터 보강 완료 — 성공 ${ok} · 미상 ${miss} (총 ${todo.length})`);
  process.exit(0);
}

main().catch((e) => { console.error("섹터 보강 실패:", e); process.exit(1); });
