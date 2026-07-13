// Fed 대차대조표 백필/증분 수집 — FRED 공개 CSV(fredgraph.csv, 키 불요) → 단위정규화 → upsert.
//   전체 백필(1회):  npm run fed:backfill
//   주간 cron(증분):  npm run fed:backfill -- --only weekly --recent 35
//   일간 cron(증분):  npm run fed:backfill -- --only daily  --recent 10
// upsert(on conflict) 라 재실행 멱등 — 수정치가 나중에 반영돼도 덮어쓴다.
import "dotenv/config";
import { db } from "../server/storage.js";
import { fedBalanceSheet } from "../shared/schema.js";
import { SERIES, normalizeToMusd, type SeriesSpec } from "../server/fed.js";
import { sql } from "drizzle-orm";

const FREDGRAPH = "https://fred.stlouisfed.org/graph/fredgraph.csv";
const UA = "ticker-radar admin@tritonasia1223.com"; // FRED 매너: 식별 UA
const FULL_START = "2002-12-01"; // WALCL 최초 관측(2002-12). 시리즈별 실제 시작은 CSV 가 알아서 반환.

// ── args ──
const argv = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}
const only = flag("only"); // "weekly" | "daily" | undefined(전체)
const recentDays = flag("recent") ? Number(flag("recent")) : undefined;

// cosd 계산: --recent N 이면 오늘−N일, 아니면 전체 시작일.
function cosd(): string {
  if (recentDays == null) return FULL_START;
  const d = new Date(Date.now() - recentDays * 86400_000);
  return d.toISOString().slice(0, 10);
}

const targets: SeriesSpec[] = SERIES.filter((s) => !only || s.freq === only);

async function fetchCsv(id: string, from: string): Promise<[string, number][]> {
  const url = `${FREDGRAPH}?id=${id}&cosd=${from}`;
  const resp = await fetch(url, { headers: { "User-Agent": UA } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const text = await resp.text();
  const out: [string, number][] = [];
  for (const line of text.split(/\r?\n/)) {
    const c = line.indexOf(",");
    if (c < 0) continue;
    const date = line.slice(0, c).trim();
    const raw = line.slice(c + 1).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue; // 헤더/빈줄 스킵
    if (raw === "" || raw === ".") continue;          // FRED 결측 마커
    const num = Number(raw);
    if (!Number.isFinite(num)) continue;
    out.push([date, num]);
  }
  return out;
}

async function upsertBatch(rows: { seriesId: string; obsDate: string; valueMusd: number }[]) {
  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    await db.insert(fedBalanceSheet).values(batch).onConflictDoUpdate({
      target: [fedBalanceSheet.seriesId, fedBalanceSheet.obsDate],
      set: { valueMusd: sql`excluded.value_musd` },
    });
  }
}

async function main() {
  const from = cosd();
  console.log(`[fed:backfill] ${targets.length}개 시리즈 (only=${only ?? "전체"}, cosd=${from})`);
  let totalRows = 0;
  for (const s of targets) {
    try {
      const obs = await fetchCsv(s.id, from);
      const rows = obs.map(([date, raw]) => ({
        seriesId: s.id, obsDate: date, valueMusd: normalizeToMusd(s.unit, raw),
      }));
      await upsertBatch(rows);
      totalRows += rows.length;
      const last = obs.at(-1);
      console.log(`  ${s.id.padEnd(18)} ${String(rows.length).padStart(5)}행  최신 ${last ? `${last[0]}=${normalizeToMusd(s.unit, last[1]).toLocaleString()}` : "-"}`);
    } catch (e: any) {
      console.error(`  ${s.id.padEnd(18)} ✗ 실패: ${e.message}`);
      process.exitCode = 1; // 한 시리즈 실패해도 나머지 계속, 종료코드로 신호
    }
  }
  console.log(`[fed:backfill] 완료 — 총 ${totalRows.toLocaleString()}행 upsert`);
  await db.end?.();
  process.exit(process.exitCode ?? 0);
}
main().catch(async (e) => { console.error("[fed:backfill] 치명 실패:", e); process.exit(1); });
