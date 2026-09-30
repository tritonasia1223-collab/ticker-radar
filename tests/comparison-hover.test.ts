import { describe, expect, it } from "vitest";
import { nearbyObservation, hoverLayout } from "../client/src/lib/comparison-hover";
import type { ComparePoint } from "../shared/cap-comparison";

const p = (time: number, value: number): ComparePoint => ({ time, value, raw: value * 10, date: `2000-01-${String(time + 1).padStart(2, "0")}`, month: "2000-01" });
const identity = (v: number) => v;
const segment = (points: ComparePoint[]) => ({ points, rendered: points });

describe("compact hover layout", () => {
  it("fits all 21 indicators without scrollbars at desktop and mobile viewport sizes", () => {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
      const layout = hoverLayout(21, viewport);
      expect(layout.width).toBeLessThanOrEqual(viewport.width - 16);
      expect(layout.height).toBeLessThanOrEqual(viewport.height - 16);
      expect(layout.columns * layout.rows).toBeGreaterThanOrEqual(21);
    }
    expect(hoverLayout(3, { width: 1440, height: 900 })).toMatchObject({ columns: 1, rows: 3, height: 90 });
  });
});

describe("nearby chart observations", () => {
  it("includes all nearby lines within 18 pixels and excludes distant lines", () => {
    const hits = [100, 115, 130].map(v => nearbyObservation([segment([p(0, v), p(100, v)])], { x: 50, y: 100 }, identity, identity));
    expect(hits.map(Boolean)).toEqual([true, true, false]);
  });
  it("aligns steep lines and isolated observations with the cursor time", () => {
    expect(nearbyObservation([segment([p(0, 0), p(100, 100)])], { x: 50, y: 55 }, identity, identity)).toMatchObject({ x: 50, y: 50, distance: 5 });
    expect(nearbyObservation([segment([p(20, 20)])], { x: 20, y: 30 }, identity, identity)?.point.raw).toBe(200);
    expect(nearbyObservation([segment([p(20, 20)])], { x: 30, y: 20 }, identity, identity)).toBeNull();
  });
  it("does not invent a line across missing data", () => {
    const segments = [segment([p(0, 50), p(20, 50)]), segment([p(80, 50), p(100, 50)])];
    expect(nearbyObservation(segments, { x: 50, y: 50 }, identity, identity)).toBeNull();
  });
  it("compares observations at the cursor time even when the nearest line point is diagonal", () => {
    const points = [p(0, 0), p(50, 50), p(60, 60), p(100, 100)];
    expect(nearbyObservation([segment(points)], { x: 50, y: 65 }, identity, identity)?.point).toBe(points[1]);
  });
  it("keeps crossing markers on one time line and rejects nearby values at other times", () => {
    const rising = [segment([p(0, 0), p(100, 100)])];
    const falling = [segment([p(0, 100), p(100, 0)])];
    const pointer = { x: 45, y: 50 };
    expect(nearbyObservation(rising, pointer, identity, identity)).toMatchObject({ x: 45, y: 45 });
    expect(nearbyObservation(falling, pointer, identity, identity)).toMatchObject({ x: 45, y: 55 });
    expect(nearbyObservation(rising, { x: 45, y: 70 }, identity, identity)).toBeNull();
  });
  it("uses displayed geometry for simplified lines, while returning the original observation", () => {
    const points = [p(0, 100), p(50, 200), p(100, 100)];
    const hit = nearbyObservation([{ points, rendered: [points[0], points[2]] }], { x: 50, y: 100 }, identity, identity);
    expect(hit?.point).toBe(points[1]);
    expect(hit?.point.raw).toBe(2000);
    expect(hit?.y).toBe(100);
  });
  it("respects each axis projection and maintains a screen-space radius after zoom", () => {
    const segments = [segment([p(0, 5), p(100, 5)])];
    expect(nearbyObservation(segments, { x: 100, y: 100 }, t => t * 2, v => v * 20)).not.toBeNull();
    expect(nearbyObservation(segments, { x: 100, y: 100 }, t => t * 2, v => v * 40)).toBeNull();
  });
});
