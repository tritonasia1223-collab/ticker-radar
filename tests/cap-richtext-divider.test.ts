import { describe, expect, it } from "vitest";
import { insertRichDivider, DIVIDER_LINE, plainText } from "../client/src/lib/capitalism-richtext";

describe("insight divider insertion", () => {
  it("inserts between paragraphs and places the caret below the divider", () => {
    const result = insertRichDivider("앞 문단\n뒤 문단", 4);
    expect(result.text).toBe(`앞 문단\n${DIVIDER_LINE}\n뒤 문단`);
    expect(plainText(result.text).slice(result.caret)).toBe("뒤 문단");
  });
  it("splits a highlighted sentence without losing either part or its marks", () => {
    const result = insertRichDivider("[[hl-y|앞뒤]]", 1);
    expect(result.text).toBe(`[[hl-y|앞]]\n${DIVIDER_LINE}\n[[hl-y|뒤]]`);
    expect(result.caret).toBe(6);
  });
  it("supports an empty editor and appending after text", () => {
    expect(insertRichDivider("", 0)).toEqual({ text: `${DIVIDER_LINE}\n`, caret: 4 });
    expect(insertRichDivider("글", 1)).toEqual({ text: `글\n${DIVIDER_LINE}\n`, caret: 6 });
  });
  it("keeps existing inline scene markers and links intact", () => {
    const raw = "[[link:history|출처]]\n앞\n[[scene:abc]]\n뒤";
    const result = insertRichDivider(raw, 2);
    expect(result.text).toContain("[[link:history|출처]]");
    expect(result.text).toContain("[[scene:abc]]");
    expect(result.text.endsWith("\n뒤")).toBe(true);
  });
});
