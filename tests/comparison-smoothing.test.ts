import { describe, expect, it } from "vitest";
import { monthlyPoints } from "../shared/cap-comparison";
import { smoothComparison } from "../client/src/lib/comparison-smoothing";
import { nearbyObservation } from "../client/src/lib/comparison-hover";

const points = (values: number[]) => monthlyPoints(values.map((v, i) => [new Date(Date.UTC(2000, i, 1)).toISOString().slice(0, 10), v]));
describe("baseline-preserving display smoothing", () => {
  it("keeps exact original crossings at every strength and never invents a crossing", () => {
    const input = points([2, 7, 1, -3, -7, -2, 5, 0, 4, 10, 1, -2]);
    const before = structuredClone(input);
    const expected = input.flatMap((p, i) => p.value === 0 ? [p.time] : i && p.value * input[i - 1].value < 0
      ? [input[i - 1].time + (p.time - input[i - 1].time) * -input[i - 1].value / (p.value - input[i - 1].value)] : []);
    for (const months of [3, 6, 12, 24]) {
      const [{ rendered, crossings }] = smoothComparison(input, 1, months);
      expect(crossings.map(p => p.time)).toEqual(expected);
      expect(rendered.filter(p => p.value === 0).map(p => p.time)).toEqual(expected);
      for (const p of rendered) {
        const end = input.findIndex(q => q.time >= p.time), a = input[Math.max(0, end - 1)], b = input[end];
        const original = a.time === b.time ? a.value : a.value + (b.value - a.value) * (p.time - a.time) / (b.time - a.time);
        if (Math.abs(original) > 1e-9) expect(Math.sign(p.value)).toBe(Math.sign(original));
      }
    }
    expect(input).toEqual(before);
  });
  it("reduces noise, retains gaps and single observations, and reports actual hover values", () => {
    const input = points([2, 9, 2, 9, 2, 9, 2, 9, 2]);
    const [{ rendered, original }] = smoothComparison(input, 1, 6);
    const atMonths = rendered.filter(p => input.some(q => q.time === p.time));
    const variation = (values: { value: number }[]) => values.slice(1).reduce((sum, p, i) => sum + Math.abs(p.value - values[i].value), 0);
    expect(variation(atMonths)).toBeLessThan(variation(input) / 2);
    const at = atMonths[3];
    const hit = nearbyObservation([{ points: original, rendered }], { x: at.time, y: at.value }, v => v, v => v);
    expect(hit?.point.raw).toBe(9);
    expect(hit?.y).toBeCloseTo(at.value);
    const separated = smoothComparison([input[0], input[1], input[8]], 1, 24);
    expect(separated).toHaveLength(2);
    expect(separated[1].rendered).toEqual([input[8]]);
    expect(smoothComparison([], 1, 6)).toEqual([]);
    expect(smoothComparison(points([0, 0, 0]), 1, 6)[0].rendered.every(p => p.value === 0)).toBe(true);
  });
});
