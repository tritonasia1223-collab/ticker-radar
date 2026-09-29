import "dotenv/config";
import { readCreditSnapshot } from "../server/credit/storage.js";
import { creditAudit } from "../server/credit/audit.js";
import { mkdir, writeFile } from "node:fs/promises";

async function main() {
  const audit = creditAudit(await readCreditSnapshot());
  await mkdir("output/credit", { recursive: true });
  await writeFile("output/credit/refresh-audit.json", JSON.stringify(audit, null, 2));
  console.log(JSON.stringify(audit.indicators.map(i => ({ name: i.name, status: i.status, dates: i.lines.map(l => `${l.label}: ${l.latestObservation ?? "자료 없음"}`), collectionOverdue: i.lines.some(l => l.collectionOverdue) })), null, 2));
}
main().catch(() => { console.error("신용 갱신 점검 실패. DB 연결을 확인하세요."); process.exitCode = 1; });
