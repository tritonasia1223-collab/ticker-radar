import { afterEach, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
const fixture = vi.hoisted(() => ({ clients: [] as any[] }));
vi.mock("postgres", () => ({ default: () => {
  const client = { id: fixture.clients.length + 1, unsafe: vi.fn(async () => []), end: vi.fn(async () => {}) };
  fixture.clients.push(client);
  return client;
} }));
vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: (client: any) => ({ execute: async () => client.id }) }));
import { db, withDatabaseRequest } from "../server/storage";
afterEach(() => { fixture.clients.length = 0; vi.unstubAllEnvs(); });

it("isolates overlapping request connections and closes each after its own work", async () => {
  vi.stubEnv("DATABASE_URL", "postgres://test:test@localhost/test");
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const a = withDatabaseRequest(async () => {
    const first = await db.execute(sql`select 1`);
    await barrier;
    expect(await db.execute(sql`select 1`)).toBe(first);
    return first;
  });
  const b = withDatabaseRequest(async () => {
    const first = await db.execute(sql`select 1`);
    release();
    await Promise.resolve();
    expect(await db.execute(sql`select 1`)).toBe(first);
    return first;
  });
  expect(new Set(await Promise.all([a, b])).size).toBe(2);
  expect(fixture.clients).toHaveLength(2);
  for (const client of fixture.clients) {
    expect(client.unsafe).toHaveBeenCalledWith("select 1");
    expect(client.end).toHaveBeenCalledTimes(1);
  }
});

it("closes failed work without replaying its write", async () => {
  vi.stubEnv("DATABASE_URL", "postgres://test:test@localhost/test");
  const write = vi.fn(async () => { throw Error("save failed"); });
  await expect(withDatabaseRequest(write)).rejects.toThrow("save failed");
  expect(write).toHaveBeenCalledTimes(1);
  expect(fixture.clients[0].end).toHaveBeenCalledTimes(1);
});
