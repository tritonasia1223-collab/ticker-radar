import { describe, expect, it } from "vitest";
import { acceptRemote, changeDraft, discardDraft, isSaveShortcut, markDraftDirty, removeCardById, seedDraft, shouldSaveOnLeave, takeDraftForSave, upsertCardById } from "../client/src/lib/capitalism-insight-draft";

describe("인사이트 편집 저장 정책 — 2차 보강", () => {
  it("markDraftDirty: 값은 그대로 두고 저장 대상으로만 만든다(표 셀 입력). 이미 dirty 면 같은 객체", () => {
    const clean = seedDraft("a");
    const marked = markDraftDirty(clean);
    expect(marked).toEqual({ value: "a", dirty: true, saved: "a" });
    expect(markDraftDirty(marked)).toBe(marked);
    expect(takeDraftForSave(marked).toSave).toBe("a"); // 값이 같아도 저장은 한 번 나간다(자식 편집기 확정값 반영은 호출부)
  });

  it("discardDraft: 명시적 삭제처럼 저장하지 않고 버리면 이탈 저장이 일어나지 않는다", () => {
    const d = discardDraft(changeDraft(seedDraft("a"), "b"));
    expect(shouldSaveOnLeave(d)).toBe(false); expect(takeDraftForSave(d).toSave).toBeNull();
    const clean = seedDraft("a"); expect(discardDraft(clean)).toBe(clean);
  });

  it("메타 카드 목록: id 기준 갱신·삭제가 누적된다 — 같은 틱에 두 카드가 저장돼도 앞 카드 변경이 남는다", () => {
    const cards = [{ id: "m1", title: "1" }, { id: "m2", title: "2" }];
    let latest = cards;
    latest = upsertCardById(latest, { id: "m1", title: "UNSAVED_ONE" });
    latest = upsertCardById(latest, { id: "m2", title: "UNSAVED_TWO" });
    expect(latest.map((c) => c.title)).toEqual(["UNSAVED_ONE", "UNSAVED_TWO"]);
    expect(upsertCardById(latest, { id: "m3", title: "3" })).toHaveLength(3);
    expect(removeCardById(latest, "m1").map((c) => c.id)).toEqual(["m2"]);
    expect(removeCardById(latest, "zzz")).toEqual(latest);
  });
});

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
