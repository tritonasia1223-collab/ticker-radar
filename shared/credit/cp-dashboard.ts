import { readingIndicators } from './schema.js';
import { DAY, type IndicatorAnalysis } from './signals.js';

/** 세 금리가 같은 날 관측된 경우만 비교하며, 선택일 이후 값은 제외한다. */
export function cpDashboard(data: IndicatorAnalysis[], asOf: string) {
  const credit = readingIndicators.find(i => i.id === 'cp_credit_spread')!;
  const treasury = readingIndicators.find(i => i.id === 'cp_treasury_spread')!;
  const creditLines = data.find(i => i.id === credit.id)?.comparisonLines ?? [];
  const treasuryLines = data.find(i => i.id === treasury.id)?.comparisonLines ?? [];
  const a2 = creditLines.find(l => l.key === credit.chart.lines[0].key)?.points ?? [];
  const aa = new Map((creditLines.find(l => l.key === credit.chart.lines[1].key)?.points ?? []).map(p => [p.date, p.value]));
  const bill = new Map((treasuryLines.find(l => l.key === treasury.chart.lines[1].key)?.points ?? []).map(p => [p.date, p.value]));
  const start = Date.parse(asOf) - 3 * 365.25 * DAY;
  const rows = a2.flatMap(p => {
    const b = bill.get(p.date), a = aa.get(p.date);
    if (p.date > asOf || Date.parse(p.date) < start || b == null || a == null || ![p.value, a, b].every(Number.isFinite)) return [];
    return [{date: p.date, time: Date.parse(p.date), bill: b, aa: a, a2: p.value, aaSpread: a - b, creditSpread: p.value - a}];
  }).sort((a, b) => a.date.localeCompare(b.date));
  const values = rows.flatMap(r => [r.bill, r.aa, r.a2]);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const padding = Math.max((max - min) * 0.08, 0.05);
  // 누적 금리나 변환값 대신 실제 금리를 사용하고, 표시 축만 관측 범위로 좁힌다.
  const domain: [number, number] = [Math.floor((min - padding) * 20) / 20, Math.ceil((max + padding) * 20) / 20];
  return {rows, current: rows.at(-1) ?? null, domain};
}
