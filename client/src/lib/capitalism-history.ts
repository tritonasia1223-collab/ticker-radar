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
  inflation: [{ source: "미국 CPI 계절조정 지수의 전년 동월 대비 상승률", id: "CPIAUCSL", url: fred("CPIAUCSL"), note: "CPI 수준에서 12개월 전년비를 계산합니다. 이전 구간은 비계절조정 CPI를 사용하므로 조정 방식이 다릅니다." }],
  gdp_growth: [{ source: "미국 실질 GDP 성장률 · 분기 전기 대비 연율", id: "A191RL1Q225SBEA", url: fred("A191RL1Q225SBEA"), note: "이전 연간 성장률과 발표 주기·계산 기준이 다릅니다." }],
  unrate: [{ source: "미국 실업률 · 월간 계절조정", id: "UNRATE", url: fred("UNRATE"), note: "BLS 실업률을 사용합니다. 1947년 공백은 채우지 않습니다." }],
  fedfunds: [{ source: "미국 유효 연방기금금리", id: "FEDFUNDS", url: fred("FEDFUNDS"), note: "월평균 유효금리입니다. 이전 재할인율은 같은 지표가 아닌 정책금리 대용입니다." }],
  gs10: [{ source: "미국 10년 국채 고정만기 수익률", id: "GS10", url: fred("GS10"), note: "월간 자료입니다. 이전 구간은 만기가 고정된 10년물 대신 장기 국채수익률입니다." }],
  tb3ms: [{ source: "미국 3개월 재무부 단기증권 금리", id: "TB3MS", url: fred("TB3MS"), note: "이전 상업어음 금리는 T-bill과 신용위험·수준이 다른 대용 지표입니다." }],
  monbase: [{ source: "미국 본원통화", id: "BOGMBASE", url: fred("BOGMBASE"), note: "월간 원자료입니다. 이전 조정 본원통화는 정의가 달라 배율을 조정해 연결했습니다." }],
  sp500: [{ source: "OECD 미국 주가지수", id: "SPASTT01USM661N", url: fred("SPASTT01USM661N"), note: "이전 다우존스와 구성 종목이 다릅니다. 전체 기간을 동일한 S&P 500 원본 지수로 해석하지 않습니다." }],
};

const SPECIAL: Record<string, SourcePeriod[]> = {
  dollar: [
    { from: "1973-01-01", to: "2019-12-01", source: "연준 주요통화 명목 달러지수", id: "TWEXMMTH", url: fred("TWEXMMTH"), note: "월평균 원자료를 소수 둘째 자리로 반올림한 값입니다. 직접 역산한 BIS 지수가 아니며, 이 원자료는 2019년 12월 이후 중단됐습니다." },
    { from: "2020-01-01", source: "BIS 광의 명목실효환율 기반 연결값", id: "NBUSBIS", url: fred("NBUSBIS"), note: "초기 파일에 저장된 연결값을 유지합니다. 이후 월간 갱신에서는 신규 관측값에 최근 겹침 최대 12개월의 저장값/원자료 비율 중앙값을 곱합니다. 현재 BIS 원자료의 수준값과 같지 않으며, 출처 전환 경계에는 계산 기준의 차이도 반영될 수 있습니다. BIS 자료 자체는 1994년부터 있지만 우리 차트는 2020년부터 사용합니다. 전체 계열은 ICE DXY가 아닙니다." },
  ],
  debt_gdp: [
    { from: "1939-01-01", to: "1965-01-01", source: "OMB 총연방부채 / GDP · 연간", id: "GFDGDPA188S", url: fred("GFDGDPA188S"), note: "FRED가 제공하는 연간 비율입니다. 이전 재무부 부채로 계산한 값 및 이후 분기 공공부채 비율과 정의·주기가 다릅니다." },
    { from: "1966-01-01", source: "미국 총공공부채 / GDP · 분기", id: "GFDEGDQ188S", url: fred("GFDEGDQ188S"), note: "FRED가 총공공부채와 명목 GDP로 계산한 분기 비율입니다." },
  ],
  gold: [
    { from: "1833-01-01", to: "1959-12-01", source: "DataHub 역사적 금 가격 · 연평균", id: "gold-prices", url: "https://datahub.io/core/gold-prices", note: "원 제공자가 연평균 값을 각 월에 반복 수록한 구간입니다. 실제 월별 가격 변화나 일괄적인 공식 고정가격으로 해석하지 않습니다." },
    { from: "1960-01-01", source: "DataHub 금 가격 · 월간", id: "gold-prices", url: "https://datahub.io/core/gold-prices", note: "World Bank 등 자료를 모은 제공자의 월간 달러/트로이온스 계열입니다. 1944년은 우리 초기 수록 시작점일 뿐 원자료의 주기 전환점이 아닙니다." },
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
    note: [s.proxy ? "대용 지표 · 원래 수준을 유지해 연결." : s.method === "rebase" ? `배율 조정 후 연결${s.factor == null ? "" : ` (×${s.factor})`}.` : "배율 조정 없이 연결.", s.note].join(" ") }));
  const current = SPECIAL[seriesKey] ?? CURRENT[seriesKey]?.map(s => ({ ...s, from: h.modernFrom })) ?? [];
  return [...earlier, ...current];
}

export const sourcePeriodLabel = (s: SourcePeriod) => s.from.slice(0, 7) + (s.to ? " ~ " + s.to.slice(0, 7) : "부터");

// 선택 목록 툴팁에도 구간별 원자료 이름을 표시합니다.
export function historyNote(seriesKey: string): string {
  return sourcePeriods(seriesKey).map(s => `${sourcePeriodLabel(s)} ${s.source}`).join("; ");
}
