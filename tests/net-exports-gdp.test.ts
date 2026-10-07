import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildNetExportsGdp } from "../shared/net-exports-gdp";
import type { Point } from "../shared/capitalism-refresh";
import { COMPARE_SERIES, activeSeriesIds, viewingSeriesIds, seriesLabel } from "../client/src/lib/comparison-series";
import { sourcePeriods } from "../client/src/lib/capitalism-history";
import { monthlyPoints } from "../shared/cap-comparison";
import { calibrate } from "../shared/comparison-alignment";
import { comparisonSegments } from "../client/src/lib/comparison-paths";

const data = JSON.parse(readFileSync("client/src/data/capitalism-series.json", "utf8")) as Record<string, Point[]>;
const audit = JSON.parse(readFileSync("client/src/data/net-exports-gdp-audit.json", "utf8")) as { sources: { id: string; points: Point[] }[] };
const inputs = () => audit.sources.map(s => s.points.map(([d,v]): Point => [d,v])) as [Point[], Point[], Point[], Point[]];
describe("nominal net exports / GDP", () => {
  it("reproduces every stored observation from same-date official nominal inputs", () => {
    expect(audit.sources.map(s => s.id)).toEqual(["A019RC1A027NBEA", "GDPA", "NETEXP", "GDP"]);
    expect(buildNetExportsGdp(...inputs()).points).toEqual(data.net_exports_gdp);
    const [annualNet, annualGdp, net, gdp] = inputs();
    for (const [date, value] of data.net_exports_gdp) {
      const early = date < "1947-01-01";
      expect(value).toBe(new Map(early ? annualNet : net).get(date)! / new Map(early ? annualGdp : gdp).get(date)! * 100);
    }
    expect(data.net_exports_gdp[0][0]).toBe("1929-01-01");
    expect(data.net_exports_gdp.filter(([d]) => d < "1947")).toHaveLength(18);
  });
  it("preserves signs including tiny 1931 surplus, and shows the actual 1935/36 deficits", () => {
    const values = new Map(data.net_exports_gdp);
    expect(values.get("1930-01-01")).toBeGreaterThan(0);
    expect(values.get("1931-01-01")).toBeGreaterThan(0);
    expect(values.get("1931-01-01")).toBeLessThan(.01);
    expect(values.get("1935-01-01")).toBeLessThan(0);
    expect(values.get("1936-01-01")).toBeLessThan(0);
    expect(values.get("1947-01-01")).toBeGreaterThan(0);
  });
  it("rejects missing counterparts, invalid denominators, gaps and incompatible scales", () => {
    let p = inputs(); p[3].pop(); expect(() => buildNetExportsGdp(...p)).toThrow("counterpart");
    p = inputs(); p[1][0][1] = 0; expect(() => buildNetExportsGdp(...p)).toThrow("positive");
    p = inputs(); p[0].splice(1,1); expect(() => buildNetExportsGdp(...p)).toThrow("observations");
    p = inputs(); p[2] = p[2].map(([d,v]) => [d,v*1000]); expect(() => buildNetExportsGdp(...p)).toThrow("mismatch");
  });
  it("replaces viewing preferences but never relabels an old insight's real-dollar series", () => {
    expect(viewingSeriesIds(["trade", "trade_bal", "net_exports_gdp"])).toEqual(["net_exports_gdp", "trade_bal"]);
    expect(activeSeriesIds(["trade"])).toEqual([]);
    expect(seriesLabel("trade")).toBe("실질 순수출(삭제됨)");
    expect(COMPARE_SERIES.find(s => s.id === "net_exports_gdp")?.unit).toBe("%");
    expect(COMPARE_SERIES.some(s => s.id === "trade")).toBe(false);
  });
  it("uses zero in the experiment, annual dashed guides, and complete source coverage", () => {
    const points = monthlyPoints(data.net_exports_gdp);
    expect(calibrate("net_exports_gdp", points, null, null)?.center).toBe(0);
    const segments = comparisonSegments(points, "net_exports_gdp", 3);
    expect(segments).toHaveLength(2);
    expect(segments[0].dashed).toBe(true);
    expect(segments[0].original.at(-1)?.date).toBe("1947-01-01");
    expect(segments[1].dashed).toBe(false);
    for (const [date] of data.net_exports_gdp) expect(sourcePeriods("net_exports_gdp").filter(s => s.from <= date && (!s.to || date <= s.to))).toHaveLength(1);
  });
});
