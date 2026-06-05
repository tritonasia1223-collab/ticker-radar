import { defineConfig } from "drizzle-kit";

// ⚠️ #26: 이 설정을 공유 Supabase(Postgres)로 가리키지 말 것. drizzle-kit push 는 전-DB diff 라
//   미선언 테이블을 DROP ... CASCADE 로 날린다(= insiders orphan 근본원인). 운영 DDL 은 raw 스크립트로만
//   (script/db-push-*.ts, db-fk-insider.ts). `npm run db:push` 는 db-push-guard 로 차단돼 있음.
//   아래 sqlite/로컬 설정은 일부러 무해하게 둔 것 — 운영 DB credential 로 바꾸지 말 것.
export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: "./data.db",
  },
});
