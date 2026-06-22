// cap_flows 에 사건 인사이트 저장용 insight 컬럼만 안전하게 추가 (IF NOT EXISTS, 비파괴).
//   실행:  npx tsx script/db-push-capitalism-insight.ts
// ⚠️ 공유 Supabase 규약: drizzle-kit push 금지. 이 raw SQL 스크립트로만 DDL 적용.
//   ADD COLUMN IF NOT EXISTS 는 기존 행에 NULL 만 채우므로 기존 데이터 무손실.
import "dotenv/config";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL 이 없습니다."); process.exit(1); }
const sql = postgres(url, { prepare: false });

async function main() {
  console.log("cap_flows.insight 컬럼 추가(IF NOT EXISTS)…");
  await sql.unsafe(`ALTER TABLE cap_flows ADD COLUMN IF NOT EXISTS insight TEXT`);
  console.log("✅ 완료 — cap_flows.insight (nullable)");
  await sql.end();
  process.exit(0);
}
main().catch(async (e) => { console.error("실패:", e); try { await sql.end(); } catch {} process.exit(1); });
