import { lineSegments, type ComparePoint } from "../../../shared/cap-comparison";

const MONTH = 365.25 / 12 * 86400000;
export type Crossing = { time: number; estimated: boolean };

// Work on complete, gap-separated history so panning cannot change the curve.
export function smoothComparison(points: ComparePoint[], cadence: number, months: number) {
  return lineSegments(points, cadence).map(original => {
    const knots: ComparePoint[] = [], crossings: Crossing[] = [];
    original.forEach((p, i) => {
      const previous = original[i - 1];
      if (previous && previous.value * p.value < 0) {
        const time = previous.time + (p.time - previous.time) * -previous.value / (p.value - previous.value);
        knots.push({ ...p, time, value: 0 });
        crossings.push({ time, estimated: true });
      }
      knots.push({ ...p });
      if (p.value === 0) crossings.push({ time: p.time, estimated: false });
    });
    // Diffuse local noise with zeros as fixed boundaries. Convex updates preserve
    // signs and taper naturally into crossings instead of creating vertical cliffs.
    let smoothed = knots;
    for (let pass = 0; pass < Math.max(1, Math.round(months * months / 4)); pass++) {
      smoothed = smoothed.map((p, i, all) => {
        if (!p.value || i === 0 || i === all.length - 1) return p;
        const a = all[i - 1], b = all[i + 1];
        const before = (p.time - a.time) / MONTH, after = (b.time - p.time) / MONTH;
        const target = (after * a.value + before * b.value) / (before + after);
        const weight = .5 * Math.min(1, 1 / (before * after));
        return { ...p, value: p.value * (1 - weight) + target * weight };
      });
    }
    // Monotone cubic Hermite interpolation cannot overshoot between knots.
    const delta = smoothed.slice(1).map((p, i) => (p.value - smoothed[i].value) / (p.time - smoothed[i].time));
    const slopes = smoothed.map((p, i) => {
      if (!i) return delta[0] ?? 0;
      if (i === smoothed.length - 1) return delta[i - 1];
      const a = delta[i - 1], b = delta[i];
      if (a * b <= 0) return 0;
      const before = p.time - smoothed[i - 1].time, after = smoothed[i + 1].time - p.time;
      const w1 = 2 * after + before, w2 = after + 2 * before;
      return (w1 + w2) / (w1 / a + w2 / b);
    });
    const rendered: ComparePoint[] = [];
    smoothed.forEach((a, i) => {
      rendered.push(a);
      const b = smoothed[i + 1]; if (!b) return;
      const h = b.time - a.time;
      for (let step = 1; step < 12; step++) {
        const t = step / 12, t2 = t * t, t3 = t2 * t;
        const value = (2 * t3 - 3 * t2 + 1) * a.value + (t3 - 2 * t2 + t) * h * slopes[i]
          + (-2 * t3 + 3 * t2) * b.value + (t3 - t2) * h * slopes[i + 1];
        rendered.push({ ...a, time: a.time + h * t, value });
      }
    });
    return { original, rendered, crossings };
  });
}
