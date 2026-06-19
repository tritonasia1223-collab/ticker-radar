import type { Express } from "express";
import { storage } from "./storage.js";
import { collectAll } from "./apify.js";
import { seedDummy } from "./seed.js";
import { insertAccountSchema } from "../shared/schema.js";
import { listFlows, upsertFlow, deleteFlow, listLinks, addLink, deleteLink, type FlowInput } from "./capitalism.js";
import { z } from "zod";

// Writes that hit Apify (and run for a long time) must not run on Vercel's
// serverless functions — they'd time out. Collection runs from a local/worker
// process instead (see script/collect.ts). DEPLOY_TARGET=vercel disables them.
const COLLECTION_DISABLED = process.env.DEPLOY_TARGET === "vercel";

export function registerRoutes(app: Express) {
  // CDN edge caching for collect-driven read endpoints. The data changes only when the
  // collector runs (weekly cron / manual 갱신), so let Vercel serve cached JSON from the
  // edge — repeat and multi-user loads skip the function entirely. Clients bucket their
  // from/to to the hour so these URLs are stable enough to actually hit the cache.
  const EDGE_CACHE = "public, s-maxage=300, stale-while-revalidate=3600";
  app.use((req, res, next) => {
    if (req.method === "GET" && req.path.startsWith("/api/")) {
      const p = req.path;
      if (
        p.startsWith("/api/insider/") || p.startsWith("/api/congress/") ||
        p === "/api/surge" || p === "/api/sector-map" || p === "/api/tickers"
      ) {
        res.set("Cache-Control", EDGE_CACHE);
      }
    }
    next();
  });

  // ---- Accounts ----
  app.get("/api/accounts", async (_req, res) => {
    res.json(await storage.listAccounts());
  });

  app.post("/api/accounts", async (req, res) => {
    try {
      const parsed = insertAccountSchema.parse(req.body);
      const existing = await storage.getAccountByHandle(parsed.handle);
      if (existing) return res.status(409).json({ error: "이미 추적 중인 계정입니다." });
      const a = await storage.createAccount(parsed);
      res.status(201).json(a);
    } catch (e: any) {
      res.status(400).json({ error: e?.errors ?? String(e?.message || e) });
    }
  });

  app.patch("/api/accounts/:id", async (req, res) => {
    const id = Number(req.params.id);
    const patch = z.object({ active: z.boolean().optional(), note: z.string().nullable().optional(), displayName: z.string().nullable().optional() }).parse(req.body);
    const a = await storage.updateAccount(id, patch as any);
    if (!a) return res.status(404).json({ error: "not found" });
    res.json(a);
  });

  app.delete("/api/accounts/:id", async (req, res) => {
    await storage.deleteAccount(Number(req.params.id));
    res.status(204).end();
  });

  // ---- Surge / discovery ----
  app.get("/api/surge", async (req, res) => {
    const windowHours = Number(req.query.windowHours ?? 24);
    const minAccounts = Number(req.query.minAccounts ?? 2);
    const market = req.query.market === "kr" ? "kr" : "us";
    res.json(await storage.surge(windowHours, minAccounts, market));
  });

  // Sector treemap for the discovery dashboard (sized by mentions, colored by surge).
  app.get("/api/sector-map", async (req, res) => {
    const windowHours = Number(req.query.windowHours ?? 24);
    const market = req.query.market === "kr" ? "kr" : "us";
    res.json(await storage.sectorMap(windowHours, market));
  });

  // ---- 관심종목등록 상위 (KIS daily snapshots) ----
  app.get("/api/interest/today", async (_req, res) => res.json(await storage.interestToday()));
  app.get("/api/interest/trend", async (req, res) => {
    const days = Math.min(Number(req.query.days ?? 30), 120);
    res.json(await storage.interestTrend(days));
  });

  app.get("/api/symbols/:symbol/timeline", async (req, res) => {
    const days = Number(req.query.days ?? 14);
    res.json(await storage.symbolTimeline(req.params.symbol, days));
  });

  app.get("/api/symbols/:symbol/tweets", async (req, res) => {
    const limit = Number(req.query.limit ?? 30);
    res.json(await storage.tweetsForSymbol(req.params.symbol, limit));
  });

  // "왜 뜨나" 뉴스 레포트 (Gemini 그라운딩, CLI로 미리 생성된 캐시)
  app.get("/api/symbols/:symbol/report", async (req, res) => {
    res.json(await storage.getReport(req.params.symbol));
  });

  // ---- Tweets feed ----
  app.get("/api/tweets", async (req, res) => {
    res.json(await storage.recentTweets(Number(req.query.limit ?? 50)));
  });

  // ---- Collection ----
  app.post("/api/collect", async (_req, res) => {
    if (COLLECTION_DISABLED) {
      return res.status(501).json({
        ok: false,
        error: "수집은 이 배포에서 비활성화되어 있습니다. 로컬에서 `npm run collect`로 실행하세요.",
      });
    }
    const r = await collectAll();
    res.json(r);
  });

  // '갱신' 버튼 → GitHub Actions(collect.yml)을 workflow_dispatch로 트리거. Vercel 함수는
  // 10초 제한이라 직접 수집 못 돌리므로, GH 러너가 돌려 같은 Supabase에 기록한다.
  app.post("/api/collect/trigger", async (_req, res) => {
    const token = process.env.GH_DISPATCH_TOKEN;
    if (!token) return res.status(501).json({ ok: false, error: "GH_DISPATCH_TOKEN 미설정 (Vercel 환경변수에 GitHub 토큰 추가 필요)" });
    const repo = process.env.GH_REPO || "tritonasia1223-collab/ticker-radar";
    const workflow = process.env.GH_WORKFLOW || "collect.yml";
    const ref = process.env.GH_REF || "master";

    // 과도한 트리거 방지: 최근 90초 내 시작된 수집이 있으면 막는다.
    const recent = await storage.recentSyncLogs(1);
    if (recent[0] && Date.now() - recent[0].startedAt < 90_000) {
      return res.status(429).json({ ok: false, error: "방금 수집을 시작했어요. 잠시 후 다시 시도하세요." });
    }
    try {
      const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "ticker-radar",
        },
        body: JSON.stringify({ ref }),
      });
      if (r.status === 204) return res.json({ ok: true });
      return res.status(502).json({ ok: false, error: `GitHub ${r.status}: ${(await r.text()).slice(0, 200)}` });
    } catch (e: any) {
      return res.status(502).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get("/api/sync-logs", async (req, res) => {
    res.json(await storage.recentSyncLogs(Number(req.query.limit ?? 20)));
  });

  // ---- Stats ----
  app.get("/api/stats", async (_req, res) => {
    res.json(await storage.counts());
  });

  // ---- Settings ----
  app.get("/api/settings", async (_req, res) => {
    const token = await storage.getSetting("apify_token");
    res.json({
      hasToken: !!(process.env.APIFY_TOKEN || token),
      tokenSource: process.env.APIFY_TOKEN ? "env" : token ? "db" : "none",
      actor: (await storage.getSetting("apify_actor")) || "apidojo~tweet-scraper",
      maxTweetsPerHandle: Number((await storage.getSetting("max_tweets_per_handle")) || 30),
    });
  });

  app.post("/api/settings", async (req, res) => {
    const body = z.object({
      apifyToken: z.string().optional(),
      actor: z.string().optional(),
      maxTweetsPerHandle: z.number().int().positive().optional(),
    }).parse(req.body);
    if (body.apifyToken !== undefined && body.apifyToken !== "") await storage.setSetting("apify_token", body.apifyToken);
    if (body.actor !== undefined) await storage.setSetting("apify_actor", body.actor);
    if (body.maxTweetsPerHandle !== undefined) await storage.setSetting("max_tweets_per_handle", String(body.maxTweetsPerHandle));
    res.json({ ok: true });
  });

  // ---- Tickers (for name-matching dictionary) ----
  app.get("/api/tickers", async (_req, res) => res.json(await storage.listTickers()));
  app.post("/api/tickers", async (req, res) => {
    const t = z.object({
      symbol: z.string().min(1).transform((s) => s.toUpperCase()),
      companyName: z.string().nullable().optional(),
      aliases: z.array(z.string()).optional(),
      exchange: z.string().nullable().optional(),
    }).parse(req.body);
    await storage.upsertTicker({
      symbol: t.symbol, companyName: t.companyName ?? null,
      aliases: JSON.stringify(t.aliases ?? []), exchange: t.exchange ?? null,
    });
    res.json({ ok: true });
  });

  // ---- Congress / politician trading ----
  app.get("/api/congress/politicians", async (_req, res) => res.json(await storage.listPoliticians()));
  app.get("/api/congress/committees", async (_req, res) => res.json(await storage.listCommittees()));
  app.get("/api/congress/trades", async (req, res) => {
    const from = req.query.from ? Number(req.query.from) : undefined;
    const to = req.query.to ? Number(req.query.to) : undefined;
    const committee = req.query.committee ? String(req.query.committee) : undefined;
    res.json(await storage.politicalTrades({ fromMs: from, toMs: to, committeeId: committee }));
  });
  app.get("/api/congress/sectors", async (_req, res) => res.json(await storage.listTickerSectors()));

  // ---- Insider trading (Form 4) ----
  app.get("/api/insider/ranking", async (req, res) => {
    const from = req.query.from ? Number(req.query.from) : undefined;
    const to = req.query.to ? Number(req.query.to) : undefined;
    res.json(await storage.insiderRanking({ fromMs: from, toMs: to }));
  });
  app.get("/api/insider/ticker/:symbol", async (req, res) => {
    const from = req.query.from ? Number(req.query.from) : undefined;
    const to = req.query.to ? Number(req.query.to) : undefined;
    res.json(await storage.insiderTradesForSymbol(req.params.symbol, { fromMs: from, toMs: to }));
  });
  app.get("/api/insider/insider/:slug", async (req, res) => {
    const from = req.query.from ? Number(req.query.from) : undefined;
    const to = req.query.to ? Number(req.query.to) : undefined;
    res.json(await storage.insiderTradesForInsider(req.params.slug, { fromMs: from, toMs: to }));
  });
  app.get("/api/insider/clusters", async (req, res) => {
    const from = req.query.from ? Number(req.query.from) : undefined;
    const to = req.query.to ? Number(req.query.to) : undefined;
    const windowDays = req.query.window ? Number(req.query.window) : undefined;
    res.json(await storage.insiderClusters({ fromMs: from, toMs: to, windowDays }));
  });
  app.get("/api/insider/sectors", async (_req, res) => res.json(await storage.listTickerSectors()));

  // ---- 자본주의 경제사 타임라인 (격리 도메인) ----
  const capTableSchema = z.object({
    widths: z.array(z.number()),
    cells: z.array(z.array(z.string())),
  });
  const capNodeSchema = z.object({
    nodeKey: z.string().min(1),
    kind: z.enum(["cause", "event", "effect", "result"]),
    inLabel: z.string().nullable().optional(),
    text: z.string().min(1),
    ref: z.string().nullable().optional(),
    col: z.enum(["center", "left", "right"]).nullable().optional(),
    table: capTableSchema.nullable().optional(),
  });
  const capFlowInputSchema = z.object({
    slug: z.string().min(1),
    date: z.string().min(1),
    endDate: z.string().nullable().optional(), // 있으면 기간 이벤트
    year: z.number().int(),
    title: z.string().min(1),
    category: z.enum(["정치", "경제", "사회"]).default("경제"),
    layout: z.enum(["stack", "branch"]).default("stack"),
    sortOrder: z.number().int().optional(),
    nodes: z.array(capNodeSchema),
    edges: z.array(z.object({ from: z.string(), to: z.string() })),
  });

  app.get("/api/capitalism/flows", async (_req, res) => {
    res.json(await listFlows());
  });
  app.post("/api/capitalism/flows", async (req, res) => {
    try {
      const parsed = capFlowInputSchema.parse(req.body) as FlowInput;
      res.json(await upsertFlow(parsed));
    } catch (e: any) {
      res.status(400).json({ error: e?.errors ?? String(e?.message || e) });
    }
  });
  app.delete("/api/capitalism/flows/:slug", async (req, res) => {
    await deleteFlow(req.params.slug);
    res.status(204).end();
  });

  // ---- 보드 전역 화살표(링크): 카드 내/간 드래그앤드롭 연결 ----
  const capLinkInputSchema = z.object({
    fromSlug: z.string().min(1),
    fromKey: z.string().min(1),
    toSlug: z.string().min(1),
    toKey: z.string().min(1),
  });
  app.get("/api/capitalism/links", async (_req, res) => {
    res.json(await listLinks());
  });
  app.post("/api/capitalism/links", async (req, res) => {
    try {
      const parsed = capLinkInputSchema.parse(req.body);
      res.json(await addLink(parsed));
    } catch (e: any) {
      res.status(400).json({ error: e?.errors ?? String(e?.message || e) });
    }
  });
  app.delete("/api/capitalism/links/:id", async (req, res) => {
    await deleteLink(Number(req.params.id));
    res.status(204).end();
  });

  // ---- Dummy data (testing) ----
  app.post("/api/seed", async (_req, res) => {
    if (COLLECTION_DISABLED) {
      return res.status(501).json({ ok: false, error: "시드는 이 배포에서 비활성화되어 있습니다." });
    }
    const r = await seedDummy();
    res.json(r);
  });
}
