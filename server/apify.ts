import { storage } from "./storage.js";
import { buildNameMatcher, extractMentions } from "./extract.js";
import type { Account } from "../shared/schema.js";

const APIFY_BASE = "https://api.apify.com/v2";
const DEFAULT_ACTOR = "apidojo~tweet-scraper"; // apidojo/tweet-scraper, ~ form for REST path

async function getToken(): Promise<string | undefined> {
  return process.env.APIFY_TOKEN || (await storage.getSetting("apify_token"));
}
async function getActor(): Promise<string> {
  const a = await storage.getSetting("apify_actor");
  return (a && a.trim()) || DEFAULT_ACTOR;
}
async function getMaxPerHandle(): Promise<number> {
  const v = await storage.getSetting("max_tweets_per_handle");
  const n = v ? parseInt(v, 10) : 30;
  return Number.isFinite(n) && n > 0 ? n : 30;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Run the Apify actor synchronously and return dataset items. Retries on transient failure.
async function runActorWithRetry(
  token: string, actor: string, input: any, maxAttempts = 3,
): Promise<{ items: any[]; runId?: string; datasetId?: string; attempts: number }> {
  let lastErr: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // run-sync-get-dataset-items: starts run, waits, returns items in one call
      const url = `${APIFY_BASE}/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&clean=true`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const runId = resp.headers.get("x-apify-run-id") || undefined;
      const datasetId = resp.headers.get("x-apify-dataset-id") || undefined;
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        // 4xx (except 429) are not retryable
        if (resp.status >= 400 && resp.status < 500 && resp.status !== 429) {
          throw new Error(`Apify ${resp.status}: ${body.slice(0, 300)}`);
        }
        throw new Error(`Apify transient ${resp.status}: ${body.slice(0, 200)}`);
      }
      const items = (await resp.json()) as any[];
      return { items: Array.isArray(items) ? items : [], runId, datasetId, attempts: attempt };
    } catch (e: any) {
      lastErr = e;
      const nonRetryable = /Apify 4(0[0-46-9]|[1-9]\d)/.test(String(e?.message));
      if (nonRetryable || attempt === maxAttempts) break;
      await sleep(1000 * Math.pow(2, attempt - 1)); // 1s, 2s, 4s backoff
    }
  }
  throw lastErr ?? new Error("Apify run failed");
}

function num(v: any): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }

// Normalize an Apify tweet item into our tweet shape. Returns null if unusable.
function normalize(item: any): {
  tweetId: string; handle: string; text: string; url: string | null; lang: string | null;
  isReply: boolean; isRetweet: boolean; likeCount: number; retweetCount: number;
  replyCount: number; viewCount: number; tweetedAt: number;
} | null {
  if (!item || item.noResults) return null;
  const tweetId = String(item.id || item.tweetId || item.id_str || "");
  if (!tweetId || tweetId === "undefined") return null;
  const handle = String(item.author?.userName || item.author?.screen_name || item.username || "").toLowerCase();
  const text = String(item.fullText || item.text || "");
  const createdRaw = item.createdAt || item.created_at;
  const tweetedAt = createdRaw ? new Date(createdRaw).getTime() : Date.now();
  return {
    tweetId, handle, text,
    url: item.url || item.twitterUrl || (handle ? `https://x.com/${handle}/status/${tweetId}` : null),
    lang: item.lang || null,
    isReply: !!item.isReply, isRetweet: !!item.isRetweet,
    likeCount: num(item.likeCount), retweetCount: num(item.retweetCount),
    replyCount: num(item.replyCount), viewCount: num(item.viewCount),
    tweetedAt: Number.isFinite(tweetedAt) ? tweetedAt : Date.now(),
  };
}

// snowflake-ish compare for tweet ids (numeric strings of differing length)
function idGreater(a: string, b: string): boolean {
  if (a.length !== b.length) return a.length > b.length;
  return a > b;
}

export interface CollectResult {
  ok: boolean;
  logId: number;
  tweetsFetched: number;
  tweetsNew: number;
  mentionsNew: number;
  attempts: number;
  error?: string;
}

// Main entry: collect new tweets for all active accounts, dedup, extract tickers.
export async function collectAll(): Promise<CollectResult> {
  const startedAt = Date.now();
  const allAccounts = await storage.listAccounts();
  const active = allAccounts.filter((a) => a.active);
  const logId = await storage.createSyncLog(startedAt, active.length);

  const token = await getToken();
  if (!token) {
    await storage.updateSyncLog(logId, { status: "failed", finishedAt: Date.now(), error: "No Apify token configured" });
    return { ok: false, logId, tweetsFetched: 0, tweetsNew: 0, mentionsNew: 0, attempts: 0, error: "No Apify token configured" };
  }
  if (active.length === 0) {
    await storage.updateSyncLog(logId, { status: "success", finishedAt: Date.now(), error: "No active accounts" });
    return { ok: true, logId, tweetsFetched: 0, tweetsNew: 0, mentionsNew: 0, attempts: 0 };
  }

  const actor = await getActor();
  const maxPerHandle = await getMaxPerHandle();
  const tickers = await storage.listTickers();
  const matcher = buildNameMatcher(tickers);

  const input = {
    twitterHandles: active.map((a) => a.handle),
    maxItems: maxPerHandle * active.length,
    sort: "Latest",
  };

  let runId: string | undefined, datasetId: string | undefined, attempts = 0;
  let items: any[] = [];
  try {
    const r = await runActorWithRetry(token, actor, input);
    items = r.items; runId = r.runId; datasetId = r.datasetId; attempts = r.attempts;
  } catch (e: any) {
    await storage.updateSyncLog(logId, {
      status: "failed", finishedAt: Date.now(), error: String(e?.message || e), attempts: 3,
    });
    return { ok: false, logId, tweetsFetched: 0, tweetsNew: 0, mentionsNew: 0, attempts: 3, error: String(e?.message || e) };
  }

  const byHandle = new Map<string, Account>();
  for (const a of active) byHandle.set(a.handle, a);
  const newCursor = new Map<string, string>(); // handle -> max new tweet id

  let tweetsNew = 0, mentionsNew = 0, fetched = 0;
  for (const raw of items) {
    const n = normalize(raw);
    if (!n) continue;
    fetched++;
    const acct = byHandle.get(n.handle);
    if (!acct) continue; // tweet from a handle we don't track (e.g. quoted) — skip
    // incremental: skip tweets we've already passed (<= stored cursor)
    if (acct.lastTweetId && !idGreater(n.tweetId, acct.lastTweetId)) {
      // still update potential cursor max below, but don't reprocess
    }
    const inserted = await storage.insertTweetIfNew({
      tweetId: n.tweetId, accountId: acct.id, handle: n.handle, text: n.text, url: n.url,
      lang: n.lang, isReply: n.isReply, isRetweet: n.isRetweet,
      likeCount: n.likeCount, retweetCount: n.retweetCount, replyCount: n.replyCount,
      viewCount: n.viewCount, tweetedAt: n.tweetedAt, collectedAt: Date.now(),
    });
    // track max id seen per handle for cursor advance
    const cur = newCursor.get(n.handle);
    if (!cur || idGreater(n.tweetId, cur)) newCursor.set(n.handle, n.tweetId);

    if (inserted) {
      tweetsNew++;
      // extract tickers only for newly stored tweets (skip retweets noise optionally kept)
      const mentions = extractMentions(n.text, matcher);
      for (const mm of mentions) {
        const added = await storage.insertMentionIfNew({
          tweetId: n.tweetId, symbol: mm.symbol, accountId: acct.id, handle: n.handle,
          source: mm.source, tweetedAt: n.tweetedAt,
        });
        if (added) mentionsNew++;
      }
    }
  }

  // advance cursors
  for (const [handle, maxId] of newCursor) {
    const acct = byHandle.get(handle);
    if (!acct) continue;
    const newMax = acct.lastTweetId && !idGreater(maxId, acct.lastTweetId) ? acct.lastTweetId : maxId;
    await storage.setAccountCursor(acct.id, newMax, Date.now());
  }
  // accounts with no results still get a sync timestamp
  for (const a of active) if (!newCursor.has(a.handle)) await storage.setAccountCursor(a.id, a.lastTweetId, Date.now());

  const status = fetched === 0 ? "partial" : "success";
  await storage.updateSyncLog(logId, {
    status, finishedAt: Date.now(), tweetsFetched: fetched, tweetsNew, mentionsNew,
    attempts, runId, datasetId, error: fetched === 0 ? "Actor returned no items" : null,
  });

  return { ok: true, logId, tweetsFetched: fetched, tweetsNew, mentionsNew, attempts };
}
