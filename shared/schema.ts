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

// --- 종목 "왜 뜨나" 뉴스 레포트 (Gemini + Google Search 그라운딩, 종목당 최신 1건) ---
export const reports = pgTable("reports", {
  symbol: text("symbol").primaryKey(),
  summary: text("summary").notNull(),              // 한 줄 요약 + 🔺호재 / 🔻악재 (마크다운)
  sources: text("sources").notNull().default("[]"), // JSON [{title, url}] — 그라운딩 출처
  model: text("model"),
  generatedAt: bigint("generated_at", { mode: "number" }).notNull(),
});
export type Report = typeof reports.$inferSelect;

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
    // #26: FK + ON DELETE RESTRICT — insiders 행이 거래를 남긴 채 사라지면(과거 db:push 재생성) orphan 발생.
    //   운영엔 script/db-fk-insider.ts 로 NOT VALID 추가(기존 GOOG 교차티커 orphan 때문). 이 선언은 진실 기록용 —
    //   drizzle-kit push 는 공유 DB 금지(db-push-guard 참고)라 자동 적용 경로 아님.
    insiderId: integer("insider_id").notNull().references(() => insiders.id, { onDelete: "restrict" }),
    symbol: text("symbol").notNull(),
    txnCode: text("txn_code"), // Form4 코드: P/S/A/M/F/G/C/J ...
    side: text("side").notNull(), // buy | sell | award | exercise | tax | gift | conversion | other
    shares: bigint("shares", { mode: "number" }), // 거래 수량(절대값)
    sharesAfter: bigint("shares_after", { mode: "number" }), // 거래 직후 보유량(Form4 sharesOwnedFollowingTransaction = Finnhub share) — 보유대비% 계산용
    price: real("price"), // 거래 단가(USD), grant 등은 0
    value: bigint("value", { mode: "number" }), // round(shares * price)
    txnDate: bigint("txn_date", { mode: "number" }).notNull(), // unix ms
    filedDate: bigint("filed_date", { mode: "number" }),
    role: text("role"), // 직책 (SEC EDGAR Form 4 enrich): CEO/CFO/Director/10% Owner/Officer ...
    plan10b5: boolean("plan10b5"), // Form4 <aff10b5One>: true=10b5-1 정기플랜(노이즈) / false=재량적 매도(시그널) / null=미확인
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

// ============================================================================
// 자본주의 경제사 타임라인 (US Capitalism Economic History)
// 완전 격리된 새 도메인 — 기존 테이블/라우트 비침습. 사용자가 직접 큐레이팅하는
// 인과 플로우(마인드맵형) 블록·분기와, 전구간 FRED 거시지표를 담는다.
// 모든 테이블 prefix = `cap_` 로 네임스페이스 분리.
// ============================================================================

// --- 하나의 사건 = 하나의 인과 플로우(세로 스택 또는 분기/합류) ---
export const capFlows = pgTable(
  "cap_flows",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull().unique(), // 안정 키 (nixon, oilshock ...)
    date: text("date").notNull(),          // 'YYYY-MM-DD' (시작일 또는 단일 시점)
    endDate: text("end_date"),             // nullable: 있으면 기간 이벤트(date~endDate), 없으면 단일 시점
    year: integer("year").notNull(),
    title: text("title").notNull(),
    category: text("category").notNull().default("경제"), // 정치 | 경제 | 사회
    layout: text("layout").notNull().default("stack"),   // stack | branch
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => ({ byYear: index("idx_cap_flows_year").on(t.year) })
);

// --- 플로우 안의 블록(노드): 원인/사건/영향/결과 ---
export const capNodes = pgTable(
  "cap_nodes",
  {
    id: serial("id").primaryKey(),
    flowId: integer("flow_id").notNull().references(() => capFlows.id, { onDelete: "cascade" }),
    nodeKey: text("node_key").notNull(),   // 플로우 내 고유 키 (n1, oA1 ...) — edge 연결용
    kind: text("kind").notNull().default("effect"), // cause | event | effect | result
    inLabel: text("in_label"),             // 블록 위 라벨(배경/사건/영향/결과 등). 빈 문자열 허용
    text: text("text").notNull(),
    ref: text("ref"),                      // 참고 메모/출처 (없으면 null)
    col: text("col"),                      // branch 레이아웃: center | left | right
    tableData: text("table_data"),         // nullable JSON: 노드별 표(열 너비 + 셀 텍스트). 메모(ref)와 같은 층위.
    pos: integer("pos").notNull().default(0), // 표시 순서
  },
  (t) => ({
    byFlow: index("idx_cap_nodes_flow").on(t.flowId),
    uniqKey: uniqueIndex("uniq_cap_node").on(t.flowId, t.nodeKey),
  })
);

// --- 블록 간 화살표(엣지) ---
export const capEdges = pgTable(
  "cap_edges",
  {
    id: serial("id").primaryKey(),
    flowId: integer("flow_id").notNull().references(() => capFlows.id, { onDelete: "cascade" }),
    fromKey: text("from_key").notNull(),   // capNodes.nodeKey
    toKey: text("to_key").notNull(),
  },
  (t) => ({ byFlow: index("idx_cap_edges_flow").on(t.flowId) })
);

// --- 보드 전역 사용자 화살표(카드 내/간 모두) ---
// cap_edges 와 달리 flow_id 에 묶이지 않고, 노드를 (slug, node_key) 로 전역 식별한다.
// 따라서 카드 경계를 넘는 드래그앤드롭 연결을 저장할 수 있다.
export const capLinks = pgTable(
  "cap_links",
  {
    id: serial("id").primaryKey(),
    fromSlug: text("from_slug").notNull(),
    fromKey: text("from_key").notNull(),
    toSlug: text("to_slug").notNull(),
    toKey: text("to_key").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => ({
    uniqLink: uniqueIndex("uniq_cap_link").on(t.fromSlug, t.fromKey, t.toSlug, t.toKey),
  })
);

export const insertCapFlowSchema = createInsertSchema(capFlows).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCapFlow = z.infer<typeof insertCapFlowSchema>;
export type CapFlow = typeof capFlows.$inferSelect;
export type CapNode = typeof capNodes.$inferSelect;
export type CapEdge = typeof capEdges.$inferSelect;
export type CapLink = typeof capLinks.$inferSelect;
