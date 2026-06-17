// 자본주의 경제사 타임라인 테이블만 안전하게 추가 (IF NOT EXISTS). 기존 테이블 안 건드림.
//   실행:  npx tsx script/db-push-capitalism.ts
// ⚠️ 공유 Supabase 규약: drizzle-kit push 금지. 이 raw SQL 스크립트로만 DDL 적용.
import "dotenv/config";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL 이 없습니다."); process.exit(1); }
const sql = postgres(url, { prepare: false });

const statements = [
  `CREATE TABLE IF NOT EXISTS cap_flows (
     id SERIAL PRIMARY KEY,
     slug TEXT NOT NULL UNIQUE,
     date TEXT NOT NULL,
     year INTEGER NOT NULL,
     title TEXT NOT NULL,
     category TEXT NOT NULL DEFAULT '경제',
     layout TEXT NOT NULL DEFAULT 'stack',
     sort_order INTEGER NOT NULL DEFAULT 0,
     created_at BIGINT NOT NULL,
     updated_at BIGINT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_cap_flows_year ON cap_flows (year)`,

  `CREATE TABLE IF NOT EXISTS cap_nodes (
     id SERIAL PRIMARY KEY,
     flow_id INTEGER NOT NULL REFERENCES cap_flows(id) ON DELETE CASCADE,
     node_key TEXT NOT NULL,
     kind TEXT NOT NULL DEFAULT 'effect',
     in_label TEXT,
     text TEXT NOT NULL,
     ref TEXT,
     col TEXT,
     pos INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE INDEX IF NOT EXISTS idx_cap_nodes_flow ON cap_nodes (flow_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_cap_node ON cap_nodes (flow_id, node_key)`,

  `CREATE TABLE IF NOT EXISTS cap_edges (
     id SERIAL PRIMARY KEY,
     flow_id INTEGER NOT NULL REFERENCES cap_flows(id) ON DELETE CASCADE,
     from_key TEXT NOT NULL,
     to_key TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_cap_edges_flow ON cap_edges (flow_id)`,

  // 보드 전역 사용자 화살표(카드 내/간 모두). 노드는 (slug, node_key) 로 전역 식별.
  // cap_edges 와 달리 flow_id 에 묶이지 않으므로 카드 경계를 넘는 연결을 저장할 수 있다.
  `CREATE TABLE IF NOT EXISTS cap_links (
     id SERIAL PRIMARY KEY,
     from_slug TEXT NOT NULL,
     from_key TEXT NOT NULL,
     to_slug TEXT NOT NULL,
     to_key TEXT NOT NULL,
     created_at BIGINT NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_cap_link ON cap_links (from_slug, from_key, to_slug, to_key)`,
];

async function main() {
  console.log("자본주의 타임라인 테이블 생성(IF NOT EXISTS)…");
  for (const s of statements) await sql.unsafe(s);
  console.log("✅ 완료 — cap_flows, cap_nodes, cap_edges, cap_links");
  await sql.end();
  process.exit(0);
}
main().catch(async (e) => { console.error("실패:", e); try { await sql.end(); } catch {} process.exit(1); });
