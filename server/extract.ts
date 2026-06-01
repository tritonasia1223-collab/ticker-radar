import type { Ticker } from "../shared/schema.js";

// Common English words that appear as $XXX or all-caps and would be false positives.
const STOPWORDS = new Set([
  "A", "I", "AI", "API", "ATH", "ATL", "CEO", "CFO", "COO", "CTO", "DM", "EOD", "EPS",
  "ETF", "FOMC", "FUD", "FY", "GDP", "IMO", "IPO", "IRA", "LOL", "OK", "PM", "PR", "PS",
  "Q1", "Q2", "Q3", "Q4", "ROI", "RSI", "SEC", "TBD", "TLDR", "US", "USA", "USD", "WSB",
  "YOLO", "YTD", "EV", "AH", "PT", "EU", "UK", "CPI", "PPI", "GG", "WTF", "OMG", "FAQ",
  "NSFW", "TBA", "AKA", "IDK", "IDC", "BTW", "FYI", "HODL", "REIT", "M", "B", "K", "T",
]);

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
}

export function buildNameMatcher(tickers: Ticker[]): NameMatcher {
  const map = new Map<string, string>();
  for (const t of tickers) {
    let aliases: string[] = [];
    try { aliases = JSON.parse(t.aliases || "[]"); } catch { aliases = []; }
    for (const raw of aliases) {
      const a = String(raw).trim().toLowerCase();
      if (a.length >= 3) map.set(a, t.symbol); // require >=3 chars to avoid noise
    }
  }
  const aliases = [...map.keys()].sort((a, b) => b.length - a.length);
  return { map, aliases };
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
  const lower = " " + text.toLowerCase() + " ";
  const found = new Map<string, ExtractedMention>();
  for (const alias of matcher.aliases) {
    // word-bounded search to avoid substring hits (e.g. "apple" in "applejack")
    const re = new RegExp(`(?<![a-z0-9])${escapeRe(alias)}(?![a-z0-9])`, "i");
    if (re.test(lower)) {
      const sym = matcher.map.get(alias)!;
      if (!found.has(sym)) found.set(sym, { symbol: sym, source: "name" });
    }
  }
  return [...found.values()];
}

// Full extraction: cashtags (primary) + name/alias (secondary). Cashtag wins if both hit same symbol.
export function extractMentions(text: string, matcher: NameMatcher): ExtractedMention[] {
  const cash = extractCashtags(text);
  const names = extractNames(text, matcher);
  const bySym = new Map<string, ExtractedMention>();
  for (const c of cash) bySym.set(c.symbol, c);
  for (const n of names) if (!bySym.has(n.symbol)) bySym.set(n.symbol, n);
  return [...bySym.values()];
}

function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
