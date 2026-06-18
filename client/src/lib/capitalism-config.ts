// 자본주의 타임라인 — 패널/카테고리 설정 (FRED 거시지표 14종).
export interface PanelDef {
  id: string;
  label: string;
  unit: string;
  series: string;     // capitalism-series.json 의 키
  cat: string;        // market | macro | money | fed | rates
  color: string;
  on: boolean;        // 기본 표시 여부
  start: string;      // 데이터 시작 연도(표시용)
  zeroLine?: boolean;
  kind: "line" | "area";
}

export const CATEGORIES: Record<string, { label: string; color: string }> = {
  macro: { label: "거시경제", color: "#5dd6a0" },
  rates: { label: "금리", color: "#ef8a8a" },
  money: { label: "통화·대외", color: "#f0b366" },
  fed: { label: "연준 유동성", color: "#c08cf0" },
};

export const PANELS: PanelDef[] = [
  { id: "gdp_growth", label: "실질 GDP 성장률", unit: "%", series: "gdp_growth", cat: "macro", color: "#5dd6a0", on: true, start: "1947", zeroLine: true, kind: "area" },
  { id: "inflation", label: "인플레이션 (CPI YoY)", unit: "%", series: "inflation", cat: "macro", color: "#e0c267", on: true, start: "1948", zeroLine: true, kind: "line" },
  { id: "unrate", label: "실업률", unit: "%", series: "unrate", cat: "macro", color: "#8fb98f", on: false, start: "1948", kind: "line" },
  { id: "debt_gdp", label: "GDP 대비 정부부채", unit: "%", series: "debt_gdp", cat: "macro", color: "#7fae7f", on: false, start: "1939", kind: "area" },
  { id: "tb3ms", label: "단기금리 (3M T-Bill)", unit: "%", series: "tb3ms", cat: "rates", color: "#ef8a8a", on: true, start: "1934", kind: "line" },
  { id: "gs10", label: "장기금리 (10Y 국채)", unit: "%", series: "gs10", cat: "rates", color: "#d96a6a", on: true, start: "1953", kind: "line" },
  { id: "fedfunds", label: "연준 정책금리", unit: "%", series: "fedfunds", cat: "rates", color: "#f0a0a0", on: false, start: "1954", kind: "line" },
  { id: "dollar", label: "달러지수", unit: "idx", series: "dollar", cat: "money", color: "#f0b366", on: true, start: "1973", kind: "line" },
  { id: "trade", label: "무역수지 (순수출)", unit: "$B", series: "trade", cat: "money", color: "#e0a050", on: false, start: "1947", zeroLine: true, kind: "area" },
  { id: "m2", label: "M2 통화량", unit: "$B", series: "m2", cat: "money", color: "#d9954a", on: false, start: "1959", kind: "line" },
  { id: "monbase", label: "본원통화", unit: "$B", series: "monbase", cat: "fed", color: "#c08cf0", on: false, start: "1959", kind: "line" },
  { id: "walcl", label: "연준 총자산", unit: "$B", series: "walcl", cat: "fed", color: "#b07ce0", on: false, start: "2002", kind: "area" },
  { id: "wresbal", label: "지급준비금", unit: "$B", series: "wresbal", cat: "fed", color: "#a878d8", on: false, start: "2002", kind: "line" },
  { id: "rrp", label: "역레포 (ON RRP)", unit: "$B", series: "rrp", cat: "fed", color: "#9868d0", on: false, start: "2003", kind: "area" },
];

export const CAT_COLORS: Record<string, string> = {
  "정치": "#6ea8fe",
  "경제": "#5dd6a0",
  "사회": "#f0b366",
};

export const KIND_STYLE: Record<string, { tag: string; c: string }> = {
  cause: { tag: "원인", c: "#6ea8fe" },
  event: { tag: "사건", c: "#f0b366" },
  effect: { tag: "영향", c: "#5dd6a0" },
  result: { tag: "결과", c: "#c08cf0" },
};

// 'YYYY-MM-DD' → 소수 연도(1971.62 등). 슬라이더/플레이헤드 위치 계산용.
export function toFracYear(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const yearStart = Date.UTC(y, 0, 1);
  const yearEnd = Date.UTC(y + 1, 0, 1);
  const t = Date.UTC(y, (m || 1) - 1, d || 1);
  return y + (t - yearStart) / (yearEnd - yearStart);
}

// 소수 연도(1972.5) → 'YYYY년 M월' 사람이 읽는 표기.
// 소수부를 12개월로 환산(0=1월 … 11=12월). 10진법 오해 방지용.
export function fracYearToLabel(frac: number): string {
  const year = Math.floor(frac);
  let month = Math.floor((frac - year) * 12) + 1; // 1~12
  if (month < 1) month = 1;
  if (month > 12) month = 12;
  return `${year}년 ${month}월`;
}

// 연도 → 당시 미국 대통령 / 연준(Fed) 의장 (1971~1980 타임라인 범위).
// 한 해 안에서 교체된 경우 병기. 출처: 백악관/연준 공식 재임 기록.
// 대통령: 닉슨(~1974.8) → 포드(1974.8~1977.1) → 카터(1977.1~1981.1)
// Fed: 번스(~1978.1) → 밀러(1978.3~1979.8) → 볼커(1979.8~)
export function leadersForYear(year: number): { president: string; fed: string } | null {
  let president: string;
  if (year <= 1973) president = "닉슨";
  else if (year === 1974) president = "닉슨→포드";
  else if (year <= 1976) president = "포드";
  else president = "카터"; // 1977~

  let fed: string;
  if (year <= 1977) fed = "번스";
  else if (year === 1978) fed = "번스→밀러";
  else if (year === 1979) fed = "밀러→볼커";
  else fed = "볼커"; // 1980~

  if (!president || !fed) return null;
  return { president, fed };
}
