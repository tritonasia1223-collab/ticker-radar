// Rebuild these two series from mutually verified official releases; never append nominal NETEXP to real NETEXC.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fetchTradeHistory } from "./lib/trade-sources.js";

const data = fileURLToPath(new URL("../client/src/data/capitalism-series.json", import.meta.url));
const metadata = fileURLToPath(new URL("../client/src/data/capitalism-series-sources.json", import.meta.url));
const exportsDir = fileURLToPath(new URL("./cap-export/", import.meta.url));
const result = await fetchTradeHistory(); // All validation finishes before any writes.
const series = JSON.parse(readFileSync(data, "utf8")), sources = JSON.parse(readFileSync(metadata, "utf8"));
mkdirSync(exportsDir, { recursive: true });
copyFileSync(data, `${exportsDir}/capitalism-series-before-trade-${Date.now()}.json`);
series.trade = result.trade; series.trade_bal = result.trade_bal;
Object.assign(sources, result.history);
writeFileSync(data + ".tmp", JSON.stringify(series)); renameSync(data + ".tmp", data);
writeFileSync(metadata, JSON.stringify(sources, null, 2) + "\n");
writeFileSync(new URL("../client/src/data/trade-series-audit.json", import.meta.url), JSON.stringify(result.audit, null, 2) + "\n");
console.log(JSON.stringify({ trade: [result.trade[0], result.trade.at(-1)], trade_bal: [result.trade_bal[0], result.trade_bal.at(-1)], ...result.audit }, null, 2));
