import { describe, expect, it } from "vitest";
import { monthlyPoints, comparisonInsightSchema } from "../shared/cap-comparison";
import { changePresentation, periodChange, periodChangeQuote } from "../client/src/lib/comparison-period-change";
import { validateEdit } from "../server/cap-collaboration";
import { merge } from "../shared/cap-collaboration";

const tableId = "10000000-0000-4000-8000-000000000001";
const points = (a: number, b: number) => periodChange("real_tb3ms", monthlyPoints([["2000-01-01", a], ["2000-02-01", b]]), "2000-01-01", "2000-02-01").result!;
describe("compact period change", () => {
  it("rounds all values to one decimal and omits units from the difference", () => {
    expect(changePresentation(points(15.96, 7.16))).toMatchObject({ direction: "down", symbol: "▼", line: "16.0 → 7.2 (-8.8)" });
    expect(changePresentation(points(20, 10.26))).toMatchObject({ difference: "-9.7", direction: "down" });
    expect(changePresentation(points(-20, -10))).toMatchObject({ direction: "up", line: "-20.0 → -10.0 (+10.0)" });
    expect(changePresentation(points(1.002, 1.001))).toMatchObject({ direction: "flat", symbol: "—", difference: "0.0" });
  });
  it("stores quote tables separately from prose and preserves the unrounded source values", () => {
    const table = periodChangeQuote([{ label: "실질금리", result: points(15.96, 7.16) }, { label: "자료 없음", result: null }], "2000-01-01", "2000-02-01", tableId)!;
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]).toMatchObject({ label: "실질금리", start: 15.96, end: 7.16 });
    const original = { title: "인사이트", date: "2000-01-01", endDate: "2000-02-01", text: "[[hl-y|기존 본문]]", caption: "", sortOrder: 1 };
    const op = validateEdit({ id: tableId, session: tableId, editor: "test", resource: "note:test", changes: [{ path: ["tables"], before: null, after: [table] }] });
    const result = merge(original, op.changes);
    expect(result.doc?.text).toBe(original.text);
    expect(comparisonInsightSchema.parse(result.doc).tables).toEqual([table]);
    const edited = merge(result.doc!, [{ path: ["text"], before: original.text, after: "본문 수정" }]);
    expect(comparisonInsightSchema.parse(edited.doc).tables).toEqual([table]);
    expect(comparisonInsightSchema.safeParse({ ...original, tables: [{ ...table, rows: [{ label: "invalid", start: Infinity, end: 1, change: 1 }] }] }).success).toBe(false);
    expect(periodChangeQuote([], "2000-01-01", "2000-02-01", tableId)).toBeNull();
  });
  it("marks annual or mixed-frequency periods as references without interpolating endpoints", () => {
    const points = monthlyPoints([["1945-01-01", 10], ["1946-01-01", 12], ["1947-01-01", 15], ["1947-04-01", 16]]);
    const yearly = periodChange("real_gdp", points, "1945-02-01", "1946-12-31");
    expect(yearly).toEqual({ result: null, annual: true });
    const mixed = periodChange("real_gdp", points, "1946-01-01", "1947-04-01");
    expect(mixed.annual).toBe(true);
    expect(mixed.result?.change).toBe(4);
    expect(periodChange("real_gdp", points, "1947-01-01", "1947-04-01").annual).toBe(false);
  });
});
