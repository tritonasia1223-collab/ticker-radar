import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncLifecycle } from "../client/src/lib/sync-lifecycle";
afterEach(() => vi.useRealTimers());
describe("page-scoped synchronization", () => {
  it("keeps the 5-second cadence and stops on release, hidden tabs and offline", async () => {
    vi.useFakeTimers(); const run = vi.fn(async () => {}), sync = new SyncLifecycle(run);
    const release = sync.acquire("capitalism");
    await vi.advanceTimersByTimeAsync(15000); expect(run).toHaveBeenCalledTimes(4);
    sync.setEnvironment(false,true); await vi.advanceTimersByTimeAsync(60000); expect(run).toHaveBeenCalledTimes(4);
    sync.setEnvironment(true,true); await vi.advanceTimersByTimeAsync(0); expect(run).toHaveBeenCalledTimes(5);
    sync.setEnvironment(true,false); await vi.advanceTimersByTimeAsync(60000); expect(run).toHaveBeenCalledTimes(5);
    sync.setEnvironment(true,true); await vi.advanceTimersByTimeAsync(0); expect(run).toHaveBeenCalledTimes(6);
    release(); await vi.advanceTimersByTimeAsync(60000); expect(run).toHaveBeenCalledTimes(6);
  });
  it("coalesces wakeups and discards old-page responses without overlapping requests", async () => {
    vi.useFakeTimers(); let finish!: () => void, valid!: () => boolean;
    const run = vi.fn(async (_scopes: string[], current: () => boolean) => { valid = current; await new Promise<void>(r => finish=r); });
    const sync = new SyncLifecycle(run), release = sync.acquire("capitalism");
    await vi.advanceTimersByTimeAsync(15000); expect(run).toHaveBeenCalledTimes(1);
    release(); const nextRelease = sync.acquire("international");
    expect(valid()).toBe(false); await sync.wake(); await sync.wake(); expect(run).toHaveBeenCalledTimes(1);
    finish(); await vi.advanceTimersByTimeAsync(0); expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][0]).toEqual(["international"]); nextRelease(); finish();
  });
});
