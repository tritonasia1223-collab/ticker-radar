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

// Finnhub 가 비울 때 자산명으로 분류 (ETF/펀드/채권은 '회사 산업'이 없음).
function classifyAsset(name?: string | null): string | null {
  const s = (name || "").toLowerCase();
  if (!s) return null;
  if (/treasury|t-bill|\bbill\b|\bnote\b|\bbond\b|\bcpn\b|coupon|debenture|\bcusip\b/.test(s)) return "채권";
  if (/\betf\b|\bfund\b|trust|index|portfolio|spdr|ishares|vanguard|invesco|\blp\b|\bplc\b|tactical|preferred securities|\bbdc\b|\bdebt\b|credit fund|strategic credit/.test(s)) return "ETF·펀드";
  return null;
}

async function main() {
  if (!KEY) { console.error("FINNHUB_API_KEY 가 .env 에 없습니다."); process.exit(1); }
  // 정치인 + 내부자거래에서 실제로 거래된 종목 전부 (SNS 사전 전체는 제외 — 너무 큼)
  const all = [...new Set([...(await storage.distinctTradedSymbols()), ...(await storage.distinctInsiderSymbols())])];
  // 섹터가 채워진(non-null) 것만 '완료' 처리 → null 인 종목은 재시도(ETF/채권 분류 적용)
  const done = new Set((await storage.listTickerSectors()).filter((t) => t.sector).map((t) => t.symbol));
  const nameBySymbol = new Map((await storage.listTickers()).map((t) => [t.symbol, t.companyName]));
  const todo = all.filter((s) => !done.has(s));
  console.log(`종목 ${all.length}개 중 ${todo.length}개 섹터 조회 (Finnhub + ETF/채권 분류)…`);

  let ok = 0, classified = 0, miss = 0;
  for (let i = 0; i < todo.length; i++) {
    const sym = todo[i];
    let ind: string | null = null;
    try { ind = await industryOf(sym); } catch { /* ignore */ }
    if (ind) ok++;
    else { ind = classifyAsset(nameBySymbol.get(sym)); if (ind) classified++; else miss++; }
    await storage.setTickerSector(sym, ind);
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${todo.length} …`);
    await sleep(1100);
  }
  console.log(`✅ 섹터 보강 완료 — Finnhub ${ok} · ETF/채권 분류 ${classified} · 미상 ${miss} (총 ${todo.length})`);
  process.exit(0);
}

main().catch((e) => { console.error("섹터 보강 실패:", e); process.exit(1); });
