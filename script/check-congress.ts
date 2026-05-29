// 빠른 점검 — /api/congress/* 가 읽는 storage 메서드가 시드 데이터를 잘 반환하는지 확인.
import "dotenv/config";
import { storage } from "../server/storage";

async function main() {
  const pols = await storage.listPoliticians();
  const cmts = await storage.listCommittees();
  const all = await storage.politicalTrades({});
  const armed = await storage.politicalTrades({ committeeId: "senate-armed" });
  const q3 = await storage.politicalTrades({ fromMs: Date.parse("2025-07-01"), toMs: Date.parse("2025-09-30") });
  console.log("politicians:", pols.length, "| committees:", cmts.length, "| trades(all):", all.length);
  console.log("senate-armed trades:", armed.length, "| 2025Q3 trades:", q3.length);
  console.log("sample politician:", JSON.stringify({ name: pols[0]?.name, committees: pols[0]?.committees }));
  const t = all[0];
  console.log("sample trade:", JSON.stringify({ name: t?.name, symbol: t?.symbol, side: t?.side, amountLow: t?.amountLow, txnDate: t ? new Date(t.txnDate).toISOString().slice(0, 10) : null }));
  process.exit(0);
}
main().catch((e) => { console.error("check 실패:", e); process.exit(1); });
