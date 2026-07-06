// CLO 거시 신용 스트레스 스트립 — FRED 스프레드 시계열 (DB 무접촉).
//
// clo-tab-instructions v2 §4 Phase 1: 부실 대시보드의 "사이클 온도계" 앵커.
// FRED 공개 CSV 엔드포인트(fredgraph.csv)는 API 키 불요 → §6 키발급 액션아이템 없이 즉시 동작.
//
// 시리즈(부실 관점 선택):
//   BAMLH0A3HYC  CCC & Lower OAS  ← 최고위험 등급 스프레드. CLO CCC 버킷 부실과 직결(핵심 신호).
//   BAMLH0A0HYM2 High Yield OAS   ← HY 전체 스프레드(시장 신용 스트레스 광의).
//   BAMLC0A0CM   IG Corp OAS      ← 투자등급 베이스라인(대조군).

const FREDGRAPH = "https://fred.stlouisfed.org/graph/fredgraph.csv";
const COSD = "2015-01-01"; // 관측 시작(직전 사이클—2016 유가·2020 코로나·2022 긴축—이 보이게)

interface SeriesSpec { id: string; label: string; note: string; primary?: boolean }
const SERIES: SeriesSpec[] = [
  { id: "BAMLH0A3HYC", label: "CCC & Lower OAS", note: "최고위험 등급 — CLO CCC버킷 직결", primary: true },
  { id: "BAMLH0A0HYM2", label: "High Yield OAS", note: "HY 전체 신용 스트레스" },
  { id: "BAMLC0A0CM", label: "IG Corp OAS", note: "투자등급 베이스라인" },
];

export interface MacroPoint { date: string; value: number }
export interface MacroSeries {
  id: string; label: string; note: string; primary: boolean;
  latest: number; latestDate: string;
  chg1y: number | null;     // 최신 - 1년전 (percentage points)
  chg3m: number | null;     // 최신 - 3개월전
  windowMin: number; windowMax: number; // 관측창 최소/최대(현재 위치 감각)
  data: MacroPoint[];       // 주간 다운샘플
}
export interface CloMacro { series: MacroSeries[]; generatedAt: number; source: string; note: string }

async function fetchSeries(spec: SeriesSpec): Promise<MacroSeries | null> {
  const url = `${FREDGRAPH}?id=${spec.id}&cosd=${COSD}`;
  const resp = await fetch(url, { headers: { "User-Agent": "ticker-radar admin@tritonasia1223@gmail.com" } });
  if (!resp.ok) return null;
  const text = await resp.text();
  const all: MacroPoint[] = [];
  for (const line of text.replace(/\r/g, "").split("\n").slice(1)) {
    const [date, raw] = line.split(",");
    if (!date || raw == null || raw === "" || raw === ".") continue;
    const v = Number(raw);
    if (Number.isFinite(v)) all.push({ date, value: v });
  }
  if (all.length === 0) return null;

  const last = all[all.length - 1];
  // 특정 일수 전 값(가장 가까운, 그 이전 관측)
  const valAgo = (days: number): number | null => {
    const target = new Date(last.date).getTime() - days * 86400000;
    let best: MacroPoint | null = null;
    for (const p of all) { if (new Date(p.date).getTime() <= target) best = p; else break; }
    return best ? best.value : null;
  };
  const y = valAgo(365), m3 = valAgo(90);

  // 주간 다운샘플(매 5영업일) — 페이로드 경량화, 추세 충분
  const weekly = all.filter((_, i) => i % 5 === 0);
  if (weekly[weekly.length - 1]?.date !== last.date) weekly.push(last);

  const vals = all.map((p) => p.value);
  return {
    id: spec.id, label: spec.label, note: spec.note, primary: !!spec.primary,
    latest: last.value, latestDate: last.date,
    chg1y: y == null ? null : Math.round((last.value - y) * 100) / 100,
    chg3m: m3 == null ? null : Math.round((last.value - m3) * 100) / 100,
    windowMin: Math.min(...vals), windowMax: Math.max(...vals),
    data: weekly,
  };
}

let cache: { data: CloMacro; ts: number } | null = null;
const TTL = 6 * 60 * 60 * 1000; // 6h — OAS 는 일 1회 갱신

export async function cloMacro(force = false): Promise<CloMacro> {
  if (!force && cache && Date.now() - cache.ts < TTL) return cache.data;
  const out: MacroSeries[] = [];
  for (const spec of SERIES) {
    const s = await fetchSeries(spec).catch(() => null);
    if (s) out.push(s);
  }
  const data: CloMacro = {
    series: out, generatedAt: Date.now(), source: "FRED (ICE BofA OAS)",
    note: "신용 스프레드 = 실시간 시장 스트레스 프록시. 넓어질수록 부실 우려↑. CCC 가 CLO 담보 부실과 가장 직결.",
  };
  cache = { data, ts: Date.now() };
  return data;
}
