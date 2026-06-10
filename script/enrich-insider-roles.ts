// 내부자 직책(role) 보강 — SEC EDGAR Form 4 XML 에서 officerTitle/isDirector/isOfficer/10%owner 파싱.
//   실행:  npm run enrich:insider-roles            (role 없는 (인사이더,종목) 쌍 전부)
//          npm run enrich:insider-roles -- --max 50
// Finnhub external_id 의 accession 으로 해당 Form 4 를 찾는다. EDGAR 무료, 예의상 ~8 req/s.
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, storage } from "../server/storage";

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

// #2: EDGAR Form4 의 officerTitle 이 "See Remarks" 인 케이스(696행) — 실제 직책은 문서 <remarks> 자유서술에 있다.
//   여기선 '직책 문자열'만 유도(점수 아님) — tier 분류는 클라 ROLE_RULES 단일소스 그대로(드리프트 0). 못 뽑으면 null.
const TITLE_KW = /(chief\s+[\w\s.&-]*?\bofficer\b|president|general\s+counsel|treasurer|secretary|chair(?:man|person|woman)?|executive\s+vice\s+president|senior\s+vice\s+president|\bC[EFOMH]?[OT]\b|\bEVP\b|\bSVP\b|\bVP\b)/i;
function titleFromRemarks(remarks: string): string | null {
  const r = decode(remarks || "");
  if (!r) return null;
  // 1) "is/as/serves as (the) <Title> of …" 패턴 우선
  const m = r.match(/\b(?:is|as|serves?\s+as|appointed(?:\s+as)?|elected(?:\s+as)?|reporting\s+person\s+is)\s+(?:the\s+|a\s+|an\s+|our\s+)?([A-Za-z][\w&.,\/\s-]*?(?:officer|president|counsel|treasurer|secretary|chair(?:man|person|woman)?|\bC[EFOMH]?[OT]\b|\bEVP\b|\bSVP\b|\bVP\b))(?=\s+(?:of|at|for|and\s+(?:a\s+)?director)\b|[.;,]|$)/i);
  let t = m ? m[1] : null;
  if (!t && TITLE_KW.test(r)) { // 2) 폴백: 직책 키워드 포함 짧은 구절
    const k = r.match(/([A-Za-z][\w&.\/\s-]{0,48}?(?:chief\s+[\w\s.&-]*?officer|president|general\s+counsel|executive\s+vice\s+president))/i);
    t = k ? k[1] : null;
  }
  if (!t) return null;
  t = t.replace(/^\W+|\W+$/g, "").replace(/\s+/g, " ").trim();
  return t.length >= 2 && t.length <= 64 && TITLE_KW.test(t) ? t : null; // 직책 키워드 있는 짧은 것만 채택
}

function deriveRole(xml: string): string | null {
  const rel = (xml.match(/<reportingOwnerRelationship>([\s\S]*?)<\/reportingOwnerRelationship>/) || [])[1] || "";
  if (!rel) return null;
  let title = tag(rel, "officerTitle");
  if (!title || /see\s*remarks/i.test(title)) {
    const fromRemarks = titleFromRemarks(tag(xml, "remarks"));
    if (fromRemarks) title = fromRemarks;
    // 추출 실패 시 title 그대로(See Remarks/빈칸 유지) = 기존 동작 불변(네거티브 컨트롤)
  }
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

// #2 백필 — 기존 role 에 "See Remarks" 포함된 (인사이더,종목) 을 remarks 파싱으로 재유도.
//   insiderPairsNeedingRole 은 role IS NULL 만 잡아 이 696행을 못 건드리므로 별도 경로.
//   dry-run(기본): old→new 출력만 · --apply: 실제 UPDATE. 추출 실패/See Remarks 그대로면 skip(불변).
async function backfillSeeRemarks(apply: boolean, max: number) {
  const cikMap = await tickerCikMap();
  let pairs = (await db.execute(sql`
    SELECT DISTINCT ON (it.insider_id, it.symbol)
           it.insider_id AS "insiderId", it.symbol AS symbol, i.name AS name,
           it.role AS "oldRole", it.external_id AS "externalId"
    FROM insider_trades it JOIN insiders i ON i.id = it.insider_id
    WHERE it.role ILIKE '%see remarks%'
    ORDER BY it.insider_id, it.symbol, it.txn_date DESC`)) as unknown as any[];
  if (max !== Infinity) pairs = pairs.slice(0, max);
  console.log(`See Remarks 백필 — ${pairs.length}쌍 [${apply ? "APPLY" : "DRY-RUN"}]`);
  let changed = 0, kept = 0, miss = 0;
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    const cik = cikMap.get(String(p.symbol).toUpperCase());
    const accession = (p.externalId || "").split(":")[1];
    let role: string | null = null;
    if (cik && accession) { try { role = await form4Role(cik, accession); } catch { /* */ } }
    if (!role) { miss++; continue; }
    if (/see\s*remarks/i.test(role)) { kept++; continue; } // 여전히 미상 → 변경 안 함
    changed++;
    console.log(`  ✓ ${String(p.symbol).padEnd(6)} ${String(p.name).slice(0, 20).padEnd(20)} "${p.oldRole}" → "${role}"`);
    if (apply) await storage.setInsiderRole(Number(p.insiderId), p.symbol, role);
  }
  console.log(`\n${apply ? "✅ 백필 완료" : "(dry-run)"} — 변경 ${changed} · 유지(여전히 미상) ${kept} · 조회실패 ${miss} / 총 ${pairs.length}`);
  process.exit(0);
}

async function main() {
  if (process.argv.includes("--see-remarks")) {
    const mj = process.argv.indexOf("--max");
    return backfillSeeRemarks(process.argv.includes("--apply"), mj >= 0 ? Number(process.argv[mj + 1]) : Infinity);
  }
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
