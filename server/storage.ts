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
  // 세션 풀러 한도(pool_size 15)를 넘지 않게 연결 수를 작게 잡고, 유휴 연결은 빨리 닫는다
  // (Vercel 서버리스/로컬 미리보기 재시작 시 연결 누수 방지).
  const client = postgres(connectionString, { prepare: false, max: 3, idle_timeout: 20 });
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
  insiderCount: number; // 매수·매도(P·S) 한 인사이더 수
  otherInsiderCount: number; // 보상·옵션행사·세금 등만 한 인사이더 수(신호 아님)
  tradeCount: number; // 매수·매도 거래 건수
  signalScore: number; // 6레버 유의미도 점수(클러스터와 동일 엔진, 단독 포함). 하단 랭킹 정렬용.
  signalSide: "buy" | "sell" | null; // 유의미도를 주도한 방향
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
  plan10b5: boolean | null; // true=10b5-1 정기플랜(노이즈) / false=재량적(시그널) / null=미확인
}
// 클러스터 시그널 — 같은 윈도우에 여러 인사이더가 같은 방향
export interface ClusterParticipant {
  slug: string; name: string; role: string | null; value: number; trades: number;
  qty: number; sharesAfter: number | null; pctOfHoldings: number | null; // 보유 대비 거래 비중(0~1+) — 절대액보다 핵심
}
export interface InsiderCluster {
  symbol: string; company: string | null; sector: string | null;
  side: "buy" | "sell"; insiderCount: number; tradeCount: number; totalValue: number;
  windowFromMs: number; windowToMs: number; spanDays: number;
  participants: ClusterParticipant[]; score: number;
  thin: boolean;  // n=2 (합의 증거 약함, ×0.65 페널티)
  gated: boolean; // post=0 ≥3명 (구조적 일괄청산 의심, ×0.5 게이트)
}

// 직책 → 시그널 티어 가중(정보 접근도). 클라이언트 classifyRole 의 우선순위와 동일.
//   T1 CEO·회장/CFO=1.0 · 대주주=0.9 · T2 운영(COO/CTO/President)=0.7 · T3 기능=0.4 · T4 이사=0.25 · 미확인=0.3
function roleSignalWeight(role: string | null): number {
  if (!role) return 0.3;
  const r = role;
  const owner = /10\s*%/.test(r);
  if (/see\s*remarks/i.test(r)) return Math.max(0.3, owner ? 0.9 : 0);
  let w = 0.3;
  if (/\bceo\b/i.test(r) || /chief executive/i.test(r) || /chair(man|person|woman)?\b/i.test(r) || /\bcfo\b/i.test(r) || /chief financial/i.test(r)) w = 1.0;
  else if (/\bcoo\b/i.test(r) || /chief operating/i.test(r) || /\bcto\b/i.test(r) || /chief technology/i.test(r) || (/\bpresident\b/i.test(r) && !/vice[\s-]*president/i.test(r))) w = 0.7;
  else if (/\bclo\b/i.test(r) || /chief legal/i.test(r) || /general counsel/i.test(r) || /\bcounsel\b/i.test(r) || /\bcao\b/i.test(r) || /\bpao\b/i.test(r) || /chief accounting/i.test(r) || /controller/i.test(r) || /\bchro\b/i.test(r) || /\bcmo\b/i.test(r) || /chief\s+[\w\s]+officer/i.test(r) || /\b(?:e|s)?vp\b/i.test(r) || /vice\s*president/i.test(r) || /\bofficer\b/i.test(r)) w = 0.4;
  else if (/\bdirector\b/i.test(r)) w = 0.25;
  return Math.max(w, owner ? 0.9 : 0); // 대주주는 최소 0.9 (창업자·VC·행동주의)
}
// 보유 대비 거래 비중 = qty / 거래직전 보유(pre). pre = 매수 ? after-qty : after+qty.
function holdingsPct(side: string, qty: number, sharesAfter: number | null): number | null {
  if (sharesAfter == null || qty <= 0) return null;
  if (side === "buy") {
    const pre = sharesAfter - qty;
    if (pre < 0) return null;   // qty>post = 데이터 이상(외국발행사 post-holdings 깨짐) → 중립(강함 아님)
    if (pre === 0) return 1.0;  // 순수 신규 포지션 = 강한 컨빅션
    return qty / pre;
  }
  // 매도: pre = post + qty (항상 ≥ qty > 0). post=0 이면 전량청산(ratio=100%).
  return qty / (sharesAfter + qty);
}
// 보유% → 배율: >50%=1.5 · 10~50%=1.0 · <10%=0.5 · 데이터없음=1.0(중립). "비정상 규모"의 진짜 의미.
function holdingsMultiplier(pct: number | null): number {
  if (pct == null) return 1.0;
  return pct > 0.5 ? 1.5 : pct >= 0.1 ? 1.0 : 0.5;
}
const isTenPctOwner = (role: string | null) => role != null && /10\s*%/.test(role);
// 참가자 1인의 시그널 기여 = 티어 가중 × 절대규모(로그=바닥필터) × 보유대비배율(진짜 가중).
//   클래스 캡: 10% Owner의 거의-전량 매도(≥80%)는 PE 블록 청산 패턴(컨빅션 아님) → 배율 최대 1.0(×1.5 금지).
//   매수·부분매도·저비중·비(非)10%Owner 는 캡 없음 — PE의 드문 진짜 베팅/추가매집은 안 죽임. 0이 아니라 '보통 매도' 수준으로 하향.
function participantSignal(p: ClusterParticipant, side: string, massPost0: boolean): number {
  let m = holdingsMultiplier(p.pctOfHoldings);
  const capped = side === "sell" && isTenPctOwner(p.role) && p.pctOfHoldings != null && p.pctOfHoldings >= 0.80;
  if (capped) m = Math.min(m, 1.0); // 클래스 캡: 10%Owner 거의-전량 매도(PE 블록청산)
  // post=0 동시성 게이트: 같은 윈도우 post=0 ≥3명 = 구조적 이벤트(외국발행사 일괄 정정·전환 등) → 그 건들 ×0.5.
  //   단독(1~2명) post=0 은 진짜 전량매도 경보라 유지. 캡 받은 건엔 중복 적용 안 함(상호배제).
  else if (side === "sell" && massPost0 && p.sharesAfter === 0) m *= 0.5;
  return roleSignalWeight(p.role) * (1 + Math.log10(1 + Math.abs(p.value) / 1e5)) * m;
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
    // med: 종목별 median 단가 → 비정상 단가(>$1M 또는 median 50배 초과)는 금액 0 처리(데이터 오류 가드)
    const rows = (await db.execute(sql`
      WITH med AS (
        SELECT symbol, percentile_cont(0.5) WITHIN GROUP (ORDER BY price) AS medp
        FROM insider_trades WHERE price > 0 GROUP BY symbol
      )
      SELECT it.symbol AS symbol,
             t.company_name AS company,
             ts.sector AS sector,
             SUM(CASE WHEN it.side='buy'  THEN (CASE WHEN it.price > 1000000 OR (m.medp IS NOT NULL AND it.price > 50*m.medp) THEN 0 ELSE COALESCE(it.value,0) END) ELSE 0 END) AS "buyValue",
             SUM(CASE WHEN it.side='sell' THEN (CASE WHEN it.price > 1000000 OR (m.medp IS NOT NULL AND it.price > 50*m.medp) THEN 0 ELSE COALESCE(it.value,0) END) ELSE 0 END) AS "sellValue",
             SUM(CASE WHEN it.side='buy'  THEN 1 ELSE 0 END) AS "buyCount",
             SUM(CASE WHEN it.side='sell' THEN 1 ELSE 0 END) AS "sellCount",
             COUNT(DISTINCT CASE WHEN it.side IN ('buy','sell') THEN it.insider_id END) AS "insiderCount",
             COUNT(DISTINCT it.insider_id)
               - COUNT(DISTINCT CASE WHEN it.side IN ('buy','sell') THEN it.insider_id END) AS "otherInsiderCount",
             SUM(CASE WHEN it.side IN ('buy','sell') THEN 1 ELSE 0 END) AS "tradeCount"
      FROM insider_trades it
      LEFT JOIN tickers t ON t.symbol = it.symbol
      LEFT JOIN ticker_sectors ts ON ts.symbol = it.symbol
      LEFT JOIN med m ON m.symbol = it.symbol
      WHERE it.txn_date >= ${from} AND it.txn_date <= ${to}
      GROUP BY it.symbol, t.company_name, ts.sector
      HAVING SUM(CASE WHEN it.side IN ('buy','sell') THEN 1 ELSE 0 END) > 0
    `)) as unknown as any[];
    // 유의미도 점수: 클러스터와 동일 엔진을 minInsiders=1(단독 포함)로 돌려 종목별 max 점수 산출.
    // → 하단 랭킹이 절대달러가 아니라 6레버(티어·보유%·10b5제외·√n·thin·캡·post0) 점수로 줄세워짐.
    const sigClusters = await this.insiderClusters({ fromMs: opts.fromMs, toMs: opts.toMs, minInsiders: 1, limit: 100000 });
    const sig = new Map<string, { score: number; side: "buy" | "sell" }>();
    for (const c of sigClusters) { const cur = sig.get(c.symbol); if (!cur || c.score > cur.score) sig.set(c.symbol, { score: c.score, side: c.side }); }

    return rows.map((r) => {
      const buyValue = Number(r.buyValue) || 0, sellValue = Number(r.sellValue) || 0;
      const s = sig.get(r.symbol);
      return {
        symbol: r.symbol, company: r.company ?? null, sector: r.sector ?? null,
        buyValue, sellValue, netValue: buyValue - sellValue,
        buyCount: Number(r.buyCount) || 0, sellCount: Number(r.sellCount) || 0,
        insiderCount: Number(r.insiderCount) || 0, otherInsiderCount: Number(r.otherInsiderCount) || 0,
        tradeCount: Number(r.tradeCount) || 0,
        signalScore: s?.score ?? 0, signalSide: s?.side ?? null,
      };
    });
  }

  // 클러스터 시그널 — 종목·방향별로 windowDays 안에서 가장 많은 서로 다른 인사이더가 모인 윈도우를 찾는다.
  //   매수 ≫ 매도(노이즈 많음), 10b5-1 플랜 매도는 제외. 점수 = 인사이더수 × 방향가중, 동률이면 금액.
  async insiderClusters(opts: { fromMs?: number; toMs?: number; windowDays?: number; minInsiders?: number; limit?: number }): Promise<InsiderCluster[]> {
    const from = opts.fromMs ?? 0;
    const to = opts.toMs ?? Number.MAX_SAFE_INTEGER;
    const windowMs = (opts.windowDays ?? 30) * 86400000;
    const minIns = opts.minInsiders ?? 2;
    const limit = opts.limit ?? 40;
    const rows = (await db.execute(sql`
      SELECT it.insider_id AS "insiderId", i.name AS name, i.slug AS slug, it.role AS role,
             it.symbol AS symbol, t.company_name AS company, ts.sector AS sector,
             it.side AS side, COALESCE(it.value, 0) AS value, it.price AS price,
             it.shares AS shares, it.shares_after AS "sharesAfter", it.txn_date AS "txnDate"
      FROM insider_trades it
      JOIN insiders i ON i.id = it.insider_id
      LEFT JOIN tickers t ON t.symbol = it.symbol
      LEFT JOIN ticker_sectors ts ON ts.symbol = it.symbol
      WHERE it.side IN ('buy','sell') AND it.txn_date >= ${from} AND it.txn_date <= ${to}
        AND NOT (it.side = 'sell' AND it.plan10b5 IS TRUE)
    `)) as unknown as any[];

    // 종목별 median 단가 → 비정상 단가(>$1M 또는 median의 50배 초과, 예: CRWV $117인데 $700k~$11M)는 금액 0 처리
    const pricesBySym = new Map<string, number[]>();
    for (const r of rows) { const p = Number(r.price); if (p > 0) { const a = pricesBySym.get(r.symbol); if (a) a.push(p); else pricesBySym.set(r.symbol, [p]); } }
    const medBySym = new Map<string, number>();
    for (const [s, a] of pricesBySym) { a.sort((x, y) => x - y); medBySym.set(s, a[Math.floor(a.length / 2)]); }
    const cleanValue = (r: any): number => {
      const p = Number(r.price); const med = medBySym.get(r.symbol);
      if (p > 1_000_000 || (med && p > 50 * med)) return 0;
      return Number(r.value) || 0;
    };

    const groups = new Map<string, any[]>();
    for (const r of rows) { const k = r.symbol + "|" + r.side; const g = groups.get(k); if (g) g.push(r); else groups.set(k, [r]); }

    const clusters: InsiderCluster[] = [];
    for (const [k, list] of groups) {
      list.sort((a, b) => Number(a.txnDate) - Number(b.txnDate));
      // 각 거래를 시작점으로 forward window 를 잡아 서로 다른 인사이더가 가장 많은 구간 선택
      let bestTrades: any[] = []; let bestSize = 0;
      for (let i = 0; i < list.length; i++) {
        const t0 = Number(list[i].txnDate); const set = new Set<number>(); const win: any[] = [];
        for (let j = i; j < list.length && Number(list[j].txnDate) - t0 <= windowMs; j++) { win.push(list[j]); set.add(Number(list[j].insiderId)); }
        if (set.size > bestSize) { bestSize = set.size; bestTrades = win; }
      }
      if (bestSize < minIns) continue;
      const side = k.endsWith("|buy") ? "buy" : "sell";
      // 인사이더별 합산 + 거래직후 보유량(최신 거래 기준) 추적
      const byIns = new Map<string, ClusterParticipant & { _lastDate: number }>();
      for (const t of bestTrades) {
        const e = byIns.get(t.slug) || { slug: t.slug, name: t.name, role: null, value: 0, trades: 0, qty: 0, sharesAfter: null, pctOfHoldings: null, _lastDate: -1 };
        e.value += cleanValue(t); e.trades++; e.qty += Math.abs(Number(t.shares) || 0);
        if (!e.role && t.role) e.role = t.role;
        const td = Number(t.txnDate);
        if (t.sharesAfter != null && td >= e._lastDate) { e.sharesAfter = Number(t.sharesAfter); e._lastDate = td; }
        byIns.set(t.slug, e);
      }
      if (byIns.size < minIns) continue;
      const r0 = bestTrades[0];
      const wFrom = Number(bestTrades[0].txnDate), wTo = Number(bestTrades[bestTrades.length - 1].txnDate);
      const participants: ClusterParticipant[] = [...byIns.values()].map(({ _lastDate, ...p }) => ({ ...p, pctOfHoldings: holdingsPct(side, p.qty, p.sharesAfter) }));
      const totalValue = participants.reduce((s, p) => s + p.value, 0);
      const insiderCount = participants.length;
      // 점수 = 방향(매수≫매도) × Σ(티어 × 절대규모로그 × 보유대비배율) / √n.
      //   /√n: breadth(인원수)는 플러스 요인이되 한계체감 — 29명이 5명의 6배가 아니라 ~2.4배. 규모처럼 한 항(인원)이 폭주 방지.
      const dir = side === "buy" ? 2 : 1;
      // 최소 인원 게이트: n=2는 '합의'의 통계적 증거가 약함(우연 vs 조율 구분 안 됨) → thin 페널티 ×0.65.
      //   고티어 2인(CEO+CFO 등)은 per-capita가 높아 살아남고, 저티어·SPV 2인은 가라앉음. n≥3이 정상 클러스터 바닥.
      const thin = insiderCount === 2;
      const massPost0 = participants.filter((p) => p.sharesAfter === 0).length >= 3; // 다수 동시 전량청산 = 구조적 이벤트
      const score = (dir * participants.reduce((s, p) => s + participantSignal(p, side, massPost0), 0) / Math.sqrt(insiderCount)) * (thin ? 0.65 : 1);
      participants.sort((a, b) => participantSignal(b, side, massPost0) - participantSignal(a, side, massPost0)); // 리더가 카드 상단
      clusters.push({
        symbol: r0.symbol, company: r0.company ?? null, sector: r0.sector ?? null,
        side, insiderCount, tradeCount: bestTrades.length, totalValue,
        windowFromMs: wFrom, windowToMs: wTo, spanDays: Math.round((wTo - wFrom) / 86400000),
        participants, score, thin, gated: massPost0,
      });
    }
    clusters.sort((a, b) => b.score - a.score);
    return clusters.slice(0, limit);
  }

  private async joinedInsiderTrades(where: any, limit?: number): Promise<InsiderTradeRow[]> {
    const q = db.select({
      id: insiderTrades.id, insiderId: insiderTrades.insiderId,
      insiderName: insiders.name, insiderSlug: insiders.slug,
      symbol: insiderTrades.symbol, company: tickers.companyName,
      txnCode: insiderTrades.txnCode, side: insiderTrades.side,
      shares: insiderTrades.shares,
      // 비정상 단가(>$1M/주, 데이터 오류)는 미상 처리 — 인사이더/수량은 유지, 가격·금액만 숨김
      price: sql<number | null>`CASE WHEN ${insiderTrades.price} > 1000000 THEN NULL ELSE ${insiderTrades.price} END`,
      value: sql<number | null>`CASE WHEN ${insiderTrades.price} > 1000000 THEN NULL ELSE ${insiderTrades.value} END`,
      txnDate: insiderTrades.txnDate, filedDate: insiderTrades.filedDate, role: insiderTrades.role,
      plan10b5: insiderTrades.plan10b5,
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

  // 보유량 백필 — external_id 매칭으로 shares_after 일괄 UPDATE (Finnhub share 재호출분)
  async setSharesAfterByExternal(pairs: { eid: string; sa: number | null }[]) {
    if (!pairs.length) return;
    await db.execute(sql`
      UPDATE insider_trades it SET shares_after = d.sa
      FROM json_to_recordset(${JSON.stringify(pairs)}::json) AS d(eid text, sa bigint)
      WHERE it.external_id = d.eid AND it.shares_after IS DISTINCT FROM d.sa
    `);
  }
  // 보유% 미보강(shares_after NULL)인 매수·매도 종목 목록
  async symbolsNeedingHoldings(): Promise<string[]> {
    const r = (await db.execute(sql`
      SELECT DISTINCT symbol FROM insider_trades WHERE side IN ('buy','sell') AND shares_after IS NULL
    `)) as unknown as any[];
    return r.map((x) => x.symbol);
  }

  // 10b5-1 보강용 — 매수·매도 중 plan10b5 미확인인 고유 accession 목록 (한 Form4=한 accession에 여러 거래라인이 묶임)
  async psAccessionsNeedingPlan(): Promise<{ accession: string; symbol: string }[]> {
    const rows = (await db.execute(sql`
      SELECT DISTINCT split_part(it.external_id, ':', 2) AS accession, it.symbol AS symbol
      FROM insider_trades it
      WHERE it.side IN ('buy','sell') AND it.plan10b5 IS NULL
        AND it.external_id LIKE 'fin:%' AND split_part(it.external_id, ':', 2) <> ''
    `)) as unknown as any[];
    return rows.map((r) => ({ accession: r.accession, symbol: r.symbol }));
  }
  // accession 의 모든 거래라인에 10b5-1 플래그 적용 (문서레벨 필드라 동일 accession 공유)
  async setPlan10b5ByAccession(accession: string, plan: boolean | null) {
    await db.execute(sql`
      UPDATE insider_trades SET plan10b5 = ${plan}
      WHERE external_id LIKE ${"fin:" + accession + ":%"}
    `);
  }
}

export const storage = new DatabaseStorage();
