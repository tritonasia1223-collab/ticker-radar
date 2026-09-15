// cap_nodes 에 파랑 보충/첨삭 메모용 ref_blue 컬럼만 안전하게 추가 (IF NOT EXISTS, 비파괴).
//   실행:  npx tsx script/db-push-cap-node-refblue.ts
// ⚠️ 공유 Supabase 규약: drizzle-kit push 금지. 이 raw SQL 스크립트로만 DDL 적용.
//   ADD COLUMN IF NOT EXISTS 는 기존 행에 NULL 만 채우므로 기존 데이터(노랑 ref 포함) 무손실.
import "dotenv/config";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL 이 없습니다."); process.exit(1); }
const sql = postgres(url, { prepare: false });

async function main() {
  console.log("cap_nodes.ref_blue 컬럼 추가(IF NOT EXISTS)…");
  await sql.unsafe(`ALTER TABLE cap_nodes ADD COLUMN IF NOT EXISTS ref_blue TEXT`);
  console.log("✅ 완료 — cap_nodes.ref_blue (nullable). 기존 노랑 ref·데이터 무손실.");
  await sql.end();
  process.exit(0);
}
main().catch(async (e) => { console.error("실패:", e); try { await sql.end(); } catch {} process.exit(1); });
