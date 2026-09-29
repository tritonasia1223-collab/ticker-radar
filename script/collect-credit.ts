import "dotenv/config";
import { collectCredit } from "../server/credit/sources.js";
import { readCreditSnapshot, saveCreditSnapshot } from "../server/credit/storage.js";
import { writeFile, mkdir } from "node:fs/promises";
import { creditAudit } from "../server/credit/audit.js";

async function main() {
  const dry = process.argv.includes("--dry-run");
  const previous = dry ? null : await readCreditSnapshot();
  const snapshot = await collectCredit(previous, new Date(), process.argv.includes("--backfill"));
  await mkdir("output/credit", { recursive: true });
  await writeFile("output/credit/collection-status.json", JSON.stringify({ collectedAt: snapshot.collectedAt, sources: snapshot.series.map(s => ({ key: s.key, count: s.points.length, from: s.points[0]?.date, to: s.points.at(-1)?.date, transport: s.transport, error: s.error })) }, null, 2));
  if (!dry) await saveCreditSnapshot(snapshot);
  await writeFile("output/credit/refresh-audit.json", JSON.stringify(creditAudit(snapshot), null, 2));
  const failed = snapshot.series.filter(s => s.error);
  console.log(JSON.stringify({ saved: !dry, sources: snapshot.series.length, failed: failed.map(s => ({ key: s.key, error: s.error })) }));
  process.exitCode = failed.length ? 2 : 0;
}
main().catch(() => { console.error("신용 수집·저장 실패. DB 연결 및 초기화 상태를 확인하세요."); process.exitCode = 1; });
