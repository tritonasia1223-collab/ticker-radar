import {
  users, accounts, tweets, tickers, mentions, syncLogs, settings,
  politicians, committees, politicianCommittees, politicalTrades, tickerSectors,
  insiders, insiderTrades,
} from "../shared/schema.js";
import type {
  User, InsertUser, Account, InsertAccount, Tweet, InsertTweet,
  Ticker, Mention, InsertMention, SyncLog,
  Politician, InsertPolitician, Committee, InsertPoliticalTrade, TickerSector,
  InsertInsider, InsertInsiderTrade,
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

// One drill-down stock inside a sector tile.
export interface SectorStock {
  symbol: string;
  nameKo: string | null;
  nameEn: string | null;
  recentMentions: number;
  recentAccounts: number;
  changePercent: number;
}
// One sector tile for the discovery treemap. size = recentMentions, color = changePercent.
export interface SectorMapRow {
  sector: string;          // KR: Korean 업종; US: English sector (Korean-mapped on client)
  recentMentions: number;
  recentAccounts: number;  // distinct accounts mentioning ANY stock in the sector
  priorMentions: number;
  changePercent: number;   // recent vs prior window
  stocks: SectorStock[];   // members mentioned in window, sorted newly-rising first
}

// Collapse the messy raw industry strings (Nasdaq for US, Naver 업종 for KR) into clean,
// merged Korean categories for the treemap — so "Computer Software: Prepackaged Software"
// and "EDP Services" don't show up as separate tiles, and "기술" is split into "반도체" etc.
const US_INDUSTRY_KO: Record<string, string> = {
  "Semiconductors": "반도체",
  "Computer Software: Programming Data Processing": "소프트웨어",
  "Computer Software: Prepackaged Software": "소프트웨어",
  "EDP Services": "IT서비스",
  "Business Services": "IT서비스",
  "Diversified Commercial Services": "IT서비스",
  "Computer Manufacturing": "컴퓨터·하드웨어",
  "Computer peripheral equipment": "컴퓨터·하드웨어",
  "Office Equipment/Supplies/Services": "컴퓨터·하드웨어",
  "Electronic Components": "전자부품",
  "Industrial Machinery/Components": "산업기계",
  "Construction/Ag Equipment/Trucks": "산업기계",
  "Auto Manufacturing": "자동차",
  "Shoe Manufacturing": "소비재",
  "Recreational Games/Products/Toys": "소비재",
  "Restaurants": "외식·소비",
  "Catalog/Specialty Distribution": "유통·소매",
  "Department/Specialty Retail Stores": "유통·소매",
  "Other Consumer Services": "소비서비스",
  "Services-Misc. Amusement & Recreation": "소비서비스",
  "Finance: Consumer Services": "금융",
  "Investment Bankers/Brokers/Service": "증권",
  "Major Banks": "은행",
  "Commercial Banks": "은행",
  "Property-Casualty Insurers": "보험",
  "Broadcasting": "미디어",
  "Cable & Other Pay Television Services": "미디어",
  "Radio And Television Broadcasting And Communications Equipment": "통신장비",
  "Telecommunications Equipment": "통신장비",
  "Military/Government/Technical": "우주항공·방산",
  "Aerospace": "우주항공·방산",
  "Biotechnology: Pharmaceutical Preparations": "바이오·제약",
  "Biotechnology: Biological Products (No Diagnostic Substances)": "바이오·제약",
  "Medical/Nursing Services": "헬스케어",
  "Electrical Equipment": "전기장비",
  "Engineering & Construction": "건설",
  "Transportation Services": "운송",
  "Mining & Quarrying of Nonmetallic Minerals (No Fuels)": "소재",
  // coarse Nasdaq sector fallbacks (when industry was blank at seed time)
  "Technology": "기술", "Finance": "금융", "Health Care": "헬스케어",
  "Consumer Discretionary": "임의소비재", "Industrials": "산업재", "Energy": "에너지",
};
// Verbose Naver 업종 → short label (most 업종 are already short and pass through).
const KR_UPJONG_KO: Record<string, string> = {
  "반도체와반도체장비": "반도체", "전자장비와기기": "전자장비", "우주항공과국방": "우주항공·방산",
  "양방향미디어와서비스": "인터넷·미디어", "다각화된통신서비스": "통신", "생명과학도구및서비스": "생명과학",
  "건강관리기술": "헬스케어", "건강관리장비와용품": "의료기기", "전문소매": "소매",
  "식품과기본식료품소매": "식품소매", "무역회사와판매업체": "무역·유통", "에너지장비및서비스": "에너지장비",
  "복합기업": "지주·복합", "기계류": "기계", "건축자재": "건자재", "식품과음료": "식음료",
};
function normalizeSector(raw: string | null, market: string): string {
  if (!raw) return "기타";
  if (market === "kr") return KR_UPJONG_KO[raw] || raw;
  return US_INDUSTRY_KO[raw] || raw;
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

// 내부자거래 — 종목 랭킹(서버 집계)
export interface InsiderRankRow {
  symbol: string;
  company: string | null;
  sector: string | null;
  buyValue: number;
  sellValue: number;
  netValue: number;
  buyCount: number;
  sellCount: number;
  insiderCount: number;
  tradeCount: number;
}
export interface InsiderTradeRow {
  id: number;
  insiderId: number;
  insiderName: string;
  insiderSlug: string;
  symbol: string;
  company: string | null;
  txnCode: string | null;
  side: string;
  shares: number | null;
  price: number | null;
  value: number | null;
  txnDate: number;
  filedDate: number | null;
  role: string | null;
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
  surge(windowHours: number, minAccounts: number, market?: string): Promise<SurgeRow[]>;
  sectorMap(windowHours: number, market?: string): Promise<SectorMapRow[]>;
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
  distinctMentionedSymbols(): Promise<string[]>;

  // --- Insider trading (Form 4) ---
  upsertInsider(i: InsertInsider): Promise<number>;
  insertInsiderTradeIfNew(t: InsertInsiderTrade): Promise<boolean>;
  clearInsiderData(): Promise<void>;
  insiderRanking(opts: { fromMs?: number; toMs?: number }): Promise<InsiderRankRow[]>;
  insiderTradesForSymbol(symbol: string, opts: { fromMs?: number; toMs?: number; limit?: number }): Promise<InsiderTradeRow[]>;
  insiderTradesForInsider(slug: string, opts: { fromMs?: number; toMs?: number }): Promise<InsiderTradeRow[]>;
  distinctInsiderSymbols(): Promise<string[]>;
  insiderPairsNeedingRole(): Promise<{ insiderId: number; symbol: string; name: string; externalId: string | null }[]>;
  setInsiderRole(insiderId: number, symbol: string, role: string | null): Promise<void>;
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
  async upsertTicker(t: Omit<Ticker, "companyNameKo" | "market"> & { companyNameKo?: string | null; market?: string }) {
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
  async surge(windowHours: number, minAccounts: number, market = "us"): Promise<SurgeRow[]> {
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

    // attach company names + market
    const tk = await this.listTickers();
    const nameMap = new Map(tk.map((t) => [t.symbol, t.companyName]));
    const koMap = new Map(tk.map((t) => [t.symbol, t.companyNameKo]));
    const marketMap = new Map(tk.map((t) => [t.symbol, t.market]));
    for (const o of out) {
      o.companyName = nameMap.get(o.symbol) ?? null;
      o.companyNameKo = koMap.get(o.symbol) ?? null;
    }
    // keep only the requested market: 'kr' = KR-coded tickers; 'us' = everything else
    // (US tickers + bare cashtags not in the table).
    const inMarket = (sym: string) => (market === "kr" ? marketMap.get(sym) === "kr" : marketMap.get(sym) !== "kr");

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

    // rank by distinct accounts first (de-spammed: one account can't inflate a symbol by
    // posting repeatedly), then by raw mention count as a tiebreak.
    return out
      .filter((o) => o.recentAccounts >= minAccounts && o.recentMentions > 0 && inMarket(o.symbol))
      .sort((a, b) => b.recentAccounts - a.recentAccounts || b.recentMentions - a.recentMentions);
  }

  // Sector treemap for discovery: group window mentions by 업종/sector. Tiles sized by
  // recentMentions, colored by changePercent (recent vs prior window). Each tile carries its
  // member stocks (sorted newly-rising first) so the client can drill down without another call.
  async sectorMap(windowHours: number, market = "us"): Promise<SectorMapRow[]> {
    const now = Date.now();
    const winMs = windowHours * 3600 * 1000;
    const recentStart = now - winMs;
    const priorStart = now - 2 * winMs;
    // KR = tickers.market 'kr'; US = everything else (incl. bare cashtags absent from tickers).
    const marketCond = market === "kr"
      ? sql`t.market = 'kr'`
      : sql`(t.market IS DISTINCT FROM 'kr')`;

    // Per-symbol recent/prior counts within the prior+recent window, joined to sector + names.
    const rows = (await db.execute(sql`
      SELECT m.symbol AS symbol,
             COALESCE(ts.sector, '기타') AS sector,
             t.company_name AS "nameEn",
             t.company_name_ko AS "nameKo",
             SUM(CASE WHEN m.tweeted_at >= ${recentStart} THEN 1 ELSE 0 END) AS "recentMentions",
             COUNT(DISTINCT CASE WHEN m.tweeted_at >= ${recentStart} THEN m.account_id END) AS "recentAccounts",
             SUM(CASE WHEN m.tweeted_at >= ${priorStart} AND m.tweeted_at < ${recentStart} THEN 1 ELSE 0 END) AS "priorMentions"
      FROM mentions m
      LEFT JOIN tickers t ON t.symbol = m.symbol
      LEFT JOIN ticker_sectors ts ON ts.symbol = m.symbol
      WHERE m.tweeted_at >= ${priorStart} AND ${marketCond}
      GROUP BY m.symbol, ts.sector, t.company_name, t.company_name_ko
    `)) as unknown as any[];

    // Distinct (sector, account) pairs in the recent window. We normalize the raw sector in JS
    // and count distinct accounts per *normalized* sector (can't be summed — accounts overlap).
    const acctRows = (await db.execute(sql`
      SELECT COALESCE(ts.sector, '기타') AS sector, m.account_id AS "accountId"
      FROM mentions m
      LEFT JOIN tickers t ON t.symbol = m.symbol
      LEFT JOIN ticker_sectors ts ON ts.symbol = m.symbol
      WHERE m.tweeted_at >= ${recentStart} AND ${marketCond}
      GROUP BY ts.sector, m.account_id
    `)) as unknown as any[];
    const acctSet = new Map<string, Set<number>>();
    for (const r of acctRows) {
      const key = normalizeSector(r.sector, market);
      let set = acctSet.get(key);
      if (!set) { set = new Set(); acctSet.set(key, set); }
      set.add(Number(r.accountId));
    }

    const bySector = new Map<string, SectorMapRow>();
    for (const r of rows) {
      const recent = Number(r.recentMentions) || 0;
      if (recent === 0) continue; // only sectors active in the recent window
      const prior = Number(r.priorMentions) || 0;
      const sector = normalizeSector(r.sector, market);
      let s = bySector.get(sector);
      if (!s) {
        s = { sector, recentMentions: 0, recentAccounts: acctSet.get(sector)?.size ?? 0, priorMentions: 0, changePercent: 0, stocks: [] };
        bySector.set(sector, s);
      }
      s.recentMentions += recent;
      s.priorMentions += prior;
      s.stocks.push({
        symbol: r.symbol,
        nameKo: r.nameKo ?? null,
        nameEn: r.nameEn ?? null,
        recentMentions: recent,
        recentAccounts: Number(r.recentAccounts) || 0,
        changePercent: Math.round(((recent + 1) / (prior + 1) - 1) * 100),
      });
    }

    const out = [...bySector.values()];
    for (const s of out) {
      s.changePercent = Math.round(((s.recentMentions + 1) / (s.priorMentions + 1) - 1) * 100);
      // drill-down surfaces newly-rising names first: by jump, then by breadth/volume.
      s.stocks.sort((a, b) => b.changePercent - a.changePercent || b.recentAccounts - a.recentAccounts || b.recentMentions - a.recentMentions);
    }
    // biggest tiles first (size = recentMentions).
    return out.sort((a, b) => b.recentMentions - a.recentMentions);
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

  async distinctMentionedSymbols() {
    const r = await db.selectDistinct({ symbol: mentions.symbol }).from(mentions);
    return r.map((x) => x.symbol);
  }

  // --- Insider trading (Form 4) ---
  async upsertInsider(i: InsertInsider): Promise<number> {
    const r = await db.insert(insiders).values(i)
      .onConflictDoUpdate({ target: insiders.slug, set: { name: i.name } }).returning();
    return r[0].id;
  }
  async insertInsiderTradeIfNew(t: InsertInsiderTrade): Promise<boolean> {
    const r = await db.insert(insiderTrades).values(t)
      .onConflictDoNothing({ target: insiderTrades.externalId }).returning();
    return r.length > 0;
  }
  async clearInsiderData() {
    await db.delete(insiderTrades);
    await db.delete(insiders);
  }

  // 종목 랭킹 — 서버측 GROUP BY 집계 (볼륨 커서 클라 전량 전송 회피)
  async insiderRanking(opts: { fromMs?: number; toMs?: number }): Promise<InsiderRankRow[]> {
    const from = opts.fromMs ?? 0;
    const to = opts.toMs ?? Number.MAX_SAFE_INTEGER;
    const rows = (await db.execute(sql`
      SELECT it.symbol AS symbol,
             t.company_name AS company,
             ts.sector AS sector,
             SUM(CASE WHEN it.side='buy'  THEN COALESCE(it.value,0) ELSE 0 END) AS "buyValue",
             SUM(CASE WHEN it.side='sell' THEN COALESCE(it.value,0) ELSE 0 END) AS "sellValue",
             SUM(CASE WHEN it.side='buy'  THEN 1 ELSE 0 END) AS "buyCount",
             SUM(CASE WHEN it.side='sell' THEN 1 ELSE 0 END) AS "sellCount",
             COUNT(DISTINCT it.insider_id) AS "insiderCount",
             COUNT(*) AS "tradeCount"
      FROM insider_trades it
      LEFT JOIN tickers t ON t.symbol = it.symbol
      LEFT JOIN ticker_sectors ts ON ts.symbol = it.symbol
      WHERE it.txn_date >= ${from} AND it.txn_date <= ${to}
      GROUP BY it.symbol, t.company_name, ts.sector
    `)) as unknown as any[];
    return rows.map((r) => {
      const buyValue = Number(r.buyValue) || 0, sellValue = Number(r.sellValue) || 0;
      return {
        symbol: r.symbol, company: r.company ?? null, sector: r.sector ?? null,
        buyValue, sellValue, netValue: buyValue - sellValue,
        buyCount: Number(r.buyCount) || 0, sellCount: Number(r.sellCount) || 0,
        insiderCount: Number(r.insiderCount) || 0, tradeCount: Number(r.tradeCount) || 0,
      };
    });
  }

  private async joinedInsiderTrades(where: any, limit?: number): Promise<InsiderTradeRow[]> {
    const q = db.select({
      id: insiderTrades.id, insiderId: insiderTrades.insiderId,
      insiderName: insiders.name, insiderSlug: insiders.slug,
      symbol: insiderTrades.symbol, company: tickers.companyName,
      txnCode: insiderTrades.txnCode, side: insiderTrades.side,
      shares: insiderTrades.shares, price: insiderTrades.price, value: insiderTrades.value,
      txnDate: insiderTrades.txnDate, filedDate: insiderTrades.filedDate, role: insiderTrades.role,
    }).from(insiderTrades)
      .innerJoin(insiders, eq(insiderTrades.insiderId, insiders.id))
      .leftJoin(tickers, eq(tickers.symbol, insiderTrades.symbol))
      .where(where)
      .orderBy(desc(insiderTrades.txnDate));
    const rows = limit ? await q.limit(limit) : await q;
    return rows as InsiderTradeRow[];
  }
  async insiderTradesForSymbol(symbol: string, opts: { fromMs?: number; toMs?: number; limit?: number }) {
    const conds: any[] = [eq(insiderTrades.symbol, symbol.toUpperCase())];
    if (opts.fromMs != null) conds.push(gte(insiderTrades.txnDate, opts.fromMs));
    if (opts.toMs != null) conds.push(lte(insiderTrades.txnDate, opts.toMs));
    return this.joinedInsiderTrades(and(...conds), opts.limit ?? 300);
  }
  async insiderTradesForInsider(slug: string, opts: { fromMs?: number; toMs?: number }) {
    const ins = (await db.select().from(insiders).where(eq(insiders.slug, slug)).limit(1))[0];
    if (!ins) return [];
    const conds: any[] = [eq(insiderTrades.insiderId, ins.id)];
    if (opts.fromMs != null) conds.push(gte(insiderTrades.txnDate, opts.fromMs));
    if (opts.toMs != null) conds.push(lte(insiderTrades.txnDate, opts.toMs));
    return this.joinedInsiderTrades(and(...conds));
  }
  async distinctInsiderSymbols() {
    const r = await db.selectDistinct({ symbol: insiderTrades.symbol }).from(insiderTrades);
    return r.map((x) => x.symbol);
  }
  // 직책 보강용 — role 없는 (insider, symbol) 쌍 + 샘플 external_id(accession 포함) + 이름
  async insiderPairsNeedingRole(): Promise<{ insiderId: number; symbol: string; name: string; externalId: string | null }[]> {
    const rows = (await db.execute(sql`
      SELECT DISTINCT ON (it.insider_id, it.symbol)
             it.insider_id AS "insiderId", it.symbol AS symbol, i.name AS name, it.external_id AS "externalId"
      FROM insider_trades it JOIN insiders i ON i.id = it.insider_id
      WHERE it.role IS NULL
    `)) as unknown as any[];
    return rows.map((r) => ({ insiderId: Number(r.insiderId), symbol: r.symbol, name: r.name, externalId: r.externalId }));
  }
  async setInsiderRole(insiderId: number, symbol: string, role: string | null) {
    await db.update(insiderTrades).set({ role }).where(and(eq(insiderTrades.insiderId, insiderId), eq(insiderTrades.symbol, symbol)));
  }
}

export const storage = new DatabaseStorage();
