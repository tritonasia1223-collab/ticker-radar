import { PANELS } from "./capitalism-config";
import { monthlyPoints, spreadPoints, spreadSchema, RATE_SPREAD_IDS, type SpreadSpec, type SpreadPoint, type Observation } from "../../../shared/cap-comparison";
import { historyNote } from "./capitalism-history";

// Comparison-only catalog: keep the economic-history panels and source data intact.
const excludedIds = new Set(["sp500", "mktcap", "monbase", "walcl", "wresbal", "rrp", "tb3ms", "gs10", "fedfunds", "unrate", "inflation"]);
export const COMPARE_CATEGORIES = {
  dollar: { label: "달러·환율", color: "#0ea5e9" },
  money: { label: "금리·통화", color: "#0d9488" },
  assets: { label: "자산 가격", color: "#d4af37" },
  economy: { label: "경제·무역", color: "#8b5cf6" },
};
const categoryIds: Record<keyof typeof COMPARE_CATEGORIES, string[]> = {
  dollar: ["dxy", "reer", "usd_purchasing_power", "fx_krw", "fx_jpy", "fx_eur"],
  money: ["real_tb3ms", "m2"],
  assets: ["gold", "oil", "nasdaq"],
  economy: ["real_gdp", "cpi_level", "debt_gdp", "trade_bal", "net_exports_gdp"],
};

const ids: Record<string, string> = { real_gdp: "GDPC1", inflation: "CPIAUCSL", unrate: "UNRATE", debt_gdp: "GFDEGDQ188S", mktcap: "NCBEILQ027S", sp500: "SPASTT01USM661N", nasdaq: "NASDAQCOM", fedfunds: "FEDFUNDS", tb3ms: "TB3MS", gs10: "GS10", usd_purchasing_power: "CPIAUCNS", reer: "RBUSBIS", oil: "WTISPLC", net_exports_gdp: "NETEXP", m2: "M2SL", monbase: "BOGMBASE", walcl: "WALCL", wresbal: "WRESBAL", rrp: "RRPONTSYD" };
export interface CompareSeriesDef { id: string; label: string; unit: string; color: string; cadence: number; note: string; url: string; category: string }
export const COMPARE_SERIES: CompareSeriesDef[] = [
  { id: "cpi_level", label: "미국 소비자물가 수준(CPI)", unit: "idx", color: "#e0c267", cadence: 1, category: "economy", note: "CPIAUCNS · 월간 · 비계절조정 · 1982~1984=100 · 전년비가 아닌 물가 수준", url: "https://fred.stlouisfed.org/series/CPIAUCNS" },
  ...PANELS.filter(p => !excludedIds.has(p.id)).map(p => ({ id: p.series, label: p.label,
    unit: p.unit, color: p.color, category: ["real_tb3ms", "usd_purchasing_power"].includes(p.id) ? "money" : p.cat,
    cadence: ["real_gdp", "debt_gdp", "mktcap", "net_exports_gdp"].includes(p.id) ? 3 : 1,
    note: p.id === "real_gdp" ? "물가 영향을 제거한 경제 규모 · 십억 2017년 연쇄달러 · 1929~1946 연간, 1947~ 분기(계절조정 연율) · 성장률이 아닌 수준" : p.id === "dxy" ? "주요 6개 통화 대비 명목 달러가치 · 실제 DXY 월말 종가 · 1973-03부터"
      : p.id === "reer" ? "상대국 물가를 반영한 실질 대외가치 · Fed/BIS 장기 연결"
      : p.id === "usd_purchasing_power" ? "미국 CPI 역수 · 하락=미국 내 달러 구매력 감소 · 기준월 대비 구매력 비교"
      : p.id === "real_tb3ms" ? "3개월 T-bill 금리 − 동월 CPI 전년비 · 직접 계산한 실질금리 근사치"
      : p.id === "inflation" ? "CPI 수준이 아닌 전년 동월 대비 변화율(%)" : p.id === "net_exports_gdp" ? "명목 순수출÷명목 GDP×100 · 상품·서비스·국민계정 기준 · 1929~1946 연간, 1947~ 분기 · 0%=균형, 양수=흑자, 음수=적자"
      : ["nasdaq", "walcl", "wresbal", "rrp"].includes(p.id) ? "일·주간 자료의 각 월 마지막 관측값"
      : ["real_gdp", "debt_gdp", "mktcap"].includes(p.id) ? "분기 자료 (일부 초기 구간은 연간 자료)" : "월간 자료 · 기존 경제사 계열",
    url: p.id === "net_exports_gdp" ? "https://fred.stlouisfed.org/graph/?id=NETEXP,GDP" : p.id === "real_tb3ms" ? "https://fred.stlouisfed.org/graph/?id=TB3MS,CPIAUCSL" : p.id === "dxy" ? "https://finance.yahoo.com/quote/DX-Y.NYB/history/" : p.id === "gold" ? "https://datahub.io/core/gold-prices" : `https://fred.stlouisfed.org/series/${ids[p.id]}` })),
  { id: "fx_krw", label: "원/달러 환율", unit: "원 / 1달러", color: "#f472b6", cadence: 1, category: "money", note: "월평균 · 상승=달러 강세/원화 약세 · 완료된 월만 수록", url: "https://fred.stlouisfed.org/series/EXKOUS" },
  { id: "fx_jpy", label: "엔/달러 환율", unit: "엔 / 1달러", color: "#a78bfa", cadence: 1, category: "money", note: "월평균 · 상승=달러 강세/엔화 약세 · 완료된 월만 수록", url: "https://fred.stlouisfed.org/series/EXJPUS" },
  { id: "fx_eur", label: "유로/달러 환율", unit: "달러 / 1유로", color: "#38bdf8", cadence: 1, category: "money", note: "월평균 · 시장 관행(EUR/USD)대로 1유로당 달러 · 상승=유로 강세/달러 약세(원·엔 환율과 방향 반대) · 1999년 유로 도입 이후 · 완료된 월만 수록", url: "https://fred.stlouisfed.org/series/EXUSEU" },
  // 미국 대외거래 — 명목 상품·서비스 무역수지.
  { id: "trade_bal", label: "미국 무역수지", unit: "$B", color: "#fb923c", cadence: 1, category: "money", note: "상품·서비스 명목 무역수지(국제수지 기준) · 십억 달러/월 · 초기 연간÷12, 이후 계절조정 월간 · 음수=적자", url: "https://fred.stlouisfed.org/series/BOPGSTB" },
];
// 과거 확장 구간이 있는 지표는 출처 목록 설명에 구간을 덧붙인다(수록 기간은 데이터에서 자동으로 첫 관측일이 된다).
for (const s of COMPARE_SERIES) { const h = historyNote(s.id); if (h) s.note = `${s.note} · ${h}`; }
for (const [category, seriesIds] of Object.entries(categoryIds)) {
  for (const s of COMPARE_SERIES) if (seriesIds.includes(s.id)) s.category = category;
}
const pickerOrder = Object.values(categoryIds).flat();
COMPARE_SERIES.sort((a, b) => pickerOrder.indexOf(a.id) - pickerOrder.indexOf(b.id));

export const availableSpreadIds = RATE_SPREAD_IDS.filter(id => COMPARE_SERIES.some(s => s.id === id));
export function activeSpread(value: unknown): SpreadSpec | null {
  const parsed = spreadSchema.safeParse(value);
  return parsed.success && availableSpreadIds.includes(parsed.data.a) && availableSpreadIds.includes(parsed.data.b) ? parsed.data : null;
}

export interface SpreadData { spec: SpreadSpec; label: string; aLabel: string; bLabel: string; points: SpreadPoint[] }
export function makeSpread(spec: SpreadSpec | null | undefined, data: Record<string, Observation[]> | undefined): SpreadData | null {
  if (!spec) return null;
  const a = COMPARE_SERIES.find(s => s.id === spec.a), b = COMPARE_SERIES.find(s => s.id === spec.b);
  if (!a || !b) return null;
  return { spec, label: a.label + " − " + b.label, aLabel: a.label, bLabel: b.label,
    points: spreadPoints(monthlyPoints(data?.[spec.a] ?? []), monthlyPoints(data?.[spec.b] ?? [])) };
}
export const numberLabel = (value: number) => value.toLocaleString("ko", { maximumFractionDigits: 2 });
export const signedLabel = (value: number) => (value > 0 ? "+" : "") + numberLabel(value);
export function deltaUnit(unit: string) { return unit === "%" ? "%p" : unit === "idx" || unit === "p" ? "pt" : unit === "원 / 1달러" ? "원" : unit === "엔 / 1달러" ? "엔" : unit === "달러 / 1유로" ? "달러" : unit; }

// Preserve saved note identities; never relabel the retired composite as DXY or REER.
const retiredTradeLabels: Record<string, string> = { gdp_growth: "실질 GDP 성장률", trade: "실질 순수출", trade_cycle: "수출−수입 증가율 격차", exports_yoy: "미국 수출 증가율", imports_yoy: "미국 수입 증가율" };
export const seriesLabel = (id: string) => COMPARE_SERIES.find(s => s.id === id)?.label ?? (excludedIds.has(id) ? (PANELS.find(p => p.id === id)?.label ?? id) + "(비교에서 제외됨)" : retiredTradeLabels[id] ? retiredTradeLabels[id] + "(삭제됨)" : id === "dollar" ? "기존 달러지수(삭제됨)" : id);
export const activeSeriesIds = (ids: string[]) => [...new Set(ids.filter(id => COMPARE_SERIES.some(s => s.id === id)))];

// Migrate viewing preferences only; saved prose retains its original series identity.
export const viewingSeriesIds = (ids: string[]) => activeSeriesIds(ids.map(id => id === "inflation" ? "cpi_level" : id === "trade" ? "net_exports_gdp" : id === "gdp_growth" ? "real_gdp" : id));

const shortLabels: Record<string, string> = {
  dxy: "달러지수(DXY, 명목)", reer: "실질실효환율(REER)", usd_purchasing_power: "달러 구매력",
  fx_krw: "원/달러", fx_jpy: "엔/달러", fx_eur: "유로/달러",
  real_tb3ms: "실질금리", m2: "M2 통화량", gold: "금", oil: "유가(WTI)", nasdaq: "나스닥 종합",
  cpi_level: "물가 수준(CPI)", debt_gdp: "정부부채/GDP",
};
export const shortSeriesLabel = (id: string) => shortLabels[id] ?? seriesLabel(id);
