// #26 — insider_trades.insider_id 에 FK 제약 추가 (orphan 근본원인 방어).
//
// 배경/반증(로컬 PG16, T1~T5): 근본원인은 `drizzle-kit push` 가 전(全)-DB diff 라는 점 —
//   DB엔 있는데 shared/schema.ts엔 없는 테이블에 `DROP TABLE ... CASCADE` 를 생성해 FK까지 헐고
//   테이블을 날린다(→ insiders 재생성·serial 리셋·옛 거래 orphan = #23~#25). 따라서 FK는 '부분 보호'다:
//   평 DROP·수동실수는 막지만(T3a) CASCADE 는 못 막는다(T3b). 진짜 방어 = 이 FK + 도구운용 가드
//   (공유 Supabase에 db:push 금지, script/db-push-guard.ts) + orphan 탐지(#27).
//
// ON DELETE RESTRICT: 거래행이 남은 인사이더 삭제 차단(거래는 절대 잃으면 안 됨). clearInsiderData()
//   가 trades→insiders 순으로 지우므로 양립. relink(repair-orphan-links)는 UPDATE라 무관.
// NOT VALID: 운영 잔존 orphan(GOOG 47행 = 교차티커중복, 정상 A — 가드가 집계서 처리)은 진짜 FK
//   위반이라 validating ADD 는 거부됨(반증 T5a). NOT VALID 로 추가하면 기존행은 건너뛰고 '향후
//   신규/수정행 전방 강제'만 켠다(T5b: 추가 성공, T5c: 나쁜 ref 삽입 즉시 거부 확인).
//
//   실행:  npx tsx script/db-fk-insider.ts           (dry-run: 현황 + 적용계획만, 변경 없음)
//          npx tsx script/db-fk-insider.ts --apply   (운영 DB에 FK 추가)
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../server/storage";

// drizzle 명명 규칙(<table>_<col>_<reftable>_<refcol>_fk)과 동일 — 추후 schema.ts .references 와 한 제약을 가리키게.
const FK = "insider_trades_insider_id_insiders_id_fk";

async function main() {
  const apply = process.argv.includes("--apply");

  // 전(全) side orphan = FK 위반 후보(NOT VALID 가 건너뛸 기존행). P/S orphan = 스코어링 관련(게이트 대상).
  const orows = (await db.execute(sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE it.side IN ('buy','sell'))::int AS ps
    FROM insider_trades it LEFT JOIN insiders i ON i.id = it.insider_id
    WHERE i.id IS NULL`)) as unknown as any[];
  const total = Number(orows[0]?.total ?? 0), ps = Number(orows[0]?.ps ?? 0);

  const ex = (await db.execute(sql`SELECT 1 FROM pg_constraint WHERE conname = ${FK}`)) as unknown as any[];
  const exists = ex.length > 0;

  console.log(`현황 — orphan 전체 ${total}행(=FK 위반 후보, NOT VALID 가 건너뜀) · 그중 P/S ${ps}행(스코어링) · FK '${FK}' 존재: ${exists ? "예" : "아니오"}`);
  console.log(`  나머지 ${total - ps}행은 비-P/S(award/exercise/tax 등) 과거 잔존 — 스코어링 무관. P/S ${ps}행은 script/orphan-classify.ts 로 'B 진짜깨짐 0 · GOOG A만' 재확인.`);

  if (exists) { console.log("이미 FK 존재 — 변경 없음."); process.exit(0); }

  console.log(`계획: ALTER TABLE insider_trades ADD CONSTRAINT ${FK}\n        FOREIGN KEY (insider_id) REFERENCES insiders(id) ON DELETE RESTRICT NOT VALID;`);
  if (!apply) { console.log("(dry-run) 실제 적용은 --apply"); process.exit(0); }

  // NOT VALID 라 기존행 미검증·풀스캔 없음(빠름, 읽기 비차단). 이름은 DDL 에 리터럴로 박는다(식별자는 파라미터 불가).
  await db.execute(sql`
    ALTER TABLE insider_trades
    ADD CONSTRAINT insider_trades_insider_id_insiders_id_fk
    FOREIGN KEY (insider_id) REFERENCES insiders (id) ON DELETE RESTRICT NOT VALID`);

  const after = (await db.execute(sql`
    SELECT confdeltype, convalidated FROM pg_constraint WHERE conname = ${FK}`)) as unknown as any[];
  if (after.length) {
    console.log(`✅ FK 추가 완료 — ${FK} (ON DELETE ${after[0].confdeltype === "r" ? "RESTRICT" : after[0].confdeltype}, validated=${after[0].convalidated})`);
    process.exit(0);
  }
  console.log("⚠️ 추가 후 확인 실패"); process.exit(1);
}
main().catch((e) => { console.error("실패:", e); process.exit(1); });
