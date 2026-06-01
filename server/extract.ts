import type { Ticker } from "../shared/schema.js";

// Common English words that appear as $XXX or all-caps and would be false positives.
const STOPWORDS = new Set([
  "A", "I", "AI", "API", "ATH", "ATL", "CEO", "CFO", "COO", "CTO", "DM", "EOD", "EPS",
  "ETF", "FOMC", "FUD", "FY", "GDP", "IMO", "IPO", "IRA", "LOL", "OK", "PM", "PR", "PS",
  "Q1", "Q2", "Q3", "Q4", "ROI", "RSI", "SEC", "TBD", "TLDR", "US", "USA", "USD", "WSB",
  "YOLO", "YTD", "EV", "AH", "PT", "EU", "UK", "CPI", "PPI", "GG", "WTF", "OMG", "FAQ",
  "NSFW", "TBA", "AKA", "IDK", "IDC", "BTW", "FYI", "HODL", "REIT", "M", "B", "K", "T",
]);

// KR company names that are also everyday words — block them from name-matching
// (the 6-digit code still resolves these stocks). Extend as noise is spotted.
const KR_STOPWORDS = new Set([
  "대상", "태양", "우리", "하나", "현대", "미래", "다음", "한국", "대한", "동양",
  "한일", "동부", "제일", "세계", "시대", "자연", "사람", "신라", "영원", "부산",
  "서울", "대구", "광주", "인천", "대성", "동국", "신성", "한신", "이상", "자이",
  "진영",
]);

// Korean particles (조사) that may directly follow a stock name. A trailing Hangul that
// ISN'T one of these means the name is only a prefix of a longer word (테스→테스트,
// 레이→레이저), so it shouldn't count as a mention.
const KR_PARTICLES = "은는이가을를에의와과도만로요네야나랑라며서";
function koTrailing(alias: string): string {
  // ASCII names use a plain word boundary; Korean names require end / non-Hangul / a particle.
  return /[가-힣]/.test(alias)
    ? `(?=$|[^가-힣a-z0-9]|[${KR_PARTICLES}])`
    : `(?![a-z0-9])`;
}

// $TICKER pattern: $ followed by 1-6 uppercase letters, optional .A/.B class, word boundary.
// We allow $BTC etc (crypto) but those are still valid cashtags.
const CASHTAG_RE = /(?<![\w$])\$([A-Za-z]{1,6})(?:\.([A-Za-z]{1,2}))?\b/g;

export interface ExtractedMention {
  symbol: string;
  source: "cashtag" | "name";
}

// Build a name-matcher from known tickers. Each ticker can have aliases (lowercase).
export interface NameMatcher {
  // alias (lowercase, word-bounded) -> symbol
  map: Map<string, string>;
  // sorted alias list (longest first) for greedy matching
  aliases: string[];
  // valid KR 6-digit listing codes (for "(005930)" style mentions)
  codes: Set<string>;
}

export function buildNameMatcher(tickers: Ticker[]): NameMatcher {
  const map = new Map<string, string>();
  const codes = new Set<string>();
  for (const t of tickers) {
    if (t.market === "kr" && /^\d{6}$/.test(t.symbol)) codes.add(t.symbol);
    let aliases: string[] = [];
    try { aliases = JSON.parse(t.aliases || "[]"); } catch { aliases = []; }
    for (const raw of aliases) {
      const a = String(raw).trim().toLowerCase();
      const hasHangul = /[가-힣]/.test(a);
      if (t.market === "kr") {
        // KR stocks: match by Korean names only (>=2 chars), minus common-word names.
        // ASCII names ("NEW") are dropped — the 6-digit code resolves those instead.
        if (!hasHangul || a.length < 2 || KR_STOPWORDS.has(a)) continue;
      } else if (a.length < (hasHangul ? 2 : 3)) {
        continue; // US: Korean alias (애플) >=2 chars, ASCII (apple) >=3
      }
      map.set(a, t.symbol);
    }
  }
  const aliases = [...map.keys()].sort((a, b) => b.length - a.length);
  return { map, aliases, codes };
}

// KR stocks are often written as a 6-digit listing code, e.g. "예스티(122640)".
const KR_CODE_RE = /\b(\d{6})\b/g;
export function extractKrCodes(text: string, matcher: NameMatcher): ExtractedMention[] {
  const found = new Map<string, ExtractedMention>();
  let m: RegExpExecArray | null;
  KR_CODE_RE.lastIndex = 0;
  while ((m = KR_CODE_RE.exec(text)) !== null) {
    const code = m[1];
    if (matcher.codes.has(code) && !found.has(code)) found.set(code, { symbol: code, source: "cashtag" });
  }
  return [...found.values()];
}

export function extractCashtags(text: string): ExtractedMention[] {
  const found = new Map<string, ExtractedMention>();
  let m: RegExpExecArray | null;
  CASHTAG_RE.lastIndex = 0;
  while ((m = CASHTAG_RE.exec(text)) !== null) {
    const base = m[1].toUpperCase();
    const cls = m[2] ? m[2].toUpperCase() : "";
    if (STOPWORDS.has(base)) continue;
    if (base.length < 1) continue;
    const symbol = cls ? `${base}.${cls}` : base;
    found.set(symbol, { symbol, source: "cashtag" });
  }
  return [...found.values()];
}

export function extractNames(text: string, matcher: NameMatcher): ExtractedMention[] {
  // aliases are sorted longest-first; consume each match so a shorter alias can't also
  // hit inside a longer name (e.g. "에코프로" must NOT match inside "에코프로비엠").
  let work = " " + text.toLowerCase() + " ";
  const found = new Map<string, ExtractedMention>();
  for (const alias of matcher.aliases) {
    if (work.indexOf(alias) === -1) continue; // fast reject before the (costly) bounded regex
    // Leading boundary blocks a preceding Hangul so a name can't match mid-word ("이닉스"
    // inside "하이닉스"); trailing only allows particles/punctuation (blocks "테스트" etc).
    const re = new RegExp(`(?<![a-z0-9가-힣])${escapeRe(alias)}${koTrailing(alias)}`, "gi");
    let matched = false;
    work = work.replace(re, (m) => { matched = true; return " ".repeat(m.length); });
    if (matched) {
      const sym = matcher.map.get(alias)!;
      if (!found.has(sym)) found.set(sym, { symbol: sym, source: "name" });
    }
  }
  return [...found.values()];
}

// Full extraction: cashtags ($AAPL) + KR codes ((005930)) + name/alias. One mention
// per symbol per tweet — an explicit cashtag/code wins over a fuzzy name match.
export function extractMentions(text: string, matcher: NameMatcher): ExtractedMention[] {
  const cash = extractCashtags(text);
  const codes = extractKrCodes(text, matcher);
  const names = extractNames(text, matcher);
  const bySym = new Map<string, ExtractedMention>();
  for (const c of cash) bySym.set(c.symbol, c);
  for (const c of codes) if (!bySym.has(c.symbol)) bySym.set(c.symbol, c);
  for (const n of names) if (!bySym.has(n.symbol)) bySym.set(n.symbol, n);
  return [...bySym.values()];
}

function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
