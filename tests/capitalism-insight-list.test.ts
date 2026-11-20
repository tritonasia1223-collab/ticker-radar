import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi, afterAll } from "vitest";

// Node test config uses the classic JSX transform; the app uses Vite's React plugin.
vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());

vi.mock("@/lib/cap-collab-client", () => ({ collaboration: {}, collabApi: vi.fn(), focusResource: vi.fn() }));
vi.mock("@/components/CapBlocks", () => ({
  BlockStack: () => { throw new Error("A list must not mount expensive bodies"); },
  insightToBlocks: vi.fn(), blocksToInsight: vi.fn(), blocksHaveContent: vi.fn(), metaCardToBlocks: vi.fn(), blocksToMetaFields: vi.fn(),
}));
import { InsightsCollection } from "../client/src/components/CapInsight";

describe("insight collection initial rendering", () => {
  it("renders all titles with zero body renderers even with large table/media collections", () => {
    const cards = Array.from({ length: 100 }, (_, i) => ({ id: String(i), title: `조사 ${i}`, text: "비공개 본문 문장", blocks: [{ type: "html" as const, html: { src: "<iframe src='https://example.com'></iframe>" } }] }));
    const html = renderToStaticMarkup(React.createElement(InsightsCollection, {
      flows: [], metaCards: cards, onSaveMetaCards: vi.fn(), onCommitInsight: vi.fn(), onOpenInsight: vi.fn(), editable: false,
    }));
    expect(html.match(/data-testid="insight-list-row"/g)).toHaveLength(100);
    expect(html).not.toContain("비공개 본문 문장");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("insight-detail");
  });
  it("distinguishes loading from an empty collection", () => {
    const html = renderToStaticMarkup(React.createElement(InsightsCollection, { flows: [], metaCards: [], onSaveMetaCards: vi.fn(), onCommitInsight: vi.fn(), onOpenInsight: vi.fn(), loading: true }));
    expect(html).toContain("목록을 불러오고 있습니다");
    expect(html).not.toContain("아직 인사이트가 없습니다");
  });
});
