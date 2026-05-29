import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { collectAll } from "./apify";
import { seedDummy } from "./seed";
import { insertAccountSchema } from "@shared/schema";
import { z } from "zod";

export async function registerRoutes(httpServer: Server, app: Express) {
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
    res.json(await storage.surge(windowHours, minAccounts));
  });

  app.get("/api/symbols/:symbol/timeline", async (req, res) => {
    const days = Number(req.query.days ?? 14);
    res.json(await storage.symbolTimeline(req.params.symbol, days));
  });

  app.get("/api/symbols/:symbol/tweets", async (req, res) => {
    const limit = Number(req.query.limit ?? 30);
    res.json(await storage.tweetsForSymbol(req.params.symbol, limit));
  });

  // ---- Tweets feed ----
  app.get("/api/tweets", async (req, res) => {
    res.json(await storage.recentTweets(Number(req.query.limit ?? 50)));
  });

  // ---- Collection ----
  app.post("/api/collect", async (_req, res) => {
    const r = await collectAll();
    res.json(r);
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

  // ---- Dummy data (testing) ----
  app.post("/api/seed", async (_req, res) => {
    const r = await seedDummy();
    res.json(r);
  });

  return httpServer;
}
