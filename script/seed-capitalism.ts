// 자본주의 타임라인 초기 데이터(욕키푸르/오일쇼크 등 8개 플로우)를 DB에 시드.
//   실행:  npx tsx script/seed-capitalism.ts
// 멱등: slug 기준 upsert(통째 교체). 기존 자본주의 플로우만 갱신, 다른 도메인 비침습.
import "dotenv/config";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { upsertFlow } from "../server/capitalism.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(join(__dirname, "capitalism-flows-seed.json"), "utf-8"));

async function main() {
  const flows = raw.flows as any[];
  console.log(`자본주의 플로우 ${flows.length}건 시드…`);
  for (let i = 0; i < flows.length; i++) {
    const f = flows[i];
    await upsertFlow({
      slug: f.id,
      date: f.date,
      year: f.year,
      title: f.title,
      category: f.category,
      layout: f.layout,
      sortOrder: i,
      nodes: f.nodes.map((n: any) => ({
        nodeKey: n.id, kind: n.kind, inLabel: n.inLabel ?? null,
        text: n.text, ref: n.ref ?? null, col: n.col ?? null,
      })),
      edges: f.edges.map((e: any) => ({ from: e.from, to: e.to })),
    });
    console.log(`  ✓ ${f.id} (${f.title})`);
  }
  console.log("✅ 완료");
  process.exit(0);
}
main().catch((e) => { console.error("실패:", e); process.exit(1); });
