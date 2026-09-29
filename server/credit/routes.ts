import type { Express } from "express";
import { readCreditSnapshot } from "./storage.js";
import { configHash } from "./config.js";
import { analyze } from "../../shared/credit/signals.js";
import { scenarios } from "../../shared/credit/scenarios.js";

export function registerCreditRoutes(app: Express) {
  app.get("/api/liquidity/credit", async (_req, res) => {
    const asOf = new Date().toISOString().slice(0, 10);
    try {
      const snapshot = await readCreditSnapshot(); const indicators = analyze(snapshot, asOf);
      res.set("Cache-Control", "private, max-age=60").json({ asOf, collectedAt: snapshot?.collectedAt ?? null, configHash: configHash(), configChanged: !!snapshot && snapshot.configHash !== configHash(), indicators, scenarios: scenarios(indicators), error: snapshot ? null : "아직 수집된 자료가 없습니다." });
    } catch {
      const indicators = analyze(null, asOf);
      res.status(503).json({ asOf, collectedAt: null, indicators, scenarios: scenarios(indicators), error: "저장된 신용 자료를 불러오지 못했습니다." });
    }
  });
}
