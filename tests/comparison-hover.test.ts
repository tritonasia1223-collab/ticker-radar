import { describe, expect, it } from "vitest";
import { nearbyObservation } from "../client/src/lib/comparison-hover";
import type { ComparePoint } from "../shared/cap-comparison";

const p = (time: number, value: number): ComparePoint => ({ time, value, raw: value * 10, date: `2000-01-${String(time + 1).padStart(2, "0")}`, month: "2000-01" });
const identity = (v: number) => v;
const segment = (points: ComparePoint[]) => ({ points, rendered: points });

describe("nearby chart observations", () => {
  it("includes all nearby lines within 18 pixels and excludes distant lines", () => {
    const hits = [100, 115, 130].map(v => nearbyObservation([segment([p(0, v), p(100, v)])], { x: 50, y: 100 }, identity, identity));
    expect(hits.map(Boolean)).toEqual([true, true, false]);
  });
  it("hits steep segments and isolated points without requiring a direct point hover", () => {
    expect(nearbyObservation([segment([p(0, 0), p(100, 100)])], { x: 50, y: 55 }, identity, identity)?.distance).toBeCloseTo(Math.sqrt(12.5));
    expect(nearbyObservation([segment([p(20, 20)])], { x: 30, y: 20 }, identity, identity)?.point.raw).toBe(200);
  });
  it("does not invent a line across missing data", () => {
    const segments = [segment([p(0, 50), p(20, 50)]), segment([p(80, 50), p(100, 50)])];
    expect(nearbyObservation(segments, { x: 50, y: 50 }, identity, identity)).toBeNull();
  });
  it("compares observations at the cursor time even when the nearest line point is diagonal", () => {
    const points = [p(0, 0), p(50, 50), p(60, 60), p(100, 100)];
    expect(nearbyObservation([segment(points)], { x: 50, y: 65 }, identity, identity)?.point).toBe(points[1]);
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
