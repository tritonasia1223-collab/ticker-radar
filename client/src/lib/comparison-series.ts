import { PANELS, CATEGORIES } from "./capitalism-config";
import { monthlyPoints, spreadPoints, type SpreadSpec, type SpreadPoint, type Observation } from "../../../shared/cap-comparison";

export const COMPARE_CATEGORIES = CATEGORIES;

const ids: Record<string, string> = { gdp_growth: "A191RL1Q225SBEA", inflation: "CPIAUCSL", unrate: "UNRATE", debt_gdp: "GFDEGDQ188S", mktcap: "NCBEILQ027S", sp500: "SPASTT01USM661N", nasdaq: "NASDAQCOM", fedfunds: "FEDFUNDS", tb3ms: "TB3MS", gs10: "GS10", dollar: "NBUSBIS", oil: "WTISPLC", trade: "NETEXC", m2: "M2SL", monbase: "BOGMBASE", walcl: "WALCL", wresbal: "WRESBAL", rrp: "RRPONTSYD" };
export interface CompareSeriesDef { id: string; label: string; unit: string; color: string; cadence: number; note: string; url: string; category: string }
export const COMPARE_SERIES: CompareSeriesDef[] = [
  ...PANELS.map(p => ({ id: p.series, label: p.id === "dollar" ? "달러지수 (접합 계열)" : p.id === "trade" ? "실질 순수출" : p.id === "sp500" ? "미국 주가지수 (OECD)" : p.label,
    unit: p.id === "trade" ? "십억 2017달러·연율" : p.unit, color: p.color, category: p.cat,
    cadence: ["gdp_growth", "debt_gdp", "mktcap", "trade"].includes(p.id) ? 3 : 1,
    note: p.id === "dollar" ? "주요통화 명목지수와 BIS 광의 명목지수의 접합값. 공식 DXY가 아닙니다. 상승=달러 강세."
      : p.id === "inflation" ? "CPI 수준이 아닌 전년 동월 대비 변화율(%)" : p.id === "trade" ? "분기 실질 순수출 · 계절조정 연율"
      : ["nasdaq", "walcl", "wresbal", "rrp"].includes(p.id) ? "일·주간 자료의 각 월 마지막 관측값"
      : ["gdp_growth", "debt_gdp", "mktcap"].includes(p.id) ? "분기 자료 (일부 초기 구간은 연간 자료)" : "월간 자료 · 기존 경제사 계열",
    url: p.id === "gold" ? "https://datahub.io/core/gold-prices" : `https://fred.stlouisfed.org/series/${ids[p.id]}` })),
  { id: "fx_krw", label: "원/달러 환율", unit: "원 / 1달러", color: "#f472b6", cadence: 1, category: "money", note: "월평균 · 상승=달러 강세/원화 약세 · 완료된 월만 수록", url: "https://fred.stlouisfed.org/series/EXKOUS" },
  { id: "fx_jpy", label: "엔/달러 환율", unit: "엔 / 1달러", color: "#a78bfa", cadence: 1, category: "money", note: "월평균 · 상승=달러 강세/엔화 약세 · 완료된 월만 수록", url: "https://fred.stlouisfed.org/series/EXJPUS" },
];

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
export function deltaUnit(unit: string) { return unit === "%" ? "%p" : unit === "idx" || unit === "p" ? "pt" : unit === "원 / 1달러" ? "원" : unit === "엔 / 1달러" ? "엔" : unit; }
