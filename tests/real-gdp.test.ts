import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildRealGdp } from "../shared/real-gdp";
import type { Point } from "../shared/capitalism-refresh";
import { COMPARE_SERIES, activeSeriesIds, viewingSeriesIds, seriesLabel } from "../client/src/lib/comparison-series";
import { automaticComparisonView, buildComparisonAxes } from "../client/src/lib/comparison-axes";
import { buildAlignedComparison, defaultAlignment } from "../client/src/lib/comparison-experiment";
import { comparisonSegments } from "../client/src/lib/comparison-paths";
import { sourcePeriods } from "../client/src/lib/capitalism-history";
import { monthlyPoints } from "../shared/cap-comparison";

const data = JSON.parse(readFileSync("client/src/data/capitalism-series.json", "utf8")) as Record<string, Point[]>;
const audit = JSON.parse(readFileSync("client/src/data/real-gdp-audit.json", "utf8")) as { sources: { id: string; points: Point[] }[] };
const inputs = () => audit.sources.map(s => s.points.map(([d,v]): Point => [d,v])) as [Point[], Point[]];
describe("real GDP level replacement", () => {
  it("uses unchanged official levels since 1929, without compounding growth or fabricating months", () => {
    const [annual, quarterly] = inputs();
    expect(audit.sources.map(s => s.id)).toEqual(["GDPCA", "GDPC1"]);
    expect(buildRealGdp(annual, quarterly).points).toEqual(data.real_gdp);
    expect(data.real_gdp).toEqual([...annual.filter(([d]) => d < "1947-01-01"), ...quarterly]);
    expect(data.real_gdp.filter(([d]) => d < "1947")).toHaveLength(18);
    expect(data.real_gdp[0][0]).toBe("1929-01-01");
    expect(data.real_gdp.every(([,v])=>v>0)).toBe(true);
    expect(new Map(data.real_gdp).get("1933-01-01")).toBeLessThan(new Map(data.real_gdp).get("1929-01-01")!);
  });
  it("rejects wrong units, gaps, missing historical coverage and invalid values", () => {
    let p=inputs();p[1]=p[1].map(([d,v])=>[d,v*1000]);expect(()=>buildRealGdp(...p)).toThrow("mismatch");
    p=inputs();p[1].splice(2,1);expect(()=>buildRealGdp(...p)).toThrow("observations");
    p=inputs();p[0]=p[0].slice(1);expect(()=>buildRealGdp(...p)).toThrow("coverage");
    p=inputs();p[0][0][1]=NaN;expect(()=>buildRealGdp(...p)).toThrow("observations");
  });
  it("migrates current selections without reinterpreting saved growth-rate insights", () => {
    expect(viewingSeriesIds(["gdp_growth", "real_gdp", "trade"])).toEqual(["real_gdp", "net_exports_gdp"]);
    expect(activeSeriesIds(["gdp_growth"])).toEqual([]);
    expect(seriesLabel("gdp_growth")).toBe("실질 GDP 성장률(삭제됨)");
    expect(COMPARE_SERIES.some(s=>s.id==="gdp_growth")).toBe(false);
    expect(data.gdp_growth.length).toBeGreaterThan(0);
  });
  it("indexes the main chart and uses a median baseline in the experiment, keeping actual hover values", () => {
    const def=COMPARE_SERIES.find(s=>s.id==="real_gdp")!, points=monthlyPoints(data.real_gdp), raw=[{def,points}];
    const main=buildComparisonAxes(raw,automaticComparisonView([def.id]));
    expect(main.series[0].axis).toBe("index");
    expect(main.series[0].points.find(p=>p.month==="2000-01")?.value).toBe(100);
    expect(main.series[0].points.map(p=>p.raw)).toEqual(points.map(p=>p.raw));
    const experimental=buildAlignedComparison(raw,defaultAlignment);
    expect(experimental.alignment.calibrations.real_gdp.kind).toBe("median");
    expect(experimental.alignment.calibrations.real_gdp.center).toBeGreaterThan(0);
    expect(experimental.series[0].points.map(p=>p.raw)).toEqual(points.map(p=>p.raw));
  });
  it("keeps annual dashed guides through 1946 and documents every observation", () => {
    const paths=comparisonSegments(monthlyPoints(data.real_gdp),"real_gdp",3);
    expect(paths).toHaveLength(2);expect(paths[0].dashed).toBe(true);expect(paths[1].dashed).toBe(false);
    expect(paths[0].original.at(-1)?.date).toBe("1947-01-01");
    for (const [date] of data.real_gdp) expect(sourcePeriods("real_gdp").filter(s=>s.from<=date&&(!s.to||date<=s.to))).toHaveLength(1);
  });
});
