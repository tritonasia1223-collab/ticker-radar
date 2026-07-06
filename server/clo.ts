// CLO 모니터 — 라이브 프리뷰 (DB 무접촉).
//
// ⚠️ 이것은 Phase 0 게이트 통과 전의 "볼 수 있는 프리뷰"다. clo-tab-instructions 의 영구 아키텍처
//    (clo_* 테이블·스냅샷 시계열·cron 수집)는 Gate A 3영업일 안정성 확인 후에 만든다.
//    여기서는 테이블을 만들지 않고, 요청 시점에 공개 소스를 직접 가져와 조인해 보여주기만 한다.
//    → 공유 Supabase 무접촉, #26(drizzle push 금지)·게이트 규약 위반 없음.
//
// 데이터 경로(script/probe-clo-* 에서 실증됨):
//   (1) ETF 홀딩스: 운용사 /full-holdings/ 페이지에 표가 서버사이드 렌더 → HTML 파싱(CUSIP 포함)
//   (2) N-PORT: EDGAR 에서 seriesId 로 최신 NPORT-P → CUSIP 추출
//   (3) 조인: CUSIP 정확일치(퍼지 없음). 시차(오늘 vs 분기말) 때문에 raw rate 보다 생존율이 진짜 신뢰도.

const UA = process.env.EDGAR_UA || "ticker-radar tritonasia1223@gmail.com";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 확정 소스(probe-clo-cusip-join 실측: CIK/seriesId, probe-clo-etf-csv 실측: full-holdings URL).
// PAAA·CLOZ 는 URL 확정(사용자 DevTools) 후 추가.
interface EtfSource { etf: string; manager: string; tranche: string; url: string; cik: string; seriesId: string; }
const ETFS: EtfSource[] = [
  { etf: "JAAA", manager: "Janus Henderson", tranche: "AAA",
    url: "https://www.janushenderson.com/en-us/investor/product/jaaa-aaa-clo-etf/full-holdings/",
    cik: "0001500604", seriesId: "S000069705" },
  { etf: "JBBB", manager: "Janus Henderson", tranche: "BBB·메자닌",
    url: "https://www.janushenderson.com/en-us/investor/product/jbbb-b-bbb-clo-etf/full-holdings/",
    cik: "0001500604", seriesId: "S000074691" },
];

export interface CloHolding {
  cusip: string; dealName: string; marketValue: number; weightPct: number; inNport: boolean;
}
export interface CloEtfView {
  etf: string; manager: string; tranche: string; sourceUrl: string;
  holdingsCount: number; totalMarketValue: number;
  holdings: CloHolding[];
  join: {
    csvCount: number; nportCount: number; matched: number;
    rawRatePct: number; survivalRatePct: number; csvOnly: number; nportOnly: number;
    nportAsOf: string | null; nportAccession: string | null;
  } | null;
  error?: string;
}
export interface CloOverview { etfs: CloEtfView[]; generatedAt: number; note: string; }

const num = (s: string): number => {
  const n = Number(String(s).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

// full-holdings 페이지 HTML 의 홀딩스 표 파싱(<tr> 단위, <td class="data-key-X">).
function parseHoldings(html: string): CloHolding[] {
  const rows: CloHolding[] = [];
  const cell = (block: string, key: string): string => {
    const m = new RegExp(`data-key-${key}[^>]*>\\s*([^<]*?)\\s*<`, "i").exec(block);
    return m ? m[1].trim() : "";
  };
  for (const tr of html.split(/<tr[\s>]/i).slice(1)) {
    const cusipRaw = cell(tr, "cusip").toUpperCase();
    if (!/^[0-9A-Z]{9}$/.test(cusipRaw)) continue;
    rows.push({
      cusip: cusipRaw,
      dealName: cell(tr, "ticker") || cell(tr, "underlyingSecurity") || cusipRaw,
      marketValue: num(cell(tr, "marketValue") || cell(tr, "currentMarketValue")),
      weightPct: num(cell(tr, "percentOfPortfolio")),
      inNport: false,
    });
  }
  return rows;
}

async function edgarGet(url: string, kind: "json" | "text" = "json"): Promise<any> {
  await sleep(150);
  const resp = await fetch(url, { headers: { "User-Agent": UA, Accept: kind === "json" ? "application/json" : "*/*" } });
  if (!resp.ok) throw new Error(`EDGAR ${resp.status}`);
  return kind === "json" ? resp.json() : resp.text();
}

// seriesId → 최신 NPORT-P 의 CUSIP 집합 (probe-clo-cusip-join 과 동일 경로).
async function nportCusips(cik: string, seriesId: string): Promise<{ cusips: Set<string>; asOf: string | null; accession: string | null }> {
  const search = await edgarGet(`https://efts.sec.gov/LATEST/search-index?q=%22${seriesId}%22&forms=NPORT-P`);
  const hits: any[] = search.hits?.hits || [];
  if (!hits.length) return { cusips: new Set(), asOf: null, accession: null };
  hits.sort((a, b) => String(b._source?.file_date || "").localeCompare(String(a._source?.file_date || "")));
  const [accession, fileName] = String(hits[0]._id).split(":");
  const cikNum = String(parseInt(cik, 10));
  const xml = await edgarGet(`https://www.sec.gov/Archives/edgar/data/${cikNum}/${accession.replace(/-/g, "")}/${fileName || "primary_doc.xml"}`, "text");
  const set = new Set<string>();
  const re = /<cusip>\s*([0-9A-Za-z]{9})\s*<\/cusip>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) { const c = m[1].toUpperCase(); if (!/^0{9}$/.test(c)) set.add(c); }
  const asOf = (xml.match(/<repPdDate>([^<]+)<\/repPdDate>/i) || [])[1] || hits[0]._source?.file_date || null;
  return { cusips: set, asOf, accession };
}

const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 1000) / 10);

async function buildEtfView(src: EtfSource): Promise<CloEtfView> {
  const base: CloEtfView = {
    etf: src.etf, manager: src.manager, tranche: src.tranche, sourceUrl: src.url,
    holdingsCount: 0, totalMarketValue: 0, holdings: [], join: null,
  };
  try {
    const resp = await fetch(src.url, { headers: { "User-Agent": UA } });
    if (!resp.ok) throw new Error(`holdings HTTP ${resp.status}`);
    const holdings = parseHoldings(await resp.text());
    base.holdings = holdings;
    base.holdingsCount = holdings.length;
    base.totalMarketValue = holdings.reduce((s, h) => s + h.marketValue, 0);

    // N-PORT 조인(실패해도 홀딩스는 보여줌)
    try {
      const np = await nportCusips(src.cik, src.seriesId);
      if (np.cusips.size > 0) {
        let matched = 0;
        for (const h of holdings) if (np.cusips.has(h.cusip)) { h.inNport = true; matched++; }
        const csvCount = holdings.length;
        base.join = {
          csvCount, nportCount: np.cusips.size, matched,
          rawRatePct: pct(matched, csvCount),
          survivalRatePct: pct(matched, np.cusips.size),
          csvOnly: csvCount - matched,
          nportOnly: np.cusips.size - matched,
          nportAsOf: np.asOf, nportAccession: np.accession,
        };
      }
    } catch (e: any) {
      base.error = `N-PORT 조인 스킵: ${e.message}`;
    }

    holdings.sort((a, b) => b.marketValue - a.marketValue);
    return base;
  } catch (e: any) {
    base.error = String(e?.message || e);
    return base;
  }
}

// 30분 메모리 캐시 — 페이지 반복 조회 시 매번 외부 fetch 하지 않도록(홀딩스는 일 1회 갱신).
let cache: { data: CloOverview; ts: number } | null = null;
const TTL = 30 * 60 * 1000;

export async function cloOverview(force = false): Promise<CloOverview> {
  if (!force && cache && Date.now() - cache.ts < TTL) return cache.data;
  const etfs: CloEtfView[] = [];
  for (const src of ETFS) etfs.push(await buildEtfView(src)); // 순차(EDGAR 예의)
  const data: CloOverview = {
    etfs, generatedAt: Date.now(),
    note: "라이브 프리뷰 — DB 미사용. 요청 시점에 운용사 공개 홀딩스 + SEC N-PORT 를 직접 조인. 영구 스냅샷 시계열은 Gate A 통과 후 구축.",
  };
  cache = { data, ts: Date.now() };
  return data;
}
