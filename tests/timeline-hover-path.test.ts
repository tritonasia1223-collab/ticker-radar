import { describe, expect, it } from "vitest";
import { timelineHoverPath } from "../client/src/lib/timeline-hover-path";

describe("month guide routing", () => {
  const start = { x: 20, y: 30 };
  const end = { x: 300, y: 30 };
  it("uses a direct line across empty lanes", () => {
    expect(timelineHoverPath(start, end, [], 4)).toBe("M 20 30 L 300 30");
  });
  it("ignores blocks outside the actual segment", () => {
    expect(timelineHoverPath(start, end, [
      { left: 100, right: 200, top: 50, bottom: 90 },
      { left: 320, right: 400, top: 10, bottom: 60 },
    ], 4)).toBe("M 20 30 L 300 30");
  });
  it("detours when another event blocks the line", () => {
    expect(timelineHoverPath(start, end, [{ left: 100, right: 200, top: 20, bottom: 80 }], 4))
      .toBe("M 20 30 H 27 V 4 H 294 V 30 h 6");
  });
  it("checks the diagonal segment rather than its whole bounding box", () => {
    const lower = { x: 300, y: 200 };
    expect(timelineHoverPath(start, lower, [{ left: 100, right: 130, top: 160, bottom: 190 }], 4))
      .toBe("M 20 30 L 300 200");
    expect(timelineHoverPath(start, lower, [{ left: 100, right: 130, top: 70, bottom: 110 }], 4))
      .toContain(" H ");
  });
});
