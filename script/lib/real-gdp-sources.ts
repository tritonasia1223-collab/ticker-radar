import { createHash } from "node:crypto";
import { buildRealGdp } from "../../shared/real-gdp.js";
import type { Point } from "../../shared/capitalism-refresh.js";

export async function fetchRealGdp() {
  const sources = await Promise.all(["GDPCA", "GDPC1"].map(async id => {
    const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`${id}: HTTP ${response.status}`);
    const text = await response.text(), lines = text.trim().split(/\r?\n/);
    if (!lines[0].endsWith(`,${id}`)) throw new Error(`Unexpected FRED header: ${id}`);
    const points: Point[] = lines.slice(1).flatMap(row => {
      const [date, value] = row.split(",");
      return /^\d{4}-\d{2}-\d{2}$/.test(date) && value?.trim() && Number.isFinite(Number(value)) ? [[date, Number(value)] as Point] : [];
    });
    return { id, url, sha256: createHash("sha256").update(text).digest("hex"), points };
  }));
  const built = buildRealGdp(sources[0].points, sources[1].points);
  return {
    points: built.points,
    audit: { checkedAt: new Date().toISOString(), units: "Billions of chained 2017 dollars", method: "GDPCA before 1947; GDPC1 from 1947. Official levels unchanged.", sources, annualVsQuarterly: built.overlap },
    history: { modernFrom: "1947-01-01", segments: [
      { from: "1929-01-01", to: "1946-01-01", source: "BEA 실질 GDP 수준 · 연간", short: "연간", id: "GDPCA", url: "https://fred.stlouisfed.org/series/GDPCA", note: "십억 2017년 연쇄달러·연간. 물가 영향을 제거한 경제 규모. 공식 수준값을 그대로 사용합니다.", method: "append", proxy: false, factor: null },
    ] },
  };
}
