// C-0b: CUSIP 조인 프로브 — 전체 설계의 성립 조건 (읽기전용, DB 무접촉).
//   실행: npm run probe:clo:join
//
// 목적(clo-tab-instructions §3 C-0b / Gate B):
//   ETF 일간 CSV 의 CUSIP 을 EDGAR N-PORT(분기 정본)의 CUSIP 과 조인해 조인율 ≥90% 인지 본다.
//   네거티브 컨트롤: JAAA 와 JBBB 의 CUSIP 집합 교차 — 다른 펀드의 트랜치가 오조인되지 않아야 한다
//   (같은 딜의 다른 트랜치는 CUSIP 이 달라야 정상 → 두 AAA/BBB 펀드의 겹침은 낮아야 함).
//
// 실행 전략(2026-07-06 현재):
//   CSV 측 안정 URL 이 아직 미확정(C-0a 참조, Janus 는 JS 뒤)이라 CSV↔N-PORT 조인은 BLOCKED.
//   대신 오늘 가능한 것을 검증한다:
//     (1) EDGAR N-PORT 경로가 실제로 뚫리는가 (티커→CIK/series→최신 NPORT-P→CUSIP 추출)
//     (2) 네거티브 컨트롤: JAAA vs JBBB N-PORT CUSIP 겹침이 낮은가 (펀드 분리 가능성)
//   CSV 가 clo-endpoints.local.json 에 확정되면 CSV↔N-PORT 조인율까지 자동 측정한다.
//
// EDGAR 예의(문서 §2): User-Agent 필수, ≤10req/s. 아래는 요청간 150ms + UA 헤더.
import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCAL_ENDPOINTS = join(__dirname, "clo-endpoints.local.json");

const UA = process.env.EDGAR_UA || "ticker-radar tritonasia1223@gmail.com";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TICKERS = ["JAAA", "JBBB", "PAAA", "CLOZ"];

async function edgarGet(url: string, kind: "json" | "text" = "json"): Promise<any> {
  await sleep(150);
  const resp = await fetch(url, { headers: { "User-Agent": UA, Accept: kind === "json" ? "application/json" : "*/*" } });
  if (!resp.ok) throw new Error(`EDGAR ${resp.status} ${url}`);
  return kind === "json" ? resp.json() : resp.text();
}

// 티커 → {cik, seriesId} : SEC 펀드 티커 매핑 파일 (operating-company 파일과 별개)
async function resolveFundTickers(): Promise<Map<string, { cik: string; seriesId: string }>> {
  const data = await edgarGet("https://www.sec.gov/files/company_tickers_mf.json");
  // 형태: { fields:["cik","seriesId","classId","symbol"], data:[[...],...] }
  const map = new Map<string, { cik: string; seriesId: string }>();
  const rows: any[] = data.data || [];
  for (const row of rows) {
    const [cik, seriesId, , symbol] = row;
    const sym = String(symbol || "").toUpperCase();
    if (TICKERS.includes(sym) && !map.has(sym)) {
      map.set(sym, { cik: String(cik).padStart(10, "0"), seriesId: String(seriesId) });
    }
  }
  return map;
}

// series 의 최신 NPORT-P 를 찾아 CUSIP 집합 추출.
//   트러스트(CIK) 하나에 수백 개 시리즈가 섞여 있어(예: Janus Detroit Street=292건) submissions 순서로는
//   특정 ETF 를 못 고른다. EDGAR 전문검색(EFTS)이 seriesId 문자열을 인덱싱하므로 이것으로 정확 매칭한다.
async function fetchNportCusips(ticker: string, cik: string, seriesId: string): Promise<{
  accession: string | null; asOf: string | null; cusips: Set<string>; holdingsCount: number; note?: string;
}> {
  const cikNum = String(parseInt(cik, 10));
  // 1) seriesId 로 NPORT-P accession 검색 → file_date 내림차순 최신 선택
  const search = await edgarGet(`https://efts.sec.gov/LATEST/search-index?q=%22${seriesId}%22&forms=NPORT-P`);
  const hits: any[] = search.hits?.hits || [];
  if (!hits.length) return { accession: null, asOf: null, cusips: new Set(), holdingsCount: 0, note: `EFTS 검색 0건(series ${seriesId})` };
  hits.sort((a, b) => String(b._source?.file_date || "").localeCompare(String(a._source?.file_date || "")));
  const top = hits[0];
  const [accession, fileName] = String(top._id).split(":"); // "0001..-26-..:primary_doc.xml"
  const hitCik = String((top._source?.ciks || [cikNum])[0]).replace(/^0+/, "") || cikNum;
  const accNoDash = accession.replace(/-/g, "");

  // 2) primary_doc.xml 취득 (NPORT-P 는 홀딩스까지 이 한 파일에 들어있음)
  const xml = await edgarGet(`https://www.sec.gov/Archives/edgar/data/${hitCik}/${accNoDash}/${fileName || "primary_doc.xml"}`, "text");
  const foundSid = (xml.match(/<seriesId>([^<]+)<\/seriesId>/i) || [])[1];
  const cusips = extractCusips(xml);
  const asOf = (xml.match(/<repPdDate>([^<]+)<\/repPdDate>/i) || [])[1] || top._source?.file_date || null;
  const note = foundSid && foundSid.trim() !== seriesId
    ? `⚠ seriesId 불일치: 기대 ${seriesId}, 파일 ${foundSid.trim()}` : undefined;
  return { accession, asOf, cusips, holdingsCount: cusips.size, note };
}

// N-PORT XML 에서 CUSIP 추출. <invstOrSec> 블록의 <cusip>...</cusip>.
function extractCusips(xml: string): Set<string> {
  const set = new Set<string>();
  const re = /<cusip>\s*([0-9A-Za-z]{9})\s*<\/cusip>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const c = m[1].toUpperCase();
    if (c !== "N/A".padEnd(9, "0") && !/^0{9}$/.test(c) && !/^N\/?A/i.test(c)) set.add(c);
  }
  return set;
}

// CSV 측 CUSIP (C-0a 로직 축약). 로컬 확정 엔드포인트가 있을 때만.
function loadLocalEndpoints(): Record<string, string> {
  if (!existsSync(LOCAL_ENDPOINTS)) return {};
  try { return JSON.parse(readFileSync(LOCAL_ENDPOINTS, "utf8")); } catch { return {}; }
}
async function fetchCsvCusips(url: string): Promise<Set<string>> {
  const resp = await fetch(url, { headers: { "User-Agent": UA } });
  const text = await resp.text();
  const set = new Set<string>();
  // (a) Janus 류: 홀딩스 표가 페이지 HTML 에 서버사이드 렌더 — <td class="data-key-cusip">VALUE</td>
  //     (실측 2026-07-06: /full-holdings/ 페이지에 CUSIP 포함 표가 그대로 박혀있음. 별도 CSV 없음.)
  const tdRe = /<td[^>]*data-key-cusip[^>]*>\s*([0-9A-Za-z]{9})\s*<\/td>/gi;
  let m: RegExpExecArray | null;
  while ((m = tdRe.exec(text)) !== null) set.add(m[1].toUpperCase());
  if (set.size > 0) return set;
  // (b) 일반 CSV 폴백: 어떤 셀이든 9자리 영숫자면 CUSIP 후보
  for (const line of text.replace(/\r/g, "").split("\n")) {
    for (const cell of line.split(",")) {
      const v = cell.replace(/"/g, "").trim().toUpperCase();
      if (/^[0-9A-Z]{9}$/.test(v)) set.add(v);
    }
  }
  return set;
}

const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 1000) / 10);

async function main() {
  console.log(`\n=== C-0b: CUSIP 조인 프로브 + 네거티브 컨트롤  (${new Date().toISOString().slice(0, 10)}) ===`);
  console.log(`UA: ${UA}\n`);

  // 1) 티커 → CIK/series
  let resolved: Map<string, { cik: string; seriesId: string }>;
  try { resolved = await resolveFundTickers(); }
  catch (e: any) { console.error(`티커 해석 실패: ${e.message}`); process.exit(1); }

  console.log(`--- 티커 → CIK/series 해석 ---`);
  for (const t of TICKERS) {
    const r = resolved.get(t);
    console.log(`  ${t}: ${r ? `CIK ${r.cik}  series ${r.seriesId}` : "❌ 매핑 없음(company_tickers_mf.json)"}`);
  }
  console.log("");

  // 2) 각 ETF N-PORT CUSIP 추출
  const nport = new Map<string, Set<string>>();
  console.log(`--- EDGAR N-PORT CUSIP 추출 ---`);
  for (const t of TICKERS) {
    const r = resolved.get(t);
    if (!r) { console.log(`  ${t}: skip (CIK 없음)`); continue; }
    try {
      const res = await fetchNportCusips(t, r.cik, r.seriesId);
      nport.set(t, res.cusips);
      console.log(`  ${t}: ${res.cusips.size} CUSIPs  (accession ${res.accession || "-"}, asOf ${res.asOf || "-"})`);
      if (res.note) console.log(`       ${res.note}`);
      const sample = [...res.cusips].slice(0, 3);
      if (sample.length) console.log(`       sample: ${sample.join(", ")}`);
    } catch (e: any) {
      console.log(`  ${t}: ❌ ${e.message}`);
    }
  }
  console.log("");

  // 3) 네거티브 컨트롤: JAAA vs JBBB (그리고 PAAA vs CLOZ) CUSIP 겹침
  console.log(`--- 네거티브 컨트롤 (다른 펀드끼리 CUSIP 겹침 — 낮아야 정상) ---`);
  const controlPairs: [string, string][] = [["JAAA", "JBBB"], ["JAAA", "PAAA"], ["JBBB", "CLOZ"], ["PAAA", "CLOZ"]];
  for (const [a, b] of controlPairs) {
    const sa = nport.get(a), sb = nport.get(b);
    if (!sa || !sb || sa.size === 0 || sb.size === 0) { console.log(`  ${a} ∩ ${b}: (데이터 부족)`); continue; }
    const inter = [...sa].filter((c) => sb.has(c)).length;
    const smaller = Math.min(sa.size, sb.size);
    console.log(`  ${a}(${sa.size}) ∩ ${b}(${sb.size}) = ${inter}  (작은쪽 대비 ${pct(inter, smaller)}%)`);
  }
  console.log(`  기대: AAA vs BBB/메자닌 펀드는 트랜치 CUSIP 이 달라 겹침 낮음. 높으면 조인 설계 재검토.`);
  console.log("");

  // 4) CSV↔N-PORT 조인 (로컬 확정 엔드포인트 있을 때만)
  const local = loadLocalEndpoints();
  console.log(`--- CSV ↔ N-PORT 조인율 (Gate B 본판정) ---`);
  if (Object.keys(local).length === 0) {
    console.log(`  ⏳ BLOCKED — script/clo-endpoints.local.json 에 확정 CSV URL 없음.`);
    console.log(`     C-0a 로 안정 CSV URL 확정 후 재실행하면 조인율(≥90% 게이트)을 자동 측정한다.`);
  } else {
    for (const t of TICKERS) {
      if (!local[t] || !nport.get(t)?.size) continue;
      try {
        const csvCusips = await fetchCsvCusips(local[t]);
        const np = nport.get(t)!;
        const matched = [...csvCusips].filter((c) => np.has(c)).length;
        const csvOnly = [...csvCusips].filter((c) => !np.has(c)).length; // 오늘 CSV 에만 = N-PORT 이후 매수
        const nportOnly = [...np].filter((c) => !csvCusips.has(c)).length; // N-PORT 에만 = 이후 매도
        const rate = pct(matched, csvCusips.size);
        const verdict = csvCusips.size === 0 ? "CSV 에 CUSIP 없음 → 딜명매칭 폴백(수동 30샘플 검증 필요)"
          : rate >= 90 ? "✅ ≥90% — 예정 스키마 진행" : "⚠️ <90% raw — 시차 보정 후 판단(아래)";
        const survival = pct(matched, np.size); // N-PORT→CSV 생존율: 시차에 덜 오염된 조인키 신뢰도 지표
        console.log(`  ${t}: CSV ${csvCusips.size} CUSIPs, N-PORT 매치 ${matched} → raw 조인율 ${rate}%  ${verdict}`);
        console.log(`       drift: CSV전용 ${csvOnly}(이후 매수 추정) / N-PORT전용 ${nportOnly}(이후 매도 추정)` +
          ` — 시차 있는 두 시점 비교라 불일치=회전. 매칭된 CUSIP 은 100% 정확일치(퍼지 불필요).`);
        console.log(`       ▶ N-PORT→CSV 생존율 ${survival}% (매치/N-PORT ${matched}/${np.size}) — ` +
          `신규매수에 오염 안 된 조인키 신뢰도. ≥90% 면 CUSIP 은 깨끗한 조인키(Gate B intent 충족).`);
      } catch (e: any) {
        console.log(`  ${t}: ❌ ${e.message}`);
      }
    }
  }
  console.log("");
}

main().catch((e) => { console.error(e); process.exit(1); });
