export type Point = [string, number];

// Only completed UTC calendar months. Sorting makes the month-end observation independent of CSV order.
export function closedMonthEnds(points: Point[], now = new Date()): Point[] {
  const currentMonth = now.toISOString().slice(0, 7);
  const months = new Map<string, number>();
  for (const [date, value] of [...points].sort(([a], [b]) => a.localeCompare(b))) {
    if (date.slice(0, 7) < currentMonth) months.set(date.slice(0, 7), value);
  }
  return [...months].map(([month, value]) => [`${month}-01`, value]);
}

// Compare actual calendar months, never the twelfth previous row across a missing observation.
export function annualChange(points: Point[], decimals: number): Point[] {
  const values = new Map(points.map(([date, value]) => [date.slice(0, 7), value]));
  return points.flatMap(([date, value]) => {
    const previous = values.get(`${Number(date.slice(0, 4)) - 1}${date.slice(4, 7)}`);
    return previous && Number.isFinite(previous) ? [[date, Number(((value / previous - 1) * 100).toFixed(decimals))] as Point] : [];
  });
}

export function mergeObservations(stored: Point[], fetched: Point[], repairLastMonth = false): { points: Point[]; added: number; corrected: Point[] } {
  const last = stored.at(-1)?.[0] ?? "", tail = fetched.filter(([date]) => date > last);
  const corrected: Point[] = [];
  const points = stored.map(([date, value]): Point => {
    // The former collector could freeze the newest Nasdaq month at a mid-month value.
    // Repair only that last stored month against a completed-month observation; older history stays intact.
    const replacement = repairLastMonth && date === last ? fetched.find(([d]) => d === date) : undefined;
    if (replacement && replacement[1] !== value) { corrected.push(replacement); return replacement; }
    return [date, value];
  });
  return { points: [...points, ...tail], added: tail.length, corrected };
}

// ── 과거 확장(앞쪽 덧붙임) — append-only 의 대칭. 저장된 첫 관측일 '이전' 구간만 더하고 기존 포인트는 건드리지 않는다. ──

const sortByDate = (points: Point[]) => [...points].sort(([a], [b]) => a.localeCompare(b));

export interface RebaseResult { factor: number; overlap: number; spread: number }

// 겹침 비율(base/extension)의 중앙값. 접합점에 가까운 쪽부터 최대 maxOverlap 개만 본다(옛 지수의 구성 차이가 시간이 갈수록 벌어지므로).
// 겹침이 minOverlap 미만이면 null — 접합할 근거가 없다.
export function rebaseFactor(base: Point[], extension: Point[], { maxOverlap = 24, minOverlap = 12 } = {}): RebaseResult | null {
  const baseByDate = new Map(base);
  const ratios: number[] = [];
  for (const [date, value] of sortByDate(extension)) {
    const b = baseByDate.get(date);
    if (b === undefined || !Number.isFinite(b) || !Number.isFinite(value) || value === 0) continue;
    ratios.push(b / value);
    if (ratios.length >= maxOverlap) break;
  }
  if (ratios.length < minOverlap) return null;
  const sorted = [...ratios].sort((a, b) => a - b);
  return { factor: sorted[Math.floor(sorted.length / 2)], overlap: ratios.length, spread: sorted[sorted.length - 1] / sorted[0] };
}

export interface PrependOptions { from?: string; until?: string; factor?: number; decimals?: number }

// history 중 [from, until) 구간(until 기본값 = 저장된 첫 관측일, 배타)만 골라 factor 를 곱해 앞에 붙인다. 저장 포인트는 그대로.
export function prependHistory(stored: Point[], history: Point[], { from, until, factor = 1, decimals }: PrependOptions = {}): { points: Point[]; added: number; from: string | null; to: string | null } {
  const stop = until ?? stored[0]?.[0] ?? "9999-12-31";
  const round = (v: number) => (decimals === undefined ? v : Number(v.toFixed(decimals)));
  const head = sortByDate(history)
    .filter(([date, value]) => date < stop && (!from || date >= from) && Number.isFinite(value))
    .map(([date, value]): Point => [date, round(value * factor)]);
  return { points: [...head, ...stored], added: head.length, from: head[0]?.[0] ?? null, to: head.at(-1)?.[0] ?? null };
}

// 두 연간 시리즈의 비율(×scale). 연도(YYYY)로 짝을 맞추고 결과 날짜는 YYYY-01-01. 한쪽이 없거나 분모가 0 이면 그 해는 뺀다.
export function ratioSeries(numerator: Point[], denominator: Point[], decimals: number, scale = 100): Point[] {
  const denomByYear = new Map(denominator.map(([date, value]) => [date.slice(0, 4), value]));
  return sortByDate(numerator).flatMap(([date, value]) => {
    const year = date.slice(0, 4), d = denomByYear.get(year);
    return d && Number.isFinite(d) && Number.isFinite(value) ? [[`${year}-01-01`, Number(((value / d) * scale).toFixed(decimals))] as Point] : [];
  });
}
