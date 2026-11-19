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

export const partyColor = (p: string | null) => (p === "D" ? "#58a6ff" : p === "R" ? "#ff7b72" : "#8b949e");

export const mid = (t: Trade) =>
  t.amountLow == null ? 0 : Math.round((t.amountLow + (t.amountHigh ?? t.amountLow)) / 2);

// ── 신선도: 거래일→공시일 gap (PTR 은 타이밍보다 포지셔닝/테마 확인 신호 — gap 짧을수록 가치↑).
//   경계는 실측 분위수(p25=6·p50=14·p75=24·max=42): ≤7 빠름 / 8–21 보통 / >21 지연.
export const gapDays = (t: Trade): number | null =>
  t.filedDate == null ? null : Math.max(0, Math.round((t.filedDate - t.txnDate) / 86400000));
export type FreshTier = "fast" | "mid" | "slow" | "unknown";
export const freshTier = (t: Trade): FreshTier => {
  const g = gapDays(t);
  return g == null ? "unknown" : g <= 7 ? "fast" : g <= 21 ? "mid" : "slow";
};
export const FRESH_META: Record<FreshTier, { ko: string; cls: string }> = {
  fast: { ko: "빠름", cls: "bg-emerald-500/15 text-emerald-400" },
  mid: { ko: "보통", cls: "bg-amber-500/15 text-amber-400" },
  slow: { ko: "지연", cls: "bg-rose-500/15 text-rose-400" },
  unknown: { ko: "미상", cls: "bg-muted text-muted-foreground" },
};
// 반감기 14일(=median) 지수감쇠. 분모45 선형은 실측(max42)과 안 맞아 폐기. unknown 은 중립 0.5.
//   곱셈 가중은 금액·신선도를 한 축으로 뭉개므로 기본 OFF(토글 전용) — top-N 변동 측정용.
export const freshWeight = (t: Trade): number => {
  const g = gapDays(t);
  return g == null ? 0.5 : Math.pow(0.5, g / 14);
};

export const quarterOf = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
};
export const fmtQ = (q: string) => q.replace("Q", " Q");

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
  volFresh: number; // 신선도 가중 거래액 (Σ mid×freshWeight) — 가중 랭킹 토글용
  netFresh: number; // 신선도 가중 순매수
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
      s = { symbol: t.symbol, company: t.company, buy: 0, sell: 0, net: 0, vol: 0, volFresh: 0, netFresh: 0,
        buyers: new Map(), sellers: new Map(), perQ: new Map(), trades: [] };
      byTk.set(t.symbol, s);
    }
    const v = mid(t);
    const vw = v * freshWeight(t);
    const q = quarterOf(t.txnDate);
    if (!s.perQ.has(q)) s.perQ.set(q, { buy: 0, sell: 0 });
    const pq = s.perQ.get(q)!;
    s.trades.push(t);
    s.vol += v; s.volFresh += vw;
    if (t.side === "sell") {
      s.sell += v; s.net -= v; s.netFresh -= vw; pq.sell += v;
      s.sellers.set(t.slug, (s.sellers.get(t.slug) || 0) + v);
    } else {
      s.buy += v; s.net += v; s.netFresh += vw; pq.buy += v;
      s.buyers.set(t.slug, (s.buyers.get(t.slug) || 0) + v);
    }
  }
  return byTk;
}

export type SortMetric = "vol" | "net" | "traders";
// weighted=true 면 vol/net 을 신선도 가중값으로 정렬(traders 는 인원수라 무관). 기본 off — B(풀 스코어 엔진)
// 진행 여부의 반증 기준: 가중 on/off 가 top-N 을 의미있게 바꾸지 않으면 풀 엔진은 불필요.
export function rankList(aggs: TickerAgg[], metric: SortMetric, weighted = false): TickerAgg[] {
  const key = (s: TickerAgg) =>
    metric === "traders" ? new Set([...s.buyers.keys(), ...s.sellers.keys()]).size
    : metric === "vol" ? (weighted ? s.volFresh : s.vol)
    : (weighted ? s.netFresh : s.net);
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
