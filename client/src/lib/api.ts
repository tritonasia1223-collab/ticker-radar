export interface Account {
  id: number;
  handle: string;
  displayName: string | null;
  note: string | null;
  active: boolean;
  lastTweetId: string | null;
  lastSyncedAt: number | null;
  createdAt: number;
}

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

export interface Tweet {
  id: number;
  tweetId: string;
  accountId: number;
  handle: string;
  text: string;
  url: string | null;
  lang: string | null;
  isReply: boolean;
  isRetweet: boolean;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  viewCount: number;
  tweetedAt: number;
  collectedAt: number;
}

export interface SyncLog {
  id: number;
  startedAt: number;
  finishedAt: number | null;
  status: string;
  handlesRequested: number;
  tweetsFetched: number;
  tweetsNew: number;
  mentionsNew: number;
  attempts: number;
  runId: string | null;
  datasetId: string | null;
  error: string | null;
}

export interface Stats {
  accounts: number;
  tweets: number;
  mentions: number;
  symbols: number;
}

export interface Settings {
  hasToken: boolean;
  tokenSource: string;
  actor: string;
  maxTweetsPerHandle: number;
}

export function timeAgo(ms: number | null): string {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  return `${d}일 전`;
}
