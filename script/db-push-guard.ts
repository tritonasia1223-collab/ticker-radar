// #26 — `npm run db:push` 가드. drizzle-kit push 는 전(全)-DB diff 라, 공유 Supabase 에 쓰면
// shared/schema.ts 에 미선언인 테이블을 `DROP TABLE ... CASCADE` 로 날린다(FK까지 헐고) — 이게
// insiders orphan(#23~#26)의 근본원인이었다. 운영 DDL 은 항상 raw 마이그레이션 스크립트로만:
//   - 테이블 생성:  script/db-push-insider.ts / db-push-congress.ts  (CREATE TABLE IF NOT EXISTS)
//   - 제약 추가:    script/db-fk-insider.ts                          (ADD CONSTRAINT ... NOT VALID)
// 로컬 스키마 실험이 필요하면 일회용 컨테이너에서(반증 하네스 참고), 공유 DB 엔 절대 push 금지.
console.error(
  "\n⛔ db:push 차단 — drizzle-kit push 는 공유 Supabase 금지(전-DB diff 가 미선언 테이블을 DROP CASCADE = #23~#26 근본원인).\n" +
  "   운영 DDL 은 raw 스크립트로만:  script/db-push-*.ts (CREATE TABLE IF NOT EXISTS) · script/db-fk-insider.ts (ADD CONSTRAINT).\n" +
  "   사유가 분명하면 이 가드(script/db-push-guard.ts)를 의도적으로 우회하되, 공유 DB 엔 push 하지 말 것.\n"
);
process.exit(1);
