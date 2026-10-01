// Explicit one-time migration. Monthly updates use fetch-capitalism-series.ts.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { longReer } from "../shared/dollar-indicators";
import type { Point } from "../shared/capitalism-refresh";
import { fetchDollarFred, fetchDxy } from "./lib/dollar-sources";

const dataPath = fileURLToPath(new URL("../client/src/data/capitalism-series.json", import.meta.url));
const sourcePath = fileURLToPath(new URL("../client/src/data/capitalism-series-sources.json", import.meta.url));
const exportDir = fileURLToPath(new URL("./cap-export/", import.meta.url));
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function main() {
  const data: Record<string, Point[]> = JSON.parse(readFileSync(dataPath, "utf8"));
  if (!data.dollar || data.dxy || data.reer || data.cpi_level) throw new Error("Migration requires the old dollar series and no replacement series; refusing to overwrite");
  const now = new Date();
  const [cpi, dxy, fed, bis] = await Promise.all([fetchDollarFred("CPIAUCNS", now), fetchDxy(now), fetchDollarFred("TWEXBPA", now), fetchDollarFred("RBUSBIS", now)]);
  const reer = longReer(fed, bis);
  if (cpi[0]?.[0] !== "1913-01-01" || dxy[0]?.[0] !== "1973-03-01") throw new Error(`Unexpected CPI/DXY coverage: ${JSON.stringify({ cpi: cpi[0], dxy: dxy[0], dxyCount: dxy.length })}`);
  const sources = JSON.parse(readFileSync(sourcePath, "utf8"));
  sources.reer = { modernFrom: reer.anchor, segments: [{ from: "1973-01-01", to: "1993-12-01", source: "연준 실질 광의 달러지수", short: "Fed Broad · 연결값", id: "TWEXBPA", url: "https://fred.stlouisfed.org/series/TWEXBPA", note: "1994년 1월 BIS/Fed 비율로 과거 구간만 조정. 두 기관의 바스켓·가중치는 다름.", method: "rebase", proxy: false, factor: reer.factor }] };
  mkdirSync(exportDir, { recursive: true });
  copyFileSync(dataPath, `${exportDir}/capitalism-series-before-dollar-replacement-${Date.now()}.json`);
  const report = { checkedAt: now.toISOString(), sources: { cpi: "CPIAUCNS", dxy: "Yahoo DX-Y.NYB · INDEX · daily close → completed month-end", fed: "TWEXBPA", bis: "RBUSBIS" }, anchor: reer.anchor, factor: reer.factor, overlap: reer.overlap,
    anchorValues: { fed: new Map(fed).get(reer.anchor), bis: new Map(bis).get(reer.anchor) },
    raw: Object.fromEntries(Object.entries({ cpi, dxy, fed, bis }).map(([k, v]) => [k, { first: v[0], last: v.at(-1), count: v.length, sha256: hash(v) }])),
    removedDollarSha256: hash(data.dollar), preserved: Object.fromEntries(Object.entries(data).filter(([k]) => k !== "dollar").map(([k, v]) => [k, hash(v)])) };
  delete data.dollar;
  Object.assign(data, { cpi_level: cpi, dxy, reer: reer.points });
  writeFileSync(dataPath + ".tmp", JSON.stringify(data)); renameSync(dataPath + ".tmp", dataPath);
  writeFileSync(sourcePath, JSON.stringify(sources, null, 2) + "\n");
  writeFileSync(`${exportDir}/dollar-indicators-migration.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
