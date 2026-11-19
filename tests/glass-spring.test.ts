import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// Deterministic frame clock and minimal layout surface; no browser dependency.
class Surface extends EventTarget {
  style = { height: "", overflow: "", translate: "" };
  hidden = false;
  naturalHeight = 120;
  x = 0;
  children: Surface[] = [];
  scrollTop = 0;
  scrollLeft = 12;
  scrollHeight = 1000;
  clientHeight = 200;
  getBoundingClientRect() { return { left: this.x, top: 0, height: this.hidden ? 0 : this.style.height && this.style.height !== "auto" ? parseFloat(this.style.height) : this.naturalHeight } as DOMRect; }
  querySelectorAll() { return this.children; }
  contains(element: Surface) { return this.children.includes(element); }
  matches() { return true; }
  scrollTo({ top }: { top: number }) { this.scrollTop = top; }
}
const asElement = (surface: Surface) => surface as unknown as HTMLElement;
let frames: Map<number, FrameRequestCallback>;
let now: number, frameId: number;
let media: EventTarget & { matches: boolean };
async function load() { return import("../client/src/lib/warm-prism/spring.js"); }
function tick(ms = 16.667) {
  now += ms;
  const batch = [...frames.values()]; frames.clear();
  batch.forEach(fn => fn(now));
}
function finish() { for (let i = 0; frames.size && i < 600; i++) tick(); expect(frames.size).toBe(0); }
beforeEach(() => {
  vi.resetModules(); frames = new Map(); now = 0; frameId = 0;
  media = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal("matchMedia", () => media);
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { frames.set(++frameId, fn); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("HTMLElement", Surface);
  vi.stubGlobal("getComputedStyle", (element: Surface) => ({ translate: element.style.translate || "none" }));
});
afterEach(() => vi.unstubAllGlobals());

describe("portable springs", () => {
  it("smooth remains monotonic and bounded in both directions, even after a tab pause", async () => {
    const { spring, springPresets } = await load();
    for (const [from, to] of [[0, 800], [800, 0]]) {
      const values: number[] = [];
      const motion = spring(asElement(new Surface()), { from, to, ...springPresets.smooth, onUpdate: v => values.push(v) });
      tick(); tick(20000); finish();
      expect(await motion.finished).toBe("finished");
      expect(values.at(-1)).toBe(to);
      expect(values.every((v, i) => v >= 0 && v <= 800 && (!i || (to > from ? v >= values[i - 1] : v <= values[i - 1])))).toBe(true);
    }
  });
  it("snappy has a small overshoot and settles exactly", async () => {
    const { spring, springPresets } = await load();
    const values: number[] = [];
    const motion = spring(asElement(new Surface()), { from: 0, to: 1, ...springPresets.snappy, onUpdate: v => values.push(v) });
    finish(); await motion.finished;
    expect(Math.max(...values)).toBeGreaterThan(1);
    expect(Math.max(...values)).toBeLessThan(1.04);
    expect(values.at(-1)).toBe(1);
  });
  it("cancels the previous owner and stops callbacks after explicit cancellation", async () => {
    const { spring } = await load(); const element = asElement(new Surface());
    const oldUpdate = vi.fn(), update = vi.fn();
    const first = spring(element, { from: 0, to: 1, onUpdate: oldUpdate }); tick();
    const count = oldUpdate.mock.calls.length;
    const second = spring(element, { from: 0.2, to: 0, onUpdate: update });
    expect(await first.finished).toBe("cancelled"); tick();
    second.cancel(); const lastCount = update.mock.calls.length; tick();
    expect(await second.finished).toBe("cancelled");
    expect(oldUpdate).toHaveBeenCalledTimes(count); expect(update).toHaveBeenCalledTimes(lastCount);
  });
  it("honors reduced motion initially and when enabled during motion", async () => {
    media.matches = true;
    const { spring, springHeight, springScroll, springGrid, captureGrid } = await load();
    const element = new Surface(), update = vi.fn();
    const immediate = spring(asElement(element), { from: 0, to: 5, onUpdate: update });
    expect(update).toHaveBeenCalledExactlyOnceWith(5, element);
    expect(await immediate.finished).toBe("finished");
    element.hidden = true;
    await springHeight(asElement(element), true).finished;
    expect(element.hidden).toBe(false); expect(element.style.height).toBe("");
    await springScroll(asElement(element), 500).finished; expect(element.scrollTop).toBe(500);
    const child = new Surface(); element.children = [child];
    const before = captureGrid(asElement(element)); child.x = 120;
    await springGrid(asElement(element), before).finished; expect(child.style.translate).toBe("");
    expect(frames.size).toBe(0);
    media.matches = false;
    const moving = spring(asElement(element), { from: 0, to: 10, onUpdate: update }); tick();
    media.matches = true; media.dispatchEvent(new Event("change"));
    expect(await moving.finished).toBe("finished"); expect(update).toHaveBeenLastCalledWith(10, element);
    expect(frames.size).toBe(0);
  });
  it("accordion reverses from painted height, restores styles and ends hidden", async () => {
    const { springHeight } = await load(); const element = new Surface(); element.hidden = true;
    const opening = springHeight(asElement(element), true); tick(); tick();
    const height = parseFloat(element.style.height);
    expect(height).toBeGreaterThan(0); expect(height).toBeLessThan(120);
    const closing = springHeight(asElement(element), false);
    expect(parseFloat(element.style.height)).toBeCloseTo(height);
    expect(await opening.finished).toBe("cancelled"); finish();
    expect(await closing.finished).toBe("finished");
    expect(element.hidden).toBe(true); expect(element.style.height).toBe(""); expect(element.style.overflow).toBe("");
    const reopened = springHeight(asElement(element), true); finish(); await reopened.finished;
    element.naturalHeight = 200; expect(element.getBoundingClientRect().height).toBe(200);
  });
  it("grid restores translation and does not override host translate", async () => {
    const { captureGrid, springGrid } = await load(); const grid = new Surface(), a = new Surface(), b = new Surface();
    b.style.translate = "10px"; grid.children = [a, b];
    const before = captureGrid(asElement(grid)); a.x = 150; b.x = 200;
    const motion = springGrid(asElement(grid), before);
    expect(a.style.translate).toBe("-150px 0px"); expect(b.style.translate).toBe("10px");
    finish(); await motion.finished; expect(a.style.translate).toBe("");
    const again = captureGrid(asElement(grid)); a.x = 220;
    const interrupted = springGrid(asElement(grid), again); interrupted.cancel();
    expect(a.style.translate).toBe(""); expect(await interrupted.finished).toEqual(["cancelled"]);
  });
  it("scroll clamps targets and stops on user input without changing horizontal position", async () => {
    const { springScroll } = await load(); const element = new Surface();
    const first = springScroll(asElement(element), 9999); finish(); await first.finished;
    expect(element.scrollTop).toBe(800); expect(element.scrollLeft).toBe(12);
    const moving = springScroll(asElement(element), -100); tick();
    element.dispatchEvent(new Event("wheel")); const stoppedAt = element.scrollTop;
    finish(); expect(await moving.finished).toBe("cancelled"); expect(element.scrollTop).toBe(stoppedAt);
  });
  it("rejects invalid physics before cancelling an existing motion", async () => {
    const { spring } = await load(); const element = asElement(new Surface());
    const first = spring(element, { from: 0, to: 1, onUpdate: () => {} });
    expect(() => spring(element, { from: 0, to: 1, damping: 0, onUpdate: () => {} })).toThrow(RangeError);
    finish(); expect(await first.finished).toBe("finished");
  });
});
