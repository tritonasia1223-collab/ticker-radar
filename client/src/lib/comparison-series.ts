import { PANELS, CATEGORIES } from "./capitalism-config";
import { monthlyPoints, spreadPoints, type SpreadSpec, type SpreadPoint, type Observation } from "../../../shared/cap-comparison";
import { historyNote } from "./capitalism-history";

export const COMPARE_CATEGORIES = CATEGORIES;

const ids: Record<string, string> = { gdp_growth: "A191RL1Q225SBEA", inflation: "CPIAUCSL", unrate: "UNRATE", debt_gdp: "GFDEGDQ188S", mktcap: "NCBEILQ027S", sp500: "SPASTT01USM661N", nasdaq: "NASDAQCOM", fedfunds: "FEDFUNDS", tb3ms: "TB3MS", gs10: "GS10", usd_purchasing_power: "CPIAUCNS", reer: "RBUSBIS", oil: "WTISPLC", trade: "NETEXC", m2: "M2SL", monbase: "BOGMBASE", walcl: "WALCL", wresbal: "WRESBAL", rrp: "RRPONTSYD" };
export interface CompareSeriesDef { id: string; label: string; unit: string; color: string; cadence: number; note: string; url: string; category: string }
export const COMPARE_SERIES: CompareSeriesDef[] = [
  ...PANELS.map(p => ({ id: p.series, label: p.id === "trade" ? "실질 순수출" : p.id === "sp500" ? "미국 주가지수 (OECD)" : p.label,
    unit: p.id === "trade" ? "십억 2017달러·연율" : p.unit, color: p.color, category: p.cat,
    cadence: ["gdp_growth", "debt_gdp", "mktcap", "trade"].includes(p.id) ? 3 : 1,
    note: p.id === "dxy" ? "주요 6개 통화 대비 명목 달러가치 · 실제 DXY 월말 종가 · 1973-03부터"
      : p.id === "reer" ? "상대국 물가를 반영한 실질 대외가치 · Fed/BIS 장기 연결"
      : p.id === "usd_purchasing_power" ? "미국 CPI 역수 · 하락=미국 내 달러 구매력 감소 · 기준월 대비 구매력 비교"
      : p.id === "inflation" ? "CPI 수준이 아닌 전년 동월 대비 변화율(%)" : p.id === "trade" ? "분기 실질 순수출 · 계절조정 연율"
      : ["nasdaq", "walcl", "wresbal", "rrp"].includes(p.id) ? "일·주간 자료의 각 월 마지막 관측값"
      : ["gdp_growth", "debt_gdp", "mktcap"].includes(p.id) ? "분기 자료 (일부 초기 구간은 연간 자료)" : "월간 자료 · 기존 경제사 계열",
    url: p.id === "dxy" ? "https://finance.yahoo.com/quote/DX-Y.NYB/history/" : p.id === "gold" ? "https://datahub.io/core/gold-prices" : `https://fred.stlouisfed.org/series/${ids[p.id]}` })),
  { id: "fx_krw", label: "원/달러 환율", unit: "원 / 1달러", color: "#f472b6", cadence: 1, category: "money", note: "월평균 · 상승=달러 강세/원화 약세 · 완료된 월만 수록", url: "https://fred.stlouisfed.org/series/EXKOUS" },
  { id: "fx_jpy", label: "엔/달러 환율", unit: "엔 / 1달러", color: "#a78bfa", cadence: 1, category: "money", note: "월평균 · 상승=달러 강세/엔화 약세 · 완료된 월만 수록", url: "https://fred.stlouisfed.org/series/EXJPUS" },
  { id: "fx_eur", label: "유로/달러 환율", unit: "달러 / 1유로", color: "#38bdf8", cadence: 1, category: "money", note: "월평균 · 시장 관행(EUR/USD)대로 1유로당 달러 · 상승=유로 강세/달러 약세(원·엔 환율과 방향 반대) · 1999년 유로 도입 이후 · 완료된 월만 수록", url: "https://fred.stlouisfed.org/series/EXUSEU" },
  // 미국 대외거래 — 수지 수준과, 수지를 움직이는 쪽이 수출인지 수입인지 보는 증가율 두 개.
  { id: "trade_bal", label: "미국 무역수지", unit: "$B", color: "#fb923c", cadence: 1, category: "money", note: "상품·서비스 무역수지(국제수지 기준) · 월간 · 계절조정 · 음수=적자 · 기준월=100 비교에는 맞지 않으니 원래 값으로 보세요", url: "https://fred.stlouisfed.org/series/BOPGSTB" },
  { id: "trade_cycle", label: "수출−수입 증가율 격차", unit: "%p", color: "#facc15", cadence: 1, category: "money", note: "수출 증가율 − 수입 증가율(전년 동월 대비, %p) · 0 위=수출이 더 빨리 느는 수출 사이클(수지 개선 방향), 0 아래=수입이 더 빨리 느는 수입 사이클 · 0 을 오가는 값이라 원래 값으로 보세요", url: "https://fred.stlouisfed.org/series/BOPTEXP" },
  { id: "exports_yoy", label: "미국 수출 증가율", unit: "%", color: "#34d399", cadence: 1, category: "money", note: "상품·서비스 수출의 전년 동월 대비 변화율(%) · 수입 증가율과 함께 켜면 수출 사이클인지 수입 사이클인지 보입니다", url: "https://fred.stlouisfed.org/series/BOPTEXP" },
  { id: "imports_yoy", label: "미국 수입 증가율", unit: "%", color: "#f87171", cadence: 1, category: "money", note: "상품·서비스 수입의 전년 동월 대비 변화율(%) · 수출 증가율보다 높으면 수입이 수지를 끌어내리는 국면", url: "https://fred.stlouisfed.org/series/BOPTIMP" },
];
// 과거 확장 구간이 있는 지표는 출처 목록 설명에 구간을 덧붙인다(수록 기간은 데이터에서 자동으로 첫 관측일이 된다).
for (const s of COMPARE_SERIES) { const h = historyNote(s.id); if (h) s.note = `${s.note} · ${h}`; }


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
export const seriesLabel = (id: string) => COMPARE_SERIES.find(s => s.id === id)?.label ?? (id === "dollar" ? "기존 달러지수(삭제됨)" : id === "cpi_level" ? "CPI 수준(이전 지표)" : id);
export const activeSeriesIds = (ids: string[]) => [...new Set(ids.filter(id => COMPARE_SERIES.some(s => s.id === id)))];

// Migrate viewing preferences only; saved prose retains its original series identity.
export const viewingSeriesIds = (ids: string[]) => activeSeriesIds(ids.map(id => id === "cpi_level" ? "usd_purchasing_power" : id));
