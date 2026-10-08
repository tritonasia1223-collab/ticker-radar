import { describe, expect, it } from "vitest";
import { monthlyPoints } from "../shared/cap-comparison";
import { changePresentation, periodChange, periodChangeQuote } from "../client/src/lib/comparison-period-change";
import { parseRich, plainText } from "../client/src/lib/capitalism-richtext";

describe("compact period change", () => {
  it("quotes readable two-line blocks using supported editor colors, preserving annual caveats", () => {
    const result = periodChange("real_tb3ms", monthlyPoints([["2000-01-01", 15.96], ["2000-02-01", 7.16]]), "2000-01-01", "2000-02-01").result;
    const quote = periodChangeQuote([
      { label: "실질금리", unit: "%", annual: false, result },
      { label: "연간 지표", unit: "%", annual: true, result },
      { label: "자료 없는 지표", unit: "%", annual: false, result: null },
    ], "2000-01-01", "2000-02-01");
    expect(plainText(quote)).toBe("이 구간의 변화\n2000-01-01 ~ 2000-02-01\n\n실질금리 ▼\n15.96 → 7.16 (-8.8%p)\n\n연간 지표 ▼\n15.96 → 7.16 (-8.8%p)\n연간 자료 · 참고");
    expect(parseRich(quote)).toContainEqual({ text: "실질금리 ▼", mark: "c-b" });
    expect(periodChangeQuote([], "2000-01-01", "2000-02-01")).toBe("");
  });
  it("shows a percentage-point decrease, not a percent return", () => {
    const { result } = periodChange("real_tb3ms", monthlyPoints([["2000-01-01", 15.96], ["2000-02-01", 7.16]]), "2000-01-01", "2000-02-01");
    expect(changePresentation(result!, "%")).toEqual({ direction: "down", symbol: "▼", label: "하락", line: "15.96 → 7.16 (-8.8%p)" });
  });
  it("uses absolute differences for negative balances and preserves flat and small changes", () => {
    const change = (a: number, b: number, unit: string) => changePresentation(periodChange("trade_bal", monthlyPoints([["2000-01-01", a], ["2000-02-01", b]]), "2000-01-01", "2000-02-01").result!, unit);
    expect(change(-20, -10, "$B").line).toBe("-20 → -10 (+10십억 달러)");
    expect(change(-20, -10, "$B").direction).toBe("up");
    expect(change(100, 100, "idx")).toMatchObject({ direction: "flat", symbol: "—", line: "100 → 100 (0pt)" });
    expect(change(1.001, 1.002, "달러 / 1유로").line).toBe("1.001 → 1.002 (+0.001달러)");
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
