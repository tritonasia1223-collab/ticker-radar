// 자본주의 전체 백업 (읽기전용). 모든 편집 안정화 작업 '전에' 실행.
//   실행: npm run cap:backup
// cap_flows/nodes/edges/links/settings 전량을 타임스탬프 JSON 으로 덤프한다.
// 어느 Phase 든 무결성 지문이 틀어지면 이 파일로 복원 근거를 삼는다. (SELECT only — 무접촉)
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { db } from "../server/storage.js";
import { capFlows, capNodes, capEdges, capLinks, capSettings } from "../shared/schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const [flows, nodes, edges, links, settings] = await Promise.all([
    db.select().from(capFlows),
    db.select().from(capNodes),
    db.select().from(capEdges),
    db.select().from(capLinks),
    db.select().from(capSettings),
  ]);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const path = join(__dirname, `cap-backup.${stamp}.json`);
  const payload = { takenAt: new Date().toISOString(), counts: {
    flows: flows.length, nodes: nodes.length, edges: edges.length, links: links.length, settings: settings.length,
  }, flows, nodes, edges, links, settings };
  writeFileSync(path, JSON.stringify(payload, null, 2));
  console.log(`✅ 백업 저장: ${path}`);
  console.log(`   flows ${flows.length} · nodes ${nodes.length} · edges ${edges.length} · links ${links.length} · settings ${settings.length}`);
  process.exit(0);
}
main().catch((e) => { console.error("백업 실패:", e); process.exit(1); });
