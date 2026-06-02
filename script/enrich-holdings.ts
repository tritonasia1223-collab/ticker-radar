// 보유량(shares_after) 백필 — Finnhub insider-transactions 의 `share`(거래후 보유) 를 재호출해
// 기존 거래행에 external_id 매칭으로 채운다. (보유 대비 % 가중 계산용)
//   실행:  npm run enrich:holdings            (shares_after NULL 인 매수·매도 종목 전부)
//          npm run enrich:holdings -- --max 50
// Finnhub `share` 는 Form4 sharesOwnedFollowingTransaction 과 일치(검증됨). 무료 60/분 → ~1.1s 간격.
import "dotenv/config";
import { storage } from "../server/storage";

const KEY = process.env.FINNHUB_API_KEY || "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface FinRow { name: string; share: number; change: number; transactionDate: string; transactionCode: string; id: string; }
async function fetchInsider(symbol: string, from: string, to: string): Promise<FinRow[]> {
  const url = `https://finnhub.io/api/v1/stock/insider-transactions?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${KEY}`;
  const res = await fetch(url);
  if (res.status === 429) { await sleep(2000); return fetchInsider(symbol, from, to); }
  if (!res.ok) return [];
  const j = (await res.json()) as any;
  return Array.isArray(j?.data) ? j.data : [];
}

async function main() {
  if (!KEY) { console.error("FINNHUB_API_KEY 가 .env 에 없습니다."); process.exit(1); }
  const mi = process.argv.indexOf("--max"); const max = mi >= 0 ? Number(process.argv[mi + 1]) : Infinity;
  // 기존 데이터 범위를 넉넉히 커버 (txn 최근 ~150일)
  const now = Date.now();
  const from = new Date(now - 150 * 86400000).toISOString().slice(0, 10);
  const to = new Date(now).toISOString().slice(0, 10);

  let symbols = await storage.symbolsNeedingHoldings();
  if (max !== Infinity) symbols = symbols.slice(0, max);
  console.log(`보유량 백필 — ${symbols.length}종목 (Finnhub share 재호출) · 기간 ${from}~${to}`);

  let filled = 0;
  for (let k = 0; k < symbols.length; k++) {
    const sym = symbols[k];
    const rows = await fetchInsider(sym, from, to);
    const pairs = rows.map((r) => ({
      // collect-insider 와 동일한 externalId 규칙으로 재구성
      eid: `fin:${r.id}:${sym}:${r.transactionCode}:${r.transactionDate}:${r.change}`,
      sa: Number.isFinite(r.share) ? Math.round(r.share) : null,
    }));
    if (pairs.length) { await storage.setSharesAfterByExternal(pairs); filled += pairs.length; }
    if ((k + 1) % 50 === 0) console.log(`  ${k + 1}/${symbols.length} … (매칭 시도 ${filled})`);
    await sleep(1100);
  }
  console.log(`✅ 보유량 백필 완료 — ${symbols.length}종목 처리 (매칭 시도 ${filled}행)`);
  process.exit(0);
}
main().catch((e) => { console.error("보유량 백필 실패:", e); process.exit(1); });
