import { differenceSeries, type Point } from "./capitalism-refresh";

// Same-month nominal short rate minus observed CPI YoY: a simple real-rate approximation.
// Both inputs already include documented historical sources; never fill missing months.
export function withRealInterestRate(data: Record<string, Point[]>): Record<string, Point[]> {
  return { ...data, real_tb3ms: differenceSeries(data.tb3ms ?? [], data.inflation ?? [], 2) };
}
