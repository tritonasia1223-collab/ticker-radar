// 자본주의 타임라인 거시지표를 '확인 가능한 가장 이른 시점'까지 과거로 확장한다(일회성 백필, 재실행 멱등).
//   실행:  npx tsx script/extend-capitalism-history.ts        (npm run cap:series:history — cap:history 는 별개의 백업 스냅샷 명령)
// ── 원칙 ────────────────────────────────────────────────────────────────────────
//   · 앞쪽 덧붙임(prepend-only): 각 시리즈의 저장된 첫 관측일 '이전' 구간만 더한다. 기존 포인트는 한 개도 바꾸지 않는다
//     (월간 크론 fetch-capitalism-series.ts 의 append-only 와 대칭). 실행 후 기존 구간이 그대로인지 스스로 검증한다.
//   · 같은 뜻의 옛 시리즈는 그대로 잇고(append), 지수·정의가 다른 시리즈는 접합점 근처 겹침 비율의 중앙값으로 리베이스(rebase)한다.
//     대용 지표(재할인율·상업어음·재무부 부채/GDP)는 수준 차이를 감추지 않는다 — 화면에서 경계와 출처 라벨로 드러낸다.
//   · 구간 출처는 client/src/data/capitalism-series-sources.json 에 남겨 화면(점선·경계·툴팁)과 테스트가 읽는다.
//   · 결측은 채우지 않는다(NBER 실업률 1943~1947 공백 등은 빈 채로).
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, renameSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { annualChange, prependHistory, ratioSeries, rebaseFactor, type Point } from "../shared/capitalism-refresh.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "../client/src/data/capitalism-series.json");
const SOURCES = join(__dirname, "../client/src/data/capitalism-series-sources.json");

export interface HistorySegment {
  from: string; to: string;        // 실제 관측일(포함)
  source: string; short: string;   // 출처 설명 / 툴팁용 짧은 라벨
  id: string; url: string; note: string;
  method: "append" | "rebase"; proxy: boolean;
  factor: number | null;           // rebase 배율(append 면 null)
}
export interface SeriesSources { modernFrom: string; segments: HistorySegment[] }

interface HistoryDef {
  key: string; source: string; short: string; id: string; url: string; note: string;
  proxy?: boolean; from: string; until?: string; method: "append" | "rebase"; decimals: number;
  maxOverlap?: number;             // rebase 비율 계산에 쓸 겹침 개수(기본 24, 최소 MIN_OVERLAP). 분산 허용치는 공통(MAX_SPREAD)
  fetch: () => Promise<Point[]>;   // 원 출처 전체(겹침 포함) 시계열 — 리베이스 비율 계산에 겹침이 필요하다
}

const fredUrl = (id: string) => `https://fred.stlouisfed.org/series/${id}`;

async function fetchText(url: string): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return await res.text();
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw new Error("unreachable");
}

// FRED 공개 CSV(키 불필요). 결측 '.' 은 건너뛰고 YYYY-MM 은 YYYY-MM-01 로.
async function fetchCsv(url: string, col = 1): Promise<Point[]> {
  const lines = (await fetchText(url)).trim().split("\n").slice(1);
  const out: Point[] = [];
  for (const line of lines) {
    const parts = line.split(",");
    let date = parts[0]?.trim();
    const raw = parts[col];
    if (!date || raw === undefined || raw === "." || raw.trim() === "") continue;
    if (/^\d{4}-\d{2}$/.test(date)) date += "-01";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const v = Number(raw);
    if (Number.isFinite(v)) out.push([date, v]);
  }
  if (!out.length) throw new Error(`no observations: ${url}`);
  return out.sort(([a], [b]) => a.localeCompare(b));
}
const fred = (id: string) => fetchCsv(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`);

// 재무부 FiscalData '역사적 총공공부채'(1790~, 회계연도 말 잔액, 달러) → $B
async function fetchTreasuryDebt(): Promise<Point[]> {
  const url = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_outstanding?sort=record_date&page%5Bsize%5D=10000&fields=record_date,debt_outstanding_amt";
  const json = JSON.parse(await fetchText(url)) as { data: { record_date: string; debt_outstanding_amt: string }[] };
  const out = json.data
    .map((r): Point => [r.record_date, Number(r.debt_outstanding_amt) / 1e9])
    .filter(([d, v]) => /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(v));
  if (!out.length) throw new Error("FiscalData debt_outstanding: no rows");
  return out.sort(([a], [b]) => a.localeCompare(b));
}

// 같은 키의 구간이 여럿이면 현행에 가까운 구간부터(prepend 는 저장 첫 관측일 이전만 받으므로).
const HISTORY: HistoryDef[] = [
  { key: "inflation", source: "CPI 비계절조정(CPIAUCNS)의 12개월 전년비", short: "비계절조정 CPI", id: "CPIAUCNS", url: fredUrl("CPIAUCNS"), from: "1914-01-01", method: "append", decimals: 2,
    note: "비계절조정 CPI의 전년 동월 대비 변화율. 1948년부터 쓰는 계절조정 CPI 전년비와 조정 방식이 달라 값이 같지는 않을 수 있다.", fetch: async () => annualChange(await fred("CPIAUCNS"), 2) },
  // 분기 자료가 1947-04 부터라 연간값은 1946년까지만(1947년 연간값을 넣으면 같은 해에 연간·분기가 섞인다).
  { key: "gdp_growth", source: "연간 실질 GDP 성장률(A191RL1A225NBEA)", short: "연간 성장률", id: "A191RL1A225NBEA", url: fredUrl("A191RL1A225NBEA"), from: "1930-01-01", until: "1947-01-01", method: "append", decimals: 1,
    note: "1947년 이전은 분기 자료가 없어 연간 성장률(전년 대비 %)을 쓴다. 분기 연율보다 완만하게 보인다.", fetch: () => fred("A191RL1A225NBEA") },
  { key: "unrate", source: "NBER 실업률(M0892BUSM156SNBR)", short: "NBER 실업률", id: "M0892BUSM156SNBR", url: fredUrl("M0892BUSM156SNBR"), from: "1940-01-01", method: "append", decimals: 1,
    note: "NBER 거시경제사 복원치(계절조정). 1947년은 자료가 없어 비워 둔다.", fetch: () => fred("M0892BUSM156SNBR") },
  { key: "unrate", source: "NBER 실업률(M0892AUSM156SNBR)", short: "NBER 실업률", id: "M0892AUSM156SNBR", url: fredUrl("M0892AUSM156SNBR"), from: "1929-04-01", until: "1940-01-01", method: "append", decimals: 1,
    note: "NBER 거시경제사 복원치(계절조정).", fetch: () => fred("M0892AUSM156SNBR") },
  { key: "fedfunds", source: "뉴욕 연은 재할인율(NBER M13009USM156NNBR)", short: "재할인율(대용)", id: "M13009USM156NNBR", url: fredUrl("M13009USM156NNBR"), from: "1914-11-01", method: "append", decimals: 2, proxy: true,
    note: "연방기금금리가 생기기 전(1954)의 정책금리 대용. 겹치는 1954~1969년에도 0.5~1%p 차이가 나므로 수준을 그대로 잇는다.", fetch: () => fred("M13009USM156NNBR") },
  { key: "gs10", source: "장기 국채수익률(LTGOVTBD, 단종)", short: "장기국채(단종 시리즈)", id: "LTGOVTBD", url: fredUrl("LTGOVTBD"), from: "1925-01-01", method: "append", decimals: 2,
    note: "10년물 고정만기 수익률(1953~) 이전의 장기 국채 수익률. 겹치는 구간에서 거의 같다.", fetch: () => fred("LTGOVTBD") },
  { key: "tb3ms", source: "뉴욕 상업어음 금리(NBER M13002US35620M156NNBR)", short: "상업어음(대용)", id: "M13002US35620M156NNBR", url: fredUrl("M13002US35620M156NNBR"), from: "1857-01-01", method: "append", decimals: 2, proxy: true,
    note: "3개월 T-bill(1934~) 이전의 단기 시장금리 대용. T-bill 보다 높게 형성되는 금리라 1934년에 수준 차이가 있다.", fetch: () => fred("M13002US35620M156NNBR") },
  { key: "monbase", source: "세인트루이스 조정 본원통화(AMBSL, 단종)", short: "조정 본원통화(접합)", id: "AMBSL", url: fredUrl("AMBSL"), from: "1918-01-01", method: "rebase", decimals: 1,
    note: "정의가 달라 1959년 접합점의 겹침 비율로 리베이스했다. 1959년 이전은 증감률만 의미가 있다.", fetch: () => fred("AMBSL") },
  { key: "sp500", source: "다우존스 산업지수(NBER M1109BUSM293NNBR)", short: "다우존스(접합)", id: "M1109BUSM293NNBR", url: fredUrl("M1109BUSM293NNBR"), from: "1914-12-01", method: "rebase", decimals: 2,
    note: "OECD 미국 주가지수(우리 수록 구간 1957년부터) 이전을 다우존스 산업지수로 연결했다. 1957~1958년 겹침 비율로 배율을 조정했으며 구성 종목이 다르다.", fetch: () => fred("M1109BUSM293NNBR") },
  // 옛 12종목 지수(A)와 20종목 지수(B)는 겹치는 1914-12~1916-09 사이에 비율이 0.69~0.80 으로 벌어진다(전시 종목 차이).
  // 접합점에 가까운 12개월만 본다(그 안의 분산 1.12 — 공통 허용치 1.15 이내). 1914년 이전 구간의 수준에는 ±6% 안팎의 불확실성이 있다(출처 설명에 명시).
  { key: "sp500", source: "다우존스 산업지수 12종목(NBER M1109AUSM293NNBR)", short: "다우존스(접합)", id: "M1109AUSM293NNBR", url: fredUrl("M1109AUSM293NNBR"), from: "1897-01-01", until: "1914-12-01", method: "rebase", decimals: 2, maxOverlap: 12,
    note: "1914년 이전 구간. 1914-12~1915-11 겹침 비율로 뒤 구간(20종목 지수)에 접합했으며 두 지수의 비율이 그 안에서 최대 12% 벌어지므로 이 구간의 수준은 ±6% 안팎 불확실하다.", fetch: () => fred("M1109AUSM293NNBR") },
  { key: "debt_gdp", source: "재무부 총공공부채(FiscalData) ÷ 명목 GDP(GDPA)", short: "재무부 부채/GDP(대용)", id: "debt_outstanding ÷ GDPA", url: "https://fiscaldata.treasury.gov/datasets/historical-debt-outstanding/", from: "1929-01-01", method: "append", decimals: 2, proxy: true,
    note: "회계연도 말(6월) 총공공부채를 역년 명목 GDP 로 나눈 값. 1939년부터의 OMB 총연방부채(정부보증채 포함)와 정의가 달라 1939년에 약 8%p 단절이 있다.", fetch: async () => ratioSeries(await fetchTreasuryDebt(), await fred("GDPA"), 2) },
  { key: "gold", source: "DataHub 역사적 금 가격(연평균 반복)", short: "연평균 반복", id: "datahub gold-prices", url: "https://datahub.io/core/gold-prices", from: "1833-01-01", method: "append", decimals: 2,
    note: "1833~1959년은 원 제공자가 연평균을 각 월에 반복 수록한 구간이다. 1944년은 초기 저장 범위의 시작일이며 월간 원자료로 바뀌는 시점은 아니다.", fetch: () => fetchCsv("https://raw.githubusercontent.com/datasets/gold-prices/main/data/monthly.csv") },
];

const MIN_OVERLAP = 12, MAX_SPREAD = 1.15;

async function main() {
  const series = JSON.parse(readFileSync(DATA, "utf-8")) as Record<string, Point[]>;
  const sources: Record<string, SeriesSources> = existsSync(SOURCES) ? JSON.parse(readFileSync(SOURCES, "utf-8")) : {};
  const before: Record<string, Point[]> = Object.fromEntries(Object.entries(series).map(([k, v]) => [k, v.map(([d, x]): Point => [d, x])]));
  const exportDir = join(__dirname, "cap-export");
  mkdirSync(exportDir, { recursive: true });
  copyFileSync(DATA, join(exportDir, `capitalism-series-before-history-${Date.now()}.json`));

  let added = 0, skipped = 0;
  const report: any[] = [];
  for (const def of HISTORY) {
    const stored = series[def.key];
    if (!stored?.length) { console.log(`  ${def.key.padEnd(10)} 저장 시리즈 없음 — SKIP`); skipped++; continue; }
    // 현행 구간의 시작: 이전 실행이 남긴 modernFrom 이 있으면 그것, 없으면 지금 첫 관측일.
    const modernFrom = sources[def.key]?.modernFrom ?? stored[0][0];
    const segmentEnd = def.until ?? modernFrom;                     // 이 구간의 배타 종료
    const stop = segmentEnd < stored[0][0] ? segmentEnd : stored[0][0]; // 재실행이면 stored[0] 이 이미 앞이라 0건
    process.stdout.write(`  ${def.key.padEnd(10)} ${def.id.padEnd(24)} `);
    let history: Point[];
    try { history = await def.fetch(); }
    catch (e) { console.log(`ERR ${(e as Error).message} — SKIP`); report.push({ key: def.key, id: def.id, status: "error", error: String(e) }); skipped++; continue; }

    let factor = 1;
    if (def.method === "rebase") {
      const rb = rebaseFactor(stored, history, { maxOverlap: def.maxOverlap ?? 24, minOverlap: MIN_OVERLAP });
      if (!rb || rb.spread >= MAX_SPREAD) {
        console.log(`리베이스 근거 부족(겹침 ${rb?.overlap ?? 0}, 분산 ${rb?.spread.toFixed(3) ?? "-"}) — SKIP`);
        report.push({ key: def.key, id: def.id, status: "rebase-rejected", overlap: rb?.overlap ?? 0, spread: rb?.spread ?? null }); skipped++; continue;
      }
      factor = rb.factor;
      process.stdout.write(`[×${factor.toFixed(4)} 겹침 ${rb.overlap} 분산 ${rb.spread.toFixed(3)}] `);
    }
    const r = prependHistory(stored, history, { from: def.from, until: stop, factor, decimals: def.decimals });
    // 접합점: 옛 구간 마지막 값 ↔ 현행 첫 값. 리베이스 구간은 두 값의 비율이 분산 허용치 안이어야 저장한다
    // (겹침 비율은 맞아도 접합 직전 한 점이 오염됐을 수 있다). 대용·그대로 잇는 구간은 수준 차이가 있을 수 있어 보고만 한다.
    const j = r.points.findIndex(([d]) => d >= segmentEnd);
    const joint = r.added && j > 0 ? { oldDate: r.points[j - 1][0], oldValue: r.points[j - 1][1], newDate: r.points[j][0], newValue: r.points[j][1] } : null;
    if (def.method === "rebase" && joint) {
      const ratio = joint.newValue !== 0 ? joint.oldValue / joint.newValue : Infinity;
      if (!(ratio > 0) || Math.max(ratio, 1 / ratio) >= MAX_SPREAD) {
        console.log(`접합점 불연속 ${joint.oldDate}:${joint.oldValue} → ${joint.newDate}:${joint.newValue} — SKIP`);
        report.push({ key: def.key, id: def.id, status: "junction-rejected", joint }); skipped++; continue;
      }
    }
    series[def.key] = r.points;
    added += r.added;
    console.log(`+${r.added} (${r.from ?? "-"} ~ ${r.to ?? "-"}) ${joint ? `접합 ${joint.oldDate}:${joint.oldValue} → ${joint.newDate}:${joint.newValue}` : ""}`);
    report.push({ key: def.key, id: def.id, status: "ok", added: r.added, from: r.from, to: r.to, factor: def.method === "rebase" ? factor : null, joint });

    // 출처 메타데이터(구간은 실제 데이터에서 다시 계산). 재실행으로 0건이면 구간·배율은 기존 항목(실제 적용된 값)을 지키고
    // 설명 문구(source·short·note·url·proxy)만 정의에서 새로 받는다.
    const existing = sources[def.key]?.segments.find((s) => s.id === def.id);
    if (!r.added && existing) { Object.assign(existing, { source: def.source, short: def.short, url: def.url, note: def.note, proxy: !!def.proxy }); continue; }
    const pts = series[def.key];
    const segFrom = pts.find(([d]) => d >= def.from && d < segmentEnd)?.[0];
    const segTo = [...pts].reverse().find(([d]) => d < segmentEnd && d >= def.from)?.[0];
    if (segFrom && segTo) {
      const entry = sources[def.key] ?? { modernFrom, segments: [] };
      entry.modernFrom = modernFrom;
      entry.segments = entry.segments.filter((s) => s.id !== def.id);
      entry.segments.push({ from: segFrom, to: segTo, source: def.source, short: def.short, id: def.id, url: def.url, note: def.note, method: def.method, proxy: !!def.proxy, factor: def.method === "rebase" ? Number(factor.toFixed(6)) : null });
      entry.segments.sort((a, b) => a.from.localeCompare(b.from));
      sources[def.key] = entry;
    }
  }

  // 불변 검증: 실행 전 저장돼 있던 (날짜, 값) 이 모두 같은 자리에 그대로 있는가.
  for (const [key, prev] of Object.entries(before)) {
    const now = series[key];
    const tail = now.slice(now.length - prev.length);
    if (JSON.stringify(tail) !== JSON.stringify(prev)) throw new Error(`${key}: 기존 관측이 바뀌었습니다 — 저장하지 않음`);
    for (let i = 1; i < now.length; i++) if (!(now[i - 1][0] < now[i][0])) throw new Error(`${key}: 날짜 순서/중복 ${now[i - 1][0]} ${now[i][0]}`);
  }

  writeFileSync(DATA + ".tmp", JSON.stringify(series));
  renameSync(DATA + ".tmp", DATA);
  writeFileSync(SOURCES, JSON.stringify(sources, null, 2) + "\n");
  writeFileSync(join(exportDir, "capitalism-history-latest.json"), JSON.stringify({ checkedAt: new Date().toISOString(), added, skipped, report }, null, 2));
  if (skipped) process.exitCode = 1;
  console.log(`\n✅ 과거 확장 완료 → ${added}개 포인트 추가, ${skipped}개 구간 SKIP. 출처 메타데이터 ${Object.keys(sources).length}개 시리즈`);
}
main().catch((e) => { console.error("실패:", e); process.exit(1); });
