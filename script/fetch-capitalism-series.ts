// 자본주의 타임라인 그래프용 FRED 시계열 수집·병합(전 19종).
//   실행:  npx tsx script/fetch-capitalism-series.ts
// FRED 공개 CSV(키 불필요)에서 받아 client/src/data/capitalism-series.json 에 병합한다.
// ── 병합 정책: APPEND-ONLY(비파괴) ─────────────────────────────────────────────
//   기존 포인트는 그대로 보존하고, '마지막 저장 날짜 이후' 신규 포인트만 이어붙인다.
//   --repair-last-month: 가장 최근 나스닥 월간 표본만 완료된 월말 값으로 교정 가능.
//   → 오래된 역사(예: gold 1944·debt_gdp 1939), 과거 vintage(개정 전) 값이 절대 바뀌지 않음.
//   각 시리즈는 병합 전에 '겹침 구간(마지막 N개)'을 재현하는지 자동 검증(overlap ✓/≠)하고,
//   재현 실패 시 그 시리즈는 SKIP(경고) — 잘못된 FRED id/변환이 데이터를 오염시키는 것을 차단.
// ── 특수 처리 ──────────────────────────────────────────────────────────────────
//   inflation : CPIAUCSL(SA) 의 12개월 YoY(%) 파생. 최근값은 CPI 개정 전 vintage라 미세차 → 검증 면제, append.
//   dollar    : 1973~2019 는 주요통화 명목지수(단종), 이후 BIS 명목광의(NBUSBIS)로 스티치.
//               겹침 구간 비율의 중앙값으로 신규 포인트를 리베이스 접합 → 이음매 제거.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, renameSync } from "fs";
import { closedMonthEnds, annualChange, mergeObservations, type Point } from "../shared/capitalism-refresh.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "../client/src/data/capitalism-series.json");

interface SeriesDef {
  key: string;          // capitalism-series.json 의 키 (config PANELS.series 와 일치)
  fredId?: string;      // FRED 시리즈 ID (url 미지정 시 CSV URL 구성)
  url?: string;         // 직접 CSV URL(비-FRED). 있으면 fredId 대신 사용.
  freq: "monthly" | "asis"; // monthly=일별→월말 다운샘플 / asis=원본 날짜 유지(월·분기·주간·일간)
  valueCol?: number;    // 값 컬럼 인덱스(기본 1)
  fromDate?: string;    // 'YYYY-MM-DD' 이상만 포함
  scale?: number;       // 값 배율(예: 백만$→십억$ = 1/1000)
  decimals: number;
  transform?: "yoy";    // yoy = 12개월 전 대비 % 변화(월별 시리즈 전용)
  stitch?: boolean;     // 접합 시리즈(겹침 비율로 신규 리베이스). dollar 전용.
  noVerify?: boolean;   // 겹침 검증 면제(파생/접합처럼 재현이 목적이 아닌 시리즈)
}

const SERIES: SeriesDef[] = [
  // ── 금리 ──
  { key: "tb3ms", fredId: "TB3MS", freq: "asis", decimals: 2 },
  { key: "gs10", fredId: "GS10", freq: "asis", decimals: 2 },
  { key: "fedfunds", fredId: "FEDFUNDS", freq: "asis", decimals: 2 },
  // ── 거시 ──
  { key: "unrate", fredId: "UNRATE", freq: "asis", decimals: 1 },
  { key: "inflation", fredId: "CPIAUCSL", freq: "asis", decimals: 2, transform: "yoy", noVerify: true },
  { key: "gdp_growth", fredId: "A191RL1Q225SBEA", freq: "asis", decimals: 1 }, // 실질GDP 전기대비 연율(%)
  { key: "debt_gdp", fredId: "GFDEGDQ188S", freq: "asis", decimals: 2 },       // 공공부채/GDP(%)
  // ── 통화·대외 ──
  { key: "trade", fredId: "NETEXC", freq: "asis", decimals: 1 },   // 실질 순수출($B, 분기)
  { key: "m2", fredId: "M2SL", freq: "asis", decimals: 1 },        // M2($B, 월)
  { key: "monbase", fredId: "BOGMBASE", freq: "asis", decimals: 1 }, // 본원통화($B, 월)
  { key: "dollar", fredId: "NBUSBIS", freq: "asis", decimals: 2, stitch: true, noVerify: true }, // 달러지수(접합)
  { key: "oil", fredId: "WTISPLC", freq: "asis", decimals: 2 },    // WTI($/bbl, 월)
  { key: "gold", url: "https://raw.githubusercontent.com/datasets/gold-prices/main/data/monthly.csv", freq: "asis", fromDate: "1944-01-01", decimals: 2 },
  // ── 주식시장 ──
  { key: "sp500", fredId: "SPASTT01USM661N", freq: "asis", decimals: 2 }, // 미국 주가지수(OECD, 2015=100)
  { key: "nasdaq", fredId: "NASDAQCOM", freq: "monthly", decimals: 2 },   // 나스닥(일별→월말)
  { key: "mktcap", fredId: "NCBEILQ027S", freq: "asis", scale: 1 / 1000, decimals: 1 }, // 미국 시총($B, 분기)
  // ── 연준 유동성 ──
  { key: "walcl", fredId: "WALCL", freq: "asis", scale: 1 / 1000, decimals: 1 },     // 총자산($B, 주간)
  { key: "wresbal", fredId: "WRESBAL", freq: "asis", scale: 1 / 1000, decimals: 1 }, // 지급준비금($B, 주간)
  { key: "rrp", fredId: "RRPONTSYD", freq: "asis", decimals: 1 },                    // ON RRP($B, 일간)
];

async function fetchCsv(s: SeriesDef): Promise<Point[]> {
  const url = s.url ?? `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${s.fredId}`;
  let text = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
      if (!res.ok) throw new Error(`${s.key}: HTTP ${res.status}`);
      text = await res.text(); break;
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  const lines = text.trim().split("\n").slice(1); // 헤더 제외
  const col = s.valueCol ?? 1;
  const out: Point[] = [];
  for (const line of lines) {
    const parts = line.split(",");
    let date = parts[0]?.trim();
    const raw = parts[col];
    if (!date || raw === undefined || raw === "." || raw.trim() === "") continue; // 결측치
    if (/^\d{4}-\d{2}$/.test(date)) date += "-01"; // YYYY-MM → YYYY-MM-01
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const v = Number(raw);
    if (!Number.isFinite(v)) continue;
    out.push([date, v]);
  }
  if (!out.length) throw new Error(`${s.key}: no valid observations`);
  return out.sort(([a], [b]) => a.localeCompare(b));
}

async function buildFetched(s: SeriesDef): Promise<Point[]> {
  const raw = await fetchCsv(s);
  let pts = s.freq === "monthly" ? closedMonthEnds(raw) : raw;
  if (s.transform === "yoy") pts = annualChange(pts, s.decimals);
  if (s.fromDate) pts = pts.filter(([d]) => d >= s.fromDate!);
  const scale = s.scale ?? 1;
  if (scale !== 1 || s.transform !== "yoy") pts = pts.map(([d, v]) => [d, Number((v * scale).toFixed(s.decimals))] as Point);
  return pts.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

// 겹침 검증: 저장 tail 마지막 n개가 fetched 로 재현되는지(허용오차 내). {matched,total,detail}
function verifyOverlap(stored: Point[], fMap: Map<string, number>, n = 8): { matched: number; total: number; detail: string } {
  const tail = stored.slice(-n);
  let matched = 0; const bits: string[] = [];
  for (const [d, sv] of tail) {
    const fv = fMap.get(d);
    const tol = Math.max(0.06, Math.abs(sv) * 0.004);
    const ok = fv !== undefined && Math.abs(fv - sv) <= tol;
    if (ok) matched++;
    bits.push(`${d.slice(2)}:${ok ? "✓" : fv === undefined ? "∅" : "≠" + fv}`);
  }
  return { matched, total: tail.length, detail: bits.join(" ") };
}

async function main() {
  const json = JSON.parse(readFileSync(OUT, "utf-8")) as Record<string, Point[]>;
  let added = 0, skipped = 0, corrected = 0;
  const report: any = { checkedAt: new Date().toISOString(), policy: "append-only; completed monthly samples; optional latest Nasdaq month repair", series: [] };
  const repair = process.argv.includes("--repair-last-month");
  const reportDir = join(__dirname, "cap-export");
  mkdirSync(reportDir, { recursive: true });
  copyFileSync(OUT, join(reportDir, `capitalism-series-before-${Date.now()}.json`));
  for (const s of SERIES) {
    process.stdout.write(`  ${s.key.padEnd(11)} `);
    let fetched: Point[];
    try { fetched = await buildFetched(s); }
    catch (e) { console.log(`ERR ${(e as Error).message} — SKIP`); report.series.push({key:s.key,status:"error",error:String(e)}); skipped++; continue; }

    const stored = json[s.key] ?? [];
    const fMap = new Map(fetched.map(([d, v]) => [d, v]));

    // 검증(파생/접합 제외): 겹침 재현 실패면 병합하지 않음.
    if (stored.length && !s.noVerify) {
      const { matched, total, detail } = verifyOverlap(stored, fMap);
      if (matched < Math.ceil(total * 0.6)) {
        console.log(`검증실패 ${matched}/${total} [${detail}] — SKIP(매핑 의심)`); report.series.push({key:s.key,status:"overlap-error",detail}); skipped++; continue;
      }
    }

    const lastStored = stored.length ? stored[stored.length - 1][0] : "";
    let tail = fetched.filter(([d]) => d > lastStored);

    // dollar: 겹침 비율 중앙값으로 신규 포인트 리베이스(이음매 제거).
    if (s.stitch && stored.length) {
      const sMap = new Map(stored);
      const ratios = fetched
        .filter(([d]) => sMap.has(d)).slice(-12)
        .map(([d, v]) => (v !== 0 ? sMap.get(d)! / v : NaN))
        .filter(Number.isFinite).sort((a, b) => a - b);
      const factor = ratios.length ? ratios[Math.floor(ratios.length / 2)] : 1;
      tail = tail.map(([d, v]) => [d, Number((v * factor).toFixed(s.decimals))] as Point);
      process.stdout.write(`[splice×${factor.toFixed(4)}] `);
    }

    const merged = mergeObservations(stored, s.stitch ? tail : fetched, repair && s.freq === "monthly");
    json[s.key] = merged.points;
    added += merged.added; corrected += merged.corrected.length;
    report.series.push({ key:s.key, status:"ok", previous:lastStored, latest:merged.points.at(-1)?.[0], added:merged.added,
      corrected:merged.corrected.map(([date,value]) => ({ date, before:stored.find(([d]) => d===date)?.[1], after:value })) });
    console.log(`+${merged.added}, corrected ${merged.corrected.length} → ${merged.points.at(-1)?.[0]}`);
  }
  writeFileSync(OUT + ".tmp", JSON.stringify(json));
  renameSync(OUT + ".tmp", OUT);
  writeFileSync(join(reportDir, "capitalism-refresh-latest.json"), JSON.stringify({ ...report, added, corrected, skipped }, null, 2));
  if (skipped) process.exitCode = 1;
  console.log(`\n✅ 병합 완료 → 신규 ${added}개 포인트 추가, ${skipped}개 시리즈 SKIP (총 ${Object.keys(json).length}개 시리즈)`);
}
main().catch((e) => { console.error("실패:", e); process.exit(1); });
