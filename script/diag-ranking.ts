// #23 랭킹 회귀 하네스 — 실 storage.insiderRanking 을 호출(로직 복제 없음, drift 0).
//   실행: npx tsx script/diag-ranking.ts
//   회귀 기준: 공동신고 종목(NRG/MDLN/DELL/LGN/SYM) 금액·insiderCount dedup 반영,
//             비공동신고 종목(네거티브 컨트롤)은 불변.
import "dotenv/config";
import { storage } from "../server/storage";

async function main() {
  const rows = await storage.insiderRanking({});
  const by = new Map(rows.map((r) => [r.symbol, r]));
  const fmt = (v: number) => `$${(v / 1e6).toFixed(0)}M`;
  console.log(`총 ${rows.length} 종목\n`);
  console.log("=== 공동신고 종목 (dedup 반영돼야) ===");
  for (const s of ["NRG", "MDLN", "DELL", "LGN", "SYM"]) {
    const r = by.get(s);
    if (!r) { console.log(`  ${s}: 없음`); continue; }
    console.log(`  ${s}: 인사이더 ${r.insiderCount}명 / 매도 ${fmt(r.sellValue)} / 매수 ${fmt(r.buyValue)} / 순 ${fmt(r.netValue)} / 거래 ${r.tradeCount} / signal ${r.signalScore.toFixed(2)}`);
  }
  console.log("\n=== 네거티브 컨트롤 (불변이어야: 비공동신고) ===");
  for (const s of ["ESLT", "AAPL", "NVDA", "WBD", "CAT", "SPGI"]) {
    const r = by.get(s);
    if (!r) { console.log(`  ${s}: 없음`); continue; }
    console.log(`  ${s}: 인사이더 ${r.insiderCount}명 / 매도 ${fmt(r.sellValue)} / 매수 ${fmt(r.buyValue)} / 거래 ${r.tradeCount} / signal ${r.signalScore.toFixed(2)}`);
  }
  // 정렬순서 회귀: 매도액 상위 12
  console.log("\n=== 매도액 상위 12 (정렬 회귀) ===");
  [...rows].sort((a, b) => b.sellValue - a.sellValue).slice(0, 12).forEach((r, i) =>
    console.log(`  ${i + 1}. ${r.symbol} ${fmt(r.sellValue)} (${r.insiderCount}명)`));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
