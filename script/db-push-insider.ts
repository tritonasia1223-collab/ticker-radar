// 내부자거래 테이블만 안전하게 추가 (IF NOT EXISTS). 기존 테이블 안 건드림.
//   실행:  npx tsx script/db-push-insider.ts
import "dotenv/config";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL 이 없습니다."); process.exit(1); }
const sql = postgres(url, { prepare: false });

const statements = [
  `CREATE TABLE IF NOT EXISTS insiders (
     id SERIAL PRIMARY KEY,
     slug TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL,
     created_at BIGINT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS insider_trades (
     id SERIAL PRIMARY KEY,
     insider_id INTEGER NOT NULL,
     symbol TEXT NOT NULL,
     txn_code TEXT,
     side TEXT NOT NULL,
     shares BIGINT,
     price REAL,
     value BIGINT,
     txn_date BIGINT NOT NULL,
     filed_date BIGINT,
     external_id TEXT,
     created_at BIGINT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_itrade_symbol ON insider_trades (symbol)`,
  `CREATE INDEX IF NOT EXISTS idx_itrade_insider ON insider_trades (insider_id)`,
  `CREATE INDEX IF NOT EXISTS idx_itrade_txn ON insider_trades (txn_date)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_itrade_ext ON insider_trades (external_id)`,
  `ALTER TABLE insider_trades ADD COLUMN IF NOT EXISTS role TEXT`,
];

async function main() {
  console.log("내부자거래 테이블 생성(IF NOT EXISTS)…");
  for (const s of statements) await sql.unsafe(s);
  console.log("✅ 완료 — insiders, insider_trades");
  await sql.end();
  process.exit(0);
}
main().catch(async (e) => { console.error("실패:", e); try { await sql.end(); } catch {} process.exit(1); });
