// 자본주의 app-level 설정 키-값 테이블만 안전하게 추가 (IF NOT EXISTS, 비파괴).
//   실행:  npx tsx script/db-push-capitalism-settings.ts
// ⚠️ 공유 Supabase 규약: drizzle-kit push 금지. 이 raw SQL 스크립트로만 DDL 적용.
import "dotenv/config";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL 이 없습니다."); process.exit(1); }
const sql = postgres(url, { prepare: false });

async function main() {
  console.log("cap_settings 테이블 생성(IF NOT EXISTS)…");
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS cap_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at BIGINT NOT NULL
  )`);
  console.log("✅ 완료 — cap_settings (key, value, updated_at)");
  await sql.end();
  process.exit(0);
}
main().catch(async (e) => { console.error("실패:", e); try { await sql.end(); } catch {} process.exit(1); });
