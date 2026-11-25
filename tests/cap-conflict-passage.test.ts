import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, expect, it, vi } from "vitest";
import { ConflictPassage } from "../client/src/components/CapConflictWizard";
import { mergeText } from "../shared/cap-text-merge";
vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());

it("shows original font colours and names despite the yellow conflict highlight", () => {
  const parts = mergeText("[[c-r|내용입니다]]", "[[c-b|내용입니다]]", "[[c-g|내용입니다]]", ["text"]).conflicts[0].passage!;
  for (const [side, label, colour] of [["before", "빨강 글자", "#ff2e2e"], ["local", "파랑 글자", "#146aff"], ["remote", "초록 글자", "#008738"]] as const) {
    const html = renderToStaticMarkup(React.createElement(ConflictPassage, { passage: parts[side] }));
    expect(html).toContain(label);
    expect(html).toContain(`color:${colour}`);
    expect(html).toContain("background-color:#fef08a");
  }
});

it("distinguishes and highlights changed internal link targets with the same visible text", () => {
  const result = mergeText("[[link:base|참고 자료]]", "[[link:mine|참고 자료]]", "[[link:theirs|참고 자료]]", ["text"]);
  expect(result.conflicts).toHaveLength(1);
  const passage = result.conflicts[0].passage!;
  for (const side of ["before", "local", "remote"] as const) {
    const html = renderToStaticMarkup(React.createElement(ConflictPassage, { passage: passage[side] }));
    expect(html).toContain(side === "before" ? "base" : side === "local" ? "mine" : "theirs");
    expect(html).toContain("연결 대상:");
    expect(html).toMatch(/<mark[^>]*>참고 자료<\/mark>/);
    expect(html).not.toContain("[[link:");
  }
});
