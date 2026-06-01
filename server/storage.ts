import {
  users, accounts, tweets, tickers, mentions, syncLogs, settings,
  politicians, committees, politicianCommittees, politicalTrades, tickerSectors,
} from "../shared/schema.js";
import type {
  User, InsertUser, Account, InsertAccount, Tweet, InsertTweet,
  Ticker, Mention, InsertMention, SyncLog,
  Politician, InsertPolitician, Committee, InsertPoliticalTrade, TickerSector,
} from "../shared/schema.js";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, desc, sql, and, gte, lte, inArray } from "drizzle-orm";

// Lazy initialization: do NOT connect at module load time.
// On Vercel, importing this module must not throw or open a connection before
// the handler runs (env vars and network are only guaranteed inside the request).
let _db: ReturnType<typeof drizzle> | null = null;

function getDb() {
  if (_db) return _db;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Point it at your Supabase Postgres connection string.");
  }
  // `prepare: false` is required when going through Supabase's transaction pooler (pgbouncer).
  const client = postgres(connectionString, { prepare: false });
  _db = drizzle(client);
  return _db;
}

// Proxy so existing `db.select()...` call sites work unchanged while staying lazy.
export const db: ReturnType<typeof drizzle> = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_t, prop) {
    const real = getDb() as any;
    const v = real[prop];
    return typeof v === "function" ? v.bind(real) : v;
  },
});

export interface SurgeRow {
  symbol: string;
  companyName: string | null;
  companyNameKo: string | null;
  totalMentions: number;
  distinctAccounts: number;
  recentMentions: number;
  recentAccounts: number;
  priorMentions: number;
  surgeScore: number;
  firstSeen: number;
  lastSeen: number;
  accounts: string[];
  changePercent: number; // recent vs prior window, as % (from lift)
  trend: number[];       // daily mention counts over the last 14 days (sparkline)
}

// Politician with its committee ids attached (for the congress UI)
export interface PoliticianWithCommittees extends Politician {
  committees: string[];
}

// A single disclosed trade joined with its politician — the congress page
// aggregates these client-side (ranking / per-quarter / committee grouping),
// mirroring the prototype's logic.
export interface PoliticalTradeRow {
  id: number;
  politicianId: number;
  slug: string;
  name: string;
  party: string | null;
  chamber: string;
  state: string | null;
  symbol: string;
  company: string | null;
  side: string; // buy | sell | exchange
  amountLow: number | null;
  amountHigh: number | null;
  txnDate: number; // unix ms
  filedDate: number | null;
  verification: string;
  source: string;
}

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // accounts
  listAccounts(): Promise<Account[]>;
  createAccount(a: InsertAccount): Promise<Account>;
  updateAccount(id: number, patch: Partial<Account>): Promise<Account | undefined>;
  deleteAccount(id: number): Promise<void>;
  getAccountByHandle(handle: string): Promise<Account | undefined>;
  setAccountCursor(id: number, lastTweetId: string | null, lastSyncedAt: number): Promise<void>;

  // tweets
  insertTweetIfNew(t: InsertTweet): Promise<boolean>; // returns true if inserted (new)
  recentTweets(limit: number): Promise<Tweet[]>;
  tweetsForSymbol(symbol: string, limit: number): Promise<Tweet[]>;

  // tickers
  listTickers(): Promise<Ticker[]>;
  upsertTicker(t: Ticker): Promise<void>;

  // mentions
  insertMentionIfNew(m: InsertMention): Promise<boolean>;
  surge(windowHours: number, minAccounts: number): Promise<SurgeRow[]>;
  symbolTimeline(symbol: string, days: number): Promise<{ day: string; count: number }[]>;

  // sync logs
  createSyncLog(startedAt: number, handlesRequested: number): Promise<number>;
  updateSyncLog(id: number, patch: Partial<SyncLog>): Promise<void>;
  recentSyncLogs(limit: number): Promise<SyncLog[]>;

  // settings
  getSetting(key: string): Promise<string | undefined>;
  setSetting(key: string, value: string): Promise<void>;

  // stats
  counts(): Promise<{ accounts: number; tweets: number; mentions: number; symbols: number }>;

  // --- Congress / politician trading ---
  listPoliticians(): Promise<PoliticianWithCommittees[]>;
  listCommittees(): Promise<Committee[]>;
  politicalTrades(opts: { fromMs?: number; toMs?: number; committeeId?: string }): Promise<PoliticalTradeRow[]>;
  // ingestion (seed / collect)
  upsertPolitician(p: InsertPolitician): Promise<number>;
  upsertCommittee(c: Committee): Promise<void>;
  linkPoliticianCommittee(politicianId: number, committeeId: string): Promise<void>;
  insertPoliticalTradeIfNew(t: InsertPoliticalTrade): Promise<boolean>;
  clearPoliticianData(): Promise<void>;
  clearCommitteesAndLinks(): Promise<void>;
  // ticker sector/industry
  setTickerSector(symbol: string, sector: string | null): Promise<void>;
  listTickerSectors(): Promise<TickerSector[]>;
  distinctTradedSymbols(): Promise<string[]>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number) {
    return (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
  }
  async getUserByUsername(username: string) {
    return (await db.select().from(users).where(eq(users.username, username)).limit(1))[0];
  }
  async createUser(u: InsertUser) {
    return (await db.insert(users).values(u).returning())[0];
  }

  async listAccounts() { return db.select().from(accounts).orderBy(desc(accounts.createdAt)); }
  async createAccount(a: InsertAccount) {
    return (await db.insert(accounts).values({
      handle: a.handle, displayName: a.displayName ?? null, note: a.note ?? null,
      platform: a.platform ?? "x", active: a.active ?? true, createdAt: Date.now(),
    }).returning())[0];
  }
  async updateAccount(id: number, patch: Partial<Account>) {
    return (await db.update(accounts).set(patch).where(eq(accounts.id, id)).returning())[0];
  }
  async deleteAccount(id: number) { await db.delete(accounts).where(eq(accounts.id, id)); }
  async getAccountByHandle(handle: string) {
    return (await db.select().from(accounts).where(eq(accounts.handle, handle.toLowerCase())).limit(1))[0];
  }
  async setAccountCursor(id: number, lastTweetId: string | null, lastSyncedAt: number) {
    await db.update(accounts).set({ lastTweetId: lastTweetId ?? undefined, lastSyncedAt }).where(eq(accounts.id, id));
  }

  async insertTweetIfNew(t: InsertTweet) {
    const r = await db.insert(tweets).values(t).onConflictDoNothing({ target: tweets.tweetId }).returning();
    return r.length > 0;
  }
  async recentTweets(limit: number) {
    return db.select().from(tweets).orderBy(desc(tweets.tweetedAt)).limit(limit);
  }
  async tweetsForSymbol(symbol: string, limit: number) {
    const rows = await db.select({ t: tweets }).from(mentions)
      .innerJoin(tweets, eq(mentions.tweetId, tweets.tweetId))
      .where(eq(mentions.symbol, symbol.toUpperCase()))
      .orderBy(desc(tweets.tweetedAt)).limit(limit);
    // de-dup tweets (a tweet may have cashtag+name mention)
    const seen = new Set<string>();
    const out: Tweet[] = [];
    for (const r of rows) { if (!seen.has(r.t.tweetId)) { seen.add(r.t.tweetId); out.push(r.t); } }
    return out;
  }

  async listTickers() { return db.select().from(tickers); }
  // companyNameKo is optional and intentionally NOT in the conflict-update set, so the
  // Korean names seeded by script/seed-korean-names.ts survive a re-upsert from the API/seed.
  async upsertTicker(t: Omit<Ticker, "companyNameKo"> & { companyNameKo?: string | null }) {
    await db.insert(tickers).values(t).onConflictDoUpdate({
      target: tickers.symbol,
      set: { companyName: t.companyName, aliases: t.aliases, exchange: t.exchange },
    });
  }

  async insertMentionIfNew(m: InsertMention) {
    const r = await db.insert(mentions).values(m)
      .onConflictDoNothing({ target: [mentions.tweetId, mentions.symbol, mentions.source] }).returning();
    return r.length > 0;
  }

  // Surge detection: compare a recent window vs the immediately preceding window of equal length.
  async surge(windowHours: number, minAccounts: number): Promise<SurgeRow[]> {
    const now = Date.now();
    const winMs = windowHours * 3600 * 1000;
    const recentStart = now - winMs;
    const priorStart = now - 2 * winMs;

    // Aliases are double-quoted to preserve camelCase (Postgres lowercases bare identifiers).
    const rows = (await db.execute(sql`
      SELECT m.symbol AS symbol,
             COUNT(*) AS "totalMentions",
             COUNT(DISTINCT m.account_id) AS "distinctAccounts",
             SUM(CASE WHEN m.tweeted_at >= ${recentStart} THEN 1 ELSE 0 END) AS "recentMentions",
             COUNT(DISTINCT CASE WHEN m.tweeted_at >= ${recentStart} THEN m.account_id END) AS "recentAccounts",
             SUM(CASE WHEN m.tweeted_at >= ${priorStart} AND m.tweeted_at < ${recentStart} THEN 1 ELSE 0 END) AS "priorMentions",
             MIN(m.tweeted_at) AS "firstSeen",
             MAX(m.tweeted_at) AS "lastSeen",
             string_agg(DISTINCT m.handle, ',') AS handles
      FROM mentions m
      GROUP BY m.symbol
    `)) as unknown as any[];

    const out: SurgeRow[] = rows.map((r) => {
      const recent = Number(r.recentMentions) || 0;
      const prior = Number(r.priorMentions) || 0;
      const recentAccounts = Number(r.recentAccounts) || 0;
      // surge score: recent volume weighted by breadth (distinct accounts), vs prior baseline.
      const lift = (recent + 1) / (prior + 1);
      const surgeScore = recent * recentAccounts * lift;
      return {
        symbol: r.symbol,
        companyName: null,
        companyNameKo: null,
        totalMentions: Number(r.totalMentions),
        distinctAccounts: Number(r.distinctAccounts),
        recentMentions: recent,
        recentAccounts,
        priorMentions: prior,
        surgeScore: Math.round(surgeScore * 100) / 100,
        firstSeen: Number(r.firstSeen),
        lastSeen: Number(r.lastSeen),
        accounts: (r.handles ? String(r.handles).split(",") : []),
        changePercent: Math.round((lift - 1) * 100),
        trend: [],
      };
    });

    // attach company names
    const tk = await this.listTickers();
    const nameMap = new Map(tk.map((t) => [t.symbol, t.companyName]));
    const koMap = new Map(tk.map((t) => [t.symbol, t.companyNameKo]));
    for (const o of out) {
      o.companyName = nameMap.get(o.symbol) ?? null;
      o.companyNameKo = koMap.get(o.symbol) ?? null;
    }

    // attach a 14-day daily mention trend per symbol (one query) for the sparkline
    const TREND_DAYS = 14;
    const trendStart = now - TREND_DAYS * 86400 * 1000;
    const trendRows = (await db.execute(sql`
      SELECT m.symbol AS symbol,
             to_char(to_timestamp(m.tweeted_at / 1000), 'YYYY-MM-DD') AS day,
             COUNT(*) AS c
      FROM mentions m WHERE m.tweeted_at >= ${trendStart}
      GROUP BY m.symbol, day
    `)) as unknown as any[];
    const trendMap = new Map<string, Map<string, number>>();
    for (const r of trendRows) {
      let mm = trendMap.get(r.symbol);
      if (!mm) { mm = new Map(); trendMap.set(r.symbol, mm); }
      mm.set(r.day, Number(r.c));
    }
    const axis: string[] = [];
    for (let i = TREND_DAYS - 1; i >= 0; i--) axis.push(new Date(now - i * 86400 * 1000).toISOString().slice(0, 10));
    for (const o of out) {
      const mm = trendMap.get(o.symbol);
      o.trend = axis.map((d) => mm?.get(d) ?? 0);
    }

    // require breadth: surfaced symbols must be mentioned by >= minAccounts distinct accounts in recent window.
    // ranking is simply by mention count (most-talked-about first); accounts breaks ties.
    return out
      .filter((o) => o.recentAccounts >= minAccounts && o.recentMentions > 0)
      .sort((a, b) => b.recentMentions - a.recentMentions || b.recentAccounts - a.recentAccounts);
  }

  async symbolTimeline(symbol: string, days: number) {
    const start = Date.now() - days * 86400 * 1000;
    const rows = (await db.execute(sql`
      SELECT to_char(to_timestamp(m.tweeted_at / 1000), 'YYYY-MM-DD') AS day, COUNT(*) AS count
      FROM mentions m WHERE m.symbol = ${symbol.toUpperCase()} AND m.tweeted_at >= ${start}
      GROUP BY day ORDER BY day
    `)) as unknown as any[];
    return rows.map((r) => ({ day: r.day, count: Number(r.count) }));
  }

  async createSyncLog(startedAt: number, handlesRequested: number) {
    const r = (await db.insert(syncLogs).values({ startedAt, status: "running", handlesRequested }).returning())[0];
    return r.id;
  }
  async updateSyncLog(id: number, patch: Partial<SyncLog>) {
    await db.update(syncLogs).set(patch).where(eq(syncLogs.id, id));
  }
  async recentSyncLogs(limit: number) {
    return db.select().from(syncLogs).orderBy(desc(syncLogs.startedAt)).limit(limit);
  }

  async getSetting(key: string) {
    const r = (await db.select().from(settings).where(eq(settings.key, key)).limit(1))[0];
    return r?.value ?? undefined;
  }
  async setSetting(key: string, value: string) {
    await db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
  }

  async counts() {
    const r = (await db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM accounts) AS accounts,
        (SELECT COUNT(*) FROM tweets) AS tweets,
        (SELECT COUNT(*) FROM mentions) AS mentions,
        (SELECT COUNT(DISTINCT symbol) FROM mentions) AS symbols
    `)) as unknown as any[];
    const row = r[0] ?? {};
    return {
      accounts: Number(row.accounts) || 0,
      tweets: Number(row.tweets) || 0,
      mentions: Number(row.mentions) || 0,
      symbols: Number(row.symbols) || 0,
    };
  }

  // --- Congress / politician trading ---
  async listPoliticians(): Promise<PoliticianWithCommittees[]> {
    const pols = await db.select().from(politicians).orderBy(politicians.name);
    const links = await db.select().from(politicianCommittees);
    const byPol = new Map<number, string[]>();
    for (const l of links) {
      if (!byPol.has(l.politicianId)) byPol.set(l.politicianId, []);
      byPol.get(l.politicianId)!.push(l.committeeId);
    }
    return pols.map((p) => ({ ...p, committees: byPol.get(p.id) ?? [] }));
  }

  async listCommittees() { return db.select().from(committees); }

  async politicalTrades(opts: { fromMs?: number; toMs?: number; committeeId?: string }): Promise<PoliticalTradeRow[]> {
    const conds: any[] = [];
    if (opts.fromMs != null) conds.push(gte(politicalTrades.txnDate, opts.fromMs));
    if (opts.toMs != null) conds.push(lte(politicalTrades.txnDate, opts.toMs));
    if (opts.committeeId) {
      const links = await db.select().from(politicianCommittees)
        .where(eq(politicianCommittees.committeeId, opts.committeeId));
      const ids = links.map((l) => l.politicianId);
      if (ids.length === 0) return [];
      conds.push(inArray(politicalTrades.politicianId, ids));
    }
    const rows = await db
      .select({
        id: politicalTrades.id,
        politicianId: politicalTrades.politicianId,
        slug: politicians.slug,
        name: politicians.name,
        party: politicians.party,
        chamber: politicians.chamber,
        state: politicians.state,
        symbol: politicalTrades.symbol,
        company: politicalTrades.company,
        side: politicalTrades.side,
        amountLow: politicalTrades.amountLow,
        amountHigh: politicalTrades.amountHigh,
        txnDate: politicalTrades.txnDate,
        filedDate: politicalTrades.filedDate,
        verification: politicalTrades.verification,
        source: politicalTrades.source,
      })
      .from(politicalTrades)
      .innerJoin(politicians, eq(politicalTrades.politicianId, politicians.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(politicalTrades.txnDate));
    return rows as PoliticalTradeRow[];
  }

  async upsertPolitician(p: InsertPolitician): Promise<number> {
    const r = await db.insert(politicians).values(p)
      .onConflictDoUpdate({
        target: politicians.slug,
        set: { name: p.name, party: p.party, chamber: p.chamber, state: p.state, bioguideId: p.bioguideId },
      })
      .returning();
    return r[0].id;
  }

  async upsertCommittee(c: Committee) {
    await db.insert(committees).values(c)
      .onConflictDoUpdate({ target: committees.id, set: { ko: c.ko, name: c.name, chamber: c.chamber } });
  }

  async linkPoliticianCommittee(politicianId: number, committeeId: string) {
    await db.insert(politicianCommittees).values({ politicianId, committeeId }).onConflictDoNothing();
  }

  async insertPoliticalTradeIfNew(t: InsertPoliticalTrade): Promise<boolean> {
    const r = await db.insert(politicalTrades).values(t)
      .onConflictDoNothing({ target: politicalTrades.externalId }).returning();
    return r.length > 0;
  }

  async clearPoliticianData() {
    await db.delete(politicalTrades);
    await db.delete(politicianCommittees);
    await db.delete(politicians);
  }

  async clearCommitteesAndLinks() {
    await db.delete(politicianCommittees);
    await db.delete(committees);
  }

  async setTickerSector(symbol: string, sector: string | null) {
    await db.insert(tickerSectors).values({ symbol, sector })
      .onConflictDoUpdate({ target: tickerSectors.symbol, set: { sector } });
  }
  async listTickerSectors() { return db.select().from(tickerSectors); }
  async distinctTradedSymbols() {
    const r = await db.selectDistinct({ symbol: politicalTrades.symbol }).from(politicalTrades);
    return r.map((x) => x.symbol);
  }
}

export const storage = new DatabaseStorage();
