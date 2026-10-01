// 거시지표 과거 확장의 출처 구간 메타데이터(script/extend-capitalism-history.ts 가 생성).
//   modernFrom = 현행 시리즈가 시작하는 관측일. 그 앞 segments 는 정의·주기가 다른 옛 출처라 화면에서 점선·경계·출처 라벨로 구분한다.
import SOURCES from "@/data/capitalism-series-sources.json";

export interface HistorySegment {
  from: string; to: string; source: string; short: string; id: string; url: string; note: string;
  method: "append" | "rebase"; proxy: boolean; factor: number | null;
}
export interface SeriesHistory { modernFrom: string; segments: HistorySegment[] }

export interface SourcePeriod {
  from: string; to?: string; source: string; id: string; url: string; note: string;
}

const fred = (id: string) => `https://fred.stlouisfed.org/series/${id}`;
// These dates describe the periods used in our saved chart, not the start of the provider's full dataset.
const CURRENT: Record<string, Omit<SourcePeriod, "from">[]> = {
  inflation: [{ source: "미국 CPI 전년비 · 계절조정", id: "CPIAUCSL", url: fred("CPIAUCSL"), note: "이전 구간과 계절조정 방식이 다릅니다." }],
  gdp_growth: [{ source: "미국 실질 GDP 성장률 · 분기 전기 대비 연율", id: "A191RL1Q225SBEA", url: fred("A191RL1Q225SBEA"), note: "이전 구간은 연간 성장률입니다." }],
  unrate: [{ source: "미국 실업률 · 월간 계절조정", id: "UNRATE", url: fred("UNRATE"), note: "1947년은 자료가 없습니다." }],
  fedfunds: [{ source: "미국 유효 연방기금금리", id: "FEDFUNDS", url: fred("FEDFUNDS"), note: "월평균." }],
  gs10: [{ source: "미국 10년 국채 고정만기 수익률", id: "GS10", url: fred("GS10"), note: "월평균." }],
  tb3ms: [{ source: "미국 3개월 재무부 단기증권 금리", id: "TB3MS", url: fred("TB3MS"), note: "월평균." }],
  monbase: [{ source: "미국 본원통화", id: "BOGMBASE", url: fred("BOGMBASE"), note: "월간 원자료." }],
  sp500: [{ source: "OECD 미국 주가지수", id: "SPASTT01USM661N", url: fred("SPASTT01USM661N"), note: "이전 다우존스와 구성 종목이 다릅니다." }],
};

const SPECIAL: Record<string, SourcePeriod[]> = {
  dollar: [
    { from: "1973-01-01", to: "2019-12-01", source: "연준 주요통화 명목 달러지수", id: "TWEXMMTH", url: fred("TWEXMMTH"), note: "월평균 원자료." },
    { from: "2020-01-01", source: "BIS 광의 명목 달러지수", id: "NBUSBIS", url: fred("NBUSBIS"), note: "BIS 기반 조정값. 전체 계열은 ICE DXY가 아닙니다." },
  ],
  debt_gdp: [
    { from: "1939-01-01", to: "1965-01-01", source: "OMB 총연방부채 / GDP · 연간", id: "GFDGDPA188S", url: fred("GFDGDPA188S"), note: "구간별 부채 정의·주기가 다릅니다." },
    { from: "1966-01-01", source: "미국 총공공부채 / GDP · 분기", id: "GFDEGDQ188S", url: fred("GFDEGDQ188S"), note: "FRED 제공 비율." },
  ],
  gold: [
    { from: "1833-01-01", to: "1959-12-01", source: "DataHub 역사적 금 가격 · 연평균", id: "gold-prices", url: "https://datahub.io/core/gold-prices", note: "연평균을 각 월에 반복한 값." },
    { from: "1960-01-01", source: "DataHub 금 가격 · 월간", id: "gold-prices", url: "https://datahub.io/core/gold-prices", note: "달러/트로이온스." },
  ],
};

const MAP = SOURCES as Record<string, SeriesHistory>;

export function historyOf(seriesKey: string): SeriesHistory | null {
  const h = MAP[seriesKey];
  return h && h.segments.length ? h : null;
}

export function sourcePeriods(seriesKey: string): SourcePeriod[] {
  const h = historyOf(seriesKey);
  if (seriesKey === "dollar" || seriesKey === "gold") return SPECIAL[seriesKey];
  if (!h) return [];
  const earlier = h.segments.map(s => ({ from: s.from, to: s.to, source: s.source, id: s.id, url: s.url,
    note: seriesKey === "debt_gdp" ? "직접 계산한 대용값. 1939년 경계에 약 8%p 단절." : s.proxy ? "정의가 다른 대용 지표 · 배율 조정 없음." : s.method === "rebase" ? "배율을 조정해 연결." : "배율 조정 없음." }));
  const current = SPECIAL[seriesKey] ?? CURRENT[seriesKey]?.map(s => ({ ...s, from: h.modernFrom })) ?? [];
  return [...earlier, ...current];
}

export const sourcePeriodLabel = (s: SourcePeriod) => s.from.slice(0, 7) + (s.to ? " ~ " + s.to.slice(0, 7) : "부터");

// 선택 목록 툴팁에도 구간별 원자료 이름을 표시합니다.
export function historyNote(seriesKey: string): string {
  return sourcePeriods(seriesKey).map(s => `${sourcePeriodLabel(s)} ${s.source}`).join("; ");
}
