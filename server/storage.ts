import {
  users, accounts, tweets, tickers, mentions, syncLogs, settings,
} from "@shared/schema";
import type {
  User, InsertUser, Account, InsertAccount, Tweet, InsertTweet,
  Ticker, Mention, InsertMention, SyncLog,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc, sql, and, gte, inArray } from "drizzle-orm";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite);

// Ensure tables exist (lightweight migration on boot)
function migrate() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, handle TEXT NOT NULL UNIQUE, display_name TEXT, note TEXT,
      active INTEGER NOT NULL DEFAULT 1, last_tweet_id TEXT, last_synced_at INTEGER, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tweets (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tweet_id TEXT NOT NULL UNIQUE, account_id INTEGER NOT NULL,
      handle TEXT NOT NULL, text TEXT NOT NULL, url TEXT, lang TEXT,
      is_reply INTEGER NOT NULL DEFAULT 0, is_retweet INTEGER NOT NULL DEFAULT 0,
      like_count INTEGER NOT NULL DEFAULT 0, retweet_count INTEGER NOT NULL DEFAULT 0,
      reply_count INTEGER NOT NULL DEFAULT 0, view_count INTEGER NOT NULL DEFAULT 0,
      tweeted_at INTEGER NOT NULL, collected_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tweets_account ON tweets(account_id);
    CREATE INDEX IF NOT EXISTS idx_tweets_tweeted_at ON tweets(tweeted_at);
    CREATE TABLE IF NOT EXISTS tickers (symbol TEXT PRIMARY KEY, company_name TEXT, aliases TEXT NOT NULL DEFAULT '[]', exchange TEXT);
    CREATE TABLE IF NOT EXISTS mentions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tweet_id TEXT NOT NULL, symbol TEXT NOT NULL,
      account_id INTEGER NOT NULL, handle TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'cashtag', tweeted_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mentions_symbol ON mentions(symbol);
    CREATE INDEX IF NOT EXISTS idx_mentions_tweeted_at ON mentions(tweeted_at);
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_mention ON mentions(tweet_id, symbol, source);
    CREATE TABLE IF NOT EXISTS sync_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, started_at INTEGER NOT NULL, finished_at INTEGER,
      status TEXT NOT NULL, handles_requested INTEGER NOT NULL DEFAULT 0, tweets_fetched INTEGER NOT NULL DEFAULT 0,
      tweets_new INTEGER NOT NULL DEFAULT 0, mentions_new INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 1,
      run_id TEXT, dataset_id TEXT, error TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
  `);
}
migrate();

export interface SurgeRow {
  symbol: string;
  companyName: string | null;
  totalMentions: number;
  distinctAccounts: number;
  recentMentions: number;
  recentAccounts: number;
  priorMentions: number;
  surgeScore: number;
  firstSeen: number;
  lastSeen: number;
  accounts: string[];
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
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number) { return db.select().from(users).where(eq(users.id, id)).get(); }
  async getUserByUsername(username: string) { return db.select().from(users).where(eq(users.username, username)).get(); }
  async createUser(u: InsertUser) { return db.insert(users).values(u).returning().get(); }

  async listAccounts() { return db.select().from(accounts).orderBy(desc(accounts.createdAt)).all(); }
  async createAccount(a: InsertAccount) {
    return db.insert(accounts).values({
      handle: a.handle, displayName: a.displayName ?? null, note: a.note ?? null,
      active: a.active ?? true, createdAt: Date.now(),
    }).returning().get();
  }
  async updateAccount(id: number, patch: Partial<Account>) {
    return db.update(accounts).set(patch).where(eq(accounts.id, id)).returning().get();
  }
  async deleteAccount(id: number) { db.delete(accounts).where(eq(accounts.id, id)).run(); }
  async getAccountByHandle(handle: string) {
    return db.select().from(accounts).where(eq(accounts.handle, handle.toLowerCase())).get();
  }
  async setAccountCursor(id: number, lastTweetId: string | null, lastSyncedAt: number) {
    db.update(accounts).set({ lastTweetId: lastTweetId ?? undefined, lastSyncedAt }).where(eq(accounts.id, id)).run();
  }

  async insertTweetIfNew(t: InsertTweet) {
    const r = db.insert(tweets).values(t).onConflictDoNothing({ target: tweets.tweetId }).run();
    return r.changes > 0;
  }
  async recentTweets(limit: number) {
    return db.select().from(tweets).orderBy(desc(tweets.tweetedAt)).limit(limit).all();
  }
  async tweetsForSymbol(symbol: string, limit: number) {
    const rows = db.select({ t: tweets }).from(mentions)
      .innerJoin(tweets, eq(mentions.tweetId, tweets.tweetId))
      .where(eq(mentions.symbol, symbol.toUpperCase()))
      .orderBy(desc(tweets.tweetedAt)).limit(limit).all();
    // de-dup tweets (a tweet may have cashtag+name mention)
    const seen = new Set<string>();
    const out: Tweet[] = [];
    for (const r of rows) { if (!seen.has(r.t.tweetId)) { seen.add(r.t.tweetId); out.push(r.t); } }
    return out;
  }

  async listTickers() { return db.select().from(tickers).all(); }
  async upsertTicker(t: Ticker) {
    db.insert(tickers).values(t).onConflictDoUpdate({
      target: tickers.symbol,
      set: { companyName: t.companyName, aliases: t.aliases, exchange: t.exchange },
    }).run();
  }

  async insertMentionIfNew(m: InsertMention) {
    const r = db.insert(mentions).values(m)
      .onConflictDoNothing({ target: [mentions.tweetId, mentions.symbol, mentions.source] }).run();
    return r.changes > 0;
  }

  // Surge detection: compare a recent window vs the immediately preceding window of equal length.
  async surge(windowHours: number, minAccounts: number): Promise<SurgeRow[]> {
    const now = Date.now();
    const winMs = windowHours * 3600 * 1000;
    const recentStart = now - winMs;
    const priorStart = now - 2 * winMs;

    const rows = sqlite.prepare(`
      SELECT m.symbol AS symbol,
             COUNT(*) AS totalMentions,
             COUNT(DISTINCT m.account_id) AS distinctAccounts,
             SUM(CASE WHEN m.tweeted_at >= ? THEN 1 ELSE 0 END) AS recentMentions,
             COUNT(DISTINCT CASE WHEN m.tweeted_at >= ? THEN m.account_id END) AS recentAccounts,
             SUM(CASE WHEN m.tweeted_at >= ? AND m.tweeted_at < ? THEN 1 ELSE 0 END) AS priorMentions,
             MIN(m.tweeted_at) AS firstSeen,
             MAX(m.tweeted_at) AS lastSeen,
             GROUP_CONCAT(DISTINCT m.handle) AS handles
      FROM mentions m
      GROUP BY m.symbol
    `).all(recentStart, recentStart, priorStart, recentStart) as any[];

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
        totalMentions: Number(r.totalMentions),
        distinctAccounts: Number(r.distinctAccounts),
        recentMentions: recent,
        recentAccounts,
        priorMentions: prior,
        surgeScore: Math.round(surgeScore * 100) / 100,
        firstSeen: Number(r.firstSeen),
        lastSeen: Number(r.lastSeen),
        accounts: (r.handles ? String(r.handles).split(",") : []),
      };
    });

    // attach company names
    const tk = await this.listTickers();
    const nameMap = new Map(tk.map((t) => [t.symbol, t.companyName]));
    for (const o of out) o.companyName = nameMap.get(o.symbol) ?? null;

    // require breadth: surfaced symbols must be mentioned by >= minAccounts distinct accounts in recent window
    return out
      .filter((o) => o.recentAccounts >= minAccounts && o.recentMentions > 0)
      .sort((a, b) => b.surgeScore - a.surgeScore);
  }

  async symbolTimeline(symbol: string, days: number) {
    const start = Date.now() - days * 86400 * 1000;
    const rows = sqlite.prepare(`
      SELECT date(m.tweeted_at/1000,'unixepoch') AS day, COUNT(*) AS count
      FROM mentions m WHERE m.symbol = ? AND m.tweeted_at >= ?
      GROUP BY day ORDER BY day
    `).all(symbol.toUpperCase(), start) as any[];
    return rows.map((r) => ({ day: r.day, count: Number(r.count) }));
  }

  async createSyncLog(startedAt: number, handlesRequested: number) {
    const r = db.insert(syncLogs).values({ startedAt, status: "running", handlesRequested }).returning().get();
    return r.id;
  }
  async updateSyncLog(id: number, patch: Partial<SyncLog>) {
    db.update(syncLogs).set(patch).where(eq(syncLogs.id, id)).run();
  }
  async recentSyncLogs(limit: number) {
    return db.select().from(syncLogs).orderBy(desc(syncLogs.startedAt)).limit(limit).all();
  }

  async getSetting(key: string) {
    const r = db.select().from(settings).where(eq(settings.key, key)).get();
    return r?.value ?? undefined;
  }
  async setSetting(key: string, value: string) {
    db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
  }

  async counts() {
    const a = sqlite.prepare(`SELECT COUNT(*) c FROM accounts`).get() as any;
    const t = sqlite.prepare(`SELECT COUNT(*) c FROM tweets`).get() as any;
    const m = sqlite.prepare(`SELECT COUNT(*) c FROM mentions`).get() as any;
    const s = sqlite.prepare(`SELECT COUNT(DISTINCT symbol) c FROM mentions`).get() as any;
    return { accounts: a.c, tweets: t.c, mentions: m.c, symbols: s.c };
  }
}

export const storage = new DatabaseStorage();
