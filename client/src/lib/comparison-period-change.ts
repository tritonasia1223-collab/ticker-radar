import { periodSummary, type ComparisonQuoteTable, type ComparePoint } from "../../../shared/cap-comparison";
import { isAnnualObservation } from "./comparison-paths";

export function periodChange(id: string, points: ComparePoint[], from: string, to: string) {
  const result = periodSummary(points, from, to);
  const annual = isAnnualObservation(id, from.slice(0, 7)) ||
    !!result && (isAnnualObservation(id, result.first.month) || isAnnualObservation(id, result.last.month));
  return { result, annual };
}

export const oneDecimal = (value: number) => (Number(value.toFixed(1)) || 0).toLocaleString("ko", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const directionClass = (direction: string) => direction === "up" ? "text-rose-500 dark:text-rose-400" : direction === "down" ? "text-blue-500 dark:text-blue-400" : "text-muted-foreground";

export function changePresentation(result: { first: { raw: number }; last: { raw: number }; change: number }) {
  const rounded = Number(result.change.toFixed(1)) || 0;
  const direction = rounded > 0 ? "up" : rounded < 0 ? "down" : "flat";
  const start = oneDecimal(result.first.raw), end = oneDecimal(result.last.raw);
  const difference = (rounded > 0 ? "+" : "") + oneDecimal(rounded);
  return {
    direction, start, end, difference,
    symbol: direction === "up" ? "▲" : direction === "down" ? "▼" : "—",
    label: direction === "up" ? "상승" : direction === "down" ? "하락" : "변화 없음",
    line: `${start} → ${end} (${difference})`,
  };
}

export function periodChangeQuote(rows: { label: string; result: ReturnType<typeof periodSummary> }[], from: string, to: string, id: string): ComparisonQuoteTable | null {
  const values = rows.flatMap(row => row.result ? [{ label: row.label, start: row.result.first.raw, end: row.result.last.raw, change: row.result.change }] : []);
  return values.length ? { id, from, to, rows: values } : null;
}
