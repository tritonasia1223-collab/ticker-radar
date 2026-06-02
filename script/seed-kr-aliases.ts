// Add common abbreviations / nicknames for popular KR stocks so tweets that use the
// short form ("삼전", "두에빌", "엔솔") or a Korean reading of an ASCII name ("네이버"
// for NAVER) still resolve. Merges into each ticker's existing aliases (idempotent).
//
//   npm run seed:kr-aliases
//
// Only touches codes that already exist as KR tickers; prints code -> name -> aliases
// so the code/name mapping can be eyeballed.
import "dotenv/config";
import postgres from "postgres";

// 6-digit code -> extra aliases to add (high-confidence majors; extend as needed)
const EXTRA: Record<string, string[]> = {
  "005930": ["삼전"],                         // 삼성전자
  "005380": ["현대차", "현차"],               // 현대자동차
  "000660": ["하이닉스"],                     // SK하이닉스
  "207940": ["삼바", "삼성바이오"],            // 삼성바이오로직스
  "035420": ["네이버"],                       // NAVER
  "373220": ["엔솔", "엘지엔솔"],              // LG에너지솔루션
  "051910": ["엘지화학"],                     // LG화학
  "066570": ["엘지전자"],                     // LG전자
  "006400": ["삼성에스디아이"],               // 삼성SDI
  "034020": ["두산에너빌", "두에빌"],          // 두산에너빌리티
  "247540": ["에코비엠"],                     // 에코프로비엠
  "005490": ["포스코", "포홀"],                // POSCO홀딩스
  "003670": ["포퓨"],                         // 포스코퓨처엠
  "012330": ["모비스"],                       // 현대모비스
  "015760": ["한전"],                         // 한국전력
  "042700": ["한미"],                         // 한미반도체
  "055550": ["신한금융"],                     // 신한지주
  "105560": ["케이비금융"],                   // KB금융
  "086790": ["하나금융"],                     // 하나금융지주
  "316140": ["우리금융"],                     // 우리금융지주
  "323410": ["카뱅"],                         // 카카오뱅크
  "036570": ["엔씨"],                         // 엔씨소프트
  "012450": ["한화에어로"],                   // 한화에어로스페이스
  "011200": ["에이치엠엠"],                   // HMM
  "454910": ["두산로보", "두로보"],            // 두산로보틱스
  "277810": ["레인보우"],                     // 레인보우로보틱스
};

function safeArr(v: any): string[] { try { const a = JSON.parse(v || "[]"); return Array.isArray(a) ? a : []; } catch { return []; } }

async function run() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  let updated = 0, missing = 0;
  for (const [code, extra] of Object.entries(EXTRA)) {
    const row = await sql`select company_name_ko, aliases from tickers where symbol = ${code} and market = 'kr'`;
    if (!row.length) { console.log(`  ⚠️ ${code} 없음 (스킵)`); missing++; continue; }
    const merged = Array.from(new Set([...safeArr(row[0].aliases), ...extra.map((a) => a.toLowerCase())]));
    await sql`update tickers set aliases = ${JSON.stringify(merged)} where symbol = ${code}`;
    console.log(`  ${code} ${row[0].company_name_ko} ← [${extra.join(", ")}]`);
    updated++;
  }
  console.log(`✅ done — updated ${updated}, missing ${missing}`);
  await sql.end();
}

run().catch((e) => { console.error(e); process.exit(1); });
