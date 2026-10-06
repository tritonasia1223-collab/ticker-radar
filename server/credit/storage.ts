import { sql } from "drizzle-orm";
import { db } from "../storage.js";
import { snapshotSchema, type Snapshot } from "../../shared/credit/schema.js";
import { analyze } from "../../shared/credit/signals.js";
import { creditSignals } from "../../shared/credit/scenarios.js";
import { randomUUID } from "node:crypto";

// 이 모듈의 전용 테이블만 추가한다. 공유 DB 전체 스키마 동기화를 하지 않는다.
export async function initializeCreditStorage() {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS credit_collection_runs (id TEXT PRIMARY KEY, collected_at TIMESTAMPTZ NOT NULL, config_hash TEXT NOT NULL, payload JSONB NOT NULL)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS credit_collection_runs_time ON credit_collection_runs (collected_at DESC)`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS credit_observation_versions (run_id TEXT NOT NULL REFERENCES credit_collection_runs(id), series_key TEXT NOT NULL, observation_date TEXT NOT NULL, published_at TEXT NOT NULL DEFAULT '', value DOUBLE PRECISION NOT NULL, PRIMARY KEY(run_id, series_key, observation_date, published_at))`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS credit_observation_versions_lookup ON credit_observation_versions(series_key, observation_date, published_at)`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS credit_analysis_snapshots (run_id TEXT PRIMARY KEY REFERENCES credit_collection_runs(id), as_of TEXT NOT NULL, config_hash TEXT NOT NULL, payload JSONB NOT NULL)`);
}
export async function readCreditSnapshot(): Promise<Snapshot | null> {
  const rows = await db.execute(sql`SELECT payload FROM credit_collection_runs ORDER BY collected_at DESC LIMIT 1`);
  return rows[0] ? snapshotSchema.parse(rows[0].payload) : null;
}
export async function saveCreditSnapshot(input: Snapshot) {
  const snapshot = snapshotSchema.parse(input); const id = randomUUID();
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('credit-monitor:collection'))`);
    const old = await tx.execute(sql`SELECT payload FROM credit_collection_runs ORDER BY collected_at DESC LIMIT 1`);
    const previous = old[0] ? snapshotSchema.parse(old[0].payload) : null;
    if (previous && previous.collectedAt > snapshot.collectedAt) throw new Error("더 최신 수집본이 있어 저장을 건너뜁니다.");
    // 수집과 수동 입력이 겹쳐도 최신 자료를 지우지 않는다.
    for (const s of snapshot.series) {
      const prior = previous?.series.find(p => p.key === s.key);
      if (prior && (prior.checkedAt > s.checkedAt || (s.error && prior.points.length))) s.points = prior.points;
    }
    await tx.execute(sql`INSERT INTO credit_collection_runs(id, collected_at, config_hash, payload) VALUES (${id}, ${snapshot.collectedAt}, ${snapshot.configHash}, ${JSON.stringify(snapshot)}::jsonb)`);
    const previousValues = new Map(previous?.series.flatMap(s => s.points.map(p => [s.key + ":" + p.date + ":" + (p.publishedAt ?? ""), p.value] as const)) ?? []);
    const changed = snapshot.series.flatMap(s => s.points.filter(p => previousValues.get(s.key + ":" + p.date + ":" + (p.publishedAt ?? "")) !== p.value).map(p => ({ series_key: s.key, observation_date: p.date, published_at: p.publishedAt ?? "", value: p.value })));
    for (let n = 0; n < changed.length; n += 2000) {
      const block = JSON.stringify(changed.slice(n, n + 2000));
      await tx.execute(sql`INSERT INTO credit_observation_versions(run_id, series_key, observation_date, published_at, value) SELECT ${id}, x.series_key, x.observation_date, x.published_at, x.value FROM jsonb_to_recordset(${block}::jsonb) AS x(series_key TEXT, observation_date TEXT, published_at TEXT, value DOUBLE PRECISION) ON CONFLICT DO NOTHING`);
    }
    const asOf = snapshot.collectedAt.slice(0, 10), result = analyze(snapshot, asOf);
    await tx.execute(sql`INSERT INTO credit_analysis_snapshots(run_id, as_of, config_hash, payload) VALUES (${id}, ${asOf}, ${snapshot.configHash}, ${JSON.stringify(creditSignals(result))}::jsonb)`);
  });
  return id;
}
