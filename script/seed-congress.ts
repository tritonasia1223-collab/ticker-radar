// 정치인 모듈 mock 시드 — 프로토타입에서 쓰던 데이터를 공유 DB에 넣는다.
//   실행:  npm run seed:congress
// DB(DATABASE_URL) 연결 후, 실데이터 수집(collect:congress) 전에 UI를 바로 확인하기 위한 용도.
// 멱등(idempotent): externalId 기준 dedup, 매 실행 시 정치인 데이터만 초기화 후 재삽입.
import "dotenv/config";
import { storage } from "../server/storage";

const COMMITTEES: { id: string; ko: string; name: string; chamber: string }[] = [
  { id: "senate-armed", ko: "상원 군사위원회", name: "Senate Armed Services", chamber: "senate" },
  { id: "senate-ag", ko: "상원 농업위원회", name: "Senate Agriculture", chamber: "senate" },
  { id: "senate-banking", ko: "상원 은행위원회", name: "Senate Banking", chamber: "senate" },
  { id: "senate-intel", ko: "상원 정보위원회", name: "Senate Intelligence", chamber: "senate" },
  { id: "senate-finance", ko: "상원 재정위원회", name: "Senate Finance", chamber: "senate" },
  { id: "senate-environ", ko: "상원 환경위원회", name: "Senate Environment", chamber: "senate" },
  { id: "senate-help", ko: "상원 보건위원회", name: "Senate HELP", chamber: "senate" },
  { id: "house-finsvc", ko: "하원 금융서비스위원회", name: "House Financial Services", chamber: "house" },
  { id: "house-energy", ko: "하원 에너지·통상위원회", name: "House Energy & Commerce", chamber: "house" },
  { id: "house-armed", ko: "하원 군사위원회", name: "House Armed Services", chamber: "house" },
  { id: "house-intel", ko: "하원 정보위원회", name: "House Intelligence", chamber: "house" },
  { id: "house-oversight", ko: "하원 감독위원회", name: "House Oversight", chamber: "house" },
];

const MEMBERS: { slug: string; name: string; party: string; chamber: string; state: string; committees: string[] }[] = [
  { slug: "pelosi", name: "Nancy Pelosi", party: "D", chamber: "house", state: "CA", committees: ["house-finsvc"] },
  { slug: "crenshaw", name: "Dan Crenshaw", party: "R", chamber: "house", state: "TX", committees: ["house-energy", "house-intel"] },
  { slug: "warner", name: "Mark Warner", party: "D", chamber: "senate", state: "VA", committees: ["senate-intel", "senate-banking", "senate-finance"] },
  { slug: "boozman", name: "John Boozman", party: "R", chamber: "senate", state: "AR", committees: ["senate-armed", "senate-ag"] },
  { slug: "tuberville", name: "Tommy Tuberville", party: "R", chamber: "senate", state: "AL", committees: ["senate-armed", "senate-ag", "senate-help"] },
  { slug: "khanna", name: "Ro Khanna", party: "D", chamber: "house", state: "CA", committees: ["house-armed", "house-oversight"] },
  { slug: "gottheimer", name: "Josh Gottheimer", party: "D", chamber: "house", state: "NJ", committees: ["house-finsvc", "house-intel"] },
  { slug: "greene", name: "M. T. Greene", party: "R", chamber: "house", state: "GA", committees: ["house-oversight"] },
  { slug: "whitehouse", name: "Sheldon Whitehouse", party: "D", chamber: "senate", state: "RI", committees: ["senate-finance", "senate-environ"] },
  { slug: "mullin", name: "Markwayne Mullin", party: "R", chamber: "senate", state: "OK", committees: ["senate-armed", "senate-environ"] },
];

const TICKER_COMPANY: Record<string, string> = {
  LMT: "Lockheed Martin", RTX: "RTX Corp", NOC: "Northrop Grumman", GD: "General Dynamics",
  NVDA: "NVIDIA", AAPL: "Apple", MSFT: "Microsoft", GOOGL: "Alphabet", META: "Meta Platforms",
  AMZN: "Amazon", TSLA: "Tesla", JPM: "JPMorgan Chase", GS: "Goldman Sachs", BAC: "Bank of America",
  XOM: "Exxon Mobil", CVX: "Chevron", PFE: "Pfizer", UNH: "UnitedHealth Group", LLY: "Eli Lilly",
  ADM: "Archer-Daniels-Midland", DE: "Deere & Co", DIS: "Walt Disney",
};

type T = { tk: string; m: string; side: "BUY" | "SELL"; d: string; lo: number; hi: number };
const TRADES: T[] = [
  { tk: "LMT", m: "boozman", side: "BUY", d: "2024-11-12", lo: 50001, hi: 100000 },
  { tk: "RTX", m: "boozman", side: "BUY", d: "2025-02-20", lo: 15001, hi: 50000 },
  { tk: "DE", m: "boozman", side: "BUY", d: "2025-05-08", lo: 15001, hi: 50000 },
  { tk: "ADM", m: "boozman", side: "BUY", d: "2025-07-18", lo: 1001, hi: 15000 },
  { tk: "NOC", m: "boozman", side: "BUY", d: "2025-08-25", lo: 50001, hi: 100000 },
  { tk: "NVDA", m: "tuberville", side: "BUY", d: "2024-10-30", lo: 100001, hi: 250000 },
  { tk: "AAPL", m: "tuberville", side: "SELL", d: "2024-12-15", lo: 50001, hi: 100000 },
  { tk: "RTX", m: "tuberville", side: "BUY", d: "2025-01-22", lo: 15001, hi: 50000 },
  { tk: "LMT", m: "tuberville", side: "BUY", d: "2025-03-10", lo: 50001, hi: 100000 },
  { tk: "MSFT", m: "tuberville", side: "SELL", d: "2025-04-15", lo: 15001, hi: 50000 },
  { tk: "GD", m: "tuberville", side: "BUY", d: "2025-05-20", lo: 15001, hi: 50000 },
  { tk: "DE", m: "tuberville", side: "BUY", d: "2025-06-28", lo: 50001, hi: 100000 },
  { tk: "NVDA", m: "tuberville", side: "SELL", d: "2025-08-05", lo: 100001, hi: 250000 },
  { tk: "XOM", m: "tuberville", side: "BUY", d: "2025-09-02", lo: 15001, hi: 50000 },
  { tk: "NVDA", m: "khanna", side: "BUY", d: "2025-01-15", lo: 1001, hi: 15000 },
  { tk: "AAPL", m: "khanna", side: "BUY", d: "2025-03-22", lo: 1001, hi: 15000 },
  { tk: "MSFT", m: "khanna", side: "BUY", d: "2025-06-10", lo: 1001, hi: 15000 },
  { tk: "RTX", m: "khanna", side: "BUY", d: "2025-08-12", lo: 1001, hi: 15000 },
  { tk: "XOM", m: "mullin", side: "BUY", d: "2024-11-05", lo: 15001, hi: 50000 },
  { tk: "CVX", m: "mullin", side: "BUY", d: "2025-02-12", lo: 15001, hi: 50000 },
  { tk: "RTX", m: "mullin", side: "BUY", d: "2025-05-15", lo: 15001, hi: 50000 },
  { tk: "LMT", m: "mullin", side: "BUY", d: "2025-07-25", lo: 15001, hi: 50000 },
  { tk: "GOOGL", m: "warner", side: "BUY", d: "2024-12-01", lo: 100001, hi: 250000 },
  { tk: "JPM", m: "warner", side: "BUY", d: "2025-02-18", lo: 50001, hi: 100000 },
  { tk: "GOOGL", m: "warner", side: "BUY", d: "2025-04-18", lo: 100001, hi: 250000 },
  { tk: "AMZN", m: "warner", side: "BUY", d: "2025-05-27", lo: 50001, hi: 100000 },
  { tk: "NVDA", m: "warner", side: "BUY", d: "2025-09-12", lo: 15001, hi: 50000 },
  { tk: "JPM", m: "gottheimer", side: "BUY", d: "2024-10-20", lo: 15001, hi: 50000 },
  { tk: "GS", m: "gottheimer", side: "BUY", d: "2025-01-30", lo: 15001, hi: 50000 },
  { tk: "MSFT", m: "gottheimer", side: "BUY", d: "2025-04-05", lo: 50001, hi: 100000 },
  { tk: "AAPL", m: "gottheimer", side: "BUY", d: "2025-07-08", lo: 15001, hi: 50000 },
  { tk: "XOM", m: "whitehouse", side: "SELL", d: "2024-11-22", lo: 50001, hi: 100000 },
  { tk: "CVX", m: "whitehouse", side: "SELL", d: "2025-03-15", lo: 15001, hi: 50000 },
  { tk: "LLY", m: "whitehouse", side: "BUY", d: "2025-06-20", lo: 15001, hi: 50000 },
  { tk: "UNH", m: "whitehouse", side: "BUY", d: "2025-08-18", lo: 15001, hi: 50000 },
  { tk: "NVDA", m: "pelosi", side: "BUY", d: "2024-11-10", lo: 250001, hi: 500000 },
  { tk: "GOOGL", m: "pelosi", side: "BUY", d: "2025-01-14", lo: 100001, hi: 250000 },
  { tk: "AMZN", m: "pelosi", side: "BUY", d: "2025-06-20", lo: 100001, hi: 250000 },
  { tk: "META", m: "pelosi", side: "BUY", d: "2025-08-02", lo: 250001, hi: 500000 },
  { tk: "NVDA", m: "pelosi", side: "BUY", d: "2025-08-28", lo: 500001, hi: 1000000 },
  { tk: "PFE", m: "pelosi", side: "SELL", d: "2025-05-03", lo: 50001, hi: 100000 },
  { tk: "DIS", m: "pelosi", side: "SELL", d: "2025-07-15", lo: 15001, hi: 50000 },
  { tk: "XOM", m: "crenshaw", side: "BUY", d: "2024-12-08", lo: 15001, hi: 50000 },
  { tk: "LMT", m: "crenshaw", side: "BUY", d: "2025-02-25", lo: 15001, hi: 50000 },
  { tk: "LMT", m: "crenshaw", side: "BUY", d: "2025-05-19", lo: 50001, hi: 100000 },
  { tk: "NVDA", m: "crenshaw", side: "BUY", d: "2025-07-22", lo: 15001, hi: 50000 },
  { tk: "AAPL", m: "crenshaw", side: "SELL", d: "2025-08-14", lo: 15001, hi: 50000 },
  { tk: "AAPL", m: "greene", side: "BUY", d: "2025-01-08", lo: 1001, hi: 15000 },
  { tk: "TSLA", m: "greene", side: "BUY", d: "2025-03-30", lo: 15001, hi: 50000 },
  { tk: "NVDA", m: "greene", side: "BUY", d: "2025-06-15", lo: 1001, hi: 15000 },
  { tk: "TSLA", m: "greene", side: "SELL", d: "2025-09-08", lo: 15001, hi: 50000 },
];

async function main() {
  const now = Date.now();
  console.log("정치인 mock 시드 시작…");
  await storage.clearPoliticianData();

  for (const c of COMMITTEES) await storage.upsertCommittee(c);

  const idBySlug = new Map<string, number>();
  for (const m of MEMBERS) {
    const id = await storage.upsertPolitician({
      slug: m.slug, name: m.name, party: m.party, chamber: m.chamber, state: m.state,
      bioguideId: null, createdAt: now,
    });
    idBySlug.set(m.slug, id);
    for (const cid of m.committees) await storage.linkPoliticianCommittee(id, cid);
  }

  // 공유 ticker 사전에 회사명 채우기
  const symbols = [...new Set(TRADES.map((t) => t.tk))];
  for (const sym of symbols) {
    await storage.upsertTicker({ symbol: sym, companyName: TICKER_COMPANY[sym] ?? null, aliases: "[]", exchange: null });
  }

  let inserted = 0;
  for (const t of TRADES) {
    const ok = await storage.insertPoliticalTradeIfNew({
      politicianId: idBySlug.get(t.m)!,
      symbol: t.tk,
      company: TICKER_COMPANY[t.tk] ?? null,
      side: t.side === "BUY" ? "buy" : "sell",
      amountLow: t.lo,
      amountHigh: t.hi,
      txnDate: Date.parse(t.d),
      filedDate: null,
      source: "fmp",
      verification: "pending_official",
      externalId: `seed:${t.m}:${t.tk}:${t.side}:${t.d}`,
      createdAt: now,
    });
    if (ok) inserted++;
  }

  console.log(`✅ 시드 완료 — 위원회 ${COMMITTEES.length} · 의원 ${MEMBERS.length} · 거래 ${inserted}건`);
  process.exit(0);
}

main().catch((e) => { console.error("시드 실패:", e); process.exit(1); });
