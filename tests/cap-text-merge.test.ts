import { describe, expect, it } from "vitest";
import { mergeText, mergeValue, validMarkup } from "../shared/cap-text-merge";
import { merge, diff } from "../shared/cap-collaboration";
import { conflictContext } from "../client/src/lib/cap-conflict-context";

describe("three-way passage merge", () => {
  it("preserves either complete candidate across conflicting boundary insertions", () => {
    const base = "잔액은 20억입니다. 금리는 2%입니다. 수요는 보통입니다.";
    const positions = [0, ...[...base.matchAll(/\./g)].map(m => m.index! + 1), base.indexOf("금리"), base.indexOf("수요")];
    for (const at of positions) for (const spacing of ["", " ", "\n"]) {
      const insert = (name: string) => (base.slice(0, at) + spacing + name + " 추가했습니다!" + spacing + base.slice(at));
      const local = insert("내 문장을").replace("20억", "25억").replace("2%", "3%");
      const remote = insert("다른 문장을").replace("20억", "30억").replace("2%", "4%");
      const parts = mergeText(base, local, remote, ["text"]).conflicts;
      for (const choice of ["local", "remote"] as const) {
        const selected = Object.fromEntries(parts.map(part => [part.id, choice]));
        expect(mergeText(base, local, remote, ["text"], selected).value).toBe(choice === "local" ? local : remote);
      }
    }
  });
  it("never repeats insertion text at the start boundary of another conflict", () => {
    const base = "앞 문장입니다. 금리는 20억입니다.";
    for (const spacing of ["", " ", "\n"]) {
      const local = `앞 문장입니다.${spacing}새 수요입니다! 금리는 25억입니다.`;
      const remote = `앞 문장입니다.${spacing}다른 수요입니다! 금리는 30억입니다.`;
      const parts = mergeText(base, local, remote, ["text"]).conflicts;
      for (const choice of ["local", "remote"] as const) {
        const selected = Object.fromEntries(parts.map(part => [part.id, choice]));
        expect(mergeText(base, local, remote, ["text"], selected)).toEqual({ value: choice === "local" ? local : remote, conflicts: [] });
      }
    }
  });
  it("assigns a conflicting end insertion to exactly one sentence choice", () => {
    const base = "잔액은 20억입니다.", local = "잔액은 25억입니다. 수요도 증가했습니다!", remote = "잔액은 30억입니다. 수요는 감소했습니다!";
    const parts = mergeText(base, local, remote, ["text"]).conflicts;
    expect(parts).toHaveLength(2);
    for (const choice of ["local", "remote"] as const) {
      const selected = Object.fromEntries(parts.map(part => [part.id, choice]));
      expect(mergeText(base, local, remote, ["text"], selected)).toEqual({ value: choice === "local" ? local : remote, conflicts: [] });
    }
    const selected = { [parts[0].id]: "local" as const, [parts[1].id]: { text: "수요는 유지됐습니다!" } };
    expect(mergeText(base, local, remote, ["text"], selected).value).toBe("잔액은 25억입니다. 수요는 유지됐습니다!");
  });
  it("resolves concurrent text in an empty field exactly once", () => {
    const base = "", local = "내 새 문장", remote = "다른 새 문장";
    const result = mergeText(base, local, remote, ["text"]);
    expect(result.conflicts).toHaveLength(1);
    const id = result.conflicts[0].id;
    for (const choice of ["local", "remote"] as const) {
      expect(mergeText(base, local, remote, ["text"], { [id]: choice })).toEqual({ value: choice === "local" ? local : remote, conflicts: [] });
    }
    expect(mergeText(base, local, remote, ["text"], { [id]: { text: "합친 문장" } })).toEqual({ value: "합친 문장", conflicts: [] });
  });
  it("merges the user's independent 경영 / 제한적으로 changes in the same sentence", () => {
    expect(mergeText("기업 운영의 자율성이 확대됐습니다.", "기업 경영의 자율성이 확대됐습니다.", "기업 운영의 자율성이 제한적으로 확대됐습니다.")).toEqual({ value: "기업 경영의 자율성이 제한적으로 확대됐습니다.", conflicts: [] });
  });
  it("presents full sentences, highlights the overlap, and keeps safe changes on both sides", () => {
    const base = "기업 운영의 자율성이 소폭 확대됐습니다. 금리는 2%입니다.";
    const local = base.replace("운영", "경영").replace("소폭", "크게");
    const remote = base.replace("소폭", "제한적으로").replace("2%", "3%");
    const plan = mergeText(base, local, remote, ["text"]);
    expect(plan.conflicts).toHaveLength(1);
    const c = plan.conflicts[0];
    expect(c.local).toBe("기업 경영의 자율성이 크게 확대됐습니다.");
    expect(c.remote).toBe("기업 경영의 자율성이 제한적으로 확대됐습니다.");
    expect(c.passage!.local.ranges.map(([a, b]) => c.passage!.local.text.slice(a, b)).join("")).toBe("크게");
    expect(mergeText(base, local, remote, ["text"], { [c.id]: "local" }).value).toBe("기업 경영의 자율성이 크게 확대됐습니다. 금리는 3%입니다.");
    expect(mergeText(base, local, remote, ["text"], { [c.id]: "remote" }).value).toBe("기업 경영의 자율성이 제한적으로 확대됐습니다. 금리는 3%입니다.");
    expect(mergeText(base, local, remote, ["text"], { [c.id]: { text: "기업 경영의 자율성이 어느 정도 확대됐습니다." } }).value).toBe("기업 경영의 자율성이 어느 정도 확대됐습니다. 금리는 3%입니다.");
  });
  it("keeps separate sentences separate and requires every unresolved choice", () => {
    const result = mergeText("수요는 소폭 늘었습니다. 금리는 20억입니다.", "수요는 크게 늘었습니다. 금리는 25억입니다.", "수요는 제한적으로 늘었습니다. 금리는 30억입니다.", ["text"]);
    expect(result.conflicts).toHaveLength(2);
  });
  it("keeps sentence separators when a manually written choice omits surrounding whitespace", () => {
    for (const separator of [" ", "\n\n  "]) {
      const base = `앞 문장입니다.${separator}잔액은 20억 달러입니다. 다음 문장입니다.`;
      const local = base.replace("20억", "25억"), remote = base.replace("20억", "30억");
      const part = mergeText(base, local, remote, ["text"]).conflicts[0];
      const result = mergeText(base, local, remote, ["text"], { [part.id]: { text: "잔액은 28억 달러입니다." } });
      expect(result.conflicts).toEqual([]);
      expect(result.value).toBe(base.replace("20억", "28억"));
    }
  });
  it("deduplicates identical edits, preserves Unicode, and does not guess competing insertions", () => {
    expect(mergeText("가나다😀", "가나다😺", "가나다😺").value).toBe("가나다😺");
    expect(mergeText("ab", "aXb", "aYb").conflicts).toHaveLength(1);
    expect(mergeText("a b c d", "a X b c d", "a b c Y d").value).toBe("a X b c Y d");
    expect(mergeText("20", "25", "30").conflicts).toHaveLength(1);
    expect(mergeText("20.0%", "20.5%", "30.0%").conflicts).toHaveLength(1);
    expect(mergeText("1,000억", "1,005억", "2,000억").conflicts).toHaveLength(1);
  });
  it("keeps rich formatting and links valid through auto merge and choices", () => {
    const base = "기업 [[hl-y|운영]] 자율성이 [[c-r|소폭]] 확대됐습니다. [[link:history|참고]]";
    const local = base.replace("운영", "경영").replace("소폭", "크게");
    const remote = base.replace("소폭", "제한적으로").replace("참고", "출처");
    const plan = mergeText(base, local, remote, ["text"]);
    expect(plan.conflicts).toHaveLength(1);
    const resolved = mergeText(base, local, remote, ["text"], { [plan.conflicts[0].id]: "local" });
    expect(resolved.value).toBe(local.replace("참고", "출처"));
    expect(validMarkup(resolved.value as string)).toBe(true);
    expect(mergeText("경영 확대", "[[hl-y|경영]] 확대", "경영 제한적 확대").value).toBe("[[hl-y|경영]] 제한적 확대");
  });
  it("bounds wholly rewritten large passages without guessing", () => {
    expect(mergeText("가".repeat(5000), "나".repeat(5000), "다".repeat(5000)).conflicts).toHaveLength(1);
  });
  it("keeps decimal numbers inside full sentence context", () => {
    const base = "금리는 20.0 수준이고 수요는 소폭 늘었습니다.";
    const plan = mergeText(base, base.replace("소폭", "크게"), base.replace("소폭", "제한적으로"));
    expect(plan.conflicts[0].before).toBe(base);
  });
  it("preserves all non-overlapping word replacements symmetrically", () => {
    const words = Array.from({ length: 18 }, (_, i) => `원문${i}`);
    for (let a = 0; a < words.length; a++) for (let b = 0; b < words.length; b++) if (a !== b) {
      const local = [...words], remote = [...words], expected = [...words];
      local[a] = expected[a] = `내수정${a}`; remote[b] = expected[b] = `상대수정${b}`;
      for (const [l, r] of [[local, remote], [remote, local]]) expect(mergeText(words.join(" "), l.join(" "), r.join(" "))).toEqual({ value: expected.join(" "), conflicts: [] });
    }
  });
  it("does not put concurrent markup wrappers inside each other", () => {
    const result = mergeText("내용", "[[hl-y|내용]]", "[[c-r|내용]]", ["text"]);
    expect(result.conflicts).toHaveLength(1);
    const resolved = mergeText("내용", "[[hl-y|내용]]", "[[c-r|내용]]", ["text"], { [result.conflicts[0].id]: "local" });
    expect(resolved.value).toBe("[[hl-y|내용]]");
  });
});

describe("rich field merge", () => {
  it("merges independent cells when row labels repeat or are empty", () => {
    for (const label of ["", "동일 항목"]) {
      const base = { widths: [1, 3], cells: [["항목", "내용"], [label, "A"], [label, "B"]] };
      const local = structuredClone(base), remote = structuredClone(base);
      local.cells[1][0] = "미국"; remote.cells[2][1] = "수정 B";
      for (const [a, b] of [[local, remote], [remote, local]]) {
        const result = mergeValue(base, a, b, ["table"]);
        expect(result.conflicts).toEqual([]);
        expect((result.value as typeof base).cells).toEqual([["항목", "내용"], ["미국", "A"], [label, "수정 B"]]);
      }
    }
  });
  const table = { title: "연도별 상황표", widths: [1, 3, 3], cells: [["연도", "미국", "일본"], ["1969", "수요가 소폭 늘었습니다.", "기존 일본"], ["1970", "기존 미국", "기존 일본"]] };
  it("merges different cells and independent text inside a cell", () => {
    const local = structuredClone(table), remote = structuredClone(table);
    local.cells[1][1] = "수요가 크게 늘었습니다."; remote.cells[1][1] = "수출 수요가 소폭 늘었습니다.";
    remote.cells[2][2] = "일본 수정";
    const result = mergeValue(table, local, remote, ["table"]);
    expect(result.conflicts).toEqual([]);
    expect((result.value as typeof table).cells[1][1]).toBe("수출 수요가 크게 늘었습니다.");
    expect((result.value as typeof table).cells[2][2]).toBe("일본 수정");
  });
  it("preserves a new USSR column alongside another editor's existing cells", () => {
    const local = structuredClone(table), remote = structuredClone(table);
    local.widths.push(3); local.cells.forEach((r, i) => r.push(i === 0 ? "소련" : "소련 내용"));
    remote.cells[2][2] = "편집자의 일본 수정";
    const result = mergeValue(table, local, remote, ["table"]);
    expect(result.conflicts).toEqual([]);
    expect((result.value as typeof table).cells[2]).toEqual(["1970", "기존 미국", "편집자의 일본 수정", "소련 내용"]);
    expect((result.value as typeof table).widths).toEqual([1, 3, 3, 3]);
  });
  it("merges separate blocks and a new paragraph without deleting the edited table", () => {
    const base = { blocks: [{ type: "text", text: "서문입니다." }, { type: "table", table }] };
    const local = structuredClone(base), remote = structuredClone(base);
    local.blocks.unshift({ type: "text", text: "새 문단" });
    remote.blocks[1].table!.cells[1][2] = "다른 편집자의 일본";
    const result = merge(remote, diff(base, local));
    expect(result.conflicts).toEqual([]);
    expect((result.doc!.blocks as any[])[2].table.cells[1][2]).toBe("다른 편집자의 일본");
    expect((result.doc!.blocks as any[])[0].text).toBe("새 문단");
  });
  it("keeps different edits in repeated table titles in their original occurrence", () => {
    const base = { blocks: [{ type: "table", table }, { type: "table", table: { ...table, cells: [["연도", "미국", "일본"], ["1990", "원문", "원문"]] } }] };
    const local = structuredClone(base), remote = structuredClone(base);
    local.blocks[0].table.cells[1][1] = "첫 표 내 수정"; remote.blocks[1].table.cells[1][2] = "둘째 표 다른 수정";
    const result = merge(remote, diff(base, local));
    expect(result.conflicts).toEqual([]);
    expect((result.doc!.blocks as any[])[0].table.cells[1][1]).toBe("첫 표 내 수정");
    expect((result.doc!.blocks as any[])[1].table.cells[1][2]).toBe("둘째 표 다른 수정");
  });
  it("never resurrects deleted blocks/cells or treats structural identifiers as prose", () => {
    const base = { blocks: [{ type: "text", text: "원문" }] };
    const remote = { blocks: [] }, local = { blocks: [{ type: "text", text: "수정" }] };
    expect(merge(remote, diff(base, local)).conflicts).toHaveLength(1);
    expect(merge({ date: "1972-01-01" }, [{ path: ["date"], before: "1971-01-01", after: "1971-02-01" }]).conflicts).toHaveLength(1);
  });
  it("compares block mirrors once and regenerates legacy fields from the resolved source", () => {
    const base = { text: "수요는 소폭 늘었습니다.", tables: [table], images: [], blocks: [{ type: "text", text: "수요는 소폭 늘었습니다." }, { type: "table", table }] };
    const local = structuredClone(base), remote = structuredClone(base);
    local.text = local.blocks[0].text = "수요는 크게 늘었습니다.";
    remote.text = remote.blocks[0].text = "수요는 제한적으로 늘었습니다.";
    const changes = diff(base, local);
    expect(changes.map(c => c.path)).toEqual([["blocks"]]);
    const result = merge(remote, changes);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].details).toHaveLength(1);
    const resolved = merge(remote, changes, { [result.conflicts[0].details![0].id]: "local" });
    expect(resolved.doc!.text).toBe("수요는 크게 늘었습니다.");
    expect((resolved.doc!.blocks as any[])[0].text).toBe(resolved.doc!.text);
    // An older immutable request that still includes mirror changes follows the same rules.
    expect(merge(remote, [...changes, { path: ["text"], before: base.text, after: local.text }]).conflicts[0].details).toHaveLength(1);
  });
  it("names the exact table, row and column instead of showing array coordinates", () => {
    const base = { blocks: [{ type: "table", table }] }, local = structuredClone(base), remote = structuredClone(base);
    local.blocks[0].table.cells[1][1] = "수요가 크게 늘었습니다.";
    remote.blocks[0].table.cells[1][1] = "수요가 제한적으로 늘었습니다.";
    const result = merge(remote, diff(base, local)), field = result.conflicts[0];
    expect(conflictContext(field, field.details![0])).toBe("연도별 상황표 · 1969 · 미국");
  });
});
