// Fed 대차대조표(H.4.1) — 시리즈 카탈로그 · 단위 정규화 · 파생계산의 단일 출처.
//   백필(script/fed-backfill.ts) · 검증(script/fed-verify.ts) · 향후 /api/fed 가 전부 여기서 읽는다.
// 원칙(계획서 §3~§4): 원값은 million USD 로 '통일'해 저장, 파생값(SOMA·순유동성·워터폴·잔차)은
//   저장하지 않고 여기 순수함수로 계산 — 정의 변경 시 백필 불필요.
// 다른 모듈(capitalism/insider/congress)과 완전 분리: fed_balance_sheet 테이블만 사용.
import { db } from "./storage.js";
import { fedBalanceSheet } from "../shared/schema.js";

export type Unit = "millions" | "billions" | "index";
export type Role = "total" | "asset" | "liability" | "market";

export interface SeriesSpec {
  id: string;          // FRED series_id
  label: string;
  unit: Unit;          // 저장 전 정규화 기준(millions=그대로, billions=×1000, index=원값)
  freq: "weekly" | "daily";
  role: Role;
  group?: string;      // 자산: soma|loans / 부채: reserves|rrp|tga|currency
  optionalZero?: boolean; // 프로그램 비활성 시기엔 관측이 없을 수 있음 → 파생계산에서 0 취급
}

// ── H.4.1 주간(수요일 기준) ──
// 프리체크(2026-07-08)로 단위 확정: WALCL 6.74T·TREAST 4.5T·WRESBAL 3.1T 전부 millions.
export const SERIES: SeriesSpec[] = [
  // 자산(차변)
  { id: "WALCL",   label: "총자산",       unit: "millions", freq: "weekly", role: "total" },
  { id: "TREAST",  label: "국채(SOMA)",   unit: "millions", freq: "weekly", role: "asset", group: "soma" },
  { id: "WSHOMCB", label: "MBS(SOMA)",    unit: "millions", freq: "weekly", role: "asset", group: "soma" },
  { id: "WSHOFADSL", label: "연방기관채", unit: "millions", freq: "weekly", role: "asset", group: "soma", optionalZero: true },
  { id: "WLCFLPCL", label: "할인창구",    unit: "millions", freq: "weekly", role: "asset", group: "loans", optionalZero: true },
  { id: "H41RESPPALDKNWW", label: "BTFP", unit: "millions", freq: "weekly", role: "asset", group: "loans", optionalZero: true },
  { id: "WORAL",   label: "레포",         unit: "millions", freq: "weekly", role: "asset", group: "loans", optionalZero: true },
  { id: "SWPT",    label: "통화스왑",     unit: "millions", freq: "weekly", role: "asset", group: "loans", optionalZero: true },
  // 부채·자본(대변) — ⚠ 전부 '수요일 레벨(Wednesday Level)'로 통일. H.4.1 은 수요일 스냅샷이라
  //   주간평균 시리즈를 섞으면 항등식에 ±$100B 타이밍 노이즈가 잔차로 샌다(§3 진단으로 확정).
  //   지급준비금은 WLODLL(대차대조표 수요일 준비금=Other Deposits Held by DIs), 화폐발행은 WLFN(FR notes net 수요일).
  //   WRESBAL(주간평균)·WCURCIR(통화발행)은 파생계산에서 제외 — 참고·F1 앵커용으로만 수집 유지.
  { id: "WLODLL",  label: "지급준비금",   unit: "millions", freq: "weekly", role: "liability", group: "reserves" },
  { id: "WLRRAL",  label: "역레포(주간)", unit: "millions", freq: "weekly", role: "liability", group: "rrp" },
  { id: "WDTGAL",  label: "TGA(주간)",    unit: "millions", freq: "weekly", role: "liability", group: "tga" },
  { id: "WLFN",    label: "화폐발행",     unit: "millions", freq: "weekly", role: "liability", group: "currency" },
  { id: "WDFOL",   label: "해외공식예금", unit: "millions", freq: "weekly", role: "liability", group: "other" },
  { id: "WRESBAL", label: "지급준비금(주간평균·참고)", unit: "millions", freq: "weekly", role: "liability", group: "reserves-avg" },
  { id: "WCURCIR", label: "통화발행(참고)", unit: "millions", freq: "weekly", role: "liability", group: "currency-ref" },
  // ── 일간(순유동성 추적용) ──
  // RRPONTSYD 는 billions → ×1000. WTREGEN 은 FRED keyless 에선 주간(수요일)으로 반환됨(프리체크 확인)
  //   → 일간 순유동성에서 forward-fill 로 사용(§4). SP500 은 지수라 정규화 안 함.
  { id: "RRPONTSYD", label: "역레포(일간)", unit: "billions", freq: "daily", role: "liability", group: "rrp" },
  { id: "WTREGEN",   label: "TGA(일간계열)", unit: "millions", freq: "weekly", role: "liability", group: "tga" },
  { id: "SP500",     label: "S&P 500",     unit: "index",    freq: "daily", role: "market" },
];

export const BY_ID: Record<string, SeriesSpec> = Object.fromEntries(SERIES.map((s) => [s.id, s]));
export const WEEKLY_IDS = SERIES.filter((s) => s.freq === "weekly").map((s) => s.id);
export const DAILY_IDS = SERIES.filter((s) => s.freq === "daily").map((s) => s.id);

// 원값 → million USD 통일. index(SP500)는 원값 유지.
export function normalizeToMusd(unit: Unit, raw: number): number {
  if (unit === "billions") return raw * 1000;
  return raw; // millions | index
}

// ── DB 로드: seriesId → (obsDate → value_musd) ──
export async function loadAll(): Promise<Map<string, Map<string, number>>> {
  const rows = await db.select().from(fedBalanceSheet);
  const m = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (r.valueMusd == null) continue;
    let inner = m.get(r.seriesId);
    if (!inner) { inner = new Map(); m.set(r.seriesId, inner); }
    inner.set(r.obsDate, r.valueMusd);
  }
  return m;
}

// 특정 seriesId 의 관측을 날짜 오름차순 [date, value] 배열로.
export function seriesSorted(all: Map<string, Map<string, number>>, id: string): [string, number][] {
  const inner = all.get(id);
  if (!inner) return [];
  return [...inner.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

// 주간 격자: WALCL 관측일(수요일) 목록을 기준 날짜축으로 삼는다.
export function weeklyDates(all: Map<string, Map<string, number>>): string[] {
  return seriesSorted(all, "WALCL").map(([d]) => d);
}

// 특정 날짜의 시리즈 값. optionalZero 계열은 결측 시 0, 그 외 결측은 NaN.
function valAt(all: Map<string, Map<string, number>>, id: string, date: string): number {
  const v = all.get(id)?.get(date);
  if (v != null) return v;
  return BY_ID[id]?.optionalZero ? 0 : NaN;
}

export interface AssetBreak { total: number; soma: number; loans: number; residual: number; }
export interface LiabBreak { total: number; reserves: number; rrp: number; tga: number; currency: number; residual: number; }

// 자산 분해(차변): SOMA / 대출·스왑 / 기타(잔차) — 합은 WALCL.
export function deriveAssets(all: Map<string, Map<string, number>>, date: string): AssetBreak {
  const total = valAt(all, "WALCL", date);
  const soma = valAt(all, "TREAST", date) + valAt(all, "WSHOMCB", date) + valAt(all, "WSHOFADSL", date);
  const loans = valAt(all, "WLCFLPCL", date) + valAt(all, "H41RESPPALDKNWW", date) + valAt(all, "WORAL", date) + valAt(all, "SWPT", date);
  return { total, soma, loans, residual: total - soma - loans };
}

// 부채·자본 분해(대변): 준비금/역레포/TGA/현금 + 기타·자본(잔차) — 합은 WALCL.
export function deriveLiabilities(all: Map<string, Map<string, number>>, date: string): LiabBreak {
  const total = valAt(all, "WALCL", date);
  const reserves = valAt(all, "WLODLL", date);   // 수요일 준비금(대차대조표). WRESBAL(주간평균) 아님 — §3.
  const rrp = valAt(all, "WLRRAL", date);
  const tga = valAt(all, "WDTGAL", date);
  const currency = valAt(all, "WLFN", date);     // FR notes net(수요일). WCURCIR(통화발행) 아님 — §3.
  // 잔차 = 총자산 − (준비금+역레포+TGA+화폐발행). 남는 건 해외공식예금(WDFOL, ~$9B)+기타부채+자본 ≈ $60B 안정.
  return { total, reserves, rrp, tga, currency, residual: total - reserves - rrp - tga - currency };
}

// 주간 순유동성 = WALCL − TGA(주간) − 역레포(주간).
export function netLiquidityWeekly(all: Map<string, Map<string, number>>, date: string): number {
  return valAt(all, "WALCL", date) - valAt(all, "WDTGAL", date) - valAt(all, "WLRRAL", date);
}

export interface WaterfallStep { key: string; label: string; delta: number; }
export interface Waterfall {
  fromDate: string; toDate: string;
  reservesPrev: number; reservesNow: number;
  steps: WaterfallStep[];      // 부호: 준비금에 미치는 방향(증가+/감소−)
  reconError: number;          // |실측ΔWRESBAL − 분해합|
}

// 주간 준비금 변화 워터폴 (w vs w−1). 부호 반전: TGA·역레포·현금·기타 증가 = 준비금 감소.
//   ΔWRESBAL = ΔWALCL − ΔTGA − ΔRRP − ΔCUR − ΔOTHER.
export function waterfall(all: Map<string, Map<string, number>>, prev: string, now: string): Waterfall {
  const a = deriveLiabilities(all, prev);
  const b = deriveLiabilities(all, now);
  const dAssets = valAt(all, "WALCL", now) - valAt(all, "WALCL", prev);
  const dTga = b.tga - a.tga;
  const dRrp = b.rrp - a.rrp;
  const dCur = b.currency - a.currency;
  const dOther = b.residual - a.residual;
  const steps: WaterfallStep[] = [
    { key: "assets",   label: "Δ자산",        delta: dAssets },
    { key: "tga",      label: "ΔTGA",         delta: -dTga },
    { key: "rrp",      label: "Δ역레포",      delta: -dRrp },
    { key: "currency", label: "Δ현금통화",    delta: -dCur },
    { key: "other",    label: "Δ기타부채·자본", delta: -dOther },
  ];
  const decomp = steps.reduce((s, x) => s + x.delta, 0);
  const actual = b.reserves - a.reserves;
  return { fromDate: prev, toDate: now, reservesPrev: a.reserves, reservesNow: b.reserves, steps, reconError: Math.abs(actual - decomp) };
}

// ============================================================================
// API 빌더 — /api/fed/overview 가 반환할 형태. (모든 수치 million USD)
// ============================================================================
function v(all: Map<string, Map<string, number>>, id: string, date: string): number {
  const x = all.get(id)?.get(date);
  if (x != null) return x;
  return BY_ID[id]?.optionalZero ? 0 : NaN;
}

export interface WeekPoint {
  date: string;
  total: number;                 // WALCL
  treast: number; mbs: number; agency: number; soma: number;   // 자산 세부
  discount: number; btfp: number; repo: number; swap: number; loans: number;
  assetResidual: number;
  reserves: number; rrp: number; tga: number; currency: number; liabResidual: number; // 부채 세부
}

// 주간(수요일) 전체 관측 → T-계정·워터폴·헤드라인용 피벗. WALCL 관측일을 축으로.
export function buildWeekly(all: Map<string, Map<string, number>>): WeekPoint[] {
  const out: WeekPoint[] = [];
  for (const date of weeklyDates(all)) {
    const total = v(all, "WALCL", date);
    if (!Number.isFinite(total)) continue;
    const treast = v(all, "TREAST", date), mbs = v(all, "WSHOMCB", date), agency = v(all, "WSHOFADSL", date);
    const soma = treast + mbs + agency;
    const discount = v(all, "WLCFLPCL", date), btfp = v(all, "H41RESPPALDKNWW", date), repo = v(all, "WORAL", date), swap = v(all, "SWPT", date);
    const loans = discount + btfp + repo + swap;
    const reserves = v(all, "WLODLL", date), rrp = v(all, "WLRRAL", date), tga = v(all, "WDTGAL", date), currency = v(all, "WLFN", date);
    // 코어 부채 결측(시리즈 시작 전)이면 스킵 — 불완전주는 T계정에서 제외.
    if (![treast, mbs, reserves, rrp, tga, currency].every(Number.isFinite)) continue;
    out.push({
      date, total,
      treast, mbs, agency, soma, discount, btfp, repo, swap, loans, assetResidual: total - soma - loans,
      reserves, rrp, tga, currency, liabResidual: total - reserves - rrp - tga - currency,
    });
  }
  return out;
}

export interface DailyPoint { date: string; netLiq: number; sp500: number | null }

// 일간 순유동성 = WALCL(ffill) − TGA(ffill) − ONRRP(일간). RRPONTSYD 관측일(영업일)을 축으로.
//   주간(WALCL·WDTGAL)은 직전 수요일 값 forward-fill. SP500 은 있으면 첨부(없으면 null).
export function buildDaily(all: Map<string, Map<string, number>>): DailyPoint[] {
  const rrp = seriesSorted(all, "RRPONTSYD");
  const walcl = seriesSorted(all, "WALCL");
  const tga = seriesSorted(all, "WDTGAL");
  const sp = all.get("SP500");
  // forward-fill 포인터(두 배열 모두 오름차순)
  let wi = 0, ti = 0, wCur = NaN, tCur = NaN;
  const out: DailyPoint[] = [];
  for (const [date, onrrp] of rrp) {
    while (wi < walcl.length && walcl[wi][0] <= date) { wCur = walcl[wi][1]; wi++; }
    while (ti < tga.length && tga[ti][0] <= date) { tCur = tga[ti][1]; ti++; }
    if (!Number.isFinite(wCur) || !Number.isFinite(tCur)) continue; // 주간 시리즈 시작 전
    out.push({ date, netLiq: wCur - tCur - onrrp, sp500: sp?.get(date) ?? null });
  }
  return out;
}

// /api/fed/overview 페이로드.
export interface FedOverview { weeks: WeekPoint[]; daily: DailyPoint[]; updatedAt: string }
export async function fedOverview(): Promise<FedOverview> {
  const all = await loadAll();
  const weeks = buildWeekly(all);
  return { weeks, daily: buildDaily(all), updatedAt: weeks.at(-1)?.date ?? "" };
}
