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
  trade_bal: [{ source: "BEA 상품·서비스 무역수지 · 월간", id: "BOPGSTB", url: fred("BOPGSTB"), note: "명목·국제수지 기준·계절조정. 십억 달러/월. 음수=적자." }],
  trade: [{ source: "BEA 실질 순수출 · 분기 연율", id: "NETEXC", url: fred("NETEXC"), note: "2017년 연쇄가격·십억 달러·계절조정 연율. 양수·음수는 당시 명목 무역흑자·적자와 다를 수 있습니다." }],
  reer: [{ source: "BIS 실질 광의 실효환율", id: "RBUSBIS", url: fred("RBUSBIS"), note: "2020=100. 상대국 물가를 반영한 실질 대외가치." }],
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
  real_tb3ms: [
    { from: "1914-01-01", to: "1933-12-01", source: "상업어음 금리(대용) − CPI 전년비", id: "M13002US35620M156NNBR − CPIAUCNS YoY", url: "https://fred.stlouisfed.org/graph/?id=M13002US35620M156NNBR,CPIAUCNS", note: "T-bill 이전 대용값 · 비계절조정 CPI · 직접 계산." },
    { from: "1934-01-01", to: "1947-12-01", source: "3개월 T-bill − CPI 전년비(비계절조정)", id: "TB3MS − CPIAUCNS YoY", url: "https://fred.stlouisfed.org/graph/?id=TB3MS,CPIAUCNS", note: "동월 금리 − 물가상승률 · 직접 계산." },
    { from: "1948-01-01", source: "3개월 T-bill − CPI 전년비(계절조정)", id: "TB3MS − CPIAUCSL YoY", url: "https://fred.stlouisfed.org/graph/?id=TB3MS,CPIAUCSL", note: "동월 금리 − 물가상승률 · 실질금리 근사치." },
  ],
  usd_purchasing_power: [
    { from: "1913-01-01", source: "미국 CPI 기반 달러 구매력", id: "CPIAUCNS", url: fred("CPIAUCNS"), note: "CPI 역수 · 1982~1984=100. 하락하면 미국 내 구매력 감소." },
  ],
  cpi_level: [
    { from: "1913-01-01", source: "미국 소비자물가지수 · 비계절조정", id: "CPIAUCNS", url: fred("CPIAUCNS"), note: "1982~1984=100. 상승하면 고정된 달러의 국내 구매력은 하락." },
  ],
  dxy: [
    { from: "1973-03-01", source: "ICE 달러지수 · Yahoo 제공", id: "DX-Y.NYB", url: "https://finance.yahoo.com/quote/DX-Y.NYB/history/", note: "주요 6개 통화 대비 명목가치 · 일간 종가의 월말 값." },
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
  if (seriesKey === "real_tb3ms") return {
    modernFrom: "1948-01-01",
    segments: SPECIAL.real_tb3ms.slice(0, 2).map((s, i) => ({ ...s, to: s.to!,
      short: i === 0 ? "상업어음 대용 − CPI 전년비" : "T-bill − 비계절조정 CPI 전년비",
      method: "append", proxy: i === 0, factor: null })),
  };
  const h = MAP[seriesKey];
  return h && h.segments.length ? h : null;
}

export function sourcePeriods(seriesKey: string): SourcePeriod[] {
  const h = historyOf(seriesKey);
  if (["real_tb3ms", "usd_purchasing_power", "cpi_level", "dxy", "gold"].includes(seriesKey)) return SPECIAL[seriesKey];
  if (!h) return [];
  const earlier = h.segments.map(s => ({ from: s.from, to: s.to, source: s.source, id: s.id, url: s.url,
    note: ["trade", "trade_bal"].includes(seriesKey) ? s.note : seriesKey === "debt_gdp" ? "직접 계산한 대용값. 1939년 경계에 약 8%p 단절." : s.proxy ? "정의가 다른 대용 지표 · 배율 조정 없음." : s.method === "rebase" ? "배율을 조정해 연결." : "배율 조정 없음." }));
  const current = SPECIAL[seriesKey] ?? CURRENT[seriesKey]?.map(s => ({ ...s, from: h.modernFrom })) ?? [];
  return [...earlier, ...current];
}

export const sourcePeriodLabel = (s: SourcePeriod) => s.from.slice(0, 7) + (s.to ? " ~ " + s.to.slice(0, 7) : "부터");

// 선택 목록 툴팁에도 구간별 원자료 이름을 표시합니다.
export function historyNote(seriesKey: string): string {
  return sourcePeriods(seriesKey).map(s => `${sourcePeriodLabel(s)} ${s.source}`).join("; ");
}
