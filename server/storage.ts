import {
  users, accounts, tweets, tickers, mentions, syncLogs, settings,
  politicians, committees, politicianCommittees, politicalTrades, tickerSectors,
  insiders, insiderTrades, interestSnapshots, reports,
} from "../shared/schema.js";
import type {
  User, InsertUser, Account, InsertAccount, Tweet, InsertTweet,
  Ticker, Mention, InsertMention, SyncLog,
  Politician, InsertPolitician, Committee, InsertPoliticalTrade, TickerSector,
  InsertInsider, InsertInsiderTrade, Report,
} from "../shared/schema.js";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, desc, sql, and, gte, lte, inArray } from "drizzle-orm";

// Lazy initialization: do NOT connect at module load time.
// On Vercel, importing this module must not throw or open a connection before
// the handler runs (env vars and network are only guaranteed inside the request).
let _db: ReturnType<typeof drizzle> | null = null;

function getDb() {
  if (_db) return _db;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Point it at your Supabase Postgres connection string.");
  }
  // `prepare: false` is required when going through Supabase's transaction pooler (pgbouncer).
  // Keep the per-client pool small + release idle connections fast: the Supabase session
  // pooler caps the whole project at ~15 clients, shared by Vercel functions + any local
  // dev server/scripts. A large default pool (10) exhausts it and 500s everything.
  const client = postgres(connectionString, { prepare: false, max: 3, idle_timeout: 20 });
  _db = drizzle(client);
  return _db;
}

// Proxy so existing `db.select()...` call sites work unchanged while staying lazy.
export const db: ReturnType<typeof drizzle> = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_t, prop) {
    const real = getDb() as any;
    const v = real[prop];
    return typeof v === "function" ? v.bind(real) : v;
  },
});

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
  changePercent: number; // recent vs prior window, as % (from lift)
  trend: number[];       // daily mention counts over the last 14 days (sparkline)
}

// One drill-down stock inside a sector tile.
export interface SectorStock {
  symbol: string;
  nameKo: string | null;
  nameEn: string | null;
  recentMentions: number;
  recentAccounts: number;
  priorMentions: number;
  changePercent: number;
}
// One sector tile for the discovery treemap. size = recentMentions, color = changePercent.
export interface SectorMapRow {
  sector: string;          // KR: Korean 업종; US: English sector (Korean-mapped on client)
  recentMentions: number;
  recentAccounts: number;  // distinct accounts mentioning ANY stock in the sector
  priorMentions: number;
  changePercent: number;   // recent vs prior window
  stocks: SectorStock[];   // members mentioned in window, sorted newly-rising first
}

// 관심종목등록 상위 (KIS) — list + trend types
export interface InterestRow {
  symbol: string; name: string | null; rank: number; regCount: number;
  price: number | null; changePct: number | null;
}
export interface InterestMover {
  symbol: string; name: string | null; regNow: number; regPrev: number; delta: number; rank: number;
}
export interface InterestTrend {
  dates: string[];                       // window snapshot dates, ascending
  movers: { up: InterestMover[]; down: InterestMover[] };
  series: { symbol: string; name: string | null; points: number[] }[]; // aligned to `dates`
}

// Collapse the messy raw industry strings (Nasdaq for US, Naver 업종 for KR) into clean,
// merged Korean categories for the treemap — so "Computer Software: Prepackaged Software"
// and "EDP Services" don't show up as separate tiles, and "기술" is split into "반도체" etc.
const US_INDUSTRY_KO: Record<string, string> = {
  "Semiconductors": "반도체",
  "Computer Software: Programming Data Processing": "소프트웨어",
  "Computer Software: Prepackaged Software": "소프트웨어",
  "EDP Services": "IT서비스",
  "Business Services": "IT서비스",
  "Diversified Commercial Services": "IT서비스",
  "Computer Manufacturing": "컴퓨터·하드웨어",
  "Computer peripheral equipment": "컴퓨터·하드웨어",
  "Office Equipment/Supplies/Services": "컴퓨터·하드웨어",
  "Electronic Components": "전자부품",
  "Industrial Machinery/Components": "산업기계",
  "Construction/Ag Equipment/Trucks": "산업기계",
  "Auto Manufacturing": "자동차",
  "Shoe Manufacturing": "소비재",
  "Recreational Games/Products/Toys": "소비재",
  "Restaurants": "외식·소비",
  "Catalog/Specialty Distribution": "유통·소매",
  "Department/Specialty Retail Stores": "유통·소매",
  "Other Consumer Services": "소비서비스",
  "Services-Misc. Amusement & Recreation": "소비서비스",
  "Finance: Consumer Services": "금융",
  "Investment Bankers/Brokers/Service": "증권",
  "Major Banks": "은행",
  "Commercial Banks": "은행",
  "Property-Casualty Insurers": "보험",
  "Broadcasting": "미디어",
  "Cable & Other Pay Television Services": "미디어",
  "Radio And Television Broadcasting And Communications Equipment": "통신장비",
  "Telecommunications Equipment": "통신장비",
  "Military/Government/Technical": "우주항공·방산",
  "Aerospace": "우주항공·방산",
  "Biotechnology: Pharmaceutical Preparations": "바이오·제약",
  "Biotechnology: Biological Products (No Diagnostic Substances)": "바이오·제약",
  "Medical/Nursing Services": "헬스케어",
  "Electrical Equipment": "전기장비",
  "Engineering & Construction": "건설",
  "Transportation Services": "운송",
  "Mining & Quarrying of Nonmetallic Minerals (No Fuels)": "소재",
  "Real Estate Investment Trusts": "리츠",
  "Financial Services": "금융",
  "Computer Communications Equipment": "통신장비",
  "Auto Parts:O.E.M.": "자동차부품",
  "Electrical Products": "전기제품",
  "Other Specialty Stores": "유통·소매",
  "Retail: Computer Software & Peripheral Equipment": "소프트웨어",
  "Biotechnology: Electromedical & Electrotherapeutic Apparatus": "의료기기",
  "Apparel": "의류",
  "Oil & Gas Production": "에너지",
  "Environmental Services": "환경",
  "Major Pharmaceuticals": "제약",
  "Industrial Specialties": "산업재",
  "Marine Transportation": "운송",
  "Metal Fabrications": "소재",
  // coarse Nasdaq sector fallbacks (when industry was blank at seed time)
  "Technology": "기술", "Finance": "금융", "Health Care": "헬스케어",
  "Consumer Discretionary": "임의소비재", "Industrials": "산업재", "Energy": "에너지",
};
// Verbose Naver 업종 → short label (most 업종 are already short and pass through).
const KR_UPJONG_KO: Record<string, string> = {
  "반도체와반도체장비": "반도체", "전자장비와기기": "전자장비", "우주항공과국방": "우주항공·방산",
  "양방향미디어와서비스": "인터넷·미디어", "다각화된통신서비스": "통신", "생명과학도구및서비스": "생명과학",
  "건강관리기술": "헬스케어", "건강관리장비와용품": "의료기기", "전문소매": "소매",
  "식품과기본식료품소매": "식품소매", "무역회사와판매업체": "무역·유통", "에너지장비및서비스": "에너지장비",
  "복합기업": "지주·복합", "기계류": "기계", "건축자재": "건자재", "식품과음료": "식음료",
};
function normalizeSector(raw: string | null, market: string): string {
  if (!raw) return "기타";
  if (market === "kr") return KR_UPJONG_KO[raw] || raw;
  return US_INDUSTRY_KO[raw] || raw;
}

// Politician with its committee ids attached (for the congress UI)
export interface PoliticianWithCommittees extends Politician {
  committees: string[];
}

// A single disclosed trade joined with its politician — the congress page
// aggregates these client-side (ranking / per-quarter / committee grouping),
// mirroring the prototype's logic.
export interface PoliticalTradeRow {
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

// 내부자거래 — 종목 랭킹(서버 집계)
export interface InsiderRankRow {
  symbol: string;
  company: string | null;
  sector: string | null;
  buyValue: number;
  sellValue: number;
  netValue: number;
  buyCount: number;
  sellCount: number;
  insiderCount: number; // 매수·매도(P·S) 한 인사이더 수
  otherInsiderCount: number; // 보상·옵션행사·세금 등만 한 인사이더 수(신호 아님)
  tradeCount: number; // 매수·매도 거래 건수
  signalScore: number; // 6레버 유의미도 점수(클러스터와 동일 엔진, 단독 포함). 하단 랭킹 정렬용.
  signalSide: "buy" | "sell" | null; // 유의미도를 주도한 방향
}
export interface InsiderTradeRow {
  id: number;
  insiderId: number;
  insiderName: string;
  insiderSlug: string;
  symbol: string;
  company: string | null;
  txnCode: string | null;
  side: string;
  shares: number | null;
  price: number | null;
  value: number | null;
  txnDate: number;
  filedDate: number | null;
  role: string | null;
  plan10b5: boolean | null; // true=10b5-1 정기플랜(노이즈) / false=재량적(시그널) / null=미확인
}
// 클러스터 시그널 — 같은 윈도우에 여러 인사이더가 같은 방향
export interface ClusterParticipant {
  slug: string; name: string; role: string | null; value: number; trades: number;
  qty: number; sharesAfter: number | null; pctOfHoldings: number | null; // 보유 대비 거래 비중(0~1+) — 절대액보다 핵심
  isNew: boolean; // 매수 pre≤0 = 진짜 신규 포지션(보유 0에서 매수). pct≥1 대량추가(pre>0)와 구분.
}
export interface InsiderCluster {
  symbol: string; company: string | null; sector: string | null;
  side: "buy" | "sell"; insiderCount: number; tradeCount: number; totalValue: number;
  windowFromMs: number; windowToMs: number; spanDays: number;
  participants: ClusterParticipant[]; score: number;
  thin: boolean;  // n=2 (합의 증거 약함, percap 비례 페널티 ×0.65~0.90)
  gated: boolean; // post=0 ≥3명 (구조적 일괄청산 의심, ×0.5 게이트)
}

// 직책 → 시그널 티어 가중(정보 접근도). 클라이언트 classifyRole 의 우선순위와 동일.
//   T1 CEO·회장/CFO=1.0 · 대주주=0.9 · T2 운영(COO/CTO/President)=0.7 · T3 기능=0.4 · T4 이사=0.25 · 미확인=0.3
function roleSignalWeight(role: string | null): number {
  if (!role) return 0.3;
  const r = role;
  const owner = /10\s*%/.test(r);
  if (/see\s*remarks/i.test(r)) return Math.max(0.3, owner ? 0.9 : 0);
  let w = 0.3;
  if (/\bceo\b/i.test(r) || /chief executive/i.test(r) || /chair(man|person|woman)?\b/i.test(r) || /\bcfo\b/i.test(r) || /chief financial/i.test(r)) w = 1.0;
  else if (/\bcoo\b/i.test(r) || /chief operating/i.test(r) || /\bcto\b/i.test(r) || /chief technology/i.test(r) || (/\bpresident\b/i.test(r) && !/vice[\s-]*president/i.test(r))) w = 0.7;
  else if (/\bclo\b/i.test(r) || /chief legal/i.test(r) || /general counsel/i.test(r) || /\bcounsel\b/i.test(r) || /\bcao\b/i.test(r) || /\bpao\b/i.test(r) || /chief accounting/i.test(r) || /controller/i.test(r) || /\bchro\b/i.test(r) || /\bcmo\b/i.test(r) || /chief\s+[\w\s]+officer/i.test(r) || /\b(?:e|s)?vp\b/i.test(r) || /vice\s*president/i.test(r) || /\bofficer\b/i.test(r)) w = 0.4;
  else if (/\bdirector\b/i.test(r)) w = 0.25;
  return Math.max(w, owner ? 0.9 : 0); // 대주주는 최소 0.9 (창업자·VC·행동주의)
}
// 보유 대비 거래 비중 = qty / 거래직전 보유(pre). pre = 매수 ? after-qty : after+qty.
function holdingsPct(side: string, qty: number, sharesAfter: number | null): number | null {
  if (sharesAfter == null || qty <= 0) return null;
  if (side === "buy") {
    const pre = sharesAfter - qty;
    if (pre < 0) return null;   // qty>post = 데이터 이상(외국발행사 post-holdings 깨짐) → 중립(강함 아님)
    if (pre === 0) return 1.0;  // 순수 신규 포지션 = 강한 컨빅션
    return qty / pre;
  }
  // 매도: pre = post + qty (항상 ≥ qty > 0). post=0 이면 전량청산(ratio=100%).
  return qty / (sharesAfter + qty);
}
// 보유% → 배율: >50%=1.5 · 10~50%=1.0 · <10%=0.5 · 데이터없음=1.0(중립). "비정상 규모"의 진짜 의미.
function holdingsMultiplier(pct: number | null): number {
  if (pct == null) return 1.0;
  return pct > 0.5 ? 1.5 : pct >= 0.1 ? 1.0 : 0.5;
}
const isTenPctOwner = (role: string | null) => role != null && /10\s*%/.test(role);
// 참가자 1인의 시그널 기여 = 티어 가중 × 절대규모(로그=바닥필터) × 보유대비배율(진짜 가중).
//   클래스 캡: 10% Owner의 거의-전량 매도(≥80%)는 PE 블록 청산 패턴(컨빅션 아님) → 배율 최대 1.0(×1.5 금지).
//   매수·부분매도·저비중·비(非)10%Owner 는 캡 없음 — PE의 드문 진짜 베팅/추가매집은 안 죽임. 0이 아니라 '보통 매도' 수준으로 하향.
function participantSignal(p: ClusterParticipant, side: string, massPost0: boolean): number {
  let m = holdingsMultiplier(p.pctOfHoldings);
  const capped = side === "sell" && isTenPctOwner(p.role) && p.pctOfHoldings != null && p.pctOfHoldings >= 0.80;
  if (capped) m = Math.min(m, 1.0); // 클래스 캡: 10%Owner 거의-전량 매도(PE 블록청산)
  // post=0 동시성 게이트: 같은 윈도우 post=0 ≥3명 = 구조적 이벤트(외국발행사 일괄 정정·전환 등) → 그 건들 ×0.5.
  //   단독(1~2명) post=0 은 진짜 전량매도 경보라 유지. 캡 받은 건엔 중복 적용 안 함(상호배제).
  else if (side === "sell" && massPost0 && p.sharesAfter === 0) m *= 0.5;
  return roleSignalWeight(p.role) * (1 + Math.log10(1 + Math.abs(p.value) / 1e5)) * m;
}
// thin(n=2) 페널티 — 개수가 아니라 1인당 시그널 강도에 연동.
//   n=2는 breadth(합의 증거)가 약하지만, 그 약함의 정도는 '누가' 모였느냐에 달림.
//   고티어 2인 큰 컨빅션(percap↑, 예: CEO+CFO 보유 다수 매도)은 우연일 확률이 낮음 → 페널티 완화.
//   저티어/소액 2인(percap↓)은 우연 vs 조율 구분 안 됨 → full 페널티 유지(하단 노이즈 그대로).
//   천장 0.90: 아무리 강해도 n≥3 정상 클러스터 대비 breadth 겸손분 10%는 남긴다.
//   ※ percap 은 클래스캡 적용 後 시그널로 계산됨(participantSignal 내부 캡 반영) → 캡이 죽인 규모가 thin 완화로 안 샘.
//   앵커 0.5/1.5 출처: 2026-06 데이터셋(240클러스터) 분포 캘리브레이션 — 저티어n=2 percap 0.66 / n≥3 0.97 / 고티어n=2 1.46.
//   → 0.5=노이즈 바닥(full 페널티), 1.5=고티어 평균 부근(거의 완화). 데이터 크게 늘면 script/diag-clusters.ts 로 재캘리브레이션.
function thinPenalty(perCapita: number): number {
  const t = Math.max(0, Math.min(1, (perCapita - 0.5) / 1.0)); // percap 0.5→0, 1.5→1
  return 0.65 + 0.25 * t; // [0.65, 0.90]
}

// ── joint-filer dedup ────────────────────────────────────────────────────────
// 문제: 엔티티(펀드)와 그 지배인/관계회사가 '동일 수익포지션'을 각자 Form4 로 신고 → 한 포지션이 N개 이름으로.
//   결과: 클러스터 insiderCount(breadth) 가짜 부풀림 + value log항 N중 중복(예: NRG LS Power+Nanus $2.6B 2번).
//   이건 분모/캡 문제가 아니라 '한 번만 세기' 문제 → 동일 포지션 행을 대표 1행으로 접는다.
// 안전조건(전 테이블 충돌 리포트로 검증, script/dedup-report.ts):
//   ① side IN(buy,sell) — A(부여) 코드는 이미 제외(이사회 일괄부여 오병합 차단).
//   ② 동일 튜플 = (txnDate, shares, sharesAfter, txnCode).
//   ③ 동일 filer-prefix(accession 앞 10자리 = 같은 제출배치). 공동신고자는 인접 accession을 받음(-023624/-023625).
//   ④ 그룹에 조직 엔티티 ≥1개. 자연인-only(예: ESLT 임원 3인 동일수량)는 진짜 피어 → 보존(실제 합의 파괴 방지).
//   ⑤ 서로 다른 인사이더 ≥2.
// 병합 속성 생존: 대표=roleWeight max(→엔티티 우선→slug순), 10%Owner=그룹 OR(클래스캡 자격 보존 — dedup이 점수 올리는 사고 방지).
const ENTITY_RE = /\b(l\.?l\.?c|l\.?p\.?|lp|inc|corp|ltd|group|partners?|capital|fund|trust|holdings?|holdco|advis|management|ventures?|equity|coinvest|investment|associates|gp)\b/i;
const isEntityName = (name: string | null) => !!name && ENTITY_RE.test(name);
const filerPrefix = (ext: string | null): string => { const m = /^fin:(\d{10})-/.exec(ext || ""); return m ? m[1] : ""; };
function dedupeJointFilers(rows: any[]): any[] {
  const groups = new Map<string, any[]>();
  for (const r of rows) {
    const k = [r.symbol, r.side, filerPrefix(r.ext), r.txnDate, r.shares, r.sharesAfter, r.code].join("|");
    const g = groups.get(k); if (g) g.push(r); else groups.set(k, [r]);
  }
  const drop = new Set<any>();
  for (const g of groups.values()) {
    if (new Set(g.map((r) => r.slug)).size < 2) continue;        // ⑤ 단독 → 유지
    if (!g.some((r) => isEntityName(r.name))) continue;          // ④ 자연인-only 피어 → 보존
    const rep = g.slice().sort((a, b) =>
      roleSignalWeight(b.role) - roleSignalWeight(a.role) ||
      (isEntityName(b.name) ? 1 : 0) - (isEntityName(a.name) ? 1 : 0) ||
      (String(a.slug) < String(b.slug) ? -1 : 1))[0];
    if (g.some((r) => isTenPctOwner(r.role)) && !isTenPctOwner(rep.role))
      rep.role = (rep.role ? rep.role + " · " : "") + "10% Owner";  // 10%Owner OR (캡 자격 보존)
    for (const r of g) if (r !== rep) drop.add(r);
  }
  return drop.size ? rows.filter((r) => !drop.has(r)) : rows;
}
// ── cross-ticker dedup (#24) ──────────────────────────────────────────────────
// 문제: 듀얼클래스 발행사(Alphabet GOOG/GOOGL · Fox FOX/FOXA · Alibaba BABA/BABAF …)의 한 Form4 가
//   Finnhub 의 클래스별 티커 조회 양쪽에서 반환 → 동일 제출이 두 심볼로 들어와 인사이더·금액 이중계상.
//   accession(=external_id 의 2번째 토큰)은 SEC 전역 유일 → 같은 accession 이 ≥2 심볼이면 동일 제출 확정
//   (우연 불가; filerPrefix 가 아니라 전체 accession 으로 매칭). 전수 검증: script/orphan-classify.ts.
//   GOOG 케이스는 insider FK 깨짐(orphan)이라 이미 fetch 의 INNER JOIN 에서 드롭됨 → 여기 입력에 없음.
//   여기서 실제로 접는 건 양쪽 다 healthy 라 둘 다 살아있는 FOX/FOXA·BABA/BABAF 류.
// canonical = 기존 데이터만으로 답이 나오는 전함수(외부 거래량 피드 의존·하드코딩 쌍 예외 없음 — 미래 쌍 자동 커버):
//   ① healthy distinct 인사이더 수 desc(실데이터 있는 쪽 우선: GOOGL 5 > GOOG 0)
//   ② 동률 → 행 수 desc   ③ 동률 → 심볼 길이 asc(F·접미사 비유동 클래스가 길어지는 경향: BABA<BABAF)
//   ④ 최종 결정적 폴백 → 사전순 asc  ⟶ 어떤 입력에도 단일 canonical 보장.
//   주의: ③④는 유동성 신호가 아니라 '데이터 대칭일 때의 결정적 타이브레이크'(금액·점수는 어느 쪽이든 동일 — 표시문제).
//   현 데이터 결과: GOOGL·BABA·FOX 보존. (FOX vs FOXA 는 대칭이라 길이규칙이 FOX 선택 — 표시상 무의미한 차이.)
const accessionOf = (ext: string | null): string => { const m = /^fin:([^:]+):/.exec(ext || ""); return m ? m[1] : ""; };
function dedupeCrossTicker(rows: any[]): any[] {
  const symsByAcc = new Map<string, Set<string>>();
  for (const r of rows) {
    const a = accessionOf(r.ext); if (!a) continue;
    const s = symsByAcc.get(a); if (s) s.add(r.symbol); else symsByAcc.set(a, new Set([r.symbol]));
  }
  const crossSyms = new Set<string>();
  for (const s of symsByAcc.values()) if (s.size >= 2) for (const x of s) crossSyms.add(x);
  if (!crossSyms.size) return rows;
  const stat = new Map<string, { ins: Set<number>; rows: number }>();
  for (const r of rows) {
    if (!crossSyms.has(r.symbol)) continue;
    const st = stat.get(r.symbol) || { ins: new Set<number>(), rows: 0 };
    st.ins.add(Number(r.insiderId)); st.rows++; stat.set(r.symbol, st);
  }
  const better = (a: string, b: string): string => {       // canonical = 더 'primary' 한 심볼
    const sa = stat.get(a)!, sb = stat.get(b)!;
    if (sa.ins.size !== sb.ins.size) return sa.ins.size > sb.ins.size ? a : b; // ①
    if (sa.rows !== sb.rows) return sa.rows > sb.rows ? a : b;                  // ②
    if (a.length !== b.length) return a.length < b.length ? a : b;             // ③
    return a < b ? a : b;                                                      // ④
  };
  const canonByAcc = new Map<string, string>();
  for (const [a, s] of symsByAcc) if (s.size >= 2) canonByAcc.set(a, [...s].reduce((x, y) => better(x, y)));
  const drop = new Set<any>();
  for (const r of rows) { const c = canonByAcc.get(accessionOf(r.ext)); if (c && r.symbol !== c) drop.add(r); }
  return drop.size ? rows.filter((r) => !drop.has(r)) : rows;
}

// 종목별 median 단가 → 비정상 단가(>$1M 또는 median 50배 초과, 예: CRWV $117인데 $700k~$11M)는 금액 0.
//   클러스터·랭킹이 같은 가드를 쓰도록 모듈 공유(복사 금지 — 한 벌만 존재).
function makeCleanValue(rows: any[]): (r: any) => number {
  const pricesBySym = new Map<string, number[]>();
  for (const r of rows) { const p = Number(r.price); if (p > 0) { const a = pricesBySym.get(r.symbol); if (a) a.push(p); else pricesBySym.set(r.symbol, [p]); } }
  const medBySym = new Map<string, number>();
  for (const [s, a] of pricesBySym) { a.sort((x, y) => x - y); medBySym.set(s, a[Math.floor(a.length / 2)]); }
  return (r: any): number => {
    const p = Number(r.price); const med = medBySym.get(r.symbol);
    if (p > 1_000_000 || (med && p > 50 * med)) return 0;
    return Number(r.value) || 0;
  };
}

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // accounts
  listAccounts(): Promise<Account[]>;
  createAccount(a: InsertAccount): Promise<Account>;
  updateAccount(id: number, patch: Partial<Account>): Promise<Account | undefined>;
  deleteAccount(id: number): Promise<void>;
  getAccountByHandle(handle: string): Promise<Account | undefined>;
  setAccountCursor(id: number, lastTweetId: string | null, lastSyncedAt: number): Promise<void>;

  // tweets
  insertTweetIfNew(t: InsertTweet): Promise<boolean>; // returns true if inserted (new)
  recentTweets(limit: number): Promise<Tweet[]>;
  tweetsForSymbol(symbol: string, limit: number): Promise<Tweet[]>;

  // tickers
  listTickers(): Promise<Ticker[]>;
  upsertTicker(t: Ticker): Promise<void>;

  // mentions
  insertMentionIfNew(m: InsertMention): Promise<boolean>;
  surge(windowHours: number, minAccounts: number, market?: string): Promise<SurgeRow[]>;
  sectorMap(windowHours: number, market?: string): Promise<SectorMapRow[]>;
  interestToday(): Promise<{ date: string | null; rows: InterestRow[] }>;
  interestTrend(days: number): Promise<InterestTrend>;
  getReport(symbol: string): Promise<Report | null>;
  symbolTimeline(symbol: string, days: number): Promise<{ day: string; count: number }[]>;

  // sync logs
  createSyncLog(startedAt: number, handlesRequested: number): Promise<number>;
  updateSyncLog(id: number, patch: Partial<SyncLog>): Promise<void>;
  recentSyncLogs(limit: number): Promise<SyncLog[]>;

  // settings
  getSetting(key: string): Promise<string | undefined>;
  setSetting(key: string, value: string): Promise<void>;

  // stats
  counts(): Promise<{ accounts: number; tweets: number; mentions: number; symbols: number }>;

  // --- Congress / politician trading ---
  listPoliticians(): Promise<PoliticianWithCommittees[]>;
  listCommittees(): Promise<Committee[]>;
  politicalTrades(opts: { fromMs?: number; toMs?: number; committeeId?: string }): Promise<PoliticalTradeRow[]>;
  // ingestion (seed / collect)
  upsertPolitician(p: InsertPolitician): Promise<number>;
  upsertCommittee(c: Committee): Promise<void>;
  linkPoliticianCommittee(politicianId: number, committeeId: string): Promise<void>;
  insertPoliticalTradeIfNew(t: InsertPoliticalTrade): Promise<boolean>;
  clearPoliticianData(): Promise<void>;
  clearCommitteesAndLinks(): Promise<void>;
  // ticker sector/industry
  setTickerSector(symbol: string, sector: string | null): Promise<void>;
  listTickerSectors(): Promise<TickerSector[]>;
  distinctTradedSymbols(): Promise<string[]>;
  distinctMentionedSymbols(): Promise<string[]>;

  // --- Insider trading (Form 4) ---
  upsertInsider(i: InsertInsider): Promise<number>;
  insertInsiderTradeIfNew(t: InsertInsiderTrade): Promise<boolean>;
  clearInsiderData(): Promise<void>;
  insiderRanking(opts: { fromMs?: number; toMs?: number }): Promise<InsiderRankRow[]>;
  insiderTradesForSymbol(symbol: string, opts: { fromMs?: number; toMs?: number; limit?: number }): Promise<InsiderTradeRow[]>;
  insiderTradesForInsider(slug: string, opts: { fromMs?: number; toMs?: number }): Promise<InsiderTradeRow[]>;
  distinctInsiderSymbols(): Promise<string[]>;
  insiderPairsNeedingRole(): Promise<{ insiderId: number; symbol: string; name: string; externalId: string | null }[]>;
  setInsiderRole(insiderId: number, symbol: string, role: string | null): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number) {
    return (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
  }
  async getUserByUsername(username: string) {
    return (await db.select().from(users).where(eq(users.username, username)).limit(1))[0];
  }
  async createUser(u: InsertUser) {
    return (await db.insert(users).values(u).returning())[0];
  }

  async listAccounts() { return db.select().from(accounts).orderBy(desc(accounts.createdAt)); }
  async createAccount(a: InsertAccount) {
    return (await db.insert(accounts).values({
      handle: a.handle, displayName: a.displayName ?? null, note: a.note ?? null,
      platform: a.platform ?? "x", active: a.active ?? true, createdAt: Date.now(),
    }).returning())[0];
  }
  async updateAccount(id: number, patch: Partial<Account>) {
    return (await db.update(accounts).set(patch).where(eq(accounts.id, id)).returning())[0];
  }
  async deleteAccount(id: number) { await db.delete(accounts).where(eq(accounts.id, id)); }
  async getAccountByHandle(handle: string) {
    return (await db.select().from(accounts).where(eq(accounts.handle, handle.toLowerCase())).limit(1))[0];
  }
  async setAccountCursor(id: number, lastTweetId: string | null, lastSyncedAt: number) {
    await db.update(accounts).set({ lastTweetId: lastTweetId ?? undefined, lastSyncedAt }).where(eq(accounts.id, id));
  }

  async insertTweetIfNew(t: InsertTweet) {
    const r = await db.insert(tweets).values(t).onConflictDoNothing({ target: tweets.tweetId }).returning();
    return r.length > 0;
  }
  async recentTweets(limit: number) {
    return db.select().from(tweets).orderBy(desc(tweets.tweetedAt)).limit(limit);
  }
  async tweetsForSymbol(symbol: string, limit: number) {
    const rows = await db.select({ t: tweets }).from(mentions)
      .innerJoin(tweets, eq(mentions.tweetId, tweets.tweetId))
      .where(eq(mentions.symbol, symbol.toUpperCase()))
      .orderBy(desc(tweets.tweetedAt)).limit(limit);
    // de-dup tweets (a tweet may have cashtag+name mention)
    const seen = new Set<string>();
    const out: Tweet[] = [];
    for (const r of rows) { if (!seen.has(r.t.tweetId)) { seen.add(r.t.tweetId); out.push(r.t); } }
    return out;
  }

  async listTickers() { return db.select().from(tickers); }
  // companyNameKo is optional and intentionally NOT in the conflict-update set, so the
  // Korean names seeded by script/seed-korean-names.ts survive a re-upsert from the API/seed.
  async upsertTicker(t: Omit<Ticker, "companyNameKo" | "market"> & { companyNameKo?: string | null; market?: string }) {
    await db.insert(tickers).values(t).onConflictDoUpdate({
      target: tickers.symbol,
      set: { companyName: t.companyName, aliases: t.aliases, exchange: t.exchange },
    });
  }

  async insertMentionIfNew(m: InsertMention) {
    const r = await db.insert(mentions).values(m)
      .onConflictDoNothing({ target: [mentions.tweetId, mentions.symbol, mentions.source] }).returning();
    return r.length > 0;
  }

  // Anchor the discovery time-windows to the latest collected mention, NOT wall-clock now.
  // So "최근 24시간" means the 24h ending at the last collection — the surge stays visible
  // until the next collect, instead of going empty as real time slides past the data.
  private async anchorTime(): Promise<number> {
    const r = (await db.execute(sql`SELECT MAX(tweeted_at) AS t FROM mentions`)) as unknown as any[];
    const t = Number(r[0]?.t);
    return Number.isFinite(t) && t > 0 ? t : Date.now();
  }

  // Surge detection: compare a recent window vs the immediately preceding window of equal length.
  async surge(windowHours: number, minAccounts: number, market = "us"): Promise<SurgeRow[]> {
    const now = await this.anchorTime();
    const winMs = windowHours * 3600 * 1000;
    const recentStart = now - winMs;
    const priorStart = now - 2 * winMs;

    // Aliases are double-quoted to preserve camelCase (Postgres lowercases bare identifiers).
    const rows = (await db.execute(sql`
      SELECT m.symbol AS symbol,
             COUNT(*) AS "totalMentions",
             COUNT(DISTINCT m.account_id) AS "distinctAccounts",
             SUM(CASE WHEN m.tweeted_at >= ${recentStart} THEN 1 ELSE 0 END) AS "recentMentions",
             COUNT(DISTINCT CASE WHEN m.tweeted_at >= ${recentStart} THEN m.account_id END) AS "recentAccounts",
             SUM(CASE WHEN m.tweeted_at >= ${priorStart} AND m.tweeted_at < ${recentStart} THEN 1 ELSE 0 END) AS "priorMentions",
             MIN(m.tweeted_at) AS "firstSeen",
             MAX(m.tweeted_at) AS "lastSeen",
             string_agg(DISTINCT m.handle, ',') AS handles
      FROM mentions m
      GROUP BY m.symbol
    `)) as unknown as any[];

    const out: SurgeRow[] = rows.map((r) => {
      const recent = Number(r.recentMentions) || 0;
      const prior = Number(r.priorMentions) || 0;
      const recentAccounts = Number(r.recentAccounts) || 0;
      // surge score: recent volume weighted by breadth (distinct accounts), vs prior baseline.
      const lift = (recent + 1) / (prior + 1);
      const surgeScore = recent * recentAccounts * lift;
      return {
        symbol: r.symbol,
        companyName: null,
        companyNameKo: null,
        totalMentions: Number(r.totalMentions),
        distinctAccounts: Number(r.distinctAccounts),
        recentMentions: recent,
        recentAccounts,
        priorMentions: prior,
        surgeScore: Math.round(surgeScore * 100) / 100,
        firstSeen: Number(r.firstSeen),
        lastSeen: Number(r.lastSeen),
        accounts: (r.handles ? String(r.handles).split(",") : []),
        changePercent: Math.round((lift - 1) * 100),
        trend: [],
      };
    });

    // attach company names + market
    const tk = await this.listTickers();
    const nameMap = new Map(tk.map((t) => [t.symbol, t.companyName]));
    const koMap = new Map(tk.map((t) => [t.symbol, t.companyNameKo]));
    const marketMap = new Map(tk.map((t) => [t.symbol, t.market]));
    for (const o of out) {
      o.companyName = nameMap.get(o.symbol) ?? null;
      o.companyNameKo = koMap.get(o.symbol) ?? null;
    }
    // keep only the requested market: 'kr' = KR-coded tickers; 'us' = everything else
    // (US tickers + bare cashtags not in the table).
    const inMarket = (sym: string) => (market === "kr" ? marketMap.get(sym) === "kr" : marketMap.get(sym) !== "kr");

    // attach a 14-day daily mention trend per symbol (one query) for the sparkline
    const TREND_DAYS = 14;
    const trendStart = now - TREND_DAYS * 86400 * 1000;
    const trendRows = (await db.execute(sql`
      SELECT m.symbol AS symbol,
             to_char(to_timestamp(m.tweeted_at / 1000), 'YYYY-MM-DD') AS day,
             COUNT(*) AS c
      FROM mentions m WHERE m.tweeted_at >= ${trendStart}
      GROUP BY m.symbol, day
    `)) as unknown as any[];
    const trendMap = new Map<string, Map<string, number>>();
    for (const r of trendRows) {
      let mm = trendMap.get(r.symbol);
      if (!mm) { mm = new Map(); trendMap.set(r.symbol, mm); }
      mm.set(r.day, Number(r.c));
    }
    const axis: string[] = [];
    for (let i = TREND_DAYS - 1; i >= 0; i--) axis.push(new Date(now - i * 86400 * 1000).toISOString().slice(0, 10));
    for (const o of out) {
      const mm = trendMap.get(o.symbol);
      o.trend = axis.map((d) => mm?.get(d) ?? 0);
    }

    // rank by distinct accounts first (de-spammed: one account can't inflate a symbol by
    // posting repeatedly), then by raw mention count as a tiebreak.
    return out
      .filter((o) => o.recentAccounts >= minAccounts && o.recentMentions > 0 && inMarket(o.symbol))
      .sort((a, b) => b.recentAccounts - a.recentAccounts || b.recentMentions - a.recentMentions);
  }

  // Sector treemap for discovery: group window mentions by 업종/sector. Tiles sized by
  // recentMentions, colored by changePercent (recent vs prior window). Each tile carries its
  // member stocks (sorted newly-rising first) so the client can drill down without another call.
  async sectorMap(windowHours: number, market = "us"): Promise<SectorMapRow[]> {
    const now = await this.anchorTime();
    const winMs = windowHours * 3600 * 1000;
    const recentStart = now - winMs;
    const priorStart = now - 2 * winMs;
    // KR = tickers.market 'kr'; US = everything else (incl. bare cashtags absent from tickers).
    const marketCond = market === "kr"
      ? sql`t.market = 'kr'`
      : sql`(t.market IS DISTINCT FROM 'kr')`;

    // Per-symbol recent/prior counts within the prior+recent window, joined to sector + names.
    const rows = (await db.execute(sql`
      SELECT m.symbol AS symbol,
             COALESCE(ts.sector, '기타') AS sector,
             t.company_name AS "nameEn",
             t.company_name_ko AS "nameKo",
             SUM(CASE WHEN m.tweeted_at >= ${recentStart} THEN 1 ELSE 0 END) AS "recentMentions",
             COUNT(DISTINCT CASE WHEN m.tweeted_at >= ${recentStart} THEN m.account_id END) AS "recentAccounts",
             SUM(CASE WHEN m.tweeted_at >= ${priorStart} AND m.tweeted_at < ${recentStart} THEN 1 ELSE 0 END) AS "priorMentions"
      FROM mentions m
      LEFT JOIN tickers t ON t.symbol = m.symbol
      LEFT JOIN ticker_sectors ts ON ts.symbol = m.symbol
      WHERE m.tweeted_at >= ${priorStart} AND ${marketCond}
      GROUP BY m.symbol, ts.sector, t.company_name, t.company_name_ko
    `)) as unknown as any[];

    // Distinct (sector, account) pairs in the recent window. We normalize the raw sector in JS
    // and count distinct accounts per *normalized* sector (can't be summed — accounts overlap).
    const acctRows = (await db.execute(sql`
      SELECT COALESCE(ts.sector, '기타') AS sector, m.account_id AS "accountId"
      FROM mentions m
      LEFT JOIN tickers t ON t.symbol = m.symbol
      LEFT JOIN ticker_sectors ts ON ts.symbol = m.symbol
      WHERE m.tweeted_at >= ${recentStart} AND ${marketCond}
      GROUP BY ts.sector, m.account_id
    `)) as unknown as any[];
    const acctSet = new Map<string, Set<number>>();
    for (const r of acctRows) {
      const key = normalizeSector(r.sector, market);
      let set = acctSet.get(key);
      if (!set) { set = new Set(); acctSet.set(key, set); }
      set.add(Number(r.accountId));
    }

    const bySector = new Map<string, SectorMapRow>();
    for (const r of rows) {
      const recent = Number(r.recentMentions) || 0;
      if (recent === 0) continue; // only sectors active in the recent window
      const prior = Number(r.priorMentions) || 0;
      const sector = normalizeSector(r.sector, market);
      let s = bySector.get(sector);
      if (!s) {
        s = { sector, recentMentions: 0, recentAccounts: acctSet.get(sector)?.size ?? 0, priorMentions: 0, changePercent: 0, stocks: [] };
        bySector.set(sector, s);
      }
      s.recentMentions += recent;
      s.priorMentions += prior;
      s.stocks.push({
        symbol: r.symbol,
        nameKo: r.nameKo ?? null,
        nameEn: r.nameEn ?? null,
        recentMentions: recent,
        recentAccounts: Number(r.recentAccounts) || 0,
        priorMentions: prior,
        changePercent: Math.round(((recent + 1) / (prior + 1) - 1) * 100),
      });
    }

    const out = [...bySector.values()];
    for (const s of out) {
      s.changePercent = Math.round(((s.recentMentions + 1) / (s.priorMentions + 1) - 1) * 100);
      // drill-down surfaces newly-rising names first: by jump, then by breadth/volume.
      s.stocks.sort((a, b) => b.changePercent - a.changePercent || b.recentAccounts - a.recentAccounts || b.recentMentions - a.recentMentions);
    }
    // biggest tiles first (size = recentMentions).
    return out.sort((a, b) => b.recentMentions - a.recentMentions);
  }

  // ---- 관심종목등록 상위 (KIS daily snapshots) ----
  async interestToday(): Promise<{ date: string | null; rows: InterestRow[] }> {
    const d = (await db.execute(sql`SELECT MAX(date) AS date FROM interest_snapshots`)) as unknown as any[];
    const date = d[0]?.date ?? null;
    if (!date) return { date: null, rows: [] };
    const rows = (await db.execute(sql`
      SELECT symbol, name, rank, reg_count AS "regCount", price, change_pct AS "changePct"
      FROM interest_snapshots WHERE date = ${date} ORDER BY rank ASC
    `)) as unknown as any[];
    return {
      date,
      rows: rows.map((r) => ({
        symbol: r.symbol, name: r.name ?? null, rank: Number(r.rank), regCount: Number(r.regCount),
        price: r.price == null ? null : Number(r.price), changePct: r.changePct == null ? null : Number(r.changePct),
      })),
    };
  }

  async interestTrend(days: number): Promise<InterestTrend> {
    // the last `days` distinct snapshot dates
    const dateRows = (await db.execute(sql`
      SELECT DISTINCT date FROM interest_snapshots ORDER BY date DESC LIMIT ${days}
    `)) as unknown as any[];
    const dates = dateRows.map((r) => r.date as string).sort();
    if (dates.length === 0) return { dates: [], movers: { up: [], down: [] }, series: [] };
    const earliest = dates[0], latest = dates[dates.length - 1];

    const rows = (await db.execute(sql`
      SELECT date, symbol, name, reg_count AS "regCount", rank
      FROM interest_snapshots WHERE date >= ${earliest}
    `)) as unknown as any[];

    // symbol -> { name, perDate: Map<date, regCount>, latestRank }
    const bySym = new Map<string, { name: string | null; perDate: Map<string, number>; rank: number }>();
    for (const r of rows) {
      let e = bySym.get(r.symbol);
      if (!e) { e = { name: r.name ?? null, perDate: new Map(), rank: 9999 }; bySym.set(r.symbol, e); }
      e.perDate.set(r.date, Number(r.regCount));
      if (r.date === latest) e.rank = Number(r.rank);
    }

    const movers: InterestMover[] = [];
    for (const [symbol, e] of bySym) {
      const regNow = e.perDate.get(latest) ?? 0;
      const regPrev = e.perDate.get(earliest) ?? 0;
      movers.push({ symbol, name: e.name, regNow, regPrev, delta: regNow - regPrev, rank: e.rank });
    }
    const up = movers.filter((m) => m.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 10);
    const down = movers.filter((m) => m.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 10);

    // chart trajectories of the currently most-popular 8 (rising & falling both visible)
    const top = [...bySym.entries()]
      .map(([symbol, e]) => ({ symbol, name: e.name, perDate: e.perDate, now: e.perDate.get(latest) ?? 0 }))
      .sort((a, b) => b.now - a.now)
      .slice(0, 8);
    const series = top.map((t) => ({ symbol: t.symbol, name: t.name, points: dates.map((d) => t.perDate.get(d) ?? 0) }));

    return { dates, movers: { up, down }, series };
  }

  async getReport(symbol: string): Promise<Report | null> {
    const r = await db.select().from(reports).where(eq(reports.symbol, symbol.toUpperCase())).limit(1);
    return r[0] ?? null;
  }

  async symbolTimeline(symbol: string, days: number) {
    const start = (await this.anchorTime()) - days * 86400 * 1000;
    const rows = (await db.execute(sql`
      SELECT to_char(to_timestamp(m.tweeted_at / 1000), 'YYYY-MM-DD') AS day, COUNT(*) AS count
      FROM mentions m WHERE m.symbol = ${symbol.toUpperCase()} AND m.tweeted_at >= ${start}
      GROUP BY day ORDER BY day
    `)) as unknown as any[];
    return rows.map((r) => ({ day: r.day, count: Number(r.count) }));
  }

  async createSyncLog(startedAt: number, handlesRequested: number) {
    const r = (await db.insert(syncLogs).values({ startedAt, status: "running", handlesRequested }).returning())[0];
    return r.id;
  }
  async updateSyncLog(id: number, patch: Partial<SyncLog>) {
    await db.update(syncLogs).set(patch).where(eq(syncLogs.id, id));
  }
  async recentSyncLogs(limit: number) {
    return db.select().from(syncLogs).orderBy(desc(syncLogs.startedAt)).limit(limit);
  }

  async getSetting(key: string) {
    const r = (await db.select().from(settings).where(eq(settings.key, key)).limit(1))[0];
    return r?.value ?? undefined;
  }
  async setSetting(key: string, value: string) {
    await db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
  }

  async counts() {
    const r = (await db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM accounts) AS accounts,
        (SELECT COUNT(*) FROM tweets) AS tweets,
        (SELECT COUNT(*) FROM mentions) AS mentions,
        (SELECT COUNT(DISTINCT symbol) FROM mentions) AS symbols
    `)) as unknown as any[];
    const row = r[0] ?? {};
    return {
      accounts: Number(row.accounts) || 0,
      tweets: Number(row.tweets) || 0,
      mentions: Number(row.mentions) || 0,
      symbols: Number(row.symbols) || 0,
    };
  }

  // --- Congress / politician trading ---
  async listPoliticians(): Promise<PoliticianWithCommittees[]> {
    const pols = await db.select().from(politicians).orderBy(politicians.name);
    const links = await db.select().from(politicianCommittees);
    const byPol = new Map<number, string[]>();
    for (const l of links) {
      if (!byPol.has(l.politicianId)) byPol.set(l.politicianId, []);
      byPol.get(l.politicianId)!.push(l.committeeId);
    }
    return pols.map((p) => ({ ...p, committees: byPol.get(p.id) ?? [] }));
  }

  async listCommittees() { return db.select().from(committees); }

  async politicalTrades(opts: { fromMs?: number; toMs?: number; committeeId?: string }): Promise<PoliticalTradeRow[]> {
    const conds: any[] = [];
    if (opts.fromMs != null) conds.push(gte(politicalTrades.txnDate, opts.fromMs));
    if (opts.toMs != null) conds.push(lte(politicalTrades.txnDate, opts.toMs));
    if (opts.committeeId) {
      const links = await db.select().from(politicianCommittees)
        .where(eq(politicianCommittees.committeeId, opts.committeeId));
      const ids = links.map((l) => l.politicianId);
      if (ids.length === 0) return [];
      conds.push(inArray(politicalTrades.politicianId, ids));
    }
    const rows = await db
      .select({
        id: politicalTrades.id,
        politicianId: politicalTrades.politicianId,
        slug: politicians.slug,
        name: politicians.name,
        party: politicians.party,
        chamber: politicians.chamber,
        state: politicians.state,
        symbol: politicalTrades.symbol,
        company: politicalTrades.company,
        side: politicalTrades.side,
        amountLow: politicalTrades.amountLow,
        amountHigh: politicalTrades.amountHigh,
        txnDate: politicalTrades.txnDate,
        filedDate: politicalTrades.filedDate,
        verification: politicalTrades.verification,
        source: politicalTrades.source,
      })
      .from(politicalTrades)
      .innerJoin(politicians, eq(politicalTrades.politicianId, politicians.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(politicalTrades.txnDate));
    return rows as PoliticalTradeRow[];
  }

  async upsertPolitician(p: InsertPolitician): Promise<number> {
    const r = await db.insert(politicians).values(p)
      .onConflictDoUpdate({
        target: politicians.slug,
        set: { name: p.name, party: p.party, chamber: p.chamber, state: p.state, bioguideId: p.bioguideId },
      })
      .returning();
    return r[0].id;
  }

  async upsertCommittee(c: Committee) {
    await db.insert(committees).values(c)
      .onConflictDoUpdate({ target: committees.id, set: { ko: c.ko, name: c.name, chamber: c.chamber } });
  }

  async linkPoliticianCommittee(politicianId: number, committeeId: string) {
    await db.insert(politicianCommittees).values({ politicianId, committeeId }).onConflictDoNothing();
  }

  async insertPoliticalTradeIfNew(t: InsertPoliticalTrade): Promise<boolean> {
    const r = await db.insert(politicalTrades).values(t)
      .onConflictDoNothing({ target: politicalTrades.externalId }).returning();
    return r.length > 0;
  }

  async clearPoliticianData() {
    await db.delete(politicalTrades);
    await db.delete(politicianCommittees);
    await db.delete(politicians);
  }

  async clearCommitteesAndLinks() {
    await db.delete(politicianCommittees);
    await db.delete(committees);
  }

  async setTickerSector(symbol: string, sector: string | null) {
    await db.insert(tickerSectors).values({ symbol, sector })
      .onConflictDoUpdate({ target: tickerSectors.symbol, set: { sector } });
  }
  async listTickerSectors() { return db.select().from(tickerSectors); }
  async distinctTradedSymbols() {
    const r = await db.selectDistinct({ symbol: politicalTrades.symbol }).from(politicalTrades);
    return r.map((x) => x.symbol);
  }

  async distinctMentionedSymbols() {
    const r = await db.selectDistinct({ symbol: mentions.symbol }).from(mentions);
    return r.map((x) => x.symbol);
  }

  // --- Insider trading (Form 4) ---
  async upsertInsider(i: InsertInsider): Promise<number> {
    const r = await db.insert(insiders).values(i)
      .onConflictDoUpdate({ target: insiders.slug, set: { name: i.name } }).returning();
    return r[0].id;
  }
  async insertInsiderTradeIfNew(t: InsertInsiderTrade): Promise<boolean> {
    const r = await db.insert(insiderTrades).values(t)
      .onConflictDoNothing({ target: insiderTrades.externalId }).returning();
    return r.length > 0;
  }
  async clearInsiderData() {
    await db.delete(insiderTrades);
    await db.delete(insiders);
  }

  // 종목 랭킹 — 클러스터와 동일한 dedup·가격가드를 거친 단일 소스에서 JS 집계(#23).
  //   raw SQL SUM/COUNT 은 공동신고자(엔티티+지배인) 금액·인사이더수를 이중계산 → dedupeJointFilers 통과 후 집계.
  //   랭킹은 10b5-1 정기매도 포함(클러스터와 달리) — fetch false. 금액 의미는 '기간 총액' 그대로(윈도우 아님).
  async insiderRanking(opts: { fromMs?: number; toMs?: number }): Promise<InsiderRankRow[]> {
    const from = opts.fromMs ?? 0;
    const to = opts.toMs ?? Number.MAX_SAFE_INTEGER;
    const rows = dedupeJointFilers(await this.fetchInsiderPsRows(from, to, false));
    const cleanValue = makeCleanValue(rows); // 클러스터와 같은 모듈 가드(복사 아님)

    type Agg = { company: string | null; sector: string | null; buyValue: number; sellValue: number; buyCount: number; sellCount: number; tradeCount: number; insiders: Set<number> };
    const agg = new Map<string, Agg>();
    for (const r of rows) {
      let a = agg.get(r.symbol);
      if (!a) { a = { company: r.company ?? null, sector: r.sector ?? null, buyValue: 0, sellValue: 0, buyCount: 0, sellCount: 0, tradeCount: 0, insiders: new Set() }; agg.set(r.symbol, a); }
      const v = cleanValue(r);
      a.tradeCount++; a.insiders.add(Number(r.insiderId));
      if (r.side === "buy") { a.buyValue += v; a.buyCount++; } else { a.sellValue += v; a.sellCount++; }
    }

    // otherInsiderCount(보상·행사 등만 한 인사이더 — 신호 아님, #23 스코프 밖): raw 카운트 유지.
    const otherRows = (await db.execute(sql`
      SELECT it.symbol AS symbol,
             COUNT(DISTINCT it.insider_id)
               - COUNT(DISTINCT CASE WHEN it.side IN ('buy','sell') THEN it.insider_id END) AS "other"
      FROM insider_trades it
      WHERE it.txn_date >= ${from} AND it.txn_date <= ${to}
      GROUP BY it.symbol
    `)) as unknown as any[];
    const otherBySym = new Map(otherRows.map((r) => [r.symbol, Number(r.other) || 0]));

    // 유의미도 점수: 클러스터와 동일 엔진을 minInsiders=1(단독 포함)로 돌려 종목별 max 점수 산출(이미 dedup됨).
    const sigClusters = await this.insiderClusters({ fromMs: opts.fromMs, toMs: opts.toMs, minInsiders: 1, limit: 100000 });
    const sig = new Map<string, { score: number; side: "buy" | "sell" }>();
    for (const c of sigClusters) { const cur = sig.get(c.symbol); if (!cur || c.score > cur.score) sig.set(c.symbol, { score: c.score, side: c.side }); }

    const result: InsiderRankRow[] = [];
    for (const [symbol, a] of agg) {
      const s = sig.get(symbol);
      result.push({
        symbol, company: a.company, sector: a.sector,
        buyValue: a.buyValue, sellValue: a.sellValue, netValue: a.buyValue - a.sellValue,
        buyCount: a.buyCount, sellCount: a.sellCount,
        insiderCount: a.insiders.size, otherInsiderCount: otherBySym.get(symbol) ?? 0,
        tradeCount: a.tradeCount,
        signalScore: s?.score ?? 0, signalSide: s?.side ?? null,
      });
    }
    return result;
  }

  // P/S 원시행 fetch — 클러스터·랭킹 공유 단일 소스. excludePlanSells: 클러스터 true / 랭킹 false.
  private async fetchInsiderPsRows(from: number, to: number, excludePlanSells: boolean): Promise<any[]> {
    const planClause = excludePlanSells ? sql`AND NOT (it.side = 'sell' AND it.plan10b5 IS TRUE)` : sql``;
    const raw = (await db.execute(sql`
      SELECT it.insider_id AS "insiderId", i.name AS name, i.slug AS slug, it.role AS role,
             it.symbol AS symbol, t.company_name AS company, ts.sector AS sector,
             it.side AS side, COALESCE(it.value, 0) AS value, it.price AS price,
             it.shares AS shares, it.shares_after AS "sharesAfter", it.txn_date AS "txnDate",
             it.txn_code AS code, it.external_id AS ext
      FROM insider_trades it
      JOIN insiders i ON i.id = it.insider_id
      LEFT JOIN tickers t ON t.symbol = it.symbol
      LEFT JOIN ticker_sectors ts ON ts.symbol = it.symbol
      WHERE it.side IN ('buy','sell') AND it.txn_date >= ${from} AND it.txn_date <= ${to}
        ${planClause}
    `)) as unknown as any[];
    // #24 교차티커(듀얼클래스) 이중계상 제거 — joint-filer dedup 보다 먼저(심볼 전체를 접어 단일 소스를 정규화).
    return dedupeCrossTicker(raw);
  }

  // 클러스터 시그널 — 종목·방향별로 windowDays 안에서 가장 많은 서로 다른 인사이더가 모인 윈도우를 찾는다.
  //   매수 ≫ 매도(노이즈 많음), 10b5-1 플랜 매도는 제외. 점수 = 인사이더수 × 방향가중, 동률이면 금액.
  async insiderClusters(opts: { fromMs?: number; toMs?: number; windowDays?: number; minInsiders?: number; limit?: number }): Promise<InsiderCluster[]> {
    const from = opts.fromMs ?? 0;
    const to = opts.toMs ?? Number.MAX_SAFE_INTEGER;
    const windowMs = (opts.windowDays ?? 30) * 86400000;
    const minIns = opts.minInsiders ?? 2;
    const limit = opts.limit ?? 40;
    // 공동신고 중복 제거(엔티티+지배인 동일 포지션 → 대표 1행). 위젯·랭킹 양쪽이 같은 정제입력을 쓰도록 여기서 1회.
    //   클러스터는 10b5-1 정기매도 제외(노이즈). 랭킹은 포함 — fetch 의 excludePlanSells 플래그로 분기.
    const rows = dedupeJointFilers(await this.fetchInsiderPsRows(from, to, true));
    const cleanValue = makeCleanValue(rows);

    const groups = new Map<string, any[]>();
    for (const r of rows) { const k = r.symbol + "|" + r.side; const g = groups.get(k); if (g) g.push(r); else groups.set(k, [r]); }

    const clusters: InsiderCluster[] = [];
    for (const [k, list] of groups) {
      list.sort((a, b) => Number(a.txnDate) - Number(b.txnDate));
      // 각 거래를 시작점으로 forward window 를 잡아 서로 다른 인사이더가 가장 많은 구간 선택
      let bestTrades: any[] = []; let bestSize = 0;
      for (let i = 0; i < list.length; i++) {
        const t0 = Number(list[i].txnDate); const set = new Set<number>(); const win: any[] = [];
        for (let j = i; j < list.length && Number(list[j].txnDate) - t0 <= windowMs; j++) { win.push(list[j]); set.add(Number(list[j].insiderId)); }
        if (set.size > bestSize) { bestSize = set.size; bestTrades = win; }
      }
      if (bestSize < minIns) continue;
      const side = k.endsWith("|buy") ? "buy" : "sell";
      // 인사이더별 합산 + 거래직후 보유량(최신 거래 기준) 추적
      const byIns = new Map<string, ClusterParticipant & { _lastDate: number }>();
      for (const t of bestTrades) {
        const e = byIns.get(t.slug) || { slug: t.slug, name: t.name, role: null, value: 0, trades: 0, qty: 0, sharesAfter: null, pctOfHoldings: null, isNew: false, _lastDate: -1 };
        e.value += cleanValue(t); e.trades++; e.qty += Math.abs(Number(t.shares) || 0);
        if (!e.role && t.role) e.role = t.role;
        const td = Number(t.txnDate);
        if (t.sharesAfter != null && td >= e._lastDate) { e.sharesAfter = Number(t.sharesAfter); e._lastDate = td; }
        byIns.set(t.slug, e);
      }
      if (byIns.size < minIns) continue;
      const r0 = bestTrades[0];
      const wFrom = Number(bestTrades[0].txnDate), wTo = Number(bestTrades[bestTrades.length - 1].txnDate);
      const participants: ClusterParticipant[] = [...byIns.values()].map(({ _lastDate, ...p }) => ({
        ...p,
        pctOfHoldings: holdingsPct(side, p.qty, p.sharesAfter),
        isNew: side === "buy" && p.sharesAfter != null && p.sharesAfter - p.qty <= 0, // pre≤0 = 신규
      }));
      const totalValue = participants.reduce((s, p) => s + p.value, 0);
      const insiderCount = participants.length;
      // 점수 = 방향(매수≫매도) × Σ(티어 × 절대규모로그 × 보유대비배율) / √n.
      //   /√n: breadth(인원수)는 플러스 요인이되 한계체감 — 29명이 5명의 6배가 아니라 ~2.4배. 규모처럼 한 항(인원)이 폭주 방지.
      const dir = side === "buy" ? 2 : 1;
      // 최소 인원 게이트: n=2는 '합의'의 통계적 증거가 약함(우연 vs 조율 구분 안 됨) → thin 페널티.
      //   단, 페널티는 개수가 아니라 1인당 시그널(percap)에 비례 → 고티어 큰 컨빅션 2인은 완화, 저티어 2인은 full.
      const thin = insiderCount === 2;
      const massPost0 = participants.filter((p) => p.sharesAfter === 0).length >= 3; // 다수 동시 전량청산 = 구조적 이벤트
      const sumSignal = participants.reduce((s, p) => s + participantSignal(p, side, massPost0), 0);
      const perCapita = sumSignal / insiderCount;
      const score = (dir * sumSignal / Math.sqrt(insiderCount)) * (thin ? thinPenalty(perCapita) : 1);
      participants.sort((a, b) => participantSignal(b, side, massPost0) - participantSignal(a, side, massPost0)); // 리더가 카드 상단
      clusters.push({
        symbol: r0.symbol, company: r0.company ?? null, sector: r0.sector ?? null,
        side, insiderCount, tradeCount: bestTrades.length, totalValue,
        windowFromMs: wFrom, windowToMs: wTo, spanDays: Math.round((wTo - wFrom) / 86400000),
        participants, score, thin, gated: massPost0,
      });
    }
    clusters.sort((a, b) => b.score - a.score);
    return clusters.slice(0, limit);
  }

  private async joinedInsiderTrades(where: any, limit?: number): Promise<InsiderTradeRow[]> {
    const q = db.select({
      id: insiderTrades.id, insiderId: insiderTrades.insiderId,
      insiderName: insiders.name, insiderSlug: insiders.slug,
      symbol: insiderTrades.symbol, company: tickers.companyName,
      txnCode: insiderTrades.txnCode, side: insiderTrades.side,
      shares: insiderTrades.shares,
      // 비정상 단가(>$1M/주, 데이터 오류)는 미상 처리 — 인사이더/수량은 유지, 가격·금액만 숨김
      price: sql<number | null>`CASE WHEN ${insiderTrades.price} > 1000000 THEN NULL ELSE ${insiderTrades.price} END`,
      // ::float8 — raw sql 의 bigint 는 postgres.js 가 문자열로 반환해 클라 합산에서 문자열 연결됨. 숫자로 캐스팅.
      value: sql<number | null>`(CASE WHEN ${insiderTrades.price} > 1000000 THEN NULL ELSE ${insiderTrades.value} END)::float8`,
      txnDate: insiderTrades.txnDate, filedDate: insiderTrades.filedDate, role: insiderTrades.role,
      plan10b5: insiderTrades.plan10b5,
    }).from(insiderTrades)
      .innerJoin(insiders, eq(insiderTrades.insiderId, insiders.id))
      .leftJoin(tickers, eq(tickers.symbol, insiderTrades.symbol))
      .where(where)
      .orderBy(desc(insiderTrades.txnDate));
    const rows = limit ? await q.limit(limit) : await q;
    return rows as InsiderTradeRow[];
  }
  async insiderTradesForSymbol(symbol: string, opts: { fromMs?: number; toMs?: number; limit?: number }) {
    const conds: any[] = [eq(insiderTrades.symbol, symbol.toUpperCase())];
    if (opts.fromMs != null) conds.push(gte(insiderTrades.txnDate, opts.fromMs));
    if (opts.toMs != null) conds.push(lte(insiderTrades.txnDate, opts.toMs));
    return this.joinedInsiderTrades(and(...conds), opts.limit ?? 300);
  }
  async insiderTradesForInsider(slug: string, opts: { fromMs?: number; toMs?: number }) {
    const ins = (await db.select().from(insiders).where(eq(insiders.slug, slug)).limit(1))[0];
    if (!ins) return [];
    const conds: any[] = [eq(insiderTrades.insiderId, ins.id)];
    if (opts.fromMs != null) conds.push(gte(insiderTrades.txnDate, opts.fromMs));
    if (opts.toMs != null) conds.push(lte(insiderTrades.txnDate, opts.toMs));
    return this.joinedInsiderTrades(and(...conds));
  }
  async distinctInsiderSymbols() {
    const r = await db.selectDistinct({ symbol: insiderTrades.symbol }).from(insiderTrades);
    return r.map((x) => x.symbol);
  }
  // 직책 보강용 — role 없는 (insider, symbol) 쌍 + 샘플 external_id(accession 포함) + 이름
  async insiderPairsNeedingRole(): Promise<{ insiderId: number; symbol: string; name: string; externalId: string | null }[]> {
    const rows = (await db.execute(sql`
      SELECT DISTINCT ON (it.insider_id, it.symbol)
             it.insider_id AS "insiderId", it.symbol AS symbol, i.name AS name, it.external_id AS "externalId"
      FROM insider_trades it JOIN insiders i ON i.id = it.insider_id
      WHERE it.role IS NULL
    `)) as unknown as any[];
    return rows.map((r) => ({ insiderId: Number(r.insiderId), symbol: r.symbol, name: r.name, externalId: r.externalId }));
  }
  async setInsiderRole(insiderId: number, symbol: string, role: string | null) {
    await db.update(insiderTrades).set({ role }).where(and(eq(insiderTrades.insiderId, insiderId), eq(insiderTrades.symbol, symbol)));
  }

  // 보유량 백필 — external_id 매칭으로 shares_after 일괄 UPDATE (Finnhub share 재호출분)
  async setSharesAfterByExternal(pairs: { eid: string; sa: number | null }[]) {
    if (!pairs.length) return;
    await db.execute(sql`
      UPDATE insider_trades it SET shares_after = d.sa
      FROM json_to_recordset(${JSON.stringify(pairs)}::json) AS d(eid text, sa bigint)
      WHERE it.external_id = d.eid AND it.shares_after IS DISTINCT FROM d.sa
    `);
  }
  // 보유% 미보강(shares_after NULL)인 매수·매도 종목 목록
  async symbolsNeedingHoldings(): Promise<string[]> {
    const r = (await db.execute(sql`
      SELECT DISTINCT symbol FROM insider_trades WHERE side IN ('buy','sell') AND shares_after IS NULL
    `)) as unknown as any[];
    return r.map((x) => x.symbol);
  }

  // 10b5-1 보강용 — 매수·매도 중 plan10b5 미확인인 고유 accession 목록 (한 Form4=한 accession에 여러 거래라인이 묶임)
  async psAccessionsNeedingPlan(): Promise<{ accession: string; symbol: string }[]> {
    const rows = (await db.execute(sql`
      SELECT DISTINCT split_part(it.external_id, ':', 2) AS accession, it.symbol AS symbol
      FROM insider_trades it
      WHERE it.side IN ('buy','sell') AND it.plan10b5 IS NULL
        AND it.external_id LIKE 'fin:%' AND split_part(it.external_id, ':', 2) <> ''
    `)) as unknown as any[];
    return rows.map((r) => ({ accession: r.accession, symbol: r.symbol }));
  }
  // accession 의 모든 거래라인에 10b5-1 플래그 적용 (문서레벨 필드라 동일 accession 공유)
  async setPlan10b5ByAccession(accession: string, plan: boolean | null) {
    await db.execute(sql`
      UPDATE insider_trades SET plan10b5 = ${plan}
      WHERE external_id LIKE ${"fin:" + accession + ":%"}
    `);
  }
}

export const storage = new DatabaseStorage();
