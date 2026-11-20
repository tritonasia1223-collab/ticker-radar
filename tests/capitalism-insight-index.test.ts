import { describe, it, expect } from "vitest";
import { metaInsightTitle } from "../client/src/lib/capitalism-insight-index";
import type { CapMetaCard } from "../client/src/lib/capitalism-types";

describe("insight list titles", () => {
  it("uses the author's title without changing rich text", () => {
    const card: CapMetaCard = { id: "a", title: "[[c-bold|금융의 전환]]", text: "본문" };
    const before = JSON.stringify(card);
    expect(metaInsightTitle(card)).toBe("금융의 전환");
    expect(JSON.stringify(card)).toBe(before);
  });
  it("uses canonical blocks over stale legacy text", () => {
    expect(metaInsightTitle({ id: "a", text: "옛 제목", blocks: [
      { type: "divider" },
      { type: "text", text: "\n## **1969~1973 연도별 상황표**\n본문" },
    ] })).toBe("1969~1973 연도별 상황표");
  });
  it("identifies table-only legacy cards and empty cards", () => {
    expect(metaInsightTitle({ id: "a", text: "", tables: [{ title: "국가별 비교", widths: [1], cells: [["미국"]] }] })).toBe("국가별 비교");
    expect(metaInsightTitle({ id: "a", text: "", blocks: [{ type: "html", html: { src: "<script>throw Error()</script>" } }] })).toBe("제목 없는 인사이트");
  });
});
