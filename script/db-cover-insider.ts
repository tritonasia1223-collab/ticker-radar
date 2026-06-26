// insider_trades.cover_tax 컬럼 추가 (sell-to-cover 세금매도 플래그). additive·nullable — 안전.
//   #26 규약: 공유 Supabase 엔 drizzle push 금지, raw ALTER 로만. IF NOT EXISTS 라 멱등.
//   실행:  npx tsx script/db-cover-insider.ts           (dry-run: 현황만)
//          npx tsx script/db-cover-insider.ts --apply   (운영 적용)
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../server/storage";

async function main() {
  const apply = process.argv.includes("--apply");
  const ex = (await db.execute(sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'insider_trades' AND column_name = 'cover_tax'`)) as unknown as any[];
  console.log(`cover_tax 컬럼 존재: ${ex.length ? "예" : "아니오"}`);
  if (ex.length) { console.log("이미 있음 — 변경 없음."); process.exit(0); }
  console.log("계획: ALTER TABLE insider_trades ADD COLUMN IF NOT EXISTS cover_tax BOOLEAN;");
  if (!apply) { console.log("(dry-run) 실제 적용은 --apply"); process.exit(0); }
  await db.execute(sql`ALTER TABLE insider_trades ADD COLUMN IF NOT EXISTS cover_tax BOOLEAN`);
  const after = (await db.execute(sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'insider_trades' AND column_name = 'cover_tax'`)) as unknown as any[];
  console.log(after.length ? "✅ cover_tax 컬럼 추가 완료" : "⚠️ 추가 후 확인 실패");
  process.exit(after.length ? 0 : 1);
}
main().catch((e) => { console.error("실패:", e); process.exit(1); });
