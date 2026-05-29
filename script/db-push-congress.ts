// 정치인 모듈 테이블만 공유 Supabase 에 안전하게 추가한다.
//   실행:  npx tsx script/db-push-congress.ts
// drizzle.config.ts 가 아직 sqlite 를 가리키고 있어 `db:push` 를 쓰지 않고,
// 우리 새 테이블 4개만 CREATE TABLE IF NOT EXISTS 로 멱등하게 만든다.
// (기존 SNS 테이블/데이터는 절대 건드리지 않음)
import "dotenv/config";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL 이 없습니다."); process.exit(1); }
const sql = postgres(url, { prepare: false });

const statements = [
  `CREATE TABLE IF NOT EXISTS politicians (
     id SERIAL PRIMARY KEY,
     slug TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL,
     party TEXT,
     chamber TEXT NOT NULL,
     state TEXT,
     bioguide_id TEXT,
     created_at BIGINT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_pol_chamber ON politicians (chamber)`,
  `CREATE TABLE IF NOT EXISTS committees (
     id TEXT PRIMARY KEY,
     ko TEXT NOT NULL,
     name TEXT NOT NULL,
     chamber TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS politician_committees (
     politician_id INTEGER NOT NULL,
     committee_id TEXT NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_pol_cmt ON politician_committees (politician_id, committee_id)`,
  `CREATE INDEX IF NOT EXISTS idx_polcmt_cmt ON politician_committees (committee_id)`,
  `CREATE TABLE IF NOT EXISTS political_trades (
     id SERIAL PRIMARY KEY,
     politician_id INTEGER NOT NULL,
     symbol TEXT NOT NULL,
     company TEXT,
     side TEXT NOT NULL,
     amount_low BIGINT,
     amount_high BIGINT,
     txn_date BIGINT NOT NULL,
     filed_date BIGINT,
     source TEXT NOT NULL DEFAULT 'fmp',
     verification TEXT NOT NULL DEFAULT 'pending_official',
     external_id TEXT,
     created_at BIGINT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_ptrade_symbol ON political_trades (symbol)`,
  `CREATE INDEX IF NOT EXISTS idx_ptrade_pol ON political_trades (politician_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ptrade_txn ON political_trades (txn_date)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_ptrade_ext ON political_trades (external_id)`,
];

async function main() {
  console.log("정치인 테이블 생성(IF NOT EXISTS)…");
  for (const s of statements) await sql.unsafe(s);
  console.log("✅ 완료 — politicians, committees, politician_committees, political_trades");
  await sql.end();
  process.exit(0);
}
main().catch(async (e) => { console.error("실패:", e); try { await sql.end(); } catch {} process.exit(1); });
