// Only creates two new tables. No existing table/data replacement; never use drizzle-kit push here.
import "dotenv/config";
import postgres from "postgres";
const client = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
try {
  await client.begin(async (tx) => {
    await tx`CREATE TABLE IF NOT EXISTS cap_edit_operations (id TEXT PRIMARY KEY, resource TEXT NOT NULL, editor TEXT NOT NULL, session TEXT NOT NULL, taken_at BIGINT NOT NULL, changes TEXT NOT NULL, request TEXT NOT NULL)`;
    await tx`CREATE INDEX IF NOT EXISTS idx_cap_edit_resource ON cap_edit_operations (resource, taken_at)`;
    await tx`CREATE TABLE IF NOT EXISTS cap_editors (session TEXT PRIMARY KEY, editor TEXT NOT NULL, resource TEXT, seen_at BIGINT NOT NULL)`;
  });
  console.log("Created collaboration operation history and presence tables; existing data unchanged.");
} finally { await client.end(); }
