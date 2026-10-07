import type { Point } from './schema.js';

// 두 은행군의 출발일을 맞춰, 서로 다른 기준일 때문에 격차가 생기지 않도록 한다.
export function bankComparison(a: Point[], b: Point[], asOf: string, years: number, indexed: boolean) {
  const start = Date.parse(asOf) - years * 365.25 * 86400000;
  const points = (values: Point[]) => new Map(values.filter(p => p.date <= asOf && Date.parse(p.date) >= start && Number.isFinite(p.value)).map(p => [p.date,p.value]));
  const large = points(a), small = points(b);
  const dates = [...new Set([...large.keys(),...small.keys()])].sort();
  const base = dates.find(d => (large.get(d) ?? 0) > 0 && (small.get(d) ?? 0) > 0);
  const rows = dates.filter(d => !indexed || (base && d >= base)).map(date => ({
    date,
    large: large.has(date) ? indexed ? large.get(date)! / large.get(base!)! * 100 : large.get(date)! : null,
    small: small.has(date) ? indexed ? small.get(date)! / small.get(base!)! * 100 : small.get(date)! : null,
  }));
  return {base,rows};
}
