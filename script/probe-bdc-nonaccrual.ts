// Phase 0' / Gate C: BDC non-accrual 추출 가능성 프로브 (읽기전용, DB 무접촉).
//   실행: npm run probe:bdc
//
// 목적(clo-tab-instructions v2 §4): 자동화 가능한 진짜 부실 신호 후보인 BDC non-accrual 비율을
//   대형 BDC 들의 EDGAR 10-Q/10-K(등록펀드 아니라 '34법 보고사 → N-PORT 아님)에서
//   신뢰성 있게 뽑을 수 있는지 반증한다. 되면 Phase 2(자동 트래커), 안 되면 수동 강등.
//
// non-accrual = 이자수취 중단(차주 부실) 자산 비중. MD&A 산문에 통상:
//   "loans on non-accrual status represented X% at amortized cost (or Y% at fair value)"
//   BDC 별 표현이 달라서(그래서 프로브) 여러 패턴 + 컨텍스트 스니펫으로 사람이 검증 가능하게 보고.
//
// 네거티브 컨트롤: 추출값이 (a) BDC 마다 서로 다르고(파싱 아티팩트 아님) (b) 0~15% 타당범위인지.
// EDGAR 예의: UA 필수, ≤10req/s(요청간 150ms).
import "dotenv/config";

const UA = process.env.EDGAR_UA || "ticker-radar tritonasia1223@gmail.com";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const BDCS = [
  { t: "ARCC", name: "Ares Capital" },
  { t: "FSK", name: "FS KKR Capital" },
  { t: "OBDC", name: "Blue Owl Capital" },
  { t: "BXSL", name: "Blackstone Secured Lending" },
  { t: "GBDC", name: "Golub Capital" },
  { t: "PSEC", name: "Prospect Capital" },
];

async function edgarGet(url: string, kind: "json" | "text" = "json"): Promise<any> {
  await sleep(150);
  const resp = await fetch(url, { headers: { "User-Agent": UA, Accept: kind === "json" ? "application/json" : "*/*" } });
  if (!resp.ok) throw new Error(`EDGAR ${resp.status}`);
  return kind === "json" ? resp.json() : resp.text();
}

async function resolveCiks(): Promise<Map<string, string>> {
  const d = await edgarGet("https://www.sec.gov/files/company_tickers.json");
  const map = new Map<string, string>();
  for (const k of Object.keys(d)) {
    const row = d[k];
    map.set(String(row.ticker).toUpperCase(), String(row.cik_str).padStart(10, "0"));
  }
  return map;
}

async function latestFiling(cik: string): Promise<{ form: string; accession: string; doc: string; date: string } | null> {
  const sub = await edgarGet(`https://data.sec.gov/submissions/CIK${cik}.json`);
  const r = sub.filings?.recent;
  if (!r) return null;
  for (let i = 0; i < r.form.length; i++) {
    if (r.form[i] === "10-Q" || r.form[i] === "10-K") {
      return { form: r.form[i], accession: r.accessionNumber[i], doc: r.primaryDocument[i], date: r.filingDate[i] };
    }
  }
  return null;
}

const P = String.raw`(\d{1,2}(?:\.\d{1,2})?)\s*%`; // 퍼센트 캡처
// fair value non-accrual % — 구조적 패턴들(BDC별 하드코딩 금지, 일반 문형만):
//   B) "cost and fair value were A% and B%"        → B (positional)
//   A) "…X% … fair value"  (% 가 키워드 앞, ≤28자) → X   (ARCC "1.2% at fair value", OBDC)
//   C) "fair value … X%"   (% 가 키워드 뒤, ≤28자) → X   (FSK 표 "fair value) 4.2%")
// 반환 tag: A/B = 깨끗한 산문(값이 fair value 에 직접 결합, 신뢰가능) / C = 표·느슨(검증필요).
function fairValuePct(region: string): { pct: number; tag: "A" | "B" | "C" } | null {
  let m = new RegExp(String.raw`cost and fair value\s*(?:were|was|are|:)?\s*${P}\s*and\s*${P}`, "i").exec(region);
  if (m) return { pct: Number(m[2]), tag: "B" };
  m = new RegExp(`${P}[^%]{0,28}(?:at |on a )?fair value`, "i").exec(region);
  if (m) return { pct: Number(m[1]), tag: "A" };
  m = new RegExp(`fair value[^%]{0,28}${P}`, "i").exec(region);
  if (m) return { pct: Number(m[1]), tag: "C" };
  return null;
}
function costPct(region: string): number | null {
  let m = new RegExp(String.raw`${P}[^%]{0,28}(?:amortized )?cost`, "i").exec(region);
  if (m) return Number(m[1]);
  m = new RegExp(String.raw`(?:amortized )?cost[^%]{0,28}${P}`, "i").exec(region);
  if (m) return Number(m[1]);
  return null;
}

interface Extract { fairValuePct: number | null; costPct: number | null; snippet: string; confident: boolean }

function extractNonAccrual(html: string): Extract | null {
  const t = html.replace(/<[^>]+>/g, " ")
    .replace(/&#160;|&nbsp;/gi, " ").replace(/&#8217;|&rsquo;|&#39;/gi, "'")
    .replace(/&amp;/gi, "&").replace(/\s+/g, " ");
  const idxs = [...t.matchAll(/non-?accrual/gi)].map((m) => m.index!);
  if (!idxs.length) return null;

  // 각 non-accrual 등장마다 넓은 region(±키워드) 잡아, fair value % 가 뽑히는 첫 region 채택.
  // 앵커문장(represented/were …)에서 뽑히면 confident.
  // 신뢰가능(confident) = 깨끗한 산문 앵커 + 값이 fair value 에 직접 결합(tag A/B).
  //   표(C)·개수서술·달러보고는 값이 나와도 confident=false → 사람이 스니펫 확인.
  // [^.$] : 문장/달러($ 보고)를 넘지 않는 범위에서만 앵커 인정(달러보고 PSEC·표 FSK 배제).
  const proseAnchor = /non-?accrual[^.$]{0,55}(represents?|is |are |were |was |totaled|as a percentage)/i;
  let fallback: { fv: number; cost: number | null; snip: string } | null = null;
  for (const i of idxs) {
    const region = t.slice(Math.max(0, i - 140), i + 240);
    const r = fairValuePct(region);
    if (r == null || r.pct < 0 || r.pct > 15) continue;
    const snip = region.trim().replace(/^\S*\s/, "").slice(0, 240);
    // confident: 깨끗한 산문 앵커 + fair value 직결(A/B) + 값 주변에 달러표기 없음
    const dollarNoise = /\$\s*[\d,]/.test(region.slice(0, region.search(/fair value/i) + 10));
    if (proseAnchor.test(region) && (r.tag === "A" || r.tag === "B") && !dollarNoise) {
      return { fairValuePct: r.pct, costPct: costPct(region), snippet: snip, confident: true };
    }
    if (!fallback) fallback = { fv: r.pct, cost: costPct(region), snip };
  }
  if (fallback) return { fairValuePct: fallback.fv, costPct: fallback.cost, snippet: fallback.snip, confident: false };
  return null;
}

const plausible = (v: number | null) => v != null && v >= 0 && v <= 15;

async function main() {
  console.log(`\n=== Gate C: BDC non-accrual 추출 프로브  (${new Date().toISOString().slice(0, 10)}) ===`);
  console.log(`UA: ${UA}\n`);

  let ciks: Map<string, string>;
  try { ciks = await resolveCiks(); } catch (e: any) { console.error("CIK 해석 실패:", e.message); process.exit(1); }

  const results: { t: string; name: string; ok: boolean; form?: string; date?: string; fv?: number | null; cost?: number | null; confident?: boolean; snippet?: string; err?: string }[] = [];

  for (const b of BDCS) {
    const cik = ciks.get(b.t);
    if (!cik) { results.push({ t: b.t, name: b.name, ok: false, err: "CIK 없음" }); continue; }
    try {
      const f = await latestFiling(cik);
      if (!f) { results.push({ t: b.t, name: b.name, ok: false, err: "10-Q/10-K 없음" }); continue; }
      const url = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${f.accession.replace(/-/g, "")}/${f.doc}`;
      const html = await edgarGet(url, "text");
      const ex = extractNonAccrual(html);
      if (!ex) { results.push({ t: b.t, name: b.name, ok: false, form: f.form, date: f.date, err: "non-accrual 추출 실패" }); continue; }
      results.push({ t: b.t, name: b.name, ok: true, form: f.form, date: f.date, fv: ex.fairValuePct, cost: ex.costPct, confident: ex.confident, snippet: ex.snippet });
    } catch (e: any) {
      results.push({ t: b.t, name: b.name, ok: false, err: e.message });
    }
  }

  console.log("--- 추출 결과 (fair value 기준 non-accrual %) ---");
  for (const r of results) {
    if (!r.ok) { console.log(`  [${r.t}] ❌ ${r.err}${r.form ? ` (${r.form} ${r.date})` : ""}`); continue; }
    const tag = r.confident ? "✅" : "🟡"; // 🟡=앵커문장 아닌 폴백(수동 확인 권장)
    console.log(`  [${r.t}] ${tag} FV ${r.fv ?? "?"}% / cost ${r.cost ?? "?"}%  (${r.form} ${r.date}) — ${r.name}`);
    console.log(`         "${r.snippet}"`);
  }

  // 네거티브 컨트롤 + Gate C
  const ok = results.filter((r) => r.ok && plausible(r.fv ?? null));
  const fvs = ok.map((r) => r.fv!);
  const distinct = new Set(fvs.map((v) => v.toFixed(2))).size;
  console.log(`\n--- 네거티브 컨트롤 ---`);
  console.log(`  타당범위(0~15%) 추출: ${ok.length}/${BDCS.length}  값: ${fvs.map((v) => v + "%").join(", ") || "(없음)"}`);
  console.log(`  서로 다른 값 ${distinct}종 (전부 동일하면 파싱 아티팩트 의심) → ${distinct >= Math.max(2, ok.length - 1) ? "✔ 분산 정상" : "⚠ 값 뭉침"}`);
  const confidentCount = results.filter((r) => r.ok && r.confident && plausible(r.fv ?? null)).length;

  const found = results.filter((r) => r.ok).length; // 스니펫까지 찾은 곳(값 신뢰와 별개)
  console.log(`\n--- Gate C 판정 ---`);
  console.log(`  non-accrual 문구 발견 ${found}/${BDCS.length} · 산문 자동추출 신뢰 ${confidentCount}/${BDCS.length} · 값범위OK ${ok.length}/${BDCS.length}`);
  console.log(`  ⚠️ 핵심: 표(FSK)·개수서술(BXSL)·달러보고(PSEC) BDC 는 값이 나와도 '그럴듯하게 틀림'.`);
  console.log(`     distinct(6종) 컨트롤은 통과하나 correct 를 보장 못함 — 완전자동 부적합.`);
  if (confidentCount >= BDCS.length - 1) {
    console.log(`  ✅ 완전자동 가능 — 거의 전부 깨끗한 산문. Phase 2 자동 트래커.`);
  } else {
    console.log(`  🟡 결론: 반자동(assisted) — 프로브가 스니펫을 100% 찾아주고(${found}/${BDCS.length}),`);
    console.log(`     깨끗한 ${confidentCount}곳은 자동 채움, 나머지는 스니펫 보고 사람이 1분 확인/입력.`);
    console.log(`     → 문서 §7 수동 레이어의 '업그레이드판'(24MB 필링 안 뒤짐). 완전자동은 오탐 리스크로 반려.`);
  }
  console.log("");
}

main().catch((e) => { console.error(e); process.exit(1); });
