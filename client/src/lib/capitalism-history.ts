// 거시지표 과거 확장의 출처 구간 메타데이터(script/extend-capitalism-history.ts 가 생성).
//   modernFrom = 현행 시리즈가 시작하는 관측일. 그 앞 segments 는 정의·주기가 다른 옛 출처라 화면에서 점선·경계·출처 라벨로 구분한다.
import SOURCES from "@/data/capitalism-series-sources.json";

export interface HistorySegment {
  from: string; to: string; source: string; short: string; id: string; url: string; note: string;
  method: "append" | "rebase"; proxy: boolean; factor: number | null;
}
export interface SeriesHistory { modernFrom: string; segments: HistorySegment[] }

const MAP = SOURCES as Record<string, SeriesHistory>;

export function historyOf(seriesKey: string): SeriesHistory | null {
  const h = MAP[seriesKey];
  return h && h.segments.length ? h : null;
}

// 그래프 비교 출처 목록용 한 줄 설명
export function historyNote(seriesKey: string): string {
  const h = historyOf(seriesKey);
  if (!h) return "";
  return "과거 구간: " + h.segments.map((s) => `${s.from.slice(0, 7)}~${s.to.slice(0, 7)} ${s.source}${s.proxy ? "(대용)" : s.method === "rebase" ? "(접합)" : ""}`).join("; ") + `; ${h.modernFrom.slice(0, 7)}~ 현행 시리즈`;
}
