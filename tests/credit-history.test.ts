import { describe, it, expect, vi } from "vitest";
import { analyze, change, joinNav } from "../shared/credit/signals";
import { scenarios } from "../shared/credit/scenarios";
import type { Point, Snapshot } from "../shared/credit/schema";
import { auctionWindow } from "../server/liquidity-beta";

const snap = (key: string, points: Point[]): Snapshot => ({ version: 1, configHash: "test", collectedAt: "2026-09-29T00:00:00Z", series: [{ key, points, checkedAt: "2026-09-29T00:00:00Z", transport: "테스트", notes: [] }] });
describe("선택 주차의 관측 시점 분석", () => {
  it("8월 공시한 6월 관측을 7월에 표시하고 9월 관측은 제외한다", () => {
    const input = snap("manual:ARCC:pik", [{ date: "2026-03-31", publishedAt: "2026-05-01", value: 5 }, { date: "2026-06-30", publishedAt: "2026-08-05", value: 8 }, { date: "2026-09-30", publishedAt: "2026-11-05", value: 99 }]);
    const line = analyze(input, "2026-07-15", "observation").find(i => i.id === "bdc_credit_quality")!.lines[2];
    expect(line.latest).toMatchObject({ value: 8, date: "2026-06-30", publishedAt: "2026-08-05" });
    expect(line.ageDays).toBe(15); expect(line.metrics.previousDelta).toBe(3);
    expect(line.points).toHaveLength(2); expect(line.stale).toBe(false);
    expect(analyze(input, "2026-07-15").find(i => i.id === "bdc_credit_quality")!.lines[2].latest?.value).toBe(5);
  });
  it("분기 공시일을 몰라도 선택일 기준으로 주간 관측 변화를 계산한다", () => {
    const points = [{ date: "2026-04-01", value: 10 }, { date: "2026-07-01", value: 15 }];
    expect(change(points, 4, "quarterly", "2026-07-15", "observation")).toMatchObject({ value: 5, from: "2026-04-01", to: "2026-07-01" });
    expect(change(points, 1, "quarterly", "2026-07-15", "observation")?.unchangedRelease).toBe(true);
  });
  it("선택일 이후의 다른 관측은 백분위와 시나리오에 영향을 주지 않는다", () => {
    const base = snap("DRTSCILM", [{ date: "2026-01-01", value: 4 }, { date: "2026-04-01", value: 5 }]);
    const future = structuredClone(base); future.series[0].points.push({ date: "2026-07-01", value: 99 });
    const a = analyze(base, "2026-05-20", "observation"), b = analyze(future, "2026-05-20", "observation");
    expect(b).toEqual(a); expect(scenarios(b)).toEqual(scenarios(a));
  });
  it("P/NAV는 관측일 이하 최신 분기 NAV를 연결하고 다음 분기 NAV는 사용하지 않는다", () => {
    const nav = [{ date: "2026-03-31", value: 10, publishedAt: "2026-05-01", effectiveAt: "2026-05-02" }, { date: "2026-06-30", value: 20, publishedAt: "2026-08-05", effectiveAt: "2026-08-06" }];
    const result = joinNav([{ date: "2026-06-29", value: 18 }, { date: "2026-07-15", value: 18 }], nav, "observation");
    expect(result.map(p => p.value)).toEqual([1.8, 0.9]); expect(result[1].publishedAt).toBe("2026-08-05");
  });
  it("자료 시작 이전의 주차에는 현재값을 대신 표시하지 않는다", () => {
    const d = analyze(snap("BAMLH0A0HYM2", [{ date: "2023-09-29", value: 4 }]), "2020-03-25", "observation");
    expect(d.find(i => i.id === "hy_oas")!.status).toBe("missing"); expect(scenarios(d).closest).toEqual([]);
  });
  it("입찰 3개월 구간도 선택 주차에서 끝난다", () => {
    expect(auctionWindow(3, new Date("2020-03-25"))).toEqual({ start: "2020-01-01", end: "2020-03-25" });
  });
});

vi.mock("../server/credit/storage.js", () => ({ readCreditSnapshot: async () => snap("DRTSCILM", [{ date: "2020-01-01", value: 20 }, { date: "2026-07-01", value: 99 }]) }));
describe("신용 API의 기준일", () => {
  async function request(query: Record<string, string>) {
    const { registerCreditRoutes } = await import("../server/credit/routes");
    let handler: any; registerCreditRoutes({ get: (_: string, fn: any) => { handler = fn; } } as any);
    let body: any, status = 200;
    const res: any = { set: () => res, status: (code: number) => { status = code; return res; }, json: (value: any) => { body = value; } };
    await handler({ query }, res); return { status, body };
  }
  it("잘못된 날짜·미래 날짜·기간을 거부한다", async () => {
    for (const query of [{ asOf: "2020-02-30" }, { asOf: "9999-01-01" }, { years: "1000" }]) expect((await request(query)).status).toBe(400);
  });
  it("응답과 차트·시나리오가 같은 과거 기준일을 사용한다", async () => {
    const { body, status } = await request({ asOf: "2020-03-25", basis: "observation", years: "3" });
    expect(status).toBe(200); expect(body.asOf).toBe("2020-03-25");
    expect(body.indicators[0].lines[0].latest.value).toBe(20);
    expect(body.indicators.flatMap((i: any) => i.lines).flatMap((l: any) => l.points).every((p: any) => p.date <= body.asOf)).toBe(true);
  });
});
