// 금액 단위는 백만 달러. 비교일 잔액 → 선택일 잔액과 같은 (비교일, 선택일] 구간.
export const DEBT_DAY = 86_400_000;
export const debtDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export function debtWindow(asOf: string, weeks: 4 | 13, offset = 0) {
  const end = debtDate(Date.parse(asOf) - offset * weeks * 7 * DEBT_DAY);
  const from = debtDate(Date.parse(end) - weeks * 7 * DEBT_DAY);
  return { from, start: debtDate(Date.parse(from) + DEBT_DAY), end, weeks };
}
export interface TreasuryFlow {
  from: string; start: string; end: string; weeks: 4 | 13;
  baselineDate: string; observedThrough: string;
  issues: number; redemptions: number; inflation: number; net: number; billsNet: number;
}
export interface TreasuryFlowResponse { flow: TreasuryFlow | null; error: string | null }
