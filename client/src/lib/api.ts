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
  priorMentions: number;
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

// 발굴 추세 상태 — 비율(%)은 모수가 작으면 왜곡되므로, 의미 있는 상태 라벨로 보여준다.
// 이전 0 → 신규, 2배 이상 → 급증, 증가/유지/감소. 언급이 적으면(dim) 신뢰도 낮음 표시.
const LOW_SAMPLE = 3; // 최근 언급이 이 미만이면 흐리게(신뢰도 낮음)
export type SurgeTone = "new" | "up" | "flat" | "down";
export interface SurgeStatus { label: string; emoji: string; tone: SurgeTone; dim: boolean }
export function surgeStatus(recent: number, prior: number): SurgeStatus {
  const dim = recent < LOW_SAMPLE;
  if (recent === 0) return { label: "–", emoji: "", tone: "flat", dim: true };
  if (prior === 0) return { label: "신규", emoji: "🆕", tone: "new", dim };
  if (recent >= prior * 2) return { label: "급증", emoji: "🔥", tone: "up", dim };
  if (recent > prior) return { label: "증가", emoji: "📈", tone: "up", dim };
  if (recent === prior) return { label: "유지", emoji: "➖", tone: "flat", dim };
  return { label: "감소", emoji: "🔻", tone: "down", dim };
}
// 상태 색: 신규=앰버, 유지=회색, 증가·감소는 시장 관례(미장 초록/빨강, 국장 빨강/파랑).
export function statusColorClass(tone: SurgeTone, market: string): string {
  if (tone === "new") return "text-amber-500";
  if (tone === "flat") return "text-muted-foreground";
  const up = tone === "up";
  return market === "kr"
    ? (up ? "text-rose-500" : "text-blue-500")
    : (up ? "text-emerald-500" : "text-rose-500");
}

// 관심종목등록 상위 (KIS)
export interface InterestRow {
  symbol: string; name: string | null; rank: number; regCount: number;
  price: number | null; changePct: number | null;
}
export interface InterestMover {
  symbol: string; name: string | null; regNow: number; regPrev: number; delta: number; rank: number;
}
export interface InterestTrend {
  dates: string[];
  movers: { up: InterestMover[]; down: InterestMover[] };
  series: { symbol: string; name: string | null; points: number[] }[];
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
