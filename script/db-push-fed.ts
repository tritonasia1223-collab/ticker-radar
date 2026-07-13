// Fed 대차대조표(H.4.1) 테이블만 안전하게 추가 (IF NOT EXISTS). 기존 테이블 안 건드림.
//   실행:  npx tsx script/db-push-fed.ts
// ⚠️ 공유 Supabase 규약: drizzle-kit push 금지(#26 — 전-DB diff 라 미선언 테이블 CASCADE DROP 위험).
//    신규 DDL 은 이 raw SQL 스크립트로만 적용한다.
import "dotenv/config";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL 이 없습니다."); process.exit(1); }
const sql = postgres(url, { prepare: false });

const statements = [
  // series_id + obs_date 복합 PK → cron 재실행 시 upsert(on conflict) 멱등.
  // value_musd 는 double precision: FRED 값은 정수(백만) 또는 지수(소수)라 float8 로 무손실·조회 편의.
  `CREATE TABLE IF NOT EXISTS fed_balance_sheet (
     series_id  TEXT NOT NULL,
     obs_date   TEXT NOT NULL,
     value_musd DOUBLE PRECISION,
     PRIMARY KEY (series_id, obs_date)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_fbs_date ON fed_balance_sheet (obs_date)`,
];

async function main() {
  console.log("Fed 대차대조표 테이블 생성(IF NOT EXISTS)…");
  for (const s of statements) await sql.unsafe(s);
  console.log("✅ 완료 — fed_balance_sheet");
  await sql.end();
  process.exit(0);
}
main().catch(async (e) => { console.error("실패:", e); try { await sql.end(); } catch {} process.exit(1); });
