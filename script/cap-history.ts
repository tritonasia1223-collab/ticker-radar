// 자본주의 5분 롤링 히스토리(읽기전용, 앱 무접촉).
//   실행: npm run cap:history            (기본 300초=5분 간격, 무한)
//         npm run cap:history -- 180     (180초 간격)
//
// 목적: 편집 중 노드/메모가 유실되면 '수 분 전' 스냅샷에서 복원할 수 있게, 공유 DB 전체를
//   주기적으로 떠 둔다. 변동이 없으면 파일을 쓰지 않아(해시 dedup) 가볍고, 하루치(기본 288개)만 보관.
//   복원은 script/cap-history/ 안 JSON 을 그 시각으로 열어 확인(또는 cap-history-restore).
// SELECT only — 저장/편집에 전혀 개입하지 않는다.
import "dotenv/config";
import { createHash } from "node:crypto";
import { writeFileSync, readdirSync, unlinkSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { db } from "../server/storage.js";
import { capFlows, capNodes, capEdges, capLinks, capSettings } from "../shared/schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "cap-history");
const INTERVAL = (Number(process.argv[2]) || 300) * 1000; // 기본 5분
const KEEP = Number(process.argv[3]) || 288;              // 5분×288 = 24시간
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function dump() {
  const [flows, nodes, edges, links, settings] = await Promise.all([
    db.select().from(capFlows), db.select().from(capNodes), db.select().from(capEdges),
    db.select().from(capLinks), db.select().from(capSettings),
  ]);
  return { flows, nodes, edges, links, settings };
}

// 콘텐츠 해시(메타 takenAt 제외) — 변동 없으면 파일 안 씀.
const hashOf = (snap: any) => createHash("sha1").update(JSON.stringify(snap)).digest("hex");
const keyset = (d: any) => new Set(d.nodes.map((n: any) => {
  const slug = d.flows.find((f: any) => f.id === n.flowId)?.slug ?? `#${n.flowId}`;
  return `${slug}:${n.nodeKey}`;
}));
const slugset = (d: any) => new Set(d.flows.map((f: any) => f.slug));

function prune() {
  const files = readdirSync(OUT).filter((f) => /^snap\..*\.json$/.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - KEEP))) {
    try { unlinkSync(join(OUT, f)); } catch { /* noop */ }
  }
}

// 재시작 시 직전 스냅샷 해시를 읽어와 중복 재기록 방지.
function lastHash(): string | null {
  try {
    const files = readdirSync(OUT).filter((f) => /^snap\..*\.json$/.test(f)).sort();
    if (!files.length) return null;
    const j = JSON.parse(readFileSync(join(OUT, files[files.length - 1]), "utf8"));
    return j.hash ?? null;
  } catch { return null; }
}

async function main() {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  console.log(`[cap:history] 시작 — ${INTERVAL / 1000}초 간격, 변동 시에만 기록, 최근 ${KEEP}개 보관 → ${OUT}`);
  let prevHash = lastHash();
  let prev: any = null;
  for (;;) {
    let snap;
    try { snap = await dump(); }
    catch (e: any) { console.log(`[cap:history] ${new Date().toISOString().slice(11, 19)} 덤프 실패: ${e.message}`); await sleep(INTERVAL); continue; }

    const h = hashOf(snap);
    const t = new Date().toISOString().slice(11, 19);
    if (h === prevHash) {
      console.log(`[cap:history] ${t} 변동 없음 (flows ${snap.flows.length} nodes ${snap.nodes.length})`);
    } else {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      writeFileSync(join(OUT, `snap.${stamp}.json`),
        JSON.stringify({ takenAt: new Date().toISOString(), hash: h, counts: {
          flows: snap.flows.length, nodes: snap.nodes.length, edges: snap.edges.length,
          links: snap.links.length, settings: snap.settings.length,
        }, ...snap }, null, 2));
      let note = "";
      if (prev) {
        const goneNodes = [...keyset(prev)].filter((k) => !keyset(snap).has(k as string));
        const goneCards = [...slugset(prev)].filter((s) => !slugset(snap).has(s as string));
        if (goneCards.length || goneNodes.length) {
          note = `  ⚠ 소멸: 카드 ${goneCards.length} 노드 ${goneNodes.length}${goneNodes.length ? " (" + goneNodes.slice(0, 4).join(",") + ")" : ""} — 유실 가능(직전 스냅샷에 원본 보존)`;
        }
      }
      console.log(`[cap:history] ${t} ✎ 기록 (flows ${snap.flows.length} nodes ${snap.nodes.length})${note}`);
      prevHash = h;
      prune();
    }
    prev = snap;
    await sleep(INTERVAL);
  }
}
main().catch((e) => { console.error("[cap:history] 실패:", e); process.exit(1); });
