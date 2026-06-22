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
  market: { label: "주식시장", color: "#38bdf8" },
  rates: { label: "금리", color: "#ef8a8a" },
  money: { label: "통화·대외", color: "#f0b366" },
  fed: { label: "연준 유동성", color: "#c08cf0" },
};

export const PANELS: PanelDef[] = [
  { id: "gdp_growth", label: "실질 GDP 성장률", unit: "%", series: "gdp_growth", cat: "macro", color: "#5dd6a0", on: true, start: "1947", zeroLine: true, kind: "area" },
  { id: "inflation", label: "인플레이션 (CPI YoY)", unit: "%", series: "inflation", cat: "macro", color: "#e0c267", on: true, start: "1948", zeroLine: true, kind: "line" },
  { id: "sp500", label: "미국 주가지수 (S&P500 추종)", unit: "idx", series: "sp500", cat: "market", color: "#0ea5e9", on: false, start: "1957", kind: "line" },
  { id: "nasdaq", label: "나스닥 종합", unit: "p", series: "nasdaq", cat: "market", color: "#38bdf8", on: false, start: "1971", kind: "line" },
  { id: "mktcap", label: "미국 시총 (기업 주식)", unit: "$B", series: "mktcap", cat: "market", color: "#2563eb", on: true, start: "1945", kind: "area" },
  { id: "unrate", label: "실업률", unit: "%", series: "unrate", cat: "macro", color: "#8fb98f", on: false, start: "1948", kind: "line" },
  { id: "debt_gdp", label: "GDP 대비 정부부채", unit: "%", series: "debt_gdp", cat: "macro", color: "#7fae7f", on: true, start: "1939", kind: "area" },
  { id: "tb3ms", label: "단기금리 (3M T-Bill)", unit: "%", series: "tb3ms", cat: "rates", color: "#ef8a8a", on: false, start: "1934", kind: "line" },
  { id: "gs10", label: "장기금리 (10Y 국채)", unit: "%", series: "gs10", cat: "rates", color: "#d96a6a", on: false, start: "1953", kind: "line" },
  { id: "fedfunds", label: "연준 정책금리", unit: "%", series: "fedfunds", cat: "rates", color: "#f0a0a0", on: true, start: "1954", kind: "line" },
  { id: "dollar", label: "달러지수", unit: "idx", series: "dollar", cat: "money", color: "#f0b366", on: true, start: "1973", kind: "line" },
  { id: "oil", label: "유가 (WTI)", unit: "$/bbl", series: "oil", cat: "money", color: "#cc7a33", on: false, start: "1946", kind: "line" },
  { id: "gold", label: "금값 (oz당)", unit: "$/oz", series: "gold", cat: "money", color: "#d4af37", on: false, start: "1944", kind: "line" },
  { id: "trade", label: "무역수지 (순수출)", unit: "$B", series: "trade", cat: "money", color: "#e0a050", on: false, start: "1947", zeroLine: true, kind: "area" },
  { id: "m2", label: "M2 통화량", unit: "$B", series: "m2", cat: "money", color: "#d9954a", on: false, start: "1959", kind: "line" },
  { id: "monbase", label: "본원통화", unit: "$B", series: "monbase", cat: "fed", color: "#c08cf0", on: false, start: "1959", kind: "line" },
  { id: "walcl", label: "연준 총자산", unit: "$B", series: "walcl", cat: "fed", color: "#b07ce0", on: false, start: "2002", kind: "area" },
  { id: "wresbal", label: "지급준비금", unit: "$B", series: "wresbal", cat: "fed", color: "#a878d8", on: false, start: "2002", kind: "line" },
  { id: "rrp", label: "역레포 (ON RRP)", unit: "$B", series: "rrp", cat: "fed", color: "#9868d0", on: false, start: "2003", kind: "area" },
];

// 달러→원화 고정 환율(근사). 시총·무역수지 등 $ 단위 패널의 '단위 클릭 → 원화 전환'에 사용.
// 고정 환율이라 그래프 모양은 동일하고 축·값 숫자만 원화로 바뀐다(과거 환율 변동은 미반영).
export const USD_KRW = 1380;

// $ 단위를 원화 단위로 변환하는 배율·라벨. 변환 불가 단위면 null.
//   $B(십억$) → 조₩  (×USD_KRW/1000),  $/bbl → ₩/bbl,  $ → ₩
export function krwConversion(unit: string): { factor: number; unit: string } | null {
  if (unit === "$B") return { factor: USD_KRW / 1000, unit: "조₩" };
  if (unit === "$/bbl") return { factor: USD_KRW, unit: "₩/bbl" };
  if (unit === "$/oz") return { factor: USD_KRW, unit: "₩/oz" };
  if (unit === "$") return { factor: USD_KRW, unit: "₩" };
  return null;
}

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

// 연도 → 당시 미국 대통령 / 연준(Fed) 의장. 한 해 안에서 교체되면 "전임→후임"으로 병기.
// 취임은 대부분 연초(대통령 1.20, 연준 의장은 1~2월 또는 8월) → 교체연도 라벨은 전임→후임.
// 출처: 백악관/연준 공식 재임 기록.
//  대통령: 존슨(~1969.1) → 닉슨(1969.1~1974.8) → 포드(~1977.1) → 카터(~1981.1) →
//          레이건(~1989.1) → 부시(아버지)(~1993.1) → 클린턴(~2001.1) → 부시(아들)(~2009.1) →
//          오바마(~2017.1) → 트럼프(~2021.1) → 바이든(~2025.1) → 트럼프(2025.1~)
//  연준:   마틴(~1970.1) → 번스(~1978.1) → 밀러(~1979.8) → 볼커(~1987.8) → 그린스펀(~2006.1) →
//          버냉키(~2014.1) → 옐런(~2018.2) → 파월(2018.2~)
export function leadersForYear(year: number): { president: string; fed: string } | null {
  let president: string;
  if (year <= 1968) president = "존슨";
  else if (year === 1969) president = "존슨→닉슨"; // 1969.1.20 취임
  else if (year <= 1973) president = "닉슨";
  else if (year === 1974) president = "닉슨→포드"; // 1974.8 사임
  else if (year <= 1976) president = "포드";
  else if (year <= 1980) president = "카터";
  else if (year === 1981) president = "카터→레이건";
  else if (year <= 1988) president = "레이건";
  else if (year === 1989) president = "레이건→부시(아버지)";
  else if (year <= 1992) president = "부시(아버지)";
  else if (year === 1993) president = "부시(아버지)→클린턴";
  else if (year <= 2000) president = "클린턴";
  else if (year === 2001) president = "클린턴→부시(아들)";
  else if (year <= 2008) president = "부시(아들)";
  else if (year === 2009) president = "부시(아들)→오바마";
  else if (year <= 2016) president = "오바마";
  else if (year === 2017) president = "오바마→트럼프";
  else if (year <= 2020) president = "트럼프";
  else if (year === 2021) president = "트럼프→바이든";
  else if (year <= 2024) president = "바이든";
  else if (year === 2025) president = "바이든→트럼프";
  else president = "트럼프"; // 2026~

  let fed: string;
  if (year <= 1969) fed = "마틴";
  else if (year === 1970) fed = "마틴→번스"; // 번스 1970.1 말 취임
  else if (year <= 1977) fed = "번스";
  else if (year === 1978) fed = "번스→밀러";
  else if (year === 1979) fed = "밀러→볼커"; // 볼커 1979.8 취임
  else if (year <= 1986) fed = "볼커";
  else if (year === 1987) fed = "볼커→그린스펀"; // 그린스펀 1987.8 취임
  else if (year <= 2005) fed = "그린스펀";
  else if (year === 2006) fed = "그린스펀→버냉키"; // 버냉키 2006.2 취임
  else if (year <= 2013) fed = "버냉키";
  else if (year === 2014) fed = "버냉키→옐런"; // 옐런 2014.2 취임
  else if (year <= 2017) fed = "옐런";
  else if (year === 2018) fed = "옐런→파월"; // 파월 2018.2 취임
  else if (year <= 2025) fed = "파월"; // 2019~2025
  else if (year === 2026) fed = "파월→워시"; // 워시 2026.5.22 취임
  else fed = "워시"; // 2027~

  return { president, fed };
}
