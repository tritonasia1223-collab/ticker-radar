import { closedMonthEnds, prependHistory, rebaseFactor, type Point } from "./capitalism-refresh";

// Never substitute a futures contract, an ETF, or a trade-weighted index for DXY.
export function dxyMonthEnds(payload: any, now = new Date()): Point[] {
  const r = payload?.chart?.result?.[0];
  const values = r?.indicators?.quote?.[0]?.close;
  if (r?.meta?.symbol !== "DX-Y.NYB" || r.meta.instrumentType !== "INDEX" || !Array.isArray(r.timestamp) || !Array.isArray(values) || values.length !== r.timestamp.length) {
    throw new Error("DXY source identity or observations mismatch");
  }
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: r.meta.exchangeTimezoneName || "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
  const points: Point[] = r.timestamp.flatMap((t: number, i: number) => {
    const value = values[i];
    return typeof t === "number" && Number.isFinite(t) && typeof value === "number" && Number.isFinite(value) && value > 0
      ? [[date.format(new Date(t * 1000)), Number(value.toFixed(3))] as Point] : [];
  });
  const monthly = closedMonthEnds(points, now).filter(([d]) => d >= "1973-03-01");
  if (!monthly.length) throw new Error("No completed DXY months");
  return monthly;
}

// Preserve BIS levels from 1994. Scale only the earlier Fed series with a fixed
// overlap-month ratio so the seam retains the Fed monthly change, not a base shift.
export function longReer(fed: Point[], bis: Point[]) {
  const anchor = "1994-01-01", from = "1973-01-01";
  const f = new Map(fed).get(anchor), b = new Map(bis).get(anchor);
  const overlap = rebaseFactor(bis, fed, { minOverlap: 12, maxOverlap: 12 });
  if (!f || !b || f <= 0 || b <= 0 || !overlap || overlap.spread > 1.15 || fed[0]?.[0] !== from || bis[0]?.[0] !== anchor) {
    throw new Error("REER anchor, coverage or overlap validation failed");
  }
  const factor = b / f;
  const { points } = prependHistory(bis, fed, { from, until: anchor, factor, decimals: 3 });
  const head = points.filter(([d]) => d < anchor);
  if (head.length !== 252 || head.at(-1)?.[0] !== "1993-12-01" || new Set(points.map(([d]) => d)).size !== points.length) throw new Error("REER history has missing or duplicate months");
  return { points, factor, anchor, overlap };
}
