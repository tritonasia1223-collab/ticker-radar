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

// Finnhub finnhubIndustry(영문) → 한글 섹터. 키워드 포함 매칭, 미매핑 시 영문 그대로.
export function koSector(ind?: string | null): string {
  if (!ind) return "";
  const s = ind.toLowerCase();
  const pairs: [string, string][] = [
    ["semiconduct", "반도체"], ["bank", "은행"], ["insurance", "보험"], ["financial", "금융"],
    ["software", "소프트웨어"], ["technology", "기술"], ["energy", "에너지"], ["oil", "에너지"], ["gas", "에너지"],
    ["pharmaceutical", "제약"], ["biotech", "바이오"], ["health", "헬스케어"], ["medical", "의료"],
    ["aerospace", "방산"], ["defense", "방산"], ["communication", "통신"], ["telecom", "통신"], ["media", "미디어"],
    ["retail", "소매"], ["consumer", "소비재"], ["food", "식품"], ["beverage", "음료"], ["apparel", "의류"],
    ["machinery", "기계"], ["industrial", "산업재"], ["manufactur", "제조"], ["real estate", "부동산"], ["reit", "부동산"],
    ["utilit", "유틸리티"], ["auto", "자동차"], ["airline", "항공"], ["aviation", "항공"], ["chemical", "화학"],
    ["metal", "금속"], ["mining", "광업"], ["transport", "운송"], ["logistic", "물류"], ["construction", "건설"],
    ["hotel", "호텔·레저"], ["leisure", "레저"], ["restaurant", "외식"], ["tobacco", "담배"], ["agricultur", "농업"],
    ["electrical", "전기장비"], ["packaging", "포장"], ["life science", "생명과학"], ["trading", "상사"],
    ["professional", "전문서비스"], ["building", "건설"], ["distribut", "유통"], ["paper", "제지"],
    ["textile", "섬유"], ["containers", "포장"], ["equipment", "장비"], ["specialty", "전문소매"],
  ];
  for (const [k, v] of pairs) if (s.includes(k)) return v;
  return ind; // 미매핑 → 영문 산업명 그대로 표시
}

// 주요 종목 한글 회사명(있는 것만). 미등록은 영문만 표시.
const KO_COMPANY: Record<string, string> = {
  AAPL: "애플", MSFT: "마이크로소프트", NVDA: "엔비디아", GOOGL: "알파벳(구글)", GOOG: "알파벳(구글)",
  AMZN: "아마존", META: "메타", TSLA: "테슬라", QCOM: "퀄컴", AVGO: "브로드컴", TXN: "텍사스인스트루먼트",
  INTC: "인텔", AMD: "AMD", MU: "마이크론", ADI: "아날로그디바이스", NXPI: "NXP반도체", LRCX: "램리서치",
  AMAT: "어플라이드머티어리얼즈", KLAC: "KLA", MRVL: "마벨",
  JPM: "JP모건체이스", GS: "골드만삭스", BAC: "뱅크오브아메리카", WFC: "웰스파고", MS: "모건스탠리",
  C: "씨티그룹", V: "비자", MA: "마스터카드", "BRK.B": "버크셔해서웨이", "BRK.A": "버크셔해서웨이",
  AXP: "아메리칸익스프레스", BLK: "블랙록", SCHW: "찰스슈왑", FULT: "풀턴파이낸셜", MORN: "모닝스타",
  XOM: "엑슨모빌", CVX: "셰브론", COP: "코노코필립스", SLB: "슐럼버거", AESI: "아틀라스에너지",
  PFE: "화이자", JNJ: "존슨앤드존슨", MRK: "머크", LLY: "일라이릴리", ABBV: "애브비", AMGN: "암젠",
  UNH: "유나이티드헬스", CVS: "CVS헬스", DXCM: "덱스컴", PODD: "인슐렛", ICLR: "아이콘",
  DIS: "월트디즈니", NFLX: "넷플릭스", CMCSA: "컴캐스트", T: "AT&T", VZ: "버라이즌", TMUS: "T모바일",
  KO: "코카콜라", PEP: "펩시코", MCD: "맥도날드", SBUX: "스타벅스", NKE: "나이키", CTVA: "코르테바",
  WMT: "월마트", COST: "코스트코", HD: "홈디포", LOW: "로우스", TGT: "타깃", PG: "프록터앤드갬블",
  LMT: "록히드마틴", RTX: "RTX", NOC: "노스럽그루먼", GD: "제너럴다이내믹스", BA: "보잉", LHX: "L3해리스",
  CAT: "캐터필러", DE: "디어", GE: "GE에어로스페이스", HON: "허니웰", MMM: "3M", EMR: "에머슨",
  F: "포드", GM: "제너럴모터스", UPS: "UPS", FDX: "페덱스", DAL: "델타항공", UAL: "유나이티드항공",
  ORCL: "오라클", CRM: "세일즈포스", ADBE: "어도비", CSCO: "시스코", IBM: "IBM", ACN: "액센추어",
  NOW: "서비스나우", UBER: "우버", PLTR: "팔란티어", COIN: "코인베이스", PYPL: "페이팔", ABNB: "에어비앤비",
  TSM: "TSMC", ASML: "ASML", SMCI: "슈퍼마이크로", DELL: "델", HPQ: "HP", SNOW: "스노우플레이크",
  CEG: "콘스텔레이션에너지", NEE: "넥스트에라에너지", DUK: "듀크에너지", SO: "서던컴퍼니",
  SPG: "사이먼프로퍼티", LGIH: "LGI홈즈", DHI: "D.R.호턴", LEN: "레나", OI: "O-I글래스", STT: "스테이트스트리트",
};
export function koCompany(symbol: string): string {
  return KO_COMPANY[symbol.toUpperCase()] || "";
}

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
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2).replace(/\.?0+$/, "")}B`;
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
