import { afterEach, describe, expect, it, vi } from "vitest";
import { frameMeasurement, relativeLayoutTop } from "../client/src/lib/capitalism-layout";
afterEach(() => vi.unstubAllGlobals());
const element = (offsetTop: number, offsetParent: HTMLElement | null, clientTop = 0) => ({ offsetTop, offsetParent, clientTop }) as HTMLElement;
describe("경제사 모니터 변경 레이아웃", () => {
  it("finds the relative position when a static reference is skipped by offsetParent", () => {
    const card = element(10000, null, 1), body = element(40, card), node = element(95, card);
    expect(relativeLayoutTop(node, body)).toBe(55);
  });
  it("includes nested positioned ancestors and their borders", () => {
    const card = element(10000, null), body = element(40, card), row = element(60, card, 2), node = element(15, row);
    expect(relativeLayoutTop(node, body)).toBe(37);
  });
  it("does not read fractional viewport coordinates", () => {
    const body = element(25, null), node = element(75, null);
    Object.defineProperty(node, "getBoundingClientRect", { get() { throw new Error("screen coordinates are unstable"); } });
    expect(relativeLayoutTop(node, body)).toBe(50);
  });
  it("batches a monitor resize burst and cancels work when the view closes", () => {
    let next = 0; const frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { frames.set(++next, fn); return next; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    const measure = vi.fn(), pending = frameMeasurement(measure);
    for (let i = 0; i < 100; i++) pending.schedule();
    expect(frames.size).toBe(1); expect(measure).not.toHaveBeenCalled();
    const fn = frames.get(1)!; frames.delete(1); fn(0);
    expect(measure).toHaveBeenCalledTimes(1);
    pending.schedule(); pending.dispose(); pending.schedule();
    expect(frames.size).toBe(0); expect(measure).toHaveBeenCalledTimes(1);
  });
});
