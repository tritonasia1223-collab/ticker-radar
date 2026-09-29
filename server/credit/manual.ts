import { parse } from "csv-parse/sync";
import { config, dateSchema, pointSchema, type Snapshot, type Point } from "../../shared/credit/schema.js";
import { configHash } from "./sources.js";

export function importManualCsv(text: string, previous: Snapshot | null, now = new Date()): Snapshot {
  const rows = parse(text, { columns: true, bom: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
  const sources = new Map(config.sources.filter(s => s.provider === "manual" || s.manualAllowed).map(s => [s.key, s]));
  const grouped = new Map<string, Point[]>(); const seen = new Set<string>(); const today = now.toISOString().slice(0, 10);
  for (const [idx, row] of rows.entries()) {
    const error = (message: string) => new Error(`CSV ${idx + 2}행: ${message}`);
    const src = sources.get(row.source_key); if (!src) throw error("등록된 수동 입력 계열이 아닙니다.");
    if (!row.value?.trim()) continue;
    if (!dateSchema.safeParse(row.observation_date).success || !dateSchema.safeParse(row.published_at).success) throw error("관측일·발표일은 YYYY-MM-DD가 필요합니다.");
    if (row.published_at < row.observation_date || row.published_at > today) throw error("발표일은 관측일 이후, 오늘 이하여야 합니다.");
    if (row.unit !== src.unit || row.basis !== src.basis) throw error("설정의 단위·분모 기준과 일치하지 않습니다.");
    const value = Number(row.value); if (!Number.isFinite(value) || value < 0 || (src.unit === "percent" && value > 100)) throw error("숫자·범위를 확인하세요.");
    try { if (!/^https?:$/.test(new URL(row.source_url).protocol)) throw error("출처 주소 오류"); } catch { throw error("출처 HTTP(S) 주소가 필요합니다."); }
    const key = row.source_key + ":" + row.observation_date; if (seen.has(key)) throw error("동일 계열·관측일이 중복되었습니다."); seen.add(key);
    const point = pointSchema.parse({ date: row.observation_date, value, publishedAt: row.published_at, basis: row.basis, sourceUrl: row.source_url });
    grouped.set(src.key, [...(grouped.get(src.key) ?? []), point]);
  }
  if (!grouped.size) throw new Error("입력된 값이 없습니다. 템플릿의 빈 칸을 채워주세요.");
  const snapshot: Snapshot = structuredClone(previous ?? { version: 1, collectedAt: now.toISOString(), configHash: configHash(), series: [] });
  snapshot.collectedAt = now.toISOString(); snapshot.configHash = configHash();
  for (const [key, points] of grouped) {
    const existing = snapshot.series.find(s => s.key === key); const byDate = new Map(existing?.points.map(p => [p.date, p]) ?? []);
    points.forEach(p => byDate.set(p.date, p));
    const next = { key, checkedAt: now.toISOString(), transport: "검증된 수동 CSV", notes: [], points: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)) };
    if (existing) Object.assign(existing, next, { error: undefined }); else snapshot.series.push(next);
  }
  return snapshot;
}
