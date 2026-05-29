import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// --- Tracked X (Twitter) accounts ---
export const accounts = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  handle: text("handle").notNull().unique(), // without @, lowercase
  displayName: text("display_name"),
  note: text("note"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  // Cursor for incremental collection: highest tweet id (as string) we've stored.
  lastTweetId: text("last_tweet_id"),
  lastSyncedAt: integer("last_synced_at"), // unix ms
  createdAt: integer("created_at").notNull(),
});

// --- Collected tweets (deduped on tweetId) ---
export const tweets = sqliteTable(
  "tweets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tweetId: text("tweet_id").notNull().unique(), // X status id — dedup key
    accountId: integer("account_id").notNull(),
    handle: text("handle").notNull(),
    text: text("text").notNull(),
    url: text("url"),
    lang: text("lang"),
    isReply: integer("is_reply", { mode: "boolean" }).notNull().default(false),
    isRetweet: integer("is_retweet", { mode: "boolean" }).notNull().default(false),
    likeCount: integer("like_count").notNull().default(0),
    retweetCount: integer("retweet_count").notNull().default(0),
    replyCount: integer("reply_count").notNull().default(0),
    viewCount: integer("view_count").notNull().default(0),
    tweetedAt: integer("tweeted_at").notNull(), // unix ms of the tweet
    collectedAt: integer("collected_at").notNull(), // unix ms when we stored it
  },
  (t) => ({
    byAccount: index("idx_tweets_account").on(t.accountId),
    byTweetedAt: index("idx_tweets_tweeted_at").on(t.tweetedAt),
  })
);

// --- Known ticker metadata (for company-name / alias matching) ---
export const tickers = sqliteTable("tickers", {
  symbol: text("symbol").primaryKey(), // uppercase, e.g. AAPL
  companyName: text("company_name"),
  // JSON array of lowercase aliases / company-name variants used for secondary matching
  aliases: text("aliases").notNull().default("[]"),
  exchange: text("exchange"),
});

// --- Extracted ticker mentions (one row per ticker per tweet) ---
export const mentions = sqliteTable(
  "mentions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tweetId: text("tweet_id").notNull(), // FK -> tweets.tweetId
    symbol: text("symbol").notNull(), // uppercase ticker
    accountId: integer("account_id").notNull(),
    handle: text("handle").notNull(),
    // 'cashtag' ($AAPL) or 'name' (company name / alias match)
    source: text("source").notNull().default("cashtag"),
    tweetedAt: integer("tweeted_at").notNull(), // unix ms (denormalized for fast surge queries)
  },
  (t) => ({
    bySymbol: index("idx_mentions_symbol").on(t.symbol),
    byTweetedAt: index("idx_mentions_tweeted_at").on(t.tweetedAt),
    // A given tweet should only count once per symbol per source
    uniqPerTweet: uniqueIndex("uniq_mention").on(t.tweetId, t.symbol, t.source),
  })
);

// --- Sync run logs (retry / empty-result / error tracking) ---
export const syncLogs = sqliteTable("sync_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  startedAt: integer("started_at").notNull(),
  finishedAt: integer("finished_at"),
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
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value"),
});

// ---------- Insert schemas & types ----------
export const insertAccountSchema = createInsertSchema(accounts)
  .pick({ handle: true, displayName: true, note: true, active: true })
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

// keep template auth table so existing template code compiles
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});
export const insertUserSchema = createInsertSchema(users).pick({ username: true, password: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
