import { dxyMonthEnds } from "../../shared/dollar-indicators";
import type { Point } from "../../shared/capitalism-refresh";

async function request(url: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(25000) });
      if (!r.ok) throw new Error(`Source HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
}

export async function fetchDollarFred(id: string, now = new Date()): Promise<Point[]> {
  const csv = await request(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`);
  const [header, ...rows] = csv.trim().split(/\r?\n/);
  if (header.split(",")[1] !== id) throw new Error(`FRED series mismatch: ${id}`);
  const points: Point[] = rows.flatMap(row => {
    const [date, value] = row.split(",");
    if (!/^\d{4}-\d{2}-01$/.test(date) || !value?.trim() || value === "." || !Number.isFinite(Number(value))) return [];
    return date.slice(0, 7) < now.toISOString().slice(0, 7) ? [[date, Number(value)] as Point] : [];
  });
  if (!points.length || points.some((p, i) => i > 0 && p[0] <= points[i - 1][0])) throw new Error(`Invalid FRED observations: ${id}`);
  return points;
}

export async function fetchDxy(now = new Date()): Promise<Point[]> {
  const params = new URLSearchParams({ interval: "1d", period1: "0", period2: String(Math.floor(now.getTime() / 1000)) });
  return dxyMonthEnds(JSON.parse(await request(`https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?${params}`)), now);
}
