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
