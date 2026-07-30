// 자본주의 거시 시계열(357KB) 로더.
//   과거엔 capitalism-series.json 을 정적 import 해 Capitalism 코드 청크(585KB)에 통째로 박혀서,
//   코드가 조금만 바뀌어도 이 데이터까지 새 해시로 재다운로드됐다.
//   → Vite '?url' 로 JSON 을 '별도 해시 에셋'으로 분리(코드 청크에서 빠짐 + base 자동 처리 + 내용 안
//     바뀌면 해시 유지→재다운로드 없음), react-query 로 감싸 세션 1회만 fetch 하고 여러 컴포넌트가 공유.
import seriesUrl from "@/data/capitalism-series.json?url";
import { useQuery } from "@tanstack/react-query";

export type SeriesMap = Record<string, [string, number][]>;

export function useCapSeries() {
  return useQuery<SeriesMap>({
    queryKey: ["capitalism-series"],
    queryFn: async () => (await fetch(seriesUrl)).json() as Promise<SeriesMap>,
    staleTime: Infinity, // 정적 데이터 — 세션 내 재요청 안 함
    gcTime: Infinity,
  });
}
