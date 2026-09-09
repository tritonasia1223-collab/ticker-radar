import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../server/storage.js", () => ({ db: {} }));
import { buildWeekly, buildTreasury } from "../server/fed";
import { completeYear, weeksBefore, restoreMissingNumbers } from "../shared/time-series";
import { compareIntegrity } from "../shared/capitalism-integrity";
import { applyUndo, makeFlowEntry } from "../client/src/lib/capitalism-undo";
import { enqueueSave, scheduleSave, waitForSaves, hasUnsavedChanges, hasFailedSaves, retryFailedSaves, persistNodes, withRetry } from "../client/src/lib/capitalism-flowops";
import type { FlowDTO, FlowNodeDTO } from "../client/src/lib/capitalism-types";

const node = (id: string, text: string): FlowNodeDTO => ({ id, text, kind: "cause", inLabel: null, ref: null });
const flow = (): FlowDTO => ({ id: 1, slug: "audit", updatedAt: 1, title: "Original", date: "1971-01-01", year: 1971,
  category: "경제", layout: "stack", sortOrder: 0, nodes: [node("a", "A"), node("b", "B")], edges: [], insight: { text: "Insight", charts: [] } });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("경제사 저장·복원 회귀", () => {
  it("진행 중인 요청과 같은 카드의 후속 요청을 끝까지 추적하고 직렬화한다", async () => {
    let finish!: () => void;
    const order: string[] = [];
    const first = enqueueSave("serial", async () => { order.push("first"); await new Promise<void>((r) => { finish = r; }); order.push("ack"); });
    const next = enqueueSave("serial", async () => { order.push("next"); });
    await Promise.resolve();
    expect(order).toEqual(["first"]); expect(hasUnsavedChanges()).toBe(true);
    finish(); await Promise.all([first, next]); await waitForSaves();
    expect(order).toEqual(["first", "ack", "next"]); expect(hasUnsavedChanges()).toBe(false);
  });
  it("실패한 변경은 다른 노드의 성공으로 지워지지 않고 재시도된다", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("503 unavailable")).mockResolvedValue(undefined);
    await expect(enqueueSave("card", save, "card:node-a")).rejects.toThrow();
    await enqueueSave("card", async () => {}, "card:node-b");
    expect(hasFailedSaves()).toBe(true); expect(hasUnsavedChanges()).toBe(true);
    await retryFailedSaves(); await waitForSaves();
    expect(save).toHaveBeenCalledTimes(2); expect(hasUnsavedChanges()).toBe(false);
  });
  it("연속 입력은 마지막 값으로 묶고 이탈 flush는 타이머보다 먼저 보낸다", async () => {
    vi.useFakeTimers(); const save = vi.fn();
    scheduleSave("draft", () => { void enqueueSave("draft", async () => save("older")); });
    scheduleSave("draft", () => { void enqueueSave("draft", async () => save("newest")); });
    expect(hasUnsavedChanges()).toBe(true);
    await waitForSaves();
    expect(save.mock.calls).toEqual([["newest"]]);
    await vi.runAllTimersAsync(); expect(save).toHaveBeenCalledTimes(1);
  });
  it("409 충돌 요청을 자동 재전송하지 않는다", async () => {
    const save = vi.fn().mockRejectedValue(new Error("409 conflict"));
    await expect(withRetry(save)).rejects.toThrow("409"); expect(save).toHaveBeenCalledTimes(1);
  });
  it("삭제한 노드만 복원하고 이후 수정된 본문·인사이트·제목과 서버 버전을 보존한다", async () => {
    const old = flow(); const entry = makeFlowEntry("delete a", old.slug, [old], [old.nodes[1]]);
    const current = { ...flow(), updatedAt: 8, title: "New title", nodes: [node("b", "B edited"), node("c", "C added")], insight: { text: "New insight", charts: [] } };
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (!init?.method || init.method === "GET") return Response.json([current]);
      const body = JSON.parse(init.body as string);
      expect(body.baseVersion).toBe(8); expect(body.title).toBe("New title"); expect(body.insight.text).toBe("New insight");
      expect(body.nodes.map((n: any) => [n.nodeKey, n.text])).toEqual([["a", "A"], ["b", "B edited"], ["c", "C added"]]);
      return Response.json(current);
    });
    vi.stubGlobal("fetch", fetch); await applyUndo(entry); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("Undo 최신본 읽기에 실패하면 과거 스냅샷을 쓰지 않는다", async () => {
    const fetch = vi.fn(async () => new Response("unavailable", { status: 503 })); vi.stubGlobal("fetch", fetch);
    await expect(applyUndo(makeFlowEntry("delete", "audit", [flow()], []))).rejects.toThrow("503");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("마지막 노드를 없애도 인사이트가 있으면 카드를 삭제하지 않는다", async () => {
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(JSON.parse(init!.body as string).insight.text).toBe("Insight");
      return Response.json({ ...flow(), nodes: [] });
    });
    vi.stubGlobal("fetch", fetch); await persistNodes(flow(), []);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("유동성 누락 관측", () => {
  it("빠진 달을 건너뛴 잔액 차이를 월간 순발행으로 계산하지 않는다", () => {
    const all = new Map<string, Map<string, number>>();
    for (const id of ["MKT_BILLS", "MKT_NOTES", "MKT_BONDS", "MKT_TIPS", "MKT_FRN"]) {
      all.set(id, new Map([["2026-01-31", 100], ["2026-02-28", 200], ["2026-03-31", 300], ["2026-04-30", 400]]));
    }
    all.get("MKT_NOTES")!.delete("2026-02-28");
    const months = buildTreasury(all).monthly;
    expect(months.find((p) => p.date === "2026-03-31")!.netBills).toBeNaN();
    expect(months.at(-1)!.netBills).toBe(100);
  });
  it("대출 자료가 없으면 합계를 0으로 만들지 않는다", () => {
    const all = new Map<string, Map<string, number>>();
    for (const id of ["WALCL", "TREAST", "WSHOMCB", "WLODLL", "WLRRAL", "WDTGAL", "WLFN"]) all.set(id, new Map([["2026-09-02", 100]]));
    expect(buildWeekly(all)[0].loans).toBeNaN();
    for (const id of ["WLCFLPCL", "H41RESPPALDKNWW", "WORAL", "SWPT"]) all.set(id, new Map([["2026-09-02", 0]]));
    expect(buildWeekly(all)[0].loans).toBe(0);
  });
  it("13주 전은 행 수가 아닌 날짜로 찾는다", () => {
    const points = [{ date: "2026-06-03", total: 100 }, { date: "2026-09-02", total: 200 }];
    expect(weeksBefore(points, "2026-09-02", 13)?.total).toBe(100);
    expect(weeksBefore(points, "2026-09-02", 1)).toBeUndefined();
  });
  it("12개월 지표는 12개 달이 모두 있을 때만 계산한다", () => {
    const points = Array.from({ length: 12 }, (_, i) => ({ date: `2026-${String(i + 1).padStart(2, "0")}-01` }));
    expect(completeYear(points, "2026-12-31")).toHaveLength(12);
    expect(completeYear(points.filter((p) => p.date !== "2026-03-01"), "2026-12-31")).toBeUndefined();
  });
  it("JSON null을 연산에서 0으로 강제 변환하지 않는다", () => {
    const restored = restoreMissingNumbers({ date: "2026-03-31", delta: null });
    expect(restored.date).toBe("2026-03-31"); expect(restored.delta).toBeNaN();
  });
});

describe("무결성 검사 종료 상태", () => {
  const backup = { flows: [{ id: 1, slug: "a" }], nodes: [{ flowId: 1, nodeKey: "n", text: "before" }] };
  it("텍스트 수정·ID 변경·추가는 정상으로 허용한다", () => {
    const result = compareIntegrity(backup, { flows: [{ id: 2, slug: "a" }], nodes: [{ flowId: 2, nodeKey: "n", text: "after" }, { flowId: 2, nodeKey: "new", text: "new" }] });
    expect(result.exitCode).toBe(0); expect(result.editedNodes).toBe(1);
  });
  it("카드/노드 소멸은 exit 1, 백업 부재는 exit 2", () => {
    expect(compareIntegrity(backup, { flows: [], nodes: [] }).exitCode).toBe(1);
    expect(compareIntegrity(backup, { ...backup, nodes: [] }).exitCode).toBe(1);
    expect(compareIntegrity(null, backup).exitCode).toBe(2);
  });
});
