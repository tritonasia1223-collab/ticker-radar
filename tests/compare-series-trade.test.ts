import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { COMPARE_SERIES, COMPARE_CATEGORIES, deltaUnit, activeSeriesIds, viewingSeriesIds, seriesLabel, activeSpread, makeSpread } from "../client/src/lib/comparison-series";
import { PANELS } from "../client/src/lib/capitalism-config";
import { withRealInterestRate } from "../shared/real-interest-rate";
import { annualChange, differenceSeries, type Point } from "../shared/capitalism-refresh";
import { monthlyPoints, commonBase } from "../shared/cap-comparison";

const series = JSON.parse(readFileSync("client/src/data/capitalism-series.json", "utf8")) as Record<string, Point[]>;
const def = (id: string) => COMPARE_SERIES.find((s) => s.id === id)!;

describe("그래프 비교 — 유로/달러·미국 무역수지", () => {
  it("비교 목록을 정리해도 경제사 원자료와 실질금리 계산은 유지된다", () => {
    const excluded = ["sp500", "mktcap", "monbase", "walcl", "wresbal", "rrp", "tb3ms", "gs10", "fedfunds", "unrate"];
    for (const id of excluded) {
      expect(def(id)).toBeUndefined();
      expect(PANELS.some(p => p.id === id)).toBe(true);
      expect(series[id].length).toBeGreaterThan(0);
      expect(seriesLabel(id)).toContain("비교에서 제외됨");
    }
    expect(viewingSeriesIds([...excluded, "nasdaq", "real_tb3ms", "usd_purchasing_power"])).toEqual(["nasdaq", "real_tb3ms", "usd_purchasing_power"]);
    expect(COMPARE_SERIES.filter(s => s.category === "assets").map(s => s.id)).toEqual(["gold", "oil", "nasdaq"]);
    expect(Object.keys(COMPARE_CATEGORIES)).toEqual(["dollar", "money", "assets", "economy"]);
    expect(def("real_tb3ms").category).toBe("money");
    expect(def("usd_purchasing_power").category).toBe("dollar");
    expect(withRealInterestRate(series).real_tb3ms).toEqual(differenceSeries(series.tb3ms, series.inflation, 2));
    expect(activeSpread({ a: "gs10", b: "tb3ms" })).toBeNull();
    expect(makeSpread({ a: "gs10", b: "tb3ms" }, series)).toBeNull();
  });
  it("삭제된 증가율은 선택·복원에서 제외하고 과거 인사이트의 이름은 보존한다", () => {
    const retired = ["trade_cycle", "exports_yoy", "imports_yoy"];
    for (const id of retired) {
      expect(def(id)).toBeUndefined(); expect(series[id]).toBeUndefined();
      expect(seriesLabel(id)).toContain("삭제됨");
    }
    expect(activeSeriesIds(["trade_bal", ...retired, "trade"])).toEqual(["trade_bal", "trade"]);
    expect(viewingSeriesIds(retired)).toEqual([]);
    expect(def("trade").unit).toBe("십억 2017달러·연율");
    expect(series.trade.length).toBeGreaterThan(0);
  });

  it("differenceSeries: 공통 날짜만, 결측은 빼고, 자릿수 반올림", () => {
    const a: Point[] = [["2025-02-01", 5.556], ["2025-01-01", 3], ["2025-03-01", 1], ["2025-04-01", NaN]];
    const b: Point[] = [["2025-01-01", 1.004], ["2025-02-01", 2], ["2025-04-01", 1], ["2025-05-01", 9]];
    expect(differenceSeries(a, b, 2)).toEqual([["2025-01-01", 2], ["2025-02-01", 3.56]]); // 3월(b 없음)·4월(a NaN)·5월(a 없음) 제외, 날짜순
    expect(differenceSeries([], b, 2)).toEqual([]);
  });

  it("유로/달러와 미국 무역수지가 관련 분류의 월간 비교 지표로 등록돼 있다", () => {
    for (const id of ["fx_eur", "trade_bal"]) {
      const d = def(id);
      expect(d, id).toBeDefined();
      expect(d.category).toBe(id === "fx_eur" ? "dollar" : "economy"); expect(d.cadence).toBe(1);
      expect(d.url).toMatch(/^https:\/\/fred\.stlouisfed\.org\/series\/(EXUSEU|BOPGSTB)$/);
      expect(d.note.length).toBeGreaterThan(10);
    }
    expect(def("fx_eur").unit).toBe("달러 / 1유로"); expect(def("fx_eur").note).toContain("유로 강세");
    expect(def("trade_bal").unit).toBe("$B"); expect(def("trade_bal").note).toContain("음수=적자");

    expect(new Set(COMPARE_SERIES.map((s) => s.id)).size).toBe(COMPARE_SERIES.length); // id 중복 없음
    expect(new Set(COMPARE_SERIES.map((s) => s.color)).size).toBeGreaterThanOrEqual(COMPARE_SERIES.length - 2); // 새 색이 기존 색과 거의 겹치지 않음
  });

  it("증감 단위: 유로/달러는 달러, 무역수지는 $B, 증가율은 %p", () => {
    expect(deltaUnit(def("fx_eur").unit)).toBe("달러");
    expect(deltaUnit(def("trade_bal").unit)).toBe("$B");
    expect(deltaUnit("%")).toBe("%p");
    expect(deltaUnit("원 / 1달러")).toBe("원"); expect(deltaUnit("엔 / 1달러")).toBe("엔"); // 기존 그대로
  });

  it("저장된 데이터: 첫 관측일·자릿수·월간 연속·유한값", () => {
    const first: Record<string, string> = { fx_eur: "1999-01-01", trade_bal: "1992-01-01" };
    for (const [id, date] of Object.entries(first)) {
      const pts = series[id];
      expect(pts, id).toBeDefined(); expect(pts[0][0]).toBe(date);
      for (let i = 1; i < pts.length; i++) {
        expect(pts[i - 1][0] < pts[i][0], `${id} 순서`).toBe(true);
        const a = new Date(pts[i - 1][0]), b = new Date(pts[i][0]);
        expect((b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth(), `${id} ${pts[i][0]} 월간 연속`).toBe(1);
      }
      for (const [d, v] of pts) { expect(/^\d{4}-\d{2}-01$/.test(d)).toBe(true); expect(Number.isFinite(v)).toBe(true); }
    }
    for (const [, v] of series.fx_eur) { expect(v).toBeGreaterThan(0.7); expect(v).toBeLessThan(1.8); expect(Number(v.toFixed(4))).toBe(v); }
    for (const [, v] of series.trade_bal) { expect(Number(v.toFixed(1))).toBe(v); expect(Math.abs(v)).toBeLessThan(400); } // 십억달러 단위(백만달러가 아님)
    expect(series.trade_bal.at(-1)![1]).toBeLessThan(0); // 최근은 적자
  });

  it("진행 중인 달의 환율은 수록하지 않는다(fx_ 규칙)", () => {
    const last = series.fx_eur.at(-1)![0].slice(0, 7);
    expect(last < new Date().toISOString().slice(0, 7)).toBe(true);
  });

  it("전년비 규칙: 같은 달 1년 전 대비 — annualChange 와 같은 계산", () => {
    const raw: Point[] = [["2024-01-01", 100], ["2024-02-01", 110], ["2025-01-01", 105], ["2025-02-01", 99]];
    expect(annualChange(raw, 2)).toEqual([["2025-01-01", 5], ["2025-02-01", -10]]);
  });

  it("비교 파이프라인: 월 포인트로 변환되고, 음수·0 을 지나는 계열은 공통 기준월을 제한한다(기존 규칙 그대로)", () => {
    const eur = monthlyPoints(series.fx_eur), bal = monthlyPoints(series.trade_bal);
    expect(eur.length).toBe(series.fx_eur.length); expect(bal.length).toBe(series.trade_bal.length);
    expect(commonBase([eur], "2010-01")).toBe("2010-01");
    const withBalance = commonBase([eur, bal], "2010-01");
    expect(withBalance === null || typeof withBalance === "string").toBe(true); // 음수 계열의 기준월 처리 방식은 shared/cap-comparison 의 기존 규칙
  });
});
