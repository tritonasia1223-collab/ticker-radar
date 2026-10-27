// Offline, reproducible extension from the reviewed MeasuringWorth snapshot.
// No API/database writes. Modern CPI and all unrelated series stay unchanged.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { extendCpiLevels, CPI_HISTORY_NOTE, CPI_MODERN_FROM } from "../shared/cpi-history";
import type { Point } from "../shared/capitalism-refresh";

const dataPath = "client/src/data/capitalism-series.json";
const metaPath = "client/src/data/capitalism-series-sources.json";
const raw = JSON.parse(readFileSync("data/cpi-history/measuringworth-1860-1913.json", "utf8"));
const before = readFileSync(dataPath, "utf8");
const data: Record<string, Point[]> = JSON.parse(before);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const modern = data.cpi_level.filter(([d]) => d >= CPI_MODERN_FROM);
const result = extendCpiLevels(data.cpi_level, raw.points);
const preserved = Object.fromEntries(Object.entries(data).filter(([id]) => id !== "cpi_level").map(([id, values]) => [id, hash(values)]));
data.cpi_level = result.points;
if (hash(data.cpi_level.filter(([d]) => d >= CPI_MODERN_FROM)) !== hash(modern)) throw new Error("Modern CPI changed");
const sources = JSON.parse(readFileSync(metaPath, "utf8"));
sources.cpi_level = { modernFrom: CPI_MODERN_FROM, segments: [{
  from: "1860-01-01", to: "1912-01-01", source: "MeasuringWorth 역사 추정 CPI · 연간",
  short: "역사 추정 CPI · 연간", id: "MeasuringWorth US CPI", url: raw.sourceUrl,
  note: CPI_HISTORY_NOTE, method: "rebase", proxy: true, factor: result.factor,
}] };
mkdirSync("script/cap-export", { recursive: true });
writeFileSync(`script/cap-export/capitalism-series-before-cpi-${Date.now()}.json`, before);
writeFileSync(dataPath, JSON.stringify(data));
writeFileSync(metaPath, JSON.stringify(sources, null, 2) + "\n");
const audit = { sourceUrl: raw.sourceUrl, sourceSha256: hash(raw.points), anchorYear: 1913,
  historicalAnchor: result.historicalAnchor, blsAnnualMean: result.blsAnnualMean, factor: result.factor,
  from: "1860-01-01", to: "1912-01-01", addedAnnualObservations: result.history.length,
  method: "historical level × (BLS 1913 monthly mean / MeasuringWorth 1913 annual level)",
  modernSha256: hash(modern), preservedSeriesSha256: preserved };
writeFileSync("client/src/data/cpi-history-audit.json", JSON.stringify(audit, null, 2) + "\n");
console.log(JSON.stringify({ added: result.history.length, factor: result.factor, blsAnnualMean: result.blsAnnualMean }));
