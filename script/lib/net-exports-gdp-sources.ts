import { createHash } from "node:crypto";
import { buildNetExportsGdp } from "../../shared/net-exports-gdp.js";
import type { Point } from "../../shared/capitalism-refresh.js";

export async function fetchNetExportsGdp() {
  const ids = ["A019RC1A027NBEA", "GDPA", "NETEXP", "GDP"];
  const fetched = await Promise.all(ids.map(async id => {
    const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`${id}: HTTP ${response.status}`);
    const text = await response.text();
    if (!text.split(/\r?\n/)[0].endsWith(`,${id}`)) throw new Error(`Unexpected FRED header: ${id}`);
    const points: Point[] = text.trim().split(/\r?\n/).slice(1).flatMap(row => {
      const [date, value] = row.split(",");
      return /^\d{4}-\d{2}-\d{2}$/.test(date) && value?.trim() && Number.isFinite(Number(value)) ? [[date, Number(value)] as Point] : [];
    });
    return { id, url, sha256: createHash("sha256").update(text).digest("hex"), points };
  }));
  const built = buildNetExportsGdp(fetched[0].points, fetched[1].points, fetched[2].points, fetched[3].points);
  return {
    points: built.points,
    audit: { checkedAt: new Date().toISOString(), formula: "nominal NIPA net exports / nominal NIPA GDP * 100", sources: fetched,
      annualNetVsQuarterly: built.annualNetVsQuarterly, annualGdpVsQuarterly: built.annualGdpVsQuarterly },
    history: { modernFrom: "1947-01-01", segments: [
      { from: "1929-01-01", to: "1946-01-01", source: "BEA 명목 순수출 / 명목 GDP · 연간", short: "연간·계산값", id: "A019RC1A027NBEA / GDPA × 100", url: "https://fred.stlouisfed.org/graph/?id=A019RC1A027NBEA,GDPA", note: "상품·서비스·국민계정 기준. 같은 해 명목 순수출÷명목 GDP×100. 연간 1개 관측.", method: "append", proxy: false, factor: null },
    ] },
  };
}
