// 정치인 거래 모듈 — API 타입 + 클라이언트 집계 로직.
// 백엔드는 거래 목록만 주고, 종목 랭킹/위원회/의원 집계는 여기서 한다(프로토타입 로직 이식).

export interface Politician {
  id: number;
  slug: string;
  name: string;
  party: string | null; // D | R | I
  chamber: string; // senate | house
  state: string | null;
  bioguideId: string | null;
  createdAt: number;
  committees: string[]; // committee ids
}

export interface Committee {
  id: string;
  ko: string;
  name: string;
  chamber: string;
}

export interface Trade {
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

export const SECTOR: Record<string, string> = {
  LMT: "방산", RTX: "방산", NOC: "방산", GD: "방산",
  NVDA: "기술", AAPL: "기술", MSFT: "기술", GOOGL: "기술", META: "기술", AMZN: "기술", TSLA: "기술",
  JPM: "금융", GS: "금융", BAC: "금융",
  XOM: "에너지", CVX: "에너지",
  PFE: "헬스케어", UNH: "헬스케어", LLY: "헬스케어",
  ADM: "농업", DE: "농업/기계", DIS: "기타",
};

const PALETTE: Record<string, string> = {
  LMT: "#ac8e68", RTX: "#b08d57", NOC: "#8a7048", GD: "#9c8254",
  NVDA: "#30d158", AAPL: "#0a84ff", MSFT: "#34c759", GOOGL: "#bf5af2", META: "#5e5ce6",
  AMZN: "#ff9f0a", TSLA: "#ff453a", JPM: "#64d2ff", GS: "#5ac8fa", BAC: "#4aa3df",
  XOM: "#ffd60a", CVX: "#e6c200", PFE: "#ff6482", UNH: "#26c6da", LLY: "#ff8fab",
  ADM: "#a3c585", DE: "#7cb342", DIS: "#a2845e",
};
export function tickerColor(sym: string): string {
  if (PALETTE[sym]) return PALETTE[sym];
  let h = 0;
  for (let i = 0; i < sym.length; i++) h = (h * 31 + sym.charCodeAt(i)) % 360;
  return `hsl(${h} 55% 55%)`;
}

export const partyColor = (p: string | null) => (p === "D" ? "#58a6ff" : p === "R" ? "#ff7b72" : "#8b949e");

export const mid = (t: Trade) =>
  t.amountLow == null ? 0 : Math.round((t.amountLow + (t.amountHigh ?? t.amountLow)) / 2);

export const quarterOf = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
};
export const fmtQ = (q: string) => q.replace("Q", " Q");

export function fmtMoney(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v)}`;
}

export function sortedQuarters(trades: Trade[]): string[] {
  const s = new Set(trades.map((t) => quarterOf(t.txnDate)));
  return [...s].sort();
}

export const cmtLabel = (c?: Committee) => (c ? `${c.ko}(${c.name})` : "");

export interface TickerAgg {
  symbol: string;
  company: string | null;
  buy: number;
  sell: number;
  net: number;
  vol: number;
  buyers: Map<string, number>; // slug -> amount
  sellers: Map<string, number>;
  perQ: Map<string, { buy: number; sell: number }>;
  trades: Trade[];
}

export function aggregate(trades: Trade[]): Map<string, TickerAgg> {
  const byTk = new Map<string, TickerAgg>();
  for (const t of trades) {
    let s = byTk.get(t.symbol);
    if (!s) {
      s = { symbol: t.symbol, company: t.company, buy: 0, sell: 0, net: 0, vol: 0,
        buyers: new Map(), sellers: new Map(), perQ: new Map(), trades: [] };
      byTk.set(t.symbol, s);
    }
    const v = mid(t);
    const q = quarterOf(t.txnDate);
    if (!s.perQ.has(q)) s.perQ.set(q, { buy: 0, sell: 0 });
    const pq = s.perQ.get(q)!;
    s.trades.push(t);
    s.vol += v;
    if (t.side === "sell") {
      s.sell += v; s.net -= v; pq.sell += v;
      s.sellers.set(t.slug, (s.sellers.get(t.slug) || 0) + v);
    } else {
      s.buy += v; s.net += v; pq.buy += v;
      s.buyers.set(t.slug, (s.buyers.get(t.slug) || 0) + v);
    }
  }
  return byTk;
}

export type SortMetric = "vol" | "net" | "traders";
export function rankList(aggs: TickerAgg[], metric: SortMetric): TickerAgg[] {
  const key = (s: TickerAgg) =>
    metric === "vol" ? s.vol : metric === "net" ? s.net : new Set([...s.buyers.keys(), ...s.sellers.keys()]).size;
  return [...aggs].sort((a, b) => key(b) - key(a));
}

export const tradersOf = (s: TickerAgg) => new Set([...s.buyers.keys(), ...s.sellers.keys()]).size;

// 분기별 매수/매도 + 의원 또는 종목 단위 내역 (추이 차트용)
export interface QuarterBar {
  quarter: string;
  label: string;
  buy: number;
  sell: number; // 양수로 저장, 차트에서 음수 처리
  cum: number; // 누적 순매수
  buyers: [string, number][]; // [label, amount]
  sellers: [string, number][];
}
export function quarterSeries(
  trades: Trade[],
  quarters: string[],
  groupBy: "member" | "ticker",
  nameOf: (slug: string) => string,
): QuarterBar[] {
  const map = new Map<string, { buy: number; sell: number; buyers: Map<string, number>; sellers: Map<string, number> }>();
  for (const q of quarters) map.set(q, { buy: 0, sell: 0, buyers: new Map(), sellers: new Map() });
  for (const t of trades) {
    const q = quarterOf(t.txnDate);
    const e = map.get(q);
    if (!e) continue;
    const v = mid(t);
    const k = groupBy === "ticker" ? t.symbol : nameOf(t.slug);
    if (t.side === "sell") { e.sell += v; e.sellers.set(k, (e.sellers.get(k) || 0) + v); }
    else { e.buy += v; e.buyers.set(k, (e.buyers.get(k) || 0) + v); }
  }
  let cum = 0;
  return quarters.map((q) => {
    const e = map.get(q)!;
    cum += e.buy - e.sell;
    const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);
    return { quarter: q, label: fmtQ(q), buy: e.buy, sell: e.sell, cum, buyers: top(e.buyers), sellers: top(e.sellers) };
  });
}
