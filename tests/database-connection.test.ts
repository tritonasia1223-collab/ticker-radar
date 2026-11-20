import { expect, it } from "vitest";
import { runtimeDatabaseUrl } from "../server/database-connection";
it("only selects the same Supabase pooler's transaction endpoint in serverless", () => {
  const session="postgres://postgres.example:dummy@aws-0-example.pooler.supabase.com:5432/postgres?sslmode=require";
  const transaction=runtimeDatabaseUrl(session,true);
  expect(new URL(transaction).port).toBe("6543");
  expect(new URL(transaction).hostname).toBe(new URL(session).hostname);
  expect(new URL(transaction).username).toBe(new URL(session).username);
  expect(new URL(transaction).pathname).toBe(new URL(session).pathname);
  expect(runtimeDatabaseUrl(session,false)).toBe(session);
  for(const url of ["postgres://local:dummy@localhost:5432/db", "postgres://user:dummy@db.example.supabase.co:5432/postgres",transaction]) expect(runtimeDatabaseUrl(url,true)).toBe(url);
});
