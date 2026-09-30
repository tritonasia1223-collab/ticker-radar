import { z } from "zod";
import rawConfig from "./credit_indicators.json" with { type: "json" };

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v);
const frequency = z.enum(["daily", "weekly", "monthly", "quarterly"]);
export const pointSchema = z.object({ date: dateSchema, value: z.number().finite(), adjustedValue: z.number().finite().optional(), publishedAt: dateSchema.optional(), effectiveAt: dateSchema.optional(), basis: z.string().optional(), sourceUrl: z.string().optional(), components: z.object({ numerator: z.number().finite(), denominator: z.number().positive() }).optional() });
export type Point = z.infer<typeof pointSchema>;
export const sourceSchema = z.object({ key: z.string(), label: z.string(), provider: z.enum(["fred", "yahoo", "sec", "manual", "xlsx", "sec_credit"]), frequency, unit: z.string(), seriesId: z.string().optional(), ticker: z.string().optional(), cik: z.string().optional(), namespace: z.string().optional(), tag: z.string().optional(), factUnit: z.string().optional(), adjusted: z.boolean().optional(), basis: z.string().optional(), metric: z.string().optional(), url: z.string().optional(), manualAllowed: z.boolean().optional(), workbook: z.object({ downloadUrl: z.string().url(), sheet: z.string(), column: z.string(), units: z.string(), security: z.string(), updateSheet: z.string() }).optional(), credit: z.object({ method: z.enum(["tagged", "table", "earnings"]), costTag: z.string().optional(), fairValueTag: z.string().optional(), pikTags: z.array(z.string()), pikAccruedTag: z.string().optional(), denominatorTag: z.string(), maxFilings: z.number().int().positive(), backfillFilings: z.number().int().positive().optional() }).optional() });
export type Source = z.infer<typeof sourceSchema>;
type Predicate = { indicator: string; metric: string; op: "gte" | "lte" | "absLt" | "absLte"; value: number; line?: string; minimum?: number; subtractLine?: string };
export type Rule = { all: Rule[] } | { any: Rule[] } | { not: Rule } | { signal: string } | { perLine: { indicator: string; minimum: number; conditions: Omit<Predicate, "indicator">[] } } | Predicate;
const predicateFields = { metric: z.string(), op: z.enum(["gte", "lte", "absLt", "absLte"]), value: z.number().finite(), line: z.string().optional(), minimum: z.number().int().positive().optional(), subtractLine: z.string().optional() } as const;
const ruleSchema: z.ZodType<Rule> = z.lazy(() => z.union([
  z.object({ all: z.array(ruleSchema).min(1) }), z.object({ any: z.array(ruleSchema).min(1) }), z.object({ not: ruleSchema }), z.object({ signal: z.string() }),
  z.object({ indicator: z.string(), ...predicateFields }),
  z.object({ perLine: z.object({ indicator: z.string(), minimum: z.number().int().positive(), conditions: z.array(z.object(predicateFields)).min(1) }) }),
]));
const indicatorSchema = z.object({ id: z.string(), name: z.string(), priority: z.number(), essential: z.boolean(), category: z.string(), frequency, measures: z.string(), role: z.string(), stress_direction: z.string(), signal_keys: z.array(z.string()).default([]), interpretation: z.string().optional(), caveats: z.array(z.string()).optional(), refresh: z.object({ publication: z.string(), collection: z.string(), url: z.string().url() }).optional(), source: z.object({ access: z.string() }).passthrough(), chart: z.object({ kind: z.enum(["series", "spread", "pnav", "manual", "group"]), unit: z.string(), indexed: z.boolean().optional(), marketYield: z.object({ key: z.string(), label: z.string() }).optional(), lines: z.array(z.object({ key: z.string(), label: z.string(), navKey: z.string().optional() })).min(1) }) });
export const config = z.object({ meta: z.object({ title: z.string(), version: z.string() }).passthrough(), settings: z.object({ collectionStaleDays: z.number(), historyYears: z.number(), lookbackYears: z.number(), staleDays: z.record(z.number()), toleranceDays: z.record(z.number()), minimumSamples: z.record(z.number()), coverageMin: z.number(), scoreMin: z.number(), mixedGap: z.number(), sourceTimeoutMs: z.number(), concurrency: z.number() }), sources: z.array(sourceSchema), paths: z.array(z.object({ path_id: z.string(), path_name: z.string(), description: z.string(), indicators: z.array(indicatorSchema) })), signals: z.record(ruleSchema), signalLabels: z.record(z.string()), scenarios: z.array(z.object({ id: z.string(), name: z.string(), interpretation: z.string(), rules: z.array(z.object({ signal: z.string(), weight: z.number().positive(), required: z.boolean() })), blockers: z.array(z.string()) })), summaries: z.array(z.object({ name: z.string(), signals: z.array(z.string()), calm: z.array(z.string()) })) }).parse(rawConfig);
export type Indicator = z.infer<typeof indicatorSchema>;
export const indicators = config.paths.flatMap(p => p.indicators);
// 연결 오류는 수집 전 차단한다. 지표별 정의는 JSON 한 곳에서만 읽는다.
const keys = new Set(config.sources.map(s => s.key));
if (keys.size !== config.sources.length || new Set(indicators.map(i => i.id)).size !== indicators.length) throw new Error("신용 설정에 중복 ID가 있습니다.");
for (const i of indicators) for (const l of i.chart.lines) if (!keys.has(l.key) || (l.navKey && !keys.has(l.navKey))) throw new Error("신용 설정 원계열 참조 오류: " + i.id);
for (const i of indicators) if (i.chart.marketYield && !keys.has(i.chart.marketYield.key)) throw new Error("회사채 시장금리 참조 오류: " + i.id);
function validateRule(rule: Rule, visited = new Set<string>()) {
  if ("signal" in rule) { if (!config.signals[rule.signal] || visited.has(rule.signal)) throw new Error("신용 신호 참조/순환 오류"); validateRule(config.signals[rule.signal], new Set([...visited, rule.signal])); }
  else if ("all" in rule) rule.all.forEach(r => validateRule(r, visited));
  else if ("any" in rule) rule.any.forEach(r => validateRule(r, visited));
  else if ("not" in rule) validateRule(rule.not, visited);
  else if (!indicators.some(i => i.id === ("perLine" in rule ? rule.perLine.indicator : rule.indicator))) throw new Error("신용 지표 참조 오류");
}
Object.values(config.signals).forEach(r => validateRule(r));
export const seriesSchema = z.object({ key: z.string(), points: z.array(pointSchema), checkedAt: z.string(), transport: z.string(), error: z.string().optional(), notes: z.array(z.string()).default([]) });
export type Series = z.infer<typeof seriesSchema>;
export const snapshotSchema = z.object({ version: z.literal(1), collectedAt: z.string().datetime(), configHash: z.string(), series: z.array(seriesSchema) });
export type Snapshot = z.infer<typeof snapshotSchema>;
