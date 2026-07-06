// C-0a: CLO ETF 홀딩스 파일 안정성 프로브 (읽기전용, DB 무접촉).
//   실행: npm run probe:clo:csv
//
// 목적(clo-tab-instructions §3 C-0a / Gate A):
//   4개 ETF(JAAA·JBBB·PAAA·CLOZ) 홀딩스 파일의
//     (a) curl 가능한 안정 URL  (b) 스키마 불변성  (c) 일자 diff 유의미성
//   을 3영업일+ 간격 2회+ 관측으로 검증한다. 하루 안에 끝내지 말 것 — 시간축 안정성 검증이 목적.
//
// 비파괴 회귀 하네스: 관측 결과를 script/clo-probe-observations.json 에 append 하고,
//   재실행 시 직전 관측과 자동 diff(URL·스키마 불변성, 행수 변화)를 출력한다. (삭제 금지)
//
// 사용자 확인 경로(문서 §8.3): 운용사 사이트 홀딩스 파일이 JS 뒤에 숨어 curl 로 안 잡히면,
//   브라우저 DevTools > Network 에서 실제 데이터 요청 URL 을 복사해
//   script/clo-endpoints.local.json ( { "JAAA": "https://...", ... } ) 에 넣으면 그 URL 을 우선 사용한다.
//   (이 파일은 커밋하지 않는다 — 로컬 확인용.)
import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OBS_PATH = join(__dirname, "clo-probe-observations.json");
const LOCAL_ENDPOINTS = join(__dirname, "clo-endpoints.local.json");

// EDGAR/운용사 요청 공통 UA (문서 §2 필수 준수사항 준용 — 연락 이메일 포함)
const UA = process.env.EDGAR_UA || "ticker-radar tritonasia1223@gmail.com";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 후보 URL 표. 각 ETF 당 curl 로 시도할 순서. Phase 0 의 임무가 "안정 URL 찾기"이므로
// 확정 전까지 후보는 여러 개일 수 있고, 확정된 것은 clo-endpoints.local.json 이 덮어쓴다.
const CANDIDATES: Record<string, string[]> = {
  JAAA: [
    // 실측(2026-07-06): 아래 ?download 은 CSV 가 아니라 WordPress HTML 을 반환 → JS 렌더 뒤 데이터.
    "https://www.janushenderson.com/en-us/investor/product/jaaa-aaa-clo-etf/full-holdings/?download",
  ],
  JBBB: [
    "https://www.janushenderson.com/en-us/investor/product/jbbb-b-bbb-clo-etf/full-holdings/?download",
  ],
  PAAA: [
    "https://www.pgim.com/us/en/intermediary/investment-capabilities/products/etf/pgim-aaa-clo-etf",
  ],
  CLOZ: [
    "https://clozfund.com/",
  ],
};

type Format = "csv" | "xlsx" | "json" | "html" | "html-table" | "empty" | "error";

interface ProbeResult {
  etf: string;
  url: string;
  httpStatus: number | null;
  finalUrl: string | null;
  contentType: string | null;
  bytes: number;
  format: Format;
  usableAsHoldings: boolean; // CSV/JSON 로 파싱돼 홀딩스 스키마가 나왔는가
  columns?: string[];
  rowCount?: number;
  hasCusipColumn?: boolean;
  cusipDetectedIn?: string; // 컬럼명 또는 "value-pattern"
  sampleNames?: string[];
  note?: string;
}

// --- 최소 CSV 파서 (collect-insider.ts 관행 준용) -------------------------------
function parseCsvLine(line: string): string[] {
  const out: string[] = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === "," && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

// 파일 앞부분 몇 줄은 펀드명/날짜 헤더인 경우가 많음 → 컬럼 수가 가장 많고 안정적인 라인을
// 헤더로 추정한다. 반환: {headerIdx, columns}.
function guessHeader(lines: string[]): { headerIdx: number; columns: string[] } {
  let best = { headerIdx: 0, columns: parseCsvLine(lines[0] || "") };
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length > best.columns.length) best = { headerIdx: i, columns: cols };
  }
  return best;
}

const CUSIP_RE = /^[0-9A-Z]{9}$/; // 9자리 영숫자 (체크섬까지 엄밀검증은 생략 — 존재성만)

function classifyFormat(buf: Buffer, contentType: string | null): Format {
  if (buf.length === 0) return "empty";
  const head = buf.subarray(0, 4);
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return "xlsx"; // "PK.."
  const text = buf.subarray(0, 512).toString("utf8").trimStart();
  if (text.startsWith("<")) return "html";
  if ((contentType || "").includes("html")) return "html";
  if (text.startsWith("{") || text.startsWith("[")) return "json";
  // CSV 추정: 앞부분에 콤마가 있고 '<' 로 시작하지 않음
  if (text.includes(",")) return "csv";
  return "html";
}

// 페이지 HTML 에 서버사이드 렌더된 홀딩스 표 파싱 (Janus 패턴: <td class="data-key-XXX">).
function parseHtmlHoldingsTable(html: string): {
  columns: string[]; rowCount: number; hasCusip: boolean; sampleNames: string[];
} | null {
  const keys = [...new Set([...html.matchAll(/data-key-([a-zA-Z0-9_]+)/g)].map((m) => m[1]))];
  if (keys.length < 2) return null;
  const cusipCells = [...html.matchAll(/<td[^>]*data-key-cusip[^>]*>\s*([0-9A-Za-z]{9})\s*<\/td>/gi)];
  const hasCusip = cusipCells.length > 0;
  // 딜명 샘플: ticker 또는 underlying 셀
  const nameKey = keys.find((k) => /ticker|underlying|name|security/i.test(k));
  const sampleNames = nameKey
    ? [...html.matchAll(new RegExp(`<td[^>]*data-key-${nameKey}[^>]*>\\s*([^<]+?)\\s*</td>`, "gi"))]
        .map((m) => m[1].trim()).filter((v) => v && v !== "-").slice(0, 10)
    : [];
  return { columns: keys, rowCount: cusipCells.length, hasCusip, sampleNames };
}

async function probeOne(etf: string, url: string): Promise<ProbeResult> {
  const base: ProbeResult = {
    etf, url, httpStatus: null, finalUrl: null, contentType: null,
    bytes: 0, format: "error", usableAsHoldings: false,
  };
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/csv,application/json,*/*" },
      redirect: "follow",
    });
    base.httpStatus = resp.status;
    base.finalUrl = resp.url;
    base.contentType = resp.headers.get("content-type");
    const ab = await resp.arrayBuffer();
    const buf = Buffer.from(ab);
    base.bytes = buf.length;
    if (!resp.ok) { base.note = `HTTP ${resp.status}`; base.format = "error"; return base; }

    base.format = classifyFormat(buf, base.contentType);

    if (base.format === "csv") {
      const raw = buf.toString("utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const lines = raw.split("\n").filter((l) => l.trim().length > 0);
      const { headerIdx, columns } = guessHeader(lines);
      const dataRows = lines.slice(headerIdx + 1).map(parseCsvLine).filter((r) => r.length >= columns.length - 1);
      base.columns = columns;
      base.rowCount = dataRows.length;

      // CUSIP 탐지: (1) 컬럼명에 cusip (2) 아니면 값 패턴으로 스캔
      const cusipColIdx = columns.findIndex((c) => /cusip/i.test(c));
      if (cusipColIdx >= 0) {
        base.hasCusipColumn = true; base.cusipDetectedIn = columns[cusipColIdx];
      } else {
        // 값 기반: 어떤 컬럼의 다수 값이 9자리 영숫자면 CUSIP 후보
        for (let c = 0; c < columns.length; c++) {
          const vals = dataRows.slice(0, 40).map((r) => (r[c] || "").toUpperCase());
          const hits = vals.filter((v) => CUSIP_RE.test(v)).length;
          if (vals.length >= 5 && hits / vals.length >= 0.7) {
            base.hasCusipColumn = true;
            base.cusipDetectedIn = `${columns[c] || `col${c}`} (value-pattern)`;
            break;
          }
        }
        if (base.hasCusipColumn === undefined) base.hasCusipColumn = false;
      }

      // 딜명 샘플: name/security/description/issuer 류 컬럼
      const nameColIdx = columns.findIndex((c) => /name|security|description|issuer|holding/i.test(c));
      if (nameColIdx >= 0) {
        base.sampleNames = dataRows.slice(0, 10).map((r) => r[nameColIdx]).filter(Boolean);
      }
      base.usableAsHoldings = base.rowCount > 5 && columns.length >= 2;
    } else if (base.format === "json") {
      base.note = "JSON 응답 — 홀딩스 배열 위치 확인 필요(어댑터에서 처리). 스키마 수동 검토 대상.";
    } else if (base.format === "xlsx") {
      base.note = "XLSX(Excel) 포맷 — 인라인 파서 없음. 어댑터에 xlsx 파서 필요. URL 안정성은 유효.";
    } else if (base.format === "html") {
      // Janus 류: 홀딩스 표가 페이지 HTML 에 서버사이드 렌더(<td class="data-key-cusip">…).
      // 별도 CSV 없이 이 페이지를 파싱하면 됨 (실측 2026-07-06).
      const table = parseHtmlHoldingsTable(buf.toString("utf8"));
      if (table) {
        base.format = "html-table";
        base.columns = table.columns;
        base.rowCount = table.rowCount;
        base.hasCusipColumn = table.hasCusip;
        base.cusipDetectedIn = table.hasCusip ? "data-key-cusip (td)" : undefined;
        base.sampleNames = table.sampleNames;
        base.usableAsHoldings = table.rowCount > 5 && table.hasCusip;
        base.note = "홀딩스 표가 페이지 HTML 에 서버사이드 렌더 — 별도 CSV 불필요, 이 URL 을 HTML 파싱.";
      } else {
        base.note = "HTML 반환 — 홀딩스 표 미검출. 데이터가 JS 렌더 뒤일 수 있음. DevTools 확인(§8.3).";
      }
    }
    return base;
  } catch (e: any) {
    base.note = String(e?.message || e);
    return base;
  }
}

function loadLocalEndpoints(): Record<string, string> {
  if (!existsSync(LOCAL_ENDPOINTS)) return {};
  try { return JSON.parse(readFileSync(LOCAL_ENDPOINTS, "utf8")); }
  catch { return {}; }
}

function loadObservations(): any[] {
  if (!existsSync(OBS_PATH)) return [];
  try { return JSON.parse(readFileSync(OBS_PATH, "utf8")); } catch { return []; }
}

async function main() {
  const runDate = new Date().toISOString().slice(0, 10);
  const local = loadLocalEndpoints();
  const prevObs = loadObservations();
  const lastRun = prevObs[prevObs.length - 1];

  console.log(`\n=== C-0a: CLO ETF 홀딩스 안정성 프로브  (${runDate}) ===`);
  console.log(`UA: ${UA}`);
  if (Object.keys(local).length) console.log(`로컬 확정 엔드포인트 사용: ${Object.keys(local).join(", ")}`);
  console.log("");

  const results: ProbeResult[] = [];
  for (const etf of Object.keys(CANDIDATES)) {
    // 로컬 확정 URL 이 있으면 그것만, 없으면 후보 순차 시도(첫 usable 에서 멈춤)
    const urls = local[etf] ? [local[etf]] : CANDIDATES[etf];
    let chosen: ProbeResult | null = null;
    for (const url of urls) {
      const r = await probeOne(etf, url);
      await sleep(300); // 예의상 간격
      if (!chosen || r.usableAsHoldings) chosen = r;
      if (r.usableAsHoldings) break;
    }
    results.push(chosen!);

    const r = chosen!;
    const tag = r.usableAsHoldings ? "✅ USABLE" : r.format === "html" ? "⚠️  HTML(JS뒤)" : `⚠️  ${r.format.toUpperCase()}`;
    console.log(`[${etf}] ${tag}  HTTP ${r.httpStatus ?? "-"}  ${r.bytes}B  ${r.contentType || ""}`);
    console.log(`   url: ${r.url}`);
    if (r.finalUrl && r.finalUrl !== r.url) console.log(`   →final: ${r.finalUrl}`);
    if (r.columns) console.log(`   columns(${r.columns.length}): ${r.columns.slice(0, 12).join(" | ")}`);
    if (r.rowCount !== undefined) console.log(`   rows: ${r.rowCount}  cusip: ${r.hasCusipColumn ? `YES (${r.cusipDetectedIn})` : "NO"}`);
    if (r.sampleNames?.length) console.log(`   딜명 샘플: ${r.sampleNames.slice(0, 5).join(" / ")}`);
    if (r.note) console.log(`   note: ${r.note}`);

    // 직전 관측 대비 안정성 diff
    const prev = lastRun?.results?.find((x: ProbeResult) => x.etf === etf);
    if (prev) {
      const urlStable = prev.finalUrl === r.finalUrl && prev.format === r.format;
      const schemaStable = JSON.stringify(prev.columns || []) === JSON.stringify(r.columns || []);
      const rowDelta = (prev.rowCount != null && r.rowCount != null) ? r.rowCount - prev.rowCount : null;
      console.log(`   ↔ 직전(${lastRun.date}): URL/포맷 ${urlStable ? "불변✔" : "변동✗"}, 스키마 ${schemaStable ? "불변✔" : "변동✗"}` +
        (rowDelta != null ? `, 행수 Δ${rowDelta >= 0 ? "+" : ""}${rowDelta}` : ""));
    }
    console.log("");
  }

  // 관측 append
  prevObs.push({ date: runDate, ts: new Date().toISOString(), results });
  writeFileSync(OBS_PATH, JSON.stringify(prevObs, null, 2));
  console.log(`관측 저장: ${OBS_PATH}  (누적 ${prevObs.length}회)`);

  // Gate A 판정 힌트
  const usable = results.filter((r) => r.usableAsHoldings);
  console.log(`\n--- Gate A 판정 힌트 ---`);
  console.log(`USABLE ${usable.length}/4: ${usable.map((r) => r.etf).join(", ") || "(없음)"}`);
  if (prevObs.length < 2) {
    console.log(`⏳ 아직 1회 관측. Gate A 는 3영업일+ 간격 2회+ 관측이 필요(스키마·URL 불변 확인). 3영업일 뒤 재실행할 것.`);
  }
  const htmlBlocked = results.filter((r) => r.format === "html");
  if (htmlBlocked.length) {
    console.log(`⚠️  HTML(JS뒤) ${htmlBlocked.length}종: ${htmlBlocked.map((r) => r.etf).join(", ")}`);
    console.log(`    → 브라우저 DevTools>Network 에서 실제 데이터 요청 URL 확인 후 script/clo-endpoints.local.json 에 등록.`);
  }
  console.log("");
}

main().catch((e) => { console.error(e); process.exit(1); });
