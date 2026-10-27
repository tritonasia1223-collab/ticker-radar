import type { Point } from "./capitalism-refresh";

export const CPI_MODERN_FROM = "1913-01-01";
export const CPI_HISTORY_NOTE = "1860~1912: MeasuringWorth 역사 추정치·연간 / 1913~: BLS CPI·월간. 1913년 연평균 기준으로 연결. 경계의 차이에는 자료 전환 영향이 포함될 수 있습니다.";
export const isHistoricalCpi = (id: string, date: string) =>
  ["cpi_level", "usd_purchasing_power"].includes(id) && date >= "1860-01" && date < "1913-01";

// One observation per year. Scale levels only; never turn these into inflation
// rates or fabricate monthly observations from the annual source.
export function extendCpiLevels(stored: Point[], annual: Point[]) {
  if (annual.length !== 54 || annual.some(([d, v], i) => d !== `${1860 + i}-01-01` || !Number.isFinite(v) || v <= 0)) {
    throw new Error("Expected 54 consecutive annual CPI levels, 1860–1913");
  }
  const modern = stored.filter(([d]) => d >= CPI_MODERN_FROM);
  const anchor = modern.filter(([d]) => d.startsWith("1913-"));
  if (anchor.length !== 12 || anchor.some(([d, v], i) => d !== `1913-${String(i + 1).padStart(2, "0")}-01` || !Number.isFinite(v) || v <= 0)) {
    throw new Error("Expected all 12 official CPI months in 1913");
  }
  const blsAnnualMean = anchor.reduce((sum, [, v]) => sum + v, 0) / 12;
  const historicalAnchor = annual.at(-1)![1];
  const factor = blsAnnualMean / historicalAnchor;
  const history: Point[] = annual.slice(0, -1).map(([d, v]) => [d, Number((v * factor).toFixed(6))]);
  return { points: [...history, ...modern], history, factor, blsAnnualMean, historicalAnchor };
}
