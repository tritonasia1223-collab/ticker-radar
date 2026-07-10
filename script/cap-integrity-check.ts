// 자본주의 무결성 지문 + 손실 가드 (읽기전용). 각 Phase '후' 실행해 손실 0 을 확인.
//   실행: npm run cap:integrity
// 라이브 편집 중엔 hash 가 매번 바뀌므로, 실제 안전 기준은 '최신 백업 대비 손실 가드'다:
//   백업에 있던 카드/노드(slug+nodeKey)가 지금도 존재해야 한다. 추가·텍스트편집은 정상, 소멸만 손실.
import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { db } from "../server/storage.js";
import { capFlows, capNodes, capEdges, capLinks, capSettings } from "../shared/schema.js";
import { asc } from "drizzle-orm";

const __dirname = dirname(fileURLToPath(import.meta.url));

function lossGuard(curFlows: any[], curNodesByFlow: Map<number, any[]>) {
  const files = readdirSync(__dirname).filter((f) => /^cap-backup\..*\.json$/.test(f)).sort();
  if (!files.length) { console.log("\n[손실가드] 백업 없음 — 스킵(먼저 npm run cap:backup)"); return; }
  const latest = files[files.length - 1];
  const bk = JSON.parse(readFileSync(join(__dirname, latest), "utf8"));
  const bkNodesByFlow = new Map<number, any[]>();
  for (const n of bk.nodes) (bkNodesByFlow.get(n.flowId) ?? bkNodesByFlow.set(n.flowId, []).get(n.flowId)!).push(n);
  const curBySlug = new Map(curFlows.map((f) => [f.slug, f]));

  const removedCards: string[] = [];
  const removedNodes: string[] = [];
  let editedNodes = 0;
  for (const bf of bk.flows) {
    const cf = curBySlug.get(bf.slug);
    if (!cf) { removedCards.push(bf.slug); continue; }
    const curByKey = new Map((curNodesByFlow.get(cf.id) ?? []).map((n: any) => [n.nodeKey, n]));
    for (const bn of (bkNodesByFlow.get(bf.id) ?? [])) {
      const cn: any = curByKey.get(bn.nodeKey);
      if (!cn) removedNodes.push(`${bf.slug}:${bn.nodeKey}`);
      else if (cn.text !== bn.text) editedNodes++;
    }
  }
  const loss = removedCards.length + removedNodes.length;
  console.log(`\n[손실가드] 최신 백업(${latest}) 대비:`);
  console.log(`  삭제된 카드: ${removedCards.length ? "WARN " + removedCards.join(", ") : "0 ok"}`);
  console.log(`  소멸한 노드(slug:key): ${removedNodes.length ? "WARN " + removedNodes.slice(0, 20).join(", ") : "0 ok"}`);
  console.log(`  (텍스트만 편집된 노드 ${editedNodes}개 = 정상 편집)`);
  console.log(`  ${loss === 0 ? "PASS 손실 0 (추가/편집은 정상)" : "FAIL 손실 감지 — 중단하고 백업 복원 검토"}`);
}

async function main() {
  const flows = await db.select().from(capFlows).orderBy(asc(capFlows.slug));
  const nodes = await db.select().from(capNodes).orderBy(asc(capNodes.flowId), asc(capNodes.pos), asc(capNodes.nodeKey));
  const [edges, links, settings] = await Promise.all([
    db.select().from(capEdges), db.select().from(capLinks), db.select().from(capSettings),
  ]);

  const insightFlows = flows.filter((f) => f.insight && f.insight.trim()).length;
  const years = flows.map((f) => f.year);
  const minY = Math.min(...years), maxY = Math.max(...years);

  const nodesByFlow = new Map<number, typeof nodes>();
  for (const n of nodes) (nodesByFlow.get(n.flowId) ?? nodesByFlow.set(n.flowId, []).get(n.flowId)!).push(n);
  const canonical = flows.map((f) => ({
    slug: f.slug, date: f.date, title: f.title, insight: f.insight ?? null,
    nodes: (nodesByFlow.get(f.id) ?? []).map((n) => ({ k: n.nodeKey, kind: n.kind, text: n.text, ref: n.ref, table: n.tableData })),
  }));
  const hash = createHash("sha1").update(JSON.stringify(canonical)).digest("hex").slice(0, 16);

  console.log("=== 자본주의 무결성 지문 ===");
  console.log(`  flows ${flows.length} · nodes ${nodes.length} · edges ${edges.length} · links ${links.length} · settings ${settings.length}`);
  console.log(`  insight 카드 ${insightFlows} · 연도 ${minY}~${maxY} · hash ${hash}`);
  console.log(`  (hash 는 라이브 편집 중 매번 바뀔 수 있음 — 아래 손실가드가 실제 안전 기준)`);
  lossGuard(flows, nodesByFlow);
  process.exit(0);
}
main().catch((e) => { console.error("무결성 확인 실패:", e); process.exit(1); });
