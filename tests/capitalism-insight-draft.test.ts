import { describe, expect, it } from "vitest";
import { acceptRemote, changeDraft, isSaveShortcut, seedDraft, shouldSaveOnLeave, takeDraftForSave } from "../client/src/lib/capitalism-insight-draft";

describe("인사이트 편집 저장 정책", () => {
  it("타이핑은 초안만 바꾸고 저장 대상이 되지 않는다 — 글자마다 저장하던 동작 제거", () => {
    let s = seedDraft("원문");
    const saves: string[] = [];
    for (const v of ["원", "원문 ", "원문 수", "원문 수정"]) {
      s = changeDraft(s, v);
      const { toSave } = { toSave: null as string | null }; // 타이핑 경로는 takeDraftForSave 를 부르지 않는다
      if (toSave !== null) saves.push(toSave);
    }
    expect(saves).toEqual([]);
    expect(s.dirty).toBe(true); expect(s.value).toBe("원문 수정"); expect(s.saved).toBe("원문");
  });

  it("'저장'은 dirty 일 때만 마지막 값을 정확히 한 번 내주고, 연속으로 누르면 두 번째는 저장하지 않는다", () => {
    let s = changeDraft(changeDraft(seedDraft("a"), "ab"), "abc");
    const first = takeDraftForSave(s);
    expect(first.toSave).toBe("abc"); expect(first.next.dirty).toBe(false); expect(first.next.saved).toBe("abc");
    const second = takeDraftForSave(first.next);
    expect(second.toSave).toBeNull(); expect(second.next).toBe(first.next);
  });

  it("이탈 시 저장 여부는 dirty 와 같다 — 변경이 없으면 저장하지 않는다", () => {
    expect(shouldSaveOnLeave(seedDraft("a"))).toBe(false);
    expect(shouldSaveOnLeave(changeDraft(seedDraft("a"), "b"))).toBe(true);
    expect(shouldSaveOnLeave(takeDraftForSave(changeDraft(seedDraft("a"), "b")).next)).toBe(false);
  });

  it("편집 중(dirty)에는 바깥 값으로 재시드하지 않고, 저장 뒤에는 따른다", () => {
    const typing = changeDraft(seedDraft("서버본"), "내 초안");
    expect(acceptRemote(typing, "다른 창의 값")).toBe(typing);            // 타이핑 보호
    const saved = takeDraftForSave(typing).next;
    expect(acceptRemote(saved, "다른 창의 값")).toEqual(seedDraft("다른 창의 값"));
    expect(acceptRemote(seedDraft("서버본"), "서버본2").value).toBe("서버본2");
  });

  it("Ctrl/Cmd+S 만 저장 단축키로 본다", () => {
    expect(isSaveShortcut({ key: "s", ctrlKey: true, metaKey: false, altKey: false })).toBe(true);
    expect(isSaveShortcut({ key: "S", ctrlKey: false, metaKey: true, altKey: false })).toBe(true);
    expect(isSaveShortcut({ key: "s", ctrlKey: false, metaKey: false, altKey: false })).toBe(false);
    expect(isSaveShortcut({ key: "s", ctrlKey: true, metaKey: false, altKey: true })).toBe(false);
    expect(isSaveShortcut({ key: "d", ctrlKey: true, metaKey: false, altKey: false })).toBe(false);
  });
});
