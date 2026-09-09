import { readFileSync, appendFileSync } from "node:fs";
import { createHash } from "node:crypto";

const base = "https://ticker-radar-five.vercel.app";
const expected = JSON.parse(readFileSync("client/public/data-refresh.json", "utf8"));
const repo = process.env.GITHUB_REPOSITORY;
const sha = process.env.DEPLOY_SHA;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function get(url: string, github = false) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: github ? { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json" } : { "Cache-Control": "no-cache" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${github ? "GitHub commit status" : url}`);
  return response;
}
async function main() {
  if (!repo || !sha || !process.env.GH_TOKEN) throw new Error("GITHUB_REPOSITORY, DEPLOY_SHA and GH_TOKEN are required");
  let lastError = "Vercel status not yet available";
  for (let attempt = 0; attempt < 32; attempt++) {
    try {
      const result = await (await get(`https://api.github.com/repos/${repo}/commits/${sha}/status`, true)).json() as any;
      const status = result.statuses?.find((s: any) => s.context === "Vercel");
      if (["failure", "error"].includes(status?.state)) throw new Error(`Vercel deployment failed: ${status.description}`);
      if (status?.state === "success") {
        const actual = await (await get(`${base}/data-refresh.json?check=${encodeURIComponent(expected.checkedAt)}`)).json() as any;
        if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Production refresh marker does not match this run (possibly superseded)");
        const html = await (await get(base)).text();
        const main = html.match(/src="([^" ]*\/index-[^" ]+\.js)"/)?.[1];
        if (!main) throw new Error("Missing production entry");
        const entry = await (await get(new URL(main, base).href)).text();
        const cap = entry.match(/Capitalism-[\w-]+\.js/)?.[0];
        if (!cap) throw new Error("Missing economic history route asset");
        const capText = await (await get(`${base}/assets/${cap}`)).text();
        const name = capText.match(/capitalism-series-[\w-]+\.json/)?.[0];
        if (!name) throw new Error("Missing macro series asset");
        const data = await (await get(`${base}/assets/${name}`)).json();
        if (hash(data) !== expected.macroSha256) throw new Error("Production macro data hash mismatch");
        const message = `Vercel 배포 및 운영 거시지표 일치 확인: ${sha}\n`;
        console.log(message);
        if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${message}\n`);
        return;
      }
      lastError = status?.description ?? "No Vercel status yet";
    } catch (error) {
      lastError = String(error);
      if (lastError.includes("Vercel deployment failed")) throw error;
    }
    console.log(`Waiting for deployment (${attempt + 1}/32): ${lastError}`);
    await new Promise(resolve => setTimeout(resolve, 15000));
  }
  throw new Error(`Deployment verification timed out: ${lastError}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
