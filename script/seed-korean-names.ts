// Seed Korean display names + aliases for popular US tickers.
//
//   npm run seed:ko    (add to package.json)  — or:  tsx script/seed-korean-names.ts
//
// Adds a `company_name_ko` column to `tickers` (idempotent) and, per ticker:
//   - sets company_name_ko (Korean display name shown first in 종목 발견)
//   - merges Korean + key English aliases into `aliases` so name matching catches
//     "팔란티어", "Palantir", "$PLTR" all → PLTR.
// Existing company_name (official English) is left untouched.
import "dotenv/config";
import postgres from "postgres";

// symbol -> { ko: 한글 표시명, aliases: 매칭용 별칭(한글 + 핵심 영문) }
const KO: Record<string, { ko: string; aliases: string[] }> = {
  NVDA: { ko: "엔비디아", aliases: ["엔비디아", "nvidia"] },
  TSLA: { ko: "테슬라", aliases: ["테슬라", "tesla"] },
  AAPL: { ko: "애플", aliases: ["애플", "apple"] },
  MSFT: { ko: "마이크로소프트", aliases: ["마이크로소프트", "microsoft"] },
  GOOGL: { ko: "알파벳(구글)", aliases: ["알파벳", "구글", "google", "alphabet"] },
  GOOG: { ko: "알파벳(구글)", aliases: ["알파벳", "구글", "google", "alphabet"] },
  AMZN: { ko: "아마존", aliases: ["아마존", "amazon"] },
  META: { ko: "메타(페이스북)", aliases: ["메타", "페이스북", "facebook"] },
  PLTR: { ko: "팔란티어", aliases: ["팔란티어", "palantir"] },
  MU: { ko: "마이크론", aliases: ["마이크론", "micron"] },
  DELL: { ko: "델", aliases: ["델테크놀로지스", "dell"] },
  INTC: { ko: "인텔", aliases: ["인텔", "intel"] },
  AVGO: { ko: "브로드컴", aliases: ["브로드컴", "broadcom"] },
  TSM: { ko: "TSMC", aliases: ["티에스엠씨", "tsmc"] },
  QCOM: { ko: "퀄컴", aliases: ["퀄컴", "qualcomm"] },
  SMCI: { ko: "슈퍼마이크로", aliases: ["슈퍼마이크로", "supermicro"] },
  NFLX: { ko: "넷플릭스", aliases: ["넷플릭스", "netflix"] },
  DIS: { ko: "디즈니", aliases: ["디즈니", "disney"] },
  BABA: { ko: "알리바바", aliases: ["알리바바", "alibaba"] },
  COIN: { ko: "코인베이스", aliases: ["코인베이스", "coinbase"] },
  SOFI: { ko: "소파이", aliases: ["소파이", "sofi"] },
  HOOD: { ko: "로빈후드", aliases: ["로빈후드", "robinhood"] },
  RKLB: { ko: "로켓랩", aliases: ["로켓랩", "rocket lab", "rocketlab"] },
  RIVN: { ko: "리비안", aliases: ["리비안", "rivian"] },
  LCID: { ko: "루시드", aliases: ["루시드", "lucid"] },
  NIO: { ko: "니오", aliases: ["니오", "nio"] },
  F: { ko: "포드", aliases: ["포드", "ford"] },
  GM: { ko: "지엠", aliases: ["제너럴모터스"] },
  BA: { ko: "보잉", aliases: ["보잉", "boeing"] },
  UBER: { ko: "우버", aliases: ["우버", "uber"] },
  ABNB: { ko: "에어비앤비", aliases: ["에어비앤비", "airbnb"] },
  SHOP: { ko: "쇼피파이", aliases: ["쇼피파이", "shopify"] },
  PYPL: { ko: "페이팔", aliases: ["페이팔", "paypal"] },
  CRM: { ko: "세일즈포스", aliases: ["세일즈포스", "salesforce"] },
  ORCL: { ko: "오라클", aliases: ["오라클", "oracle"] },
  ADBE: { ko: "어도비", aliases: ["어도비", "adobe"] },
  NOW: { ko: "서비스나우", aliases: ["서비스나우", "servicenow"] },
  SNOW: { ko: "스노우플레이크", aliases: ["스노우플레이크", "snowflake"] },
  CRWD: { ko: "크라우드스트라이크", aliases: ["크라우드스트라이크", "crowdstrike"] },
  PANW: { ko: "팔로알토", aliases: ["팔로알토", "palo alto"] },
  NET: { ko: "클라우드플레어", aliases: ["클라우드플레어", "cloudflare"] },
  DDOG: { ko: "데이터독", aliases: ["데이터독", "datadog"] },
  JPM: { ko: "JP모건", aliases: ["제이피모건", "jp모건", "jpmorgan"] },
  BAC: { ko: "뱅크오브아메리카", aliases: ["뱅크오브아메리카"] },
  GS: { ko: "골드만삭스", aliases: ["골드만삭스", "goldman sachs", "goldman"] },
  V: { ko: "비자", aliases: ["비자카드", "visa"] },
  MA: { ko: "마스터카드", aliases: ["마스터카드", "mastercard"] },
  KO: { ko: "코카콜라", aliases: ["코카콜라", "coca cola", "coca-cola"] },
  PEP: { ko: "펩시", aliases: ["펩시", "pepsi"] },
  MCD: { ko: "맥도날드", aliases: ["맥도날드", "mcdonald"] },
  SBUX: { ko: "스타벅스", aliases: ["스타벅스", "starbucks"] },
  NKE: { ko: "나이키", aliases: ["나이키", "nike"] },
  WMT: { ko: "월마트", aliases: ["월마트", "walmart"] },
  COST: { ko: "코스트코", aliases: ["코스트코", "costco"] },
  LLY: { ko: "일라이릴리", aliases: ["일라이릴리", "eli lilly"] },
  UNH: { ko: "유나이티드헬스", aliases: ["유나이티드헬스", "unitedhealth"] },
  JNJ: { ko: "존슨앤존슨", aliases: ["존슨앤존슨", "johnson"] },
  PFE: { ko: "화이자", aliases: ["화이자", "pfizer"] },
  MRNA: { ko: "모더나", aliases: ["모더나", "moderna"] },
  XOM: { ko: "엑슨모빌", aliases: ["엑슨모빌", "exxon"] },
  CVX: { ko: "셰브론", aliases: ["셰브론", "chevron"] },
};

async function run() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

  // 1) idempotent column add
  await sql`ALTER TABLE tickers ADD COLUMN IF NOT EXISTS company_name_ko text`;

  let inserted = 0, updated = 0;
  for (const [symbol, { ko, aliases }] of Object.entries(KO)) {
    const existing = await sql`select aliases from tickers where symbol = ${symbol}`;
    const prev: string[] = existing.length ? safeArr(existing[0].aliases) : [];
    const merged = Array.from(new Set([...prev, ...aliases.map((a) => a.toLowerCase())]));
    const aliasesJson = JSON.stringify(merged);

    if (existing.length) {
      await sql`update tickers set company_name_ko = ${ko}, aliases = ${aliasesJson} where symbol = ${symbol}`;
      updated++;
    } else {
      await sql`insert into tickers (symbol, company_name, company_name_ko, aliases, exchange)
                values (${symbol}, ${null}, ${ko}, ${aliasesJson}, ${null})`;
      inserted++;
    }
  }

  const tot = await sql`select count(company_name_ko)::int as n from tickers`;
  console.log(`✅ done — updated ${updated}, inserted ${inserted}, company_name_ko set on ${tot[0].n} tickers`);
  await sql.end();
}

function safeArr(v: any): string[] {
  try { const a = JSON.parse(v || "[]"); return Array.isArray(a) ? a : []; } catch { return []; }
}

run().catch((e) => { console.error(e); process.exit(1); });
