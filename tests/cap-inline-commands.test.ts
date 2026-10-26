import { describe, expect, it } from "vitest";
import { applyInlineTextCommand, inlineFractionCommand } from "../client/src/lib/capitalism-richtext";

describe("space-triggered fraction commands", () => {
  it.each([["1/3", "⅓"], ["1/2", "½"], ["2/3", "⅔"], ["3/4", "¾"], ["1/10", "⅒"], ["5/8", "⅝"]])("converts %s and places the caret after its space", (typed, symbol) => {
    const before = "비율 " + typed;
    expect(applyInlineTextCommand(before + "나머지", before.length)).toEqual({ text: "비율 " + symbol + " 나머지", caret: 5 });
  });
  it.each(["2026/1/3", "https://example.com/1/3", "11/3", "1/30", "0.1/3", "x1/3", "1/0", "2/7", "01/3"]) ("preserves non-command %s", text => {
    expect(applyInlineTextCommand(text, text.length)).toBeNull();
  });
  it("does not convert an incomplete denominator or date at the caret", () => {
    expect(applyInlineTextCommand("1/30", 3)).toBeNull();
    expect(applyInlineTextCommand("1/3/2026", 3)).toBeNull();
  });
  it("supports Korean prose and signed values without consuming the prefix", () => {
    expect(inlineFractionCommand("전체의1/3")).toEqual({ index: 3, symbol: "⅓" });
    expect(applyInlineTextCommand("-1/3", 4)).toEqual({ text: "-⅓ ", caret: 3 });
  });
  it("keeps existing arrow and circled number commands", () => {
    expect(applyInlineTextCommand("->", 2)).toEqual({ text: "→ ", caret: 2 });
    expect(applyInlineTextCommand("(1)", 3)).toEqual({ text: "① ", caret: 2 });
  });
});
