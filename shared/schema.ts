import { pgTable, text, integer, serial, bigint, boolean, real, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// --- Tracked social accounts (X / Threads) ---
export const accounts = pgTable("accounts", {
  id: serial("id").primaryKey(),
  handle: text("handle").notNull().unique(), // without @, lowercase
  displayName: text("display_name"),
  note: text("note"),
  platform: text("platform").notNull().default("x"), // 'x' | 'threads' — which network this handle is on
  active: boolean("active").notNull().default(true),
  // Cursor for incremental collection: highest tweet id (as string) we've stored.
  lastTweetId: text("last_tweet_id"),
  lastSyncedAt: bigint("last_synced_at", { mode: "number" }), // unix ms
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// --- Collected tweets (deduped on tweetId) ---
export const tweets = pgTable(
  "tweets",
  {
    id: serial("id").primaryKey(),
    tweetId: text("tweet_id").notNull().unique(), // post id — dedup key (X status id, or "th_<threadsPostId>")
    accountId: integer("account_id").notNull(),
    handle: text("handle").notNull(),
    platform: text("platform").notNull().default("x"), // 'x' | 'threads' — source network
    text: text("text").notNull(),
    url: text("url"),
    lang: text("lang"),
    isReply: boolean("is_reply").notNull().default(false),
    isRetweet: boolean("is_retweet").notNull().default(false),
    likeCount: integer("like_count").notNull().default(0),
    retweetCount: integer("retweet_count").notNull().default(0),
    replyCount: integer("reply_count").notNull().default(0),
    viewCount: integer("view_count").notNull().default(0),
    tweetedAt: bigint("tweeted_at", { mode: "number" }).notNull(), // unix ms of the tweet
    collectedAt: bigint("collected_at", { mode: "number" }).notNull(), // unix ms when we stored it
  },
  (t) => ({
    byAccount: index("idx_tweets_account").on(t.accountId),
    byTweetedAt: index("idx_tweets_tweeted_at").on(t.tweetedAt),
  })
);

// --- Known ticker metadata (for company-name / alias matching) ---
export const tickers = pgTable("tickers", {
  symbol: text("symbol").primaryKey(), // US ticker (AAPL) or KR 6-digit code (005930)
  companyName: text("company_name"),
  companyNameKo: text("company_name_ko"), // Korean display name (shown first in 종목 발견)
  market: text("market").notNull().default("us"), // 'us' | 'kr' — which market (toggle in 종목 발견)
  // JSON array of lowercase aliases / company-name variants used for secondary matching
  aliases: text("aliases").notNull().default("[]"),
  exchange: text("exchange"),
});

// --- Extracted ticker mentions (one row per ticker per tweet) ---
export const mentions = pgTable(
  "mentions",
  {
    id: serial("id").primaryKey(),
    tweetId: text("tweet_id").notNull(), // FK -> tweets.tweetId
    symbol: text("symbol").notNull(), // uppercase ticker
    accountId: integer("account_id").notNull(),
    handle: text("handle").notNull(),
    // 'cashtag' ($AAPL) or 'name' (company name / alias match)
    source: text("source").notNull().default("cashtag"),
    tweetedAt: bigint("tweeted_at", { mode: "number" }).notNull(), // unix ms (denormalized for fast surge queries)
  },
  (t) => ({
    bySymbol: index("idx_mentions_symbol").on(t.symbol),
    byTweetedAt: index("idx_mentions_tweeted_at").on(t.tweetedAt),
    // A given tweet should only count once per symbol per source
    uniqPerTweet: uniqueIndex("uniq_mention").on(t.tweetId, t.symbol, t.source),
  })
);

// --- Sync run logs (retry / empty-result / error tracking) ---
export const syncLogs = pgTable("sync_logs", {
  id: serial("id").primaryKey(),
  startedAt: bigint("started_at", { mode: "number" }).notNull(),
  finishedAt: bigint("finished_at", { mode: "number" }),
  status: text("status").notNull(), // running | success | partial | failed
  handlesRequested: integer("handles_requested").notNull().default(0),
  tweetsFetched: integer("tweets_fetched").notNull().default(0),
  tweetsNew: integer("tweets_new").notNull().default(0),
  mentionsNew: integer("mentions_new").notNull().default(0),
  attempts: integer("attempts").notNull().default(1),
  runId: text("run_id"), // Apify run id
  datasetId: text("dataset_id"), // Apify dataset id
  error: text("error"),
});

// --- Simple key/value settings (apify token, actor id, thresholds) ---
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value"),
});

// --- 국내주식 관심종목등록 상위: 일별 스냅샷 (KIS Open API, FHPST01800000) ---
// 맵/랭킹(SNS 발굴)과는 별개의 보조 신호 — retail이 관심종목으로 등록한 상위 종목.
// 하루 한 번 스냅샷을 쌓아, 등록 건수(reg_count) 추이로 인기 상승/하락을 본다.
export const interestSnapshots = pgTable(
  "interest_snapshots",
  {
    id: serial("id").primaryKey(),
    date: text("date").notNull(),                        // 'YYYY-MM-DD' (KST) — 스냅샷 날짜
    symbol: text("symbol").notNull(),                    // 6자리 종목코드
    name: text("name"),                                  // 한글 종목명
    rank: integer("rank").notNull(),                     // data_rank (관심등록 순위)
    regCount: integer("reg_count").notNull().default(0), // inter_issu_reg_csnu (관심 종목 등록 건수)
    price: integer("price"),                             // stck_prpr (현재가)
    changePct: real("change_pct"),                       // prdy_ctrt (전일 대비율)
    collectedAt: bigint("collected_at", { mode: "number" }).notNull(),
  },
  (t) => ({
    byDate: index("idx_interest_date").on(t.date),
    uniqPerDay: uniqueIndex("uniq_interest").on(t.date, t.symbol), // re-run같은 날 = upsert
  })
);

// ---------- Insert schemas & types ----------
export const insertAccountSchema = createInsertSchema(accounts)
  .pick({ handle: true, displayName: true, note: true, active: true, platform: true })
  .extend({
    handle: z
      .string()
      .min(1)
      .transform((h) => h.replace(/^@/, "").trim().toLowerCase()),
  });
export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Account = typeof accounts.$inferSelect;

export const insertTweetSchema = createInsertSchema(tweets).omit({ id: true });
export type InsertTweet = z.infer<typeof insertTweetSchema>;
export type Tweet = typeof tweets.$inferSelect;

export const insertTickerSchema = createInsertSchema(tickers);
export type InsertTicker = z.infer<typeof insertTickerSchema>;
export type Ticker = typeof tickers.$inferSelect;

export const insertMentionSchema = createInsertSchema(mentions).omit({ id: true });
export type InsertMention = z.infer<typeof insertMentionSchema>;
export type Mention = typeof mentions.$inferSelect;

export type SyncLog = typeof syncLogs.$inferSelect;
export type Setting = typeof settings.$inferSelect;
export type InterestSnapshot = typeof interestSnapshots.$inferSelect;

// keep template auth table so existing template code compiles
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});
export const insertUserSchema = createInsertSchema(users).pick({ username: true, password: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// ============================================================================
// Congress / Politician trading (STOCK Act periodic transaction reports)
// 공유 `tickers` 사전을 그대로 쓰고, 정치인 도메인은 별도 테이블로 추가한다.
// 내부자거래도 동일 패턴(insiders + insider_trades)으로 나중에 붙일 수 있다.
// ============================================================================

// --- Members of Congress (the "actor") ---
export const politicians = pgTable(
  "politicians",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull().unique(), // stable key, e.g. "tuberville"
    name: text("name").notNull(),
    party: text("party"), // D | R | I
    chamber: text("chamber").notNull(), // senate | house
    state: text("state"),
    bioguideId: text("bioguide_id"), // official Bioguide id (joins to committee sources)
    createdAt: bigint("created_at", { mode: "number" }).notNull(), // unix ms
  },
  (t) => ({ byChamber: index("idx_pol_chamber").on(t.chamber) })
);

// --- Committees (chamber-specific) ---
export const committees = pgTable("committees", {
  id: text("id").primaryKey(), // e.g. "senate-armed"
  ko: text("ko").notNull(), // 한글명
  name: text("name").notNull(), // English name
  chamber: text("chamber").notNull(), // senate | house
});

// --- Politician ↔ Committee (many-to-many) ---
export const politicianCommittees = pgTable(
  "politician_committees",
  {
    politicianId: integer("politician_id").notNull(),
    committeeId: text("committee_id").notNull(),
  },
  (t) => ({
    uniq: uniqueIndex("uniq_pol_cmt").on(t.politicianId, t.committeeId),
    byCommittee: index("idx_polcmt_cmt").on(t.committeeId),
  })
);

// --- Disclosed trades (one row per PTR transaction line) ---
export const politicalTrades = pgTable(
  "political_trades",
  {
    id: serial("id").primaryKey(),
    politicianId: integer("politician_id").notNull(),
    symbol: text("symbol").notNull(), // uppercase ticker (FK -> tickers.symbol)
    company: text("company"),
    side: text("side").notNull(), // buy | sell | exchange
    // STOCK Act discloses amount RANGES, not exact values.
    amountLow: bigint("amount_low", { mode: "number" }),
    amountHigh: bigint("amount_high", { mode: "number" }),
    txnDate: bigint("txn_date", { mode: "number" }).notNull(), // unix ms — transaction date
    filedDate: bigint("filed_date", { mode: "number" }), // unix ms — disclosure date
    source: text("source").notNull().default("fmp"), // fmp | house | senate
    // hybrid verification status (see reconcile pipeline)
    verification: text("verification").notNull().default("pending_official"), // confirmed | discrepancy | pending_official | official_only
    externalId: text("external_id"), // source-side dedup key
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => ({
    bySymbol: index("idx_ptrade_symbol").on(t.symbol),
    byPolitician: index("idx_ptrade_pol").on(t.politicianId),
    byTxnDate: index("idx_ptrade_txn").on(t.txnDate),
    uniqExternal: uniqueIndex("uniq_ptrade_ext").on(t.externalId),
  })
);

export const insertPoliticianSchema = createInsertSchema(politicians).omit({ id: true });
export type InsertPolitician = z.infer<typeof insertPoliticianSchema>;
export type Politician = typeof politicians.$inferSelect;

export type Committee = typeof committees.$inferSelect;
export type PoliticianCommittee = typeof politicianCommittees.$inferSelect;

export const insertPoliticalTradeSchema = createInsertSchema(politicalTrades).omit({ id: true });
export type InsertPoliticalTrade = z.infer<typeof insertPoliticalTradeSchema>;
export type PoliticalTrade = typeof politicalTrades.$inferSelect;

// --- Ticker → sector/industry (별도 테이블: 공유 tickers 스키마 비침습) ---
export const tickerSectors = pgTable("ticker_sectors", {
  symbol: text("symbol").primaryKey(), // uppercase
  sector: text("sector"), // 원천 산업/섹터 문자열(영문). 표시 라벨은 클라이언트에서 한글 매핑
});
export type TickerSector = typeof tickerSectors.$inferSelect;

// ============================================================================
// Insider trading (SEC Form 4) — 정치인 도메인과 같은 패턴(actor → 거래).
// 공유 tickers / ticker_sectors 재사용. 볼륨이 커서 랭킹은 서버측 집계.
// ============================================================================
export const insiders = pgTable("insiders", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(), // 이름 기반 안정 키
  name: text("name").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const insiderTrades = pgTable(
  "insider_trades",
  {
    id: serial("id").primaryKey(),
    insiderId: integer("insider_id").notNull(),
    symbol: text("symbol").notNull(),
    txnCode: text("txn_code"), // Form4 코드: P/S/A/M/F/G/C/J ...
    side: text("side").notNull(), // buy | sell | award | exercise | tax | gift | conversion | other
    shares: bigint("shares", { mode: "number" }), // 거래 수량(절대값)
    price: real("price"), // 거래 단가(USD), grant 등은 0
    value: bigint("value", { mode: "number" }), // round(shares * price)
    txnDate: bigint("txn_date", { mode: "number" }).notNull(), // unix ms
    filedDate: bigint("filed_date", { mode: "number" }),
    role: text("role"), // 직책 (SEC EDGAR Form 4 enrich): CEO/CFO/Director/10% Owner/Officer ...
    externalId: text("external_id"), // dedup
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => ({
    bySymbol: index("idx_itrade_symbol").on(t.symbol),
    byInsider: index("idx_itrade_insider").on(t.insiderId),
    byTxnDate: index("idx_itrade_txn").on(t.txnDate),
    uniqExt: uniqueIndex("uniq_itrade_ext").on(t.externalId),
  })
);

export const insertInsiderSchema = createInsertSchema(insiders).omit({ id: true });
export type InsertInsider = z.infer<typeof insertInsiderSchema>;
export type Insider = typeof insiders.$inferSelect;
export const insertInsiderTradeSchema = createInsertSchema(insiderTrades).omit({ id: true });
export type InsertInsiderTrade = z.infer<typeof insertInsiderTradeSchema>;
export type InsiderTrade = typeof insiderTrades.$inferSelect;
