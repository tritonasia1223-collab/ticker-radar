import { weeksBefore } from './time-series.js';

type Balance = { date: string; total: number; tga: number; rrp: number };
export type LiquidityPeriod = { weeks: number; from: string; to: string; change: number | null };
export type LiquidityPeriods = Record<1 | 4 | 13, LiquidityPeriod>;

/** Compare exact calendar weeks, never substitute an earlier available row. Values are million USD. */
export function liquidityPeriods(history: Balance[], asOf: string): LiquidityPeriods {
  const current = history.find(p => p.date === asOf);
  const valid = (p?: Balance) => !!p && [p.total, p.tga, p.rrp].every(v => typeof v === 'number' && Number.isFinite(v));
  const net = (p: Balance) => p.total - p.tga - p.rrp;
  return Object.fromEntries(([1, 4, 13] as const).map(weeks => {
    const from = asOf ? new Date(Date.parse(asOf) - weeks * 7 * 86400000).toISOString().slice(0, 10) : '';
    const previous = asOf ? weeksBefore(history, asOf, weeks) : undefined;
    return [weeks, { weeks, from, to: asOf, change: valid(current) && valid(previous) ? net(current!) - net(previous!) : null }];
  })) as LiquidityPeriods;
}
