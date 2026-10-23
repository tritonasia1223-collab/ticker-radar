import { describe, expect, it } from "vitest";
import { balanceRelation, insightBalanceSchema } from "../shared/comparison-balance";
import { comparisonInsightSchema } from "../shared/cap-comparison";
import { diff, merge } from "../shared/cap-collaboration";
import { validateEdit } from "../server/cap-collaboration";

const note = { title: "2차 뉴딜", date: "1935-01-01", endDate: "1937-09-01", text: "[[hl-y|물건도 늘었지만 돈이 더 빠르게 늘어남]]", caption: "회복", sortOrder: 6, context: { ids: ["real_gdp", "cpi_level"], spread: null }, tables: [] };
const balance = { money: 2, goods: 1, outcome: "inflation" } as const;
describe("insight money and goods diagram", () => {
  it("stores editorial result labels independently of bars and preserves them during prose edits", () => {
    const result = { ...balance, outcome: "stagflation", outcomeLabel: "스태그플레이션 · 단기" };
    const doc = comparisonInsightSchema.parse({ ...note, balance: result });
    expect(doc.balance).toEqual(result);
    expect(merge(doc, diff(note, { ...note, text: "수정한 본문" })).doc).toEqual({ ...doc, text: "수정한 본문" });
    expect(insightBalanceSchema.parse({ ...result, outcomeLabel: "" }).outcomeLabel).toBe("");
    expect(insightBalanceSchema.safeParse({ ...result, outcomeLabel: "가".repeat(41) }).success).toBe(false);
  });
  it("retains legacy prose and metadata, round-trips the optional diagram, and removes only the diagram", () => {
    expect(comparisonInsightSchema.parse(note)).toEqual(note);
    const withDiagram = comparisonInsightSchema.parse(JSON.parse(JSON.stringify({ ...note, balance })));
    expect(withDiagram).toEqual({ ...note, balance });
    const changes = diff(note, withDiagram);
    expect(changes).toEqual([{ path: ["balance"], before: null, after: balance }]);
    expect(validateEdit({ id: crypto.randomUUID(), session: crypto.randomUUID(), resource: "note:example", editor: "test", changes }).changes).toEqual(changes);
    expect(merge(withDiagram, diff(withDiagram, { ...note, balance: null })).doc).toEqual({ ...note, balance: null });
  });
  it("preserves independent prose and diagram edits while detecting concurrent diagram changes", () => {
    const changes = diff(note, { ...note, balance });
    expect(merge({ ...note, text: "다른 창에서 수정한 본문" }, changes)).toMatchObject({ doc: { ...note, text: "다른 창에서 수정한 본문", balance }, conflicts: [] });
    expect(merge({ ...note, balance }, diff(note, { ...note, text: "이전 버전의 본문 수정" })).doc).toEqual({ ...note, balance, text: "이전 버전의 본문 수정" });
    expect(merge({ ...note, balance: { ...balance, goods: -1 } }, diff({ ...note, balance }, { ...note, balance: { ...balance, money: 1 } })).conflicts).toHaveLength(1);
  });
  it("does not infer inflation or goldilocks from equal or unequal steps", () => {
    expect(insightBalanceSchema.parse({ money: 1, goods: 1, outcome: null }).outcome).toBeNull();
    expect(insightBalanceSchema.parse({ money: -1, goods: -1, outcome: "inflation" }).outcome).toBe("inflation");
    for (const money of [-3, 3, 1.5, NaN, Infinity]) expect(insightBalanceSchema.safeParse({ ...balance, money }).success).toBe(false);
    expect(insightBalanceSchema.safeParse({ ...balance, outcome: "automatic" }).success).toBe(false);
  });
  it.each([
    [2, 1, "돈이 물건보다 더 빠르게 늘어남"],
    [1, 2, "물건이 돈보다 더 빠르게 늘어남"],
    [-2, -1, "돈이 물건보다 더 크게 줄어듦"],
    [-1, -2, "물건이 돈보다 더 크게 줄어듦"],
    [1, -1, "돈은 늘고, 물건은 줄어듦"],
    [-1, 1, "돈은 줄고, 물건은 늘어남"],
    [1, 1, "돈과 물건이 함께 늘어남"],
    [-1, -1, "돈과 물건이 함께 줄어듦"],
    [0, 0, "돈과 물건 모두 변화 없음"],
    [0, 1, "돈은 그대로, 물건은 늘어남"],
    [0, -1, "돈은 그대로, 물건은 줄어듦"],
    [1, 0, "돈은 늘고, 물건은 그대로"],
    [-1, 0, "돈은 줄고, 물건은 그대로"],
  ])("distinguishes direction and relative change (%s, %s)", (money, goods, expected) => {
    expect(balanceRelation(insightBalanceSchema.parse({ money, goods, outcome: null }))).toBe(expected);
  });
});
