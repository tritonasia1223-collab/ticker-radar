// 자본주의 타임라인 그래프용 FRED 시계열 수집·병합.
//   실행:  npx tsx script/fetch-capitalism-series.ts
// FRED 공개 CSV(키 불필요)에서 받아 client/src/data/capitalism-series.json 에 머지한다.
// 기존 키는 보존하고, 아래 SERIES 에 정의된 키만 갱신/추가한다(비파괴).
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "../client/src/data/capitalism-series.json");

type Point = [string, number];
interface SeriesDef {
  key: string;          // capitalism-series.json 의 키 (PANELS.series 와 일치)
  fredId: string;       // FRED 시리즈 ID
  freq: "monthly" | "asis"; // daily→월말 다운샘플 | 원본 그대로(이미 월/분기)
  scale?: number;       // 값 배율(예: 백만$→십억$ = 1/1000)
  decimals: number;
}

const SERIES: SeriesDef[] = [
  // 나스닥 종합지수(1971-02~, 일별 → 월말 다운샘플)
  { key: "nasdaq", fredId: "NASDAQCOM", freq: "monthly", decimals: 2 },
  // 미국 주가지수(OECD, 2015=100, 1957~ 월별) — S&P500 라이선스 대용 장기 지수
  { key: "sp500", fredId: "SPASTT01USM661N", freq: "asis", decimals: 2 },
  // 미국 기업 주식 시가총액(1945~ 분기, 백만$ → 십억$)
  { key: "mktcap", fredId: "NCBEILQ027S", freq: "asis", scale: 1 / 1000, decimals: 1 },
];

async function fetchCsv(id: string): Promise<Point[]> {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.trim().split("\n").slice(1); // 헤더 제외
  const out: Point[] = [];
  for (const line of lines) {
    const [date, raw] = line.split(",");
    if (!date || raw === undefined || raw === "." || raw.trim() === "") continue; // FRED 결측치 = "."
    const v = Number(raw);
    if (!Number.isFinite(v)) continue;
    out.push([date.trim(), v]);
  }
  return out;
}

// 일별 → 월말(각 YYYY-MM 의 마지막 관측치) 다운샘플, 날짜는 YYYY-MM-01 로 통일(기존 포맷).
function toMonthly(points: Point[]): Point[] {
  const byMonth = new Map<string, number>();
  for (const [date, v] of points) {
    const ym = date.slice(0, 7); // YYYY-MM
    byMonth.set(ym, v); // 정렬되어 있으므로 마지막 값이 월말
  }
  return Array.from(byMonth.entries()).map(([ym, v]) => [`${ym}-01`, v] as Point);
}

async function main() {
  const json = JSON.parse(readFileSync(OUT, "utf-8")) as Record<string, Point[]>;
  for (const s of SERIES) {
    process.stdout.write(`  ${s.key} (${s.fredId})… `);
    const raw = await fetchCsv(s.fredId);
    let pts = s.freq === "monthly" ? toMonthly(raw) : raw;
    const scale = s.scale ?? 1;
    pts = pts.map(([d, v]) => [d, Number((v * scale).toFixed(s.decimals))] as Point);
    json[s.key] = pts;
    console.log(`${pts.length}개 (${pts[0]?.[0]} ~ ${pts[pts.length - 1]?.[0]})`);
  }
  writeFileSync(OUT, JSON.stringify(json));
  console.log(`✅ 병합 완료 → ${OUT} (총 ${Object.keys(json).length}개 시리즈)`);
}
main().catch((e) => { console.error("실패:", e); process.exit(1); });
