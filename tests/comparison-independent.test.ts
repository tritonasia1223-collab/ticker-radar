import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { COMPARE_SERIES } from "../client/src/lib/comparison-series";
import { buildComparisonAxes, independentComparisonView, automaticComparisonView, restoredComparisonView, sameComparisonView } from "../client/src/lib/comparison-axes";
import { focusedReferenceId, independentDomain, referenceValue, referenceLabel, tooltipUnit } from "../client/src/lib/comparison-independent";
import { buildAlignedComparison, defaultAlignment } from "../client/src/lib/comparison-experiment";
import { comparisonInsightSchema, monthlyPoints } from "../shared/cap-comparison";
import { withPurchasingPower } from "../shared/dollar-indicators";
import { withRealInterestRate } from "../shared/real-interest-rate";
import { diff, merge } from "../shared/cap-collaboration";
import { validateEdit } from "../server/cap-collaboration";

const data = withRealInterestRate(withPurchasingPower(JSON.parse(readFileSync("client/src/data/capitalism-series.json", "utf8"))));
const raw = COMPARE_SERIES.map(def => ({ def, points: monthlyPoints(data[def.id]) }));
const view = independentComparisonView(raw.map(s=>s.def.id));

describe("independent main comparison", () => {
  it("gives every series its own scale, including equal-unit percentages, without rebasing raw values", () => {
    const built = buildComparisonAxes(raw, view);
    expect(built.series).toHaveLength(COMPARE_SERIES.length);
    expect(new Set(built.series.map(s=>s.axis)).size).toBe(COMPARE_SERIES.length);
    expect(built.axes.every(a=>a.independent && !a.normalized && !a.includeZero)).toBe(true);
    expect(built.base).toBeNull();expect(built.rightUnit).toBeNull();expect(built.unavailable).toEqual([]);
    for(const series of built.series){
      expect(series.points).toEqual(raw.find(s=>s.def.id===series.def.id)!.points);
      const solo = buildComparisonAxes(raw.filter(s=>s.def.id===series.def.id), view).series[0];
      expect(independentDomain(solo.points.map(p=>p.value))).toEqual(independentDomain(series.points.map(p=>p.value)));
    }
  });
  it("retains movement in positive and negative series and handles flat/empty values", () => {
    expect(independentDomain([100,110])[0]).toBeGreaterThan(0);
    expect(independentDomain([-10,-9])[1]).toBeLessThan(0);
    expect(independentDomain([-2,3])).toEqual([-2.4,3.4]);
    for(const values of [[],[0],[5,5],[-5,-5],[NaN,Infinity,10]]){
      const [lo,hi]=independentDomain(values);expect(Number.isFinite(lo)&&Number.isFinite(hi)&&hi>lo).toBe(true);
    }
    expect(independentDomain([5,6])).not.toEqual(independentDomain([5,6,100]));
  });
  it("migrates legacy settings but leaves the experiment's view and normalization alone", () => {
    const ids=raw.map(s=>s.def.id), legacy=automaticComparisonView(ids);
    expect(independentComparisonView(ids,{...legacy,mode:"raw",assignments:{gold:"right"}})).toEqual(view);
    expect(restoredComparisonView(ids,legacy,view)).toEqual(view);
    expect(sameComparisonView(restoredComparisonView(ids,legacy,view),view,ids)).toBe(true);
    expect(sameComparisonView({...view,base:"1990-01"},view,ids)).toBe(true);
    expect(restoredComparisonView(ids,view,legacy).mode).toBe("mixed");
    const experiment=buildAlignedComparison(raw,defaultAlignment);
    expect(experiment.axes).toHaveLength(1);expect(experiment.alignment.calibrations.real_gdp.kind).toBe("median");
    expect(experiment.alignment.calibrations.net_exports_gdp.center).toBe(0);
  });
  it("stores and validates independent insight contexts without rewriting legacy prose", () => {
    const note={title:"비교",date:"2000-01-01",endDate:null,text:"기존 본문",caption:"",sortOrder:1,context:{ids:["dxy","net_exports_gdp"],spread:null,view:automaticComparisonView(["dxy","net_exports_gdp"])}};
    const next=comparisonInsightSchema.parse({...note,context:{...note.context,view}});
    const changes=diff(note,next);
    expect(validateEdit({id:crypto.randomUUID(),session:crypto.randomUUID(),resource:"note:independent",editor:"검증",changes}).changes).toEqual(changes);
    expect(merge({...note,text:"다른 본문"},changes).doc).toEqual({...next,text:"다른 본문"});
  });
  it("shows only the closest reference, or the pinned reference, and explains offscreen zeros", () => {
    expect(focusedReferenceId([{id:"trade_bal",distance:10},{id:"net_exports_gdp",distance:2}],null)).toBe("net_exports_gdp");
    expect(focusedReferenceId([{id:"gold",distance:1}],"trade_bal")).toBe("trade_bal");
    expect(focusedReferenceId([],null)).toBeNull();
    for(const id of ["real_tb3ms","trade_bal","net_exports_gdp"])expect(referenceValue(id)).toBe(0);
    expect(referenceValue("dxy")).toBe(100);expect(referenceValue("reer")).toBe(100);
    for(const id of ["real_gdp","cpi_level","gold","m2","debt_gdp"])expect(referenceValue(id)).toBeNull();
    const def=COMPARE_SERIES.find(s=>s.id==="net_exports_gdp")!;
    expect(referenceLabel(def,0,-5,-1)).toContain("표시 범위 위");
    expect(referenceLabel(def,0,1,5)).toContain("표시 범위 아래");
    expect(referenceLabel(def,0,-1,1)).toBe("순수출/GDP · 0%");
    expect(tooltipUnit("$B")).toBe("십억 달러");
  });
});
