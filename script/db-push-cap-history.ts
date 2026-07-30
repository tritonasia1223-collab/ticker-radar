// 카드 버전 히스토리(cap_flow_history) 테이블만 안전하게 추가 (IF NOT EXISTS). 기존 테이블 안 건드림.
//   실행:  npm run cap:history:init   (= npx tsx script/db-push-cap-history.ts)
// ⚠️ 공유 Supabase 규약: drizzle-kit push 금지(#26). 신규 DDL 은 이 raw SQL 스크립트로만 적용한다.
import "dotenv/config";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL 이 없습니다."); process.exit(1); }
const sql = postgres(url, { prepare: false });

const statements = [
  // version-on-write: 카드를 덮어쓰기/삭제하기 직전 상태를 append. FK 없음(카드 삭제돼도 히스토리 보존).
  `CREATE TABLE IF NOT EXISTS cap_flow_history (
     id        SERIAL PRIMARY KEY,
     flow_slug TEXT NOT NULL,
     taken_at  BIGINT NOT NULL,
     reason    TEXT NOT NULL,
     snapshot  TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_cap_hist_slug ON cap_flow_history (flow_slug, id)`,
];

async function main() {
  console.log("cap_flow_history 테이블 생성(IF NOT EXISTS)…");
  for (const s of statements) await sql.unsafe(s);
  console.log("✅ 완료 — cap_flow_history");
  await sql.end();
  process.exit(0);
}
main().catch(async (e) => { console.error("실패:", e); try { await sql.end(); } catch {} process.exit(1); });
