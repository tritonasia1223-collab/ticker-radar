import type { Express } from "express";
import { readCreditSnapshot } from "./storage.js";
import { configHash } from "./config.js";
import { analyze, DAY } from "../../shared/credit/signals.js";
import { dateSchema } from "../../shared/credit/schema.js";
import { scenarios } from "../../shared/credit/scenarios.js";

export function registerCreditRoutes(app: Express) {
  app.get("/api/liquidity/credit", async (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const date = dateSchema.safeParse(req.query.asOf ?? today);
    const basis = req.query.basis ?? "publication";
    const years = Number(req.query.years ?? 10);
    if (!date.success || date.data > today || !["publication", "observation"].includes(String(basis)) || ![1, 3, 5, 10].includes(years)) {
      res.status(400).json({ error: "기준일·시간 기준·표시 기간을 확인하세요." }); return;
    }
    const asOf = date.data, timeBasis = basis as "publication" | "observation";
    try {
      const snapshot = await readCreditSnapshot(); const indicators = analyze(snapshot, asOf, timeBasis);
      const outcome = scenarios(indicators);
      // 계산에는 전체 이력을 쓰고, 응답에는 표시할 차트 구간만 담는다.
      const start = new Date(Date.parse(asOf) - years * 365.25 * DAY).toISOString().slice(0, 10);
      for (const indicator of indicators) for (const line of indicator.lines) line.points = line.points.filter(p => p.date >= start);
      res.set("Cache-Control", "private, max-age=60").json({ asOf, basis: timeBasis, collectedAt: snapshot?.collectedAt ?? null, configHash: configHash(), configChanged: !!snapshot && snapshot.configHash !== configHash(), indicators, scenarios: outcome, error: snapshot ? null : "아직 수집된 자료가 없습니다." });
    } catch {
      const indicators = analyze(null, asOf, timeBasis);
      res.status(503).json({ asOf, collectedAt: null, indicators, scenarios: scenarios(indicators), error: "저장된 신용 자료를 불러오지 못했습니다." });
    }
  });
}
