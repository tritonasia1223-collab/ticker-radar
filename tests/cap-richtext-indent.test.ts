import { describe, expect, it } from "vitest";
import { indentRichLines, plainText } from "../client/src/lib/capitalism-richtext";

describe("five-space paragraph indentation", () => {
  it("indents the current paragraph even when the caret is in the middle", () => {
    expect(indentRichLines("앞\n문단", 3)).toEqual({ text: "앞\n     문단", start: 8, end: 8 });
  });
  it("outdents authored five and nine space prefixes one step", () => {
    expect(indentRichLines("     ㄴ설명", 8, 8, true).text).toBe("ㄴ설명");
    expect(indentRichLines("         ㄴ설명", 12, 12, true).text).toBe("    ㄴ설명");
    expect(indentRichLines("  설명", 1, 1, true)).toEqual({ text: "설명", start: 0, end: 0 });
  });
  it("never deletes text on unindented Shift+Tab", () => {
    expect(indentRichLines("설명", 1, 1, true)).toEqual({ text: "설명", start: 1, end: 1 });
  });
  it("preserves colored and highlighted text", () => {
    const raw = "[[hl-y|앞문단]]\n[[c-v|뒤문단]]";
    const added = indentRichLines(raw, 0, plainText(raw).length);
    expect(added.text).toBe("     [[hl-y|앞문단]]\n     [[c-v|뒤문단]]");
    expect(indentRichLines(added.text, added.start, added.end, true).text).toBe(raw);
  });
  it("excludes the next line if a selection ends at its start", () => {
    expect(indentRichLines("하나\n둘\n셋", 0, 3).text).toBe("     하나\n둘\n셋");
  });
  it("handles empty first and last paragraphs", () => {
    expect(indentRichLines("\n글", 0).text).toBe("     \n글");
    expect(indentRichLines("글\n", 2).text).toBe("글\n     ");
  });
  it("retains list levels and skips divider lines in multi-line selections", () => {
    const raw = "• 목록\n───\n글";
    expect(indentRichLines(raw, 0, raw.length).text).toBe("\t• 목록\n───\n     글");
    expect(indentRichLines("\t\t• 목록", 5).text).toBe("\t\t• 목록");
  });
});
