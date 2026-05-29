import { storage } from "./storage";
import { buildNameMatcher, extractMentions } from "./extract";

const DUMMY_ACCOUNTS = [
  { handle: "alphahunter", displayName: "Alpha Hunter" },
  { handle: "macrowire", displayName: "Macro Wire" },
  { handle: "chipdesk", displayName: "Chip Desk" },
  { handle: "valuegrinder", displayName: "Value Grinder" },
  { handle: "smallcapsam", displayName: "SmallCap Sam" },
];

const SEED_TICKERS = [
  { symbol: "NVDA", companyName: "NVIDIA", aliases: ["nvidia"] },
  { symbol: "AAPL", companyName: "Apple", aliases: ["apple"] },
  { symbol: "TSLA", companyName: "Tesla", aliases: ["tesla"] },
  { symbol: "PLTR", companyName: "Palantir", aliases: ["palantir"] },
  { symbol: "SOFI", companyName: "SoFi Technologies", aliases: ["sofi"] },
  { symbol: "AMD", companyName: "Advanced Micro Devices", aliases: ["amd"] },
  { symbol: "RKLB", companyName: "Rocket Lab", aliases: ["rocket lab", "rocketlab"] },
];

// Tweet templates. {SYM} replaced with cashtag, {NAME} with company name.
const TWEETS_CASH = [
  "Loading up on {SYM} here, risk/reward looks great into earnings.",
  "{SYM} breaking out of a multi-month base. Volume confirming.",
  "Anyone else watching {SYM}? Setup is clean.",
  "Adding to {SYM} on this dip. Conviction high.",
  "{SYM} guidance raise incoming, my channel checks are strong.",
];
const TWEETS_NAME = [
  "{NAME} just announced a huge new contract — this changes the thesis.",
  "Quietly, {NAME} is becoming the leader in its space.",
  "{NAME} margins expanding faster than the street expects.",
];

const hours = (h: number) => Date.now() - h * 3600 * 1000;
const rand = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

export async function seedDummy() {
  // tickers (for name matching)
  for (const t of SEED_TICKERS) {
    await storage.upsertTicker({ symbol: t.symbol, companyName: t.companyName, aliases: JSON.stringify(t.aliases), exchange: "NASDAQ" });
  }

  // accounts
  const accts: { id: number; handle: string }[] = [];
  for (const a of DUMMY_ACCOUNTS) {
    let acct = await storage.getAccountByHandle(a.handle);
    if (!acct) acct = await storage.createAccount({ handle: a.handle, displayName: a.displayName, active: true } as any);
    accts.push({ id: acct.id, handle: acct.handle });
  }

  const matcher = buildNameMatcher(await storage.listTickers());
  // Deterministic base id so re-seeding is idempotent (dedup kicks in on tweetId).
  let tid = 1900000000000;
  let tweetsNew = 0, mentionsNew = 0;

  // Engineered scenario:
  // NVDA — broad SURGE: 4 accounts in last 12h (recent), only 1 in prior window -> high surge.
  // PLTR — moderate surge: 2 accounts recent.
  // RKLB — single account chatter (should be filtered out by minAccounts=2).
  // AAPL/TSLA — steady baseline across both windows (low surge score).
  const plan: { handle: string; sym: string; useName: boolean; ago: number }[] = [
    // NVDA recent broad burst
    { handle: "alphahunter", sym: "NVDA", useName: false, ago: 2 },
    { handle: "macrowire", sym: "NVDA", useName: true, ago: 3 },
    { handle: "chipdesk", sym: "NVDA", useName: false, ago: 5 },
    { handle: "valuegrinder", sym: "NVDA", useName: false, ago: 8 },
    // NVDA prior baseline (1 account)
    { handle: "alphahunter", sym: "NVDA", useName: false, ago: 30 },
    // PLTR moderate recent
    { handle: "smallcapsam", sym: "PLTR", useName: false, ago: 4 },
    { handle: "valuegrinder", sym: "PLTR", useName: true, ago: 9 },
    // RKLB single account (filtered)
    { handle: "smallcapsam", sym: "RKLB", useName: true, ago: 6 },
    { handle: "smallcapsam", sym: "RKLB", useName: false, ago: 10 },
    // AAPL steady both windows
    { handle: "alphahunter", sym: "AAPL", useName: false, ago: 5 },
    { handle: "macrowire", sym: "AAPL", useName: false, ago: 28 },
    { handle: "valuegrinder", sym: "AAPL", useName: false, ago: 40 },
    // TSLA steady
    { handle: "chipdesk", sym: "TSLA", useName: true, ago: 7 },
    { handle: "macrowire", sym: "TSLA", useName: false, ago: 33 },
    // AMD recent pair
    { handle: "chipdesk", sym: "AMD", useName: false, ago: 3 },
    { handle: "alphahunter", sym: "AMD", useName: false, ago: 6 },
  ];

  const tk = SEED_TICKERS.reduce((m, t) => (m[t.symbol] = t, m), {} as any);

  for (const p of plan) {
    const acct = accts.find((a) => a.handle === p.handle)!;
    const meta = tk[p.sym];
    const text = p.useName
      ? rand(TWEETS_NAME).replace("{NAME}", meta.companyName)
      : rand(TWEETS_CASH).replace("{SYM}", "$" + p.sym);
    const tweetId = String(tid++);
    const tweetedAt = hours(p.ago);
    const inserted = await storage.insertTweetIfNew({
      tweetId, accountId: acct.id, handle: acct.handle, text,
      url: `https://x.com/${acct.handle}/status/${tweetId}`, lang: "en",
      isReply: false, isRetweet: false, likeCount: Math.floor(Math.random() * 500),
      retweetCount: Math.floor(Math.random() * 100), replyCount: Math.floor(Math.random() * 50),
      viewCount: Math.floor(Math.random() * 20000), tweetedAt, collectedAt: Date.now(),
    });
    if (inserted) {
      tweetsNew++;
      for (const mm of extractMentions(text, matcher)) {
        if (await storage.insertMentionIfNew({ tweetId, symbol: mm.symbol, accountId: acct.id, handle: acct.handle, source: mm.source, tweetedAt }))
          mentionsNew++;
      }
    }
  }

  return { ok: true, tweetsNew, mentionsNew, accounts: accts.length };
}
