import "dotenv/config";
import { config } from "../shared/credit/schema.js";
import { verifySource } from "../server/credit/sources.js";
import { mkdir, writeFile } from "node:fs/promises";

async function main() {
  const results = [];
  for (const src of config.sources.filter(s => s.provider === "fred")) {
    try { results.push(await verifySource(src)); } catch { results.push({ key: src.key, status: "원천 검증 실패" }); }
  }
  await mkdir("output/credit", { recursive: true });
  await writeFile("output/credit/series-verification.json", JSON.stringify({ verifiedAt: new Date().toISOString(), authenticated: !!process.env.FRED_API_KEY, results }, null, 2));
  console.table(results);
  if (results.some(r => /실패|불일치/.test(r.status))) process.exitCode = 1;
}
main().catch(() => { console.error("계열 검증 실패"); process.exitCode = 1; });
