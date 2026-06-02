// 매수·매도(P·S) 거래에 10b5-1 플랜 여부 보강 — SEC EDGAR Form 4 의 문서레벨 필드 <aff10b5One>.
//   실행:  npm run enrich:10b5            (plan10b5 미확인 P/S accession 전부)
//          npm run enrich:10b5 -- --max 100
//
// 2023.4 개정 이후 Form4 는 10b5-1 체크박스를 구조화 필드(<aff10b5One>1|0</aff10b5One>)로 의무 표기.
//   1 = 사전 약정한 10b5-1 정기 매도(노이즈에 가까움) / 0 = 재량적 매도(시그널).
// 그 이전(필드 없음) 건은 각주(footnote)에서 "10b5" 언급을 폴백으로 잡는다.
// <aff10b5One> 는 문서(=accession) 레벨이라, 한 Form4 의 모든 거래라인이 같은 플래그를 공유 → accession 단위로 디둡.
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

const truthy = (s: string) => /^(1|true|y|yes)$/i.test(s.trim());

// <aff10b5One> 우선, 없으면 각주의 "10b5" 언급 폴백. 판단 불가면 null.
function derivePlan(xml: string): boolean | null {
  const m = xml.match(/<aff10b5One>\s*([\s\S]*?)\s*<\/aff10b5One>/i);
  if (m) return truthy(m[1]);
  // 폴백: 각주에 Rule 10b5-1 언급이 있으면 플랜으로 간주
  const foot = [...xml.matchAll(/<footnote[^>]*>([\s\S]*?)<\/footnote>/gi)].map((x) => x[1]).join(" ");
  if (/10b5[\s-]?1/i.test(foot)) return true;
  return null;
}

async function fetchPlan(cik: number, accession: string): Promise<boolean | null> {
  const accNo = accession.replace(/-/g, "");
  const base = `https://www.sec.gov/Archives/edgar/data/${cik}/${accNo}`;
  let idx: any;
  try { idx = await (await fetch(`${base}/index.json`, { headers: { "User-Agent": UA } })).json(); } catch { return null; }
  const items: any[] = idx?.directory?.item || [];
  const xmls = items.map((i) => i.name).filter((n: string) => /\.xml$/i.test(n) && !n.includes("/"));
  await sleep(120);
  for (const name of xmls) {
    try {
      const xml = await (await fetch(`${base}/${name}`, { headers: { "User-Agent": UA } })).text();
      if (xml.includes("<ownershipDocument")) return derivePlan(xml);
    } catch { /* skip */ }
    await sleep(120);
  }
  return null;
}

async function main() {
  const mi = process.argv.indexOf("--max"); const max = mi >= 0 ? Number(process.argv[mi + 1]) : Infinity;
  const cikMap = await tickerCikMap();
  let accs = await storage.psAccessionsNeedingPlan();
  if (max !== Infinity) accs = accs.slice(0, max);
  console.log(`10b5-1 보강 — 매수·매도 고유 accession ${accs.length}개 (EDGAR Form 4)…`);

  let plan = 0, disc = 0, unknown = 0;
  for (let i = 0; i < accs.length; i++) {
    const { accession, symbol } = accs[i];
    const cik = cikMap.get(symbol.toUpperCase());
    let v: boolean | null = null;
    if (cik && accession) { try { v = await fetchPlan(cik, accession); } catch { /* */ } }
    // null(판단불가)은 그대로 두지 않고 false(재량적)로 보수 처리하면 시그널을 과대평가하므로,
    // 미확인은 null 유지하되 재시도 방지를 위해 일단 기록하지 않음 → 다음 회차에 재시도.
    if (v !== null) { await storage.setPlan10b5ByAccession(accession, v); v ? plan++ : disc++; }
    else unknown++;
    if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${accs.length} … (플랜 ${plan} · 재량 ${disc} · 미확인 ${unknown})`);
  }
  console.log(`✅ 10b5-1 보강 완료 — 플랜 ${plan} · 재량 ${disc} · 미확인 ${unknown} (총 ${accs.length} accession)`);
  process.exit(0);
}
main().catch((e) => { console.error("10b5-1 보강 실패:", e); process.exit(1); });
