// 카드 버전 히스토리(cap_flow_history) 조회·복구 도구.
//   목록:  npm run cap:versions -- "그리스 부도"          (제목/슬러그로 카드 버전 나열)
//   검색:  npm run cap:versions -- find "인민은행이 헤지펀드"  (전 버전에서 텍스트 검색)
//   보기:  npm run cap:versions -- show 123               (버전 123 전문)
//   복구:  npm run cap:versions -- restore 123            (버전 123을 라이브로 되돌림; 현재 상태도 히스토리에 남음)
import "dotenv/config";
import { db } from "../server/storage.js";
import { capFlowHistory, capFlows } from "../shared/schema.js";
import { upsertFlow } from "../server/capitalism.js";
import { eq, desc } from "drizzle-orm";

const argv = process.argv.slice(2);
const when = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);

async function list(q: string) {
  const flows = await db.select().from(capFlows);
  const match = flows.filter((f) => f.slug === q || f.title.includes(q));
  const slugs = match.length ? match.map((f) => f.slug) : [q]; // 못 찾으면 slug 로 간주(삭제된 카드도 조회)
  for (const slug of slugs) {
    const rows = await db.select().from(capFlowHistory).where(eq(capFlowHistory.flowSlug, slug)).orderBy(desc(capFlowHistory.id));
    const title = flows.find((f) => f.slug === slug)?.title ?? "(삭제됨)";
    console.log(`\n■ ${slug}  "${title}"  — 버전 ${rows.length}개`);
    for (const r of rows) {
      const snap = JSON.parse(r.snapshot);
      console.log(`  id=${String(r.id).padStart(5)} | ${when(r.takenAt)} | ${r.reason.padEnd(7)} | 노드 ${snap.nodes?.length ?? 0}`);
    }
  }
}

async function find(term: string) {
  const rows = await db.select().from(capFlowHistory).orderBy(desc(capFlowHistory.id));
  const best = new Map<string, { id: number; when: number; slug: string; field: string; len: number; text: string }>();
  for (const r of rows) {
    let snap: any; try { snap = JSON.parse(r.snapshot); } catch { continue; }
    for (const n of snap.nodes ?? []) {
      for (const [field, val] of [["text", n.text], ["ref", n.ref]] as const) {
        if (val && String(val).includes(term)) {
          const k = `${n.nodeKey}:${field}`;
          const cur = best.get(k);
          if (!cur || String(val).length > cur.len) best.set(k, { id: r.id, when: r.takenAt, slug: r.flowSlug, field, len: String(val).length, text: String(val) });
        }
      }
    }
  }
  if (!best.size) { console.log(`"${term}" 없음(히스토리 ${rows.length}개 검색).`); return; }
  console.log(`"${term}" 발견 — 가장 온전한 버전순:\n`);
  for (const [k, v] of [...best.entries()].sort((a, b) => b[1].len - a[1].len)) {
    console.log(`━━ ${k} [${v.field}, ${v.len}자 · 버전 id=${v.id} · ${when(v.when)} · ${v.slug}] ━━`);
    console.log(v.text + "\n");
  }
  console.log(`복구하려면: npm run cap:versions -- restore <id>  (그 버전의 카드 전체를 되돌림)`);
}

async function show(id: number) {
  const r = (await db.select().from(capFlowHistory).where(eq(capFlowHistory.id, id))).at(0);
  if (!r) { console.log(`버전 ${id} 없음`); return; }
  const snap = JSON.parse(r.snapshot);
  console.log(`버전 ${id} | ${when(r.takenAt)} | ${r.reason} | ${r.flowSlug} | "${snap.flow?.title}"`);
  for (const n of (snap.nodes ?? []).slice().sort((a: any, b: any) => a.pos - b.pos)) {
    console.log(`\n[pos ${n.pos} · col ${n.col ?? "-"}] ${n.nodeKey}`);
    console.log("  text:", (n.text || "").replace(/\n/g, " "));
    if (n.ref) console.log("  ref :", n.ref.replace(/\n/g, " "));
  }
}

async function restore(id: number) {
  const r = (await db.select().from(capFlowHistory).where(eq(capFlowHistory.id, id))).at(0);
  if (!r) { console.log(`버전 ${id} 없음`); return; }
  const s = JSON.parse(r.snapshot);
  const f = s.flow;
  const nodes = (s.nodes ?? []).slice().sort((a: any, b: any) => a.pos - b.pos);
  const input = {
    slug: f.slug, date: f.date, endDate: f.endDate ?? null, year: f.year, title: f.title,
    category: f.category, layout: f.layout,
    insight: f.insight ? JSON.parse(f.insight) : null,
    sortOrder: f.sortOrder,
    nodes: nodes.map((n: any) => ({ nodeKey: n.nodeKey, kind: n.kind, inLabel: n.inLabel, text: n.text, ref: n.ref, col: n.col, table: n.tableData ? JSON.parse(n.tableData) : null })),
    edges: (s.edges ?? []).map((e: any) => ({ from: e.fromKey, to: e.toKey })),
  };
  const restored = await upsertFlow(input); // 현재 상태는 upsert 가 히스토리에 남김 → 복구도 되돌릴 수 있음
  console.log(`✅ 복구 완료 — ${restored.slug} "${restored.title}" (노드 ${restored.nodes.length}). 브라우저 새로고침하면 반영됩니다.`);
}

async function main() {
  const [cmd, ...rest] = argv;
  if (!cmd) { console.log('사용법: cap:versions -- "제목" | find "텍스트" | show <id> | restore <id>'); process.exit(0); }
  if (cmd === "find") await find(rest.join(" "));
  else if (cmd === "show") await show(Number(rest[0]));
  else if (cmd === "restore") await restore(Number(rest[0]));
  else await list(argv.join(" "));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
