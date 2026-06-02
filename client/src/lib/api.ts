export interface Account {
  id: number;
  handle: string;
  displayName: string | null;
  note: string | null;
  platform: string; // 'x' | 'threads'
  active: boolean;
  lastTweetId: string | null;
  lastSyncedAt: number | null;
  createdAt: number;
}

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
  changePercent: number;
  trend: number[];
}

export interface SectorStock {
  symbol: string;
  nameKo: string | null;
  nameEn: string | null;
  recentMentions: number;
  recentAccounts: number;
  changePercent: number;
}
export interface SectorMapRow {
  sector: string;
  recentMentions: number;
  recentAccounts: number;
  priorMentions: number;
  changePercent: number;
  stocks: SectorStock[];
}

// Sector labels are already normalized to clean Korean by the server (storage.normalizeSector);
// keep a passthrough here so callers don't need to special-case.
export function sectorLabel(raw: string): string {
  return raw;
}

// Up/down text color by market convention: US = green up / red down; KR = red up / blue down.
export function changeColorClass(pct: number, market: string): string {
  const up = pct >= 0;
  return market === "kr"
    ? (up ? "text-rose-500" : "text-blue-500")
    : (up ? "text-emerald-500" : "text-rose-500");
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

// Shorten an official company name for compact display:
//   "Apple Inc. - Common Stock"                       -> "Apple"
//   "Palantir Technologies Inc. Class A Common Stock"  -> "Palantir Technologies"
//   "REVOLUTION MEDICINES INC"                         -> "Revolution Medicines"
export function shortCompanyName(name: string | null): string | null {
  if (!name) return null;
  let s = name.split(" - ")[0]; // drop "- Common Stock"-style tails
  if (s === s.toUpperCase()) s = s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()); // title-case SEC all-caps
  s = s.replace(/\s*\b(Class\s+[A-Z]\b.*|Common\s+Stock|Ordinary\s+Shares?|American\s+Depositary.*|Common\s+Shares?|Depositary\s+Shares?)\s*$/i, "");
  s = s.replace(/[,\.]?\s*\b(Incorporated|Inc|Corporation|Corp|Company|Co|Limited|Ltd|PLC|LLC|Holdings?)\b\.?\s*$/i, "");
  s = s.replace(/[\s,\.]+$/, "").trim();
  return s || name;
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
