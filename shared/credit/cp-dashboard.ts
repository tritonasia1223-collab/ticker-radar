import { readingIndicators } from './schema.js';
import { DAY, type IndicatorAnalysis } from './signals.js';

/** 실제 금리는 개별 결측을 보존하고, 현재 금리차는 세 금리의 공통 날짜만 사용한다. */
export function cpDashboard(data: IndicatorAnalysis[], asOf: string) {
  const credit = readingIndicators.find(i => i.id === 'cp_credit_spread')!;
  const treasury = readingIndicators.find(i => i.id === 'cp_treasury_spread')!;
  const creditData = data.find(i => i.id === credit.id), treasuryData = data.find(i => i.id === treasury.id);
  const creditLines = creditData?.rawRateLines ?? creditData?.comparisonLines ?? [];
  const treasuryLines = treasuryData?.rawRateLines ?? treasuryData?.comparisonLines ?? [];
  const a2 = new Map((creditLines.find(l => l.key === credit.chart.lines[0].key)?.points ?? []).map(p => [p.date, p.value]));
  const aa = new Map((creditLines.find(l => l.key === credit.chart.lines[1].key)?.points ?? []).map(p => [p.date, p.value]));
  const bill = new Map((treasuryLines.find(l => l.key === treasury.chart.lines[1].key)?.points ?? []).map(p => [p.date, p.value]));
  const start = Date.parse(asOf) - 3 * 365.25 * DAY;
  const rows = [...new Set([...a2.keys(), ...aa.keys(), ...bill.keys()])].flatMap(date => {
    if (date > asOf || Date.parse(date) < start) return [];
    const value = (map: Map<string, number>) => { const v = map.get(date); return v != null && Number.isFinite(v) ? v : null; };
    const b = value(bill), a = value(aa), lower = value(a2);
    return [{date, time: Date.parse(date), bill: b, aa: a, a2: lower, aaSpread: a == null || b == null ? null : a - b, creditSpread: lower == null || a == null ? null : lower - a}];
  }).sort((a, b) => a.date.localeCompare(b.date));
  const values = rows.flatMap(r => [r.bill, r.aa, r.a2]).filter((v): v is number => v !== null);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const padding = Math.max((max - min) * 0.08, 0.05);
  // 누적 금리나 변환값 대신 실제 금리를 사용하고, 표시 축만 관측 범위로 좁힌다.
  const domain: [number, number] = [Math.floor((min - padding) * 20) / 20, Math.ceil((max + padding) * 20) / 20];
  return {rows, current: rows.findLast(r => r.bill !== null && r.aa !== null && r.a2 !== null) ?? null, domain};
}
