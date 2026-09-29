import "dotenv/config";
import { readFile } from "node:fs/promises";
import { importManualCsv } from "../server/credit/manual.js";
import { readCreditSnapshot, saveCreditSnapshot } from "../server/credit/storage.js";

async function main() {
  const path = process.argv[2]; if (!path || path.startsWith("--")) throw new Error("사용법: npm run credit:import -- CSV경로 [--check]");
  const check = process.argv.includes("--check");
  const text = await readFile(path, "utf8");
  const snapshot = importManualCsv(text, check ? null : await readCreditSnapshot());
  if (!check) await saveCreditSnapshot(snapshot);
  console.log(check ? "CSV 검증 완료 — 저장하지 않음" : "CSV 저장 완료");
}
main().catch(e => { console.error(e instanceof Error && /^(CSV|입력된|사용법)/.test(e.message) ? e.message : "CSV 읽기·저장 실패. 파일 경로와 DB 상태를 확인하세요."); process.exitCode = 1; });
