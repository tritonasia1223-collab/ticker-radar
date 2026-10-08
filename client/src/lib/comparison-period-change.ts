import { periodSummary, type ComparePoint } from "../../../shared/cap-comparison";
import { isAnnualObservation } from "./comparison-paths";
import { deltaUnit } from "./comparison-series";
import { serializeRich } from "./capitalism-richtext";

export function periodChange(id: string, points: ComparePoint[], from: string, to: string) {
  const result = periodSummary(points, from, to);
  const annual = isAnnualObservation(id, from.slice(0, 7)) ||
    !!result && (isAnnualObservation(id, result.first.month) || isAnnualObservation(id, result.last.month));
  return { result, annual };
}

export function changePresentation(result: NonNullable<ReturnType<typeof periodSummary>>, unit: string) {
  // Keep small changes visible rather than showing an arrow next to a rounded zero.
  const precision = result.change !== 0 && Math.abs(result.change) < .01 ? 6 : 2;
  const format = (value: number) => value.toLocaleString("ko", { maximumFractionDigits: precision });
  const direction = result.change > 0 ? "up" : result.change < 0 ? "down" : "flat";
  const differenceUnit = unit === "$B" ? "십억 달러" : deltaUnit(unit);
  return {
    direction,
    symbol: direction === "up" ? "▲" : direction === "down" ? "▼" : "—",
    label: direction === "up" ? "상승" : direction === "down" ? "하락" : "변화 없음",
    line: `${format(result.first.raw)} → ${format(result.last.raw)} (${result.change > 0 ? "+" : ""}${format(result.change)}${differenceUnit})`,
  };
}

export function periodChangeQuote(rows: { label: string; unit: string; annual: boolean; result: ReturnType<typeof periodSummary> }[], from: string, to: string) {
  const blocks = rows.flatMap(row => {
    if (!row.result) return [];
    const change = changePresentation(row.result, row.unit);
    const heading = serializeRich([{ text: `${row.label} ${change.symbol}`, mark: change.direction === "up" ? "c-r" : change.direction === "down" ? "c-b" : undefined }]);
    return [[heading, change.line, ...(row.annual ? ["연간 자료 · 참고"] : [])].join("\n")];
  });
  if (!blocks.length) return "";
  return [serializeRich([{ text: "이 구간의 변화", mark: "hl-b" }]) + `\n${from} ~ ${to}`, ...blocks].join("\n\n");
}
