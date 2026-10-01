import { config, type Rule } from "./schema.js";
import type { IndicatorAnalysis } from "./signals.js";
import { weeklyGapTrend } from "./trends.js";

export type Verdict = true | false | null;
export interface Evidence { indicator: string; line: string; metric: string; value: number | null; expected: string; date: string | null; from?: string; status: Verdict; reason?: string }
export interface Evaluation { status: Verdict; evidence: Evidence[] }
export function evaluate(rule: Rule, data: IndicatorAnalysis[]): Evaluation {
  if ("signal" in rule) return evaluate(config.signals[rule.signal], data);
  if ("weeklyGapTrend" in rule) return weeklyGapTrend(rule.weeklyGapTrend, data);
  if ("not" in rule) { const r = evaluate(rule.not, data); return { ...r, status: r.status === null ? null : !r.status }; }
  if ("perLine" in rule) {
    const group = rule.perLine; const row = data.find(i => i.id === group.indicator);
    const results = row?.lines.map(l => evaluate({ all: group.conditions.map(p => ({ ...p, indicator: group.indicator })) }, [{ ...row, lines: [l] }])) ?? [];
    const yes = results.filter(r => r.status === true).length, unknown = results.filter(r => r.status === null).length;
    return { status: results.length < group.minimum ? null : yes >= group.minimum ? true : yes + unknown >= group.minimum ? null : false, evidence: results.flatMap(r => r.evidence) };
  }
  if ("all" in rule || "any" in rule) {
    const isAll = "all" in rule; const results = (isAll ? rule.all : rule.any).map(r => evaluate(r, data));
    const status = isAll ? results.some(r => r.status === false) ? false : results.some(r => r.status === null) ? null : true : results.some(r => r.status === true) ? true : results.some(r => r.status === null) ? null : false;
    return { status, evidence: results.flatMap(r => r.evidence) };
  }
  const rows = data.find(i => i.id === rule.indicator)?.lines.filter(l => !rule.line || l.key.includes(rule.line)) ?? [];
  const evidence: Evidence[] = rows.map(l => {
    let v = l.metrics[rule.metric] ?? null;
    const sub = rule.subtractLine ? data.find(i => i.id === rule.indicator)?.lines.find(l => l.key === rule.subtractLine) : null;
    if (rule.subtractLine) v = v !== null && sub && !sub.stale && !sub.errors.length && sub.metrics[rule.metric] != null ? v - sub.metrics[rule.metric]! : null;
    const unknown = v === null || l.stale || l.errors.length > 0;
    const status = unknown || v === null ? null : rule.op === "gte" ? v >= rule.value : rule.op === "lte" ? v <= rule.value : rule.op === "absLt" ? Math.abs(v) < rule.value : Math.abs(v) <= rule.value;
    return { indicator: rule.indicator, line: l.label, metric: rule.metric, value: v, expected: `${rule.op} ${rule.value}`, date: l.latest?.date ?? null, from: /4/.test(rule.metric) ? l.changes[4]?.from : undefined, status, reason: unknown ? l.errors.length ? "최근 수집 실패" : l.stale ? "자료 없음·갱신 지연" : "비교 관측 부족" : undefined };
  });
  const required = rule.minimum ?? rows.length;
  const yes = evidence.filter(e => e.status === true).length, unknown = evidence.filter(e => e.status === null).length;
  return { status: !rows.length || rows.length < required ? null : yes >= required ? true : yes + unknown >= required ? null : false, evidence };
}
export function scenarios(data: IndicatorAnalysis[]) {
  const signals = Object.fromEntries(Object.entries(config.signals).map(([key, rule]) => [key, evaluate(rule, data)]));
  const rows = config.scenarios.map(s => {
    const evidence = s.rules.map(r => ({ ...r, label: config.signalLabels[r.signal] ?? r.signal, ...signals[r.signal] }));
    const total = s.rules.reduce((n, r) => n + r.weight, 0), known = evidence.filter(r => r.status !== null).reduce((n, r) => n + r.weight, 0), matched = evidence.filter(r => r.status === true).reduce((n, r) => n + r.weight, 0);
    const coverage = known / total, score = known ? matched / known * 100 : null;
    const requiredMet = evidence.filter(r => r.required).every(r => r.status === true);
    const blocked = s.blockers.some(k => signals[k].status === true);
    return { id: s.id, name: s.name, interpretation: s.interpretation, score, coverage, rank: (score ?? 0) * coverage, candidate: requiredMet && !blocked && coverage >= config.settings.coverageMin && (score ?? 0) >= config.settings.scoreMin, evidence };
  });
  const candidates = rows.filter(r => r.candidate).sort((a, b) => b.rank - a.rank);
  const summary = config.summaries.map(s => {
    const stress = s.signals.filter(k => signals[k].status === true), unknown = s.signals.filter(k => signals[k].status === null);
    return { name: s.name, status: stress.length ? "긴장 신호" : unknown.length ? "자료 확인 필요" : s.calm.every(k => signals[k].status === true) ? "완화·안정 근거" : "혼합 신호", evidence: stress.map(k => config.signalLabels[k]), missing: unknown.map(k => config.signalLabels[k]) };
  });
  return { rows, summary, closest: candidates.length ? candidates.filter(r => candidates[0].rank - r.rank <= config.settings.mixedGap).map(r => r.id) : [], signals };
}
