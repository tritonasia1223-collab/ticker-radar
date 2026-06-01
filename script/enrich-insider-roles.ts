// 내부자 직책(role) 보강 — SEC EDGAR Form 4 XML 에서 officerTitle/isDirector/isOfficer/10%owner 파싱.
//   실행:  npm run enrich:insider-roles            (role 없는 (인사이더,종목) 쌍 전부)
//          npm run enrich:insider-roles -- --max 50
// Finnhub external_id 의 accession 으로 해당 Form 4 를 찾는다. EDGAR 무료, 예의상 ~8 req/s.
import "dotenv/config";
import { storage } from "../server/storage";

const UA = "ticker-radar congress/insider research (contact: dev@local)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function tickerCikMap(): Promise<Map<string, number>> {
  const j = (await (await fetch("https://www.sec.gov/files/company_tickers.json", { headers: { "User-Agent": UA } })).json()) as any;
  const m = new Map<string, number>();
  for (const k in j) m.set(String(j[k].ticker).toUpperCase(), Number(j[k].cik_str));
  return m;
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const tag = (xml: string, t: string) => { const m = xml.match(new RegExp("<" + t + ">([\\s\\S]*?)</" + t + ">")); return m ? decode(m[1]) : ""; };
const truthy = (s: string) => /^(1|true)$/i.test(s);

function deriveRole(xml: string): string | null {
  const rel = (xml.match(/<reportingOwnerRelationship>([\s\S]*?)<\/reportingOwnerRelationship>/) || [])[1] || "";
  if (!rel) return null;
  const title = tag(rel, "officerTitle");
  const parts: string[] = [];
  if (title) parts.push(title);
  else if (truthy(tag(rel, "isOfficer"))) parts.push("Officer");
  if (truthy(tag(rel, "isDirector"))) parts.push("Director");
  if (truthy(tag(rel, "isTenPercentOwner"))) parts.push("10% Owner");
  return parts.join(" · ") || null;
}

async function form4Role(cik: number, accession: string): Promise<string | null> {
  const accNo = accession.replace(/-/g, "");
  const base = `https://www.sec.gov/Archives/edgar/data/${cik}/${accNo}`;
  // 1) 폴더 목록에서 form4 원본 .xml 찾기
  let idx: any;
  try { idx = await (await fetch(`${base}/index.json`, { headers: { "User-Agent": UA } })).json(); } catch { return null; }
  const items: any[] = idx?.directory?.item || [];
  const xmls = items.map((i) => i.name).filter((n: string) => /\.xml$/i.test(n) && !n.includes("/"));
  await sleep(130);
  // 2) ownershipDocument 인 .xml 을 파싱
  for (const name of xmls) {
    try {
      const xml = await (await fetch(`${base}/${name}`, { headers: { "User-Agent": UA } })).text();
      if (xml.includes("<ownershipDocument")) return deriveRole(xml);
    } catch { /* skip */ }
    await sleep(130);
  }
  return null;
}

async function main() {
  const mi = process.argv.indexOf("--max"); const max = mi >= 0 ? Number(process.argv[mi + 1]) : Infinity;
  const cikMap = await tickerCikMap();
  let pairs = await storage.insiderPairsNeedingRole();
  if (max !== Infinity) pairs = pairs.slice(0, max);
  console.log(`직책 보강 — (인사이더,종목) ${pairs.length}쌍 (EDGAR Form 4)…`);

  let ok = 0, miss = 0;
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    const cik = cikMap.get(p.symbol.toUpperCase());
    const accession = (p.externalId || "").split(":")[1]; // fin:{accession}:...
    let role: string | null = null;
    if (cik && accession) { try { role = await form4Role(cik, accession); } catch { /* */ } }
    await storage.setInsiderRole(p.insiderId, p.symbol, role ?? "");  // "" = 시도했으나 미상 (재시도 방지)
    if (role) ok++; else miss++;
    if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${pairs.length} … (직책 확인 ${ok})`);
  }
  console.log(`✅ 직책 보강 완료 — 확인 ${ok} · 미상 ${miss} (총 ${pairs.length})`);
  process.exit(0);
}
main().catch((e) => { console.error("직책 보강 실패:", e); process.exit(1); });
