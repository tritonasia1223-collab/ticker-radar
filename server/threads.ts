// Threads (threads.net) collection — mirrors server/apify.ts collectAll but for the
// Meta Threads "posts" actor. Verified: posts mode honors postedAfter/postedBefore
// date filters, so collection is incremental per account (postedAfter = last sync).
// Posts are stored in the same tweets/mentions tables with platform = "threads".
import { storage } from "./storage.js";
import { buildNameMatcher, extractMentions } from "./extract.js";
import { runActorWithRetry, type CollectResult } from "./apify.js";
import type { Account } from "../shared/schema.js";

const DEFAULT_THREADS_ACTOR = "automation-lab~threads-scraper";

async function getToken(): Promise<string | undefined> {
  return process.env.APIFY_TOKEN || (await storage.getSetting("apify_token"));
}
async function getActor(): Promise<string> {
  const a = await storage.getSetting("threads_actor");
  return (a && a.trim()) || DEFAULT_THREADS_ACTOR;
}
// Threads caps at 200 posts/user; default to a modest window since collection is incremental.
async function getMaxPosts(): Promise<number> {
  const v = await storage.getSetting("threads_max_posts");
  const n = v ? parseInt(v, 10) : 50;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 200) : 50;
}
async function getBacklogDays(): Promise<number> {
  const v = await storage.getSetting("backlog_days");
  const n = v ? parseInt(v, 10) : 7;
  return Number.isFinite(n) && n > 0 ? n : 7;
}
const dayStr = (ms: number) => new Date(ms).toISOString().slice(0, 10);
function num(v: any): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }

// Normalize a Threads post item into our tweet shape. Returns null for profile entries.
function normalize(item: any) {
  if (!item || item.type === "profile") return null;
  const postId = String(item.postId || item.code || "");
  if (!postId) return null;
  const handle = String(item.username || "").toLowerCase();
  const text = String(item.text || "");
  const tweetedAt = item.date ? new Date(item.date).getTime()
    : item.timestamp ? Number(item.timestamp) * 1000 : Date.now();
  return {
    tweetId: `th_${postId}`, // namespaced to never collide with X status ids
    handle, text,
    url: item.url || (item.code ? `https://www.threads.com/t/${item.code}` : null),
    lang: null as string | null,
    isReply: !!item.isReply, isRetweet: !!item.isRepost,
    likeCount: num(item.likeCount), retweetCount: num(item.repostCount),
    replyCount: num(item.replyCount), viewCount: 0,
    tweetedAt: Number.isFinite(tweetedAt) ? tweetedAt : Date.now(),
  };
}

export async function collectThreads(): Promise<CollectResult> {
  const startedAt = Date.now();
  const all = await storage.listAccounts();
  const active = all.filter((a) => a.active && a.platform === "threads");
  const logId = await storage.createSyncLog(startedAt, active.length);

  const token = await getToken();
  if (!token) {
    await storage.updateSyncLog(logId, { status: "failed", finishedAt: Date.now(), error: "No Apify token configured" });
    return { ok: false, logId, tweetsFetched: 0, tweetsNew: 0, mentionsNew: 0, attempts: 0, error: "No Apify token configured" };
  }
  if (active.length === 0) {
    await storage.updateSyncLog(logId, { status: "success", finishedAt: Date.now(), error: "No active Threads accounts" });
    return { ok: true, logId, tweetsFetched: 0, tweetsNew: 0, mentionsNew: 0, attempts: 0 };
  }

  const actor = await getActor();
  const maxPosts = await getMaxPosts();
  const backlogDays = await getBacklogDays();
  const matcher = buildNameMatcher(await storage.listTickers());

  // incremental: postedAfter = last sync day; new accounts get a backlog window. batch by date.
  const backlogStart = dayStr(Date.now() - backlogDays * 86400000);
  const groups = new Map<string, Account[]>();
  for (const a of active) {
    const since = a.lastSyncedAt ? dayStr(a.lastSyncedAt) : backlogStart;
    const arr = groups.get(since);
    if (arr) arr.push(a);
    else groups.set(since, [a]);
  }

  // The Threads actor is slow; Apify's run-sync endpoint caps a run at 300s. Chunk each
  // since-group into small batches of handles so no single run exceeds the limit.
  const BATCH = 3;
  let runId: string | undefined, datasetId: string | undefined, attempts = 0;
  const items: any[] = [];
  try {
    for (const [since, accts] of groups) {
      for (let i = 0; i < accts.length; i += BATCH) {
        const batch = accts.slice(i, i + BATCH);
        const r = await runActorWithRetry(token, actor, {
          mode: "posts",
          usernames: batch.map((a) => a.handle),
          maxPosts,
          postedAfter: since, // only posts on/after this date
        });
        items.push(...r.items);
        runId = r.runId; datasetId = r.datasetId; attempts = Math.max(attempts, r.attempts);
      }
    }
  } catch (e: any) {
    await storage.updateSyncLog(logId, { status: "failed", finishedAt: Date.now(), error: String(e?.message || e), attempts: 3 });
    return { ok: false, logId, tweetsFetched: 0, tweetsNew: 0, mentionsNew: 0, attempts: 3, error: String(e?.message || e) };
  }

  const byHandle = new Map<string, Account>();
  for (const a of active) byHandle.set(a.handle, a);
  const nameByHandle = new Map<string, string>(); // handle -> fullName (Threads profile record)

  let tweetsNew = 0, mentionsNew = 0, fetched = 0;
  for (const raw of items) {
    // profile records carry the display name (fullName); capture before normalize skips them
    if (raw.fullName && raw.username) nameByHandle.set(String(raw.username).toLowerCase(), String(raw.fullName).trim());
    const n = normalize(raw);
    if (!n) continue;
    fetched++;
    const acct = byHandle.get(n.handle);
    if (!acct) continue;
    const inserted = await storage.insertTweetIfNew({
      tweetId: n.tweetId, accountId: acct.id, handle: n.handle, text: n.text, url: n.url,
      lang: n.lang, isReply: n.isReply, isRetweet: n.isRetweet, platform: "threads",
      likeCount: n.likeCount, retweetCount: n.retweetCount, replyCount: n.replyCount,
      viewCount: n.viewCount, tweetedAt: n.tweetedAt, collectedAt: Date.now(),
    });
    if (inserted) {
      tweetsNew++;
      for (const mm of extractMentions(n.text, matcher)) {
        if (await storage.insertMentionIfNew({ tweetId: n.tweetId, symbol: mm.symbol, accountId: acct.id, handle: n.handle, source: mm.source, tweetedAt: n.tweetedAt }))
          mentionsNew++;
      }
    }
  }

  for (const a of active) await storage.setAccountCursor(a.id, a.lastTweetId, Date.now());
  // backfill display name from the scraped fullName (only if not already set)
  for (const [handle, name] of nameByHandle) {
    const acct = byHandle.get(handle);
    if (acct && name && !acct.displayName) await storage.updateAccount(acct.id, { displayName: name });
  }

  const status = fetched === 0 ? "partial" : "success";
  await storage.updateSyncLog(logId, {
    status, finishedAt: Date.now(), tweetsFetched: fetched, tweetsNew, mentionsNew,
    attempts, runId, datasetId, error: fetched === 0 ? "Actor returned no posts" : null,
  });
  return { ok: true, logId, tweetsFetched: fetched, tweetsNew, mentionsNew, attempts };
}
