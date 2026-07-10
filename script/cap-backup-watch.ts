// 자본주의 실시간 롤링 백업 감시 (읽기전용, 앱 무접촉).
//   실행: npm run cap:watch            (기본 120초 간격, 120회≈4시간)
//         npm run cap:watch -- 90 200  (90초 간격, 200회)
//
// 목적: 버그 있는 저장 경로가 활성인 채 여러 명이 라이브 편집하는 위험한 구간 동안,
//   몇 분마다 전체 스냅샷을 떠 두어 손실이 나도 직전 스냅샷에서 복원 가능하게 한다.
//   덤으로 직전 스냅샷 대비 '소멸한 카드/노드'를 감지해 로그(의도적 삭제일 수도 있으니 heads-up).
// SELECT only — 저장/편집에 전혀 개입하지 않는다.
import "dotenv/config";
import { writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { db } from "../server/storage.js";
import { capFlows, capNodes, capEdges, capLinks, capSettings } from "../shared/schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INTERVAL = (Number(process.argv[2]) || 120) * 1000;
const MAX = Number(process.argv[3]) || 120;
const KEEP = 40; // 롤링 보관 개수
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function dump() {
  const [flows, nodes, edges, links, settings] = await Promise.all([
    db.select().from(capFlows), db.select().from(capNodes), db.select().from(capEdges),
    db.select().from(capLinks), db.select().from(capSettings),
  ]);
  return { flows, nodes, edges, links, settings };
}

const keyset = (d: any) => new Set(d.nodes.map((n: any) => {
  const slug = d.flows.find((f: any) => f.id === n.flowId)?.slug ?? `#${n.flowId}`;
  return `${slug}:${n.nodeKey}`;
}));
const slugset = (d: any) => new Set(d.flows.map((f: any) => f.slug));

function prune() {
  const files = readdirSync(__dirname).filter((f) => /^cap-backup\..*\.json$/.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - KEEP))) {
    try { unlinkSync(join(__dirname, f)); } catch { /* noop */ }
  }
}

async function main() {
  console.log(`[cap:watch] 시작 — ${INTERVAL / 1000}초 간격, 최대 ${MAX}회, 최근 ${KEEP}개 보관`);
  let prev: any = null;
  for (let i = 0; i < MAX; i++) {
    let snap;
    try { snap = await dump(); }
    catch (e: any) { console.log(`[cap:watch] ${new Date().toISOString().slice(11, 19)} 덤프 실패: ${e.message}`); await sleep(INTERVAL); continue; }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    writeFileSync(join(__dirname, `cap-backup.${stamp}.json`),
      JSON.stringify({ takenAt: new Date().toISOString(), counts: {
        flows: snap.flows.length, nodes: snap.nodes.length, edges: snap.edges.length,
        links: snap.links.length, settings: snap.settings.length,
      }, ...snap }, null, 2));

    let note = "";
    if (prev) {
      const pk = keyset(prev), ck = keyset(snap);
      const goneNodes = [...pk].filter((k) => !ck.has(k as string));
      const ps = slugset(prev), cs = slugset(snap);
      const goneCards = [...ps].filter((s) => !cs.has(s as string));
      const addedNodes = [...ck].filter((k) => !pk.has(k as string)).length;
      if (goneCards.length || goneNodes.length) {
        note = `  ⚠ 소멸: 카드 ${goneCards.length}${goneCards.length ? "(" + goneCards.slice(0, 3).join(",") + ")" : ""}, 노드 ${goneNodes.length}${goneNodes.length ? "(" + goneNodes.slice(0, 4).join(",") + ")" : ""} — 의도적 삭제인지 확인. (직전 스냅샷에 원본 보존됨)`;
      } else {
        note = `  +노드 ${addedNodes} · 소멸 0`;
      }
    }
    console.log(`[cap:watch] ${new Date().toISOString().slice(11, 19)} #${i + 1} flows ${snap.flows.length} nodes ${snap.nodes.length}${note}`);
    prev = snap;
    prune();
    await sleep(INTERVAL);
  }
  console.log(`[cap:watch] 종료(${MAX}회 완료). 필요하면 다시 실행.`);
  process.exit(0);
}
main().catch((e) => { console.error("[cap:watch] 실패:", e); process.exit(1); });
