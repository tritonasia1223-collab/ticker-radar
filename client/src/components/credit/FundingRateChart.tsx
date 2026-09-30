import { observedRate } from "@shared/credit/rate-comparison";
import { joinSpread } from "@shared/credit/signals";
import type { Point } from "@shared/credit/schema";
import { RateComparisonChart } from "./RateComparisonChart";

export function FundingRateChart({ sofr, iorb, asOf, weeks = 4 }: { sofr: Point[]; iorb: Point[]; asOf: string; weeks?: 4 | 13 }) {
  const spread = joinSpread(sofr, iorb), dates = new Set(spread.map(p => p.date));
  return <div className="space-y-3 min-w-0" data-testid="funding-rates">
    <h3 className="text-sm font-semibold">초단기 금리 · SOFR와 IORB</h3>
    <RateComparisonChart id="sofr-iorb" kind="difference" rates={[observedRate("sofr", "SOFR", sofr.filter(p => dates.has(p.date)), asOf), observedRate("iorb", "IORB", iorb.filter(p => dates.has(p.date)), asOf)]} spread={observedRate("sofr-iorb", "SOFR − IORB", spread, asOf)} asOf={asOf} years={1} weeks={weeks} spreadUnit="bp" />
    <p className="text-[11px] text-muted-foreground">SOFR는 담보부 익일 조달금리, IORB는 연준이 은행 준비금에 지급하는 금리입니다. 차이가 양수라는 이유만으로 자금 부족을 확정하지 않습니다.</p>
  </div>;
}
