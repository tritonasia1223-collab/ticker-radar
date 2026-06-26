// 내부자 매도 'sell-to-cover(RSU vesting 세금충당)' 보강 — Form4 <remarks> 에서 탐지해 cover_tax 설정.
//   배경: sell-to-cover 는 코드 S(공개시장 매도)+plan10b5=false 라 구조필드론 재량매도와 구분 불가(예: CRWD
//   6/22 Sentonas/Podbere/Saha). 진실은 remarks("made to cover tax withholdings due on vesting of RSU")에만 있음.
//   코드 F(주식 withholding)·10b5-1 은 이미 별도 필터됨 — 이건 그 사각지대.
//   accession 단위로 1회 조회 후 그 제출의 모든 매도행에 cover_tax 설정(true=세금매도 / false=확인했으나 아님).
//   실행: npm run enrich:cover            (cover_tax IS NULL 인 code-S 비-10b5 매도 전부)
//         npm run enrich:cover -- --max 50 / --dry
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../server/storage";

const UA = "ticker-radar congress/insider research (contact: dev@local)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dec = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
// 검증된 정규식(CRWD 측정): "to cover tax withholdings", "tax withholding", "sell-to-cover" 등. Flower류 빈 remarks 는 미탐(정상).
const COVER = /(to\s+(cover|satisfy|pay)\b[^.]{0,45}\b(tax|withhold))|(tax\s+withholding)|(withholding\s+tax)|(sell[\s-]?to[\s-]?cover)|(withheld[^.]{0,30}\btax)/i;

async function tickerCikMap(): Promise<Map<string, number>> {
  const j = (await (await fetch("https://www.sec.gov/files/company_tickers.json", { headers: { "User-Agent": UA } })).json()) as any;
  const m = new Map<string, number>();
  for (const k in j) m.set(String(j[k].ticker).toUpperCase(), Number(j[k].cik_str));
  return m;
}
async function form4Remarks(cik: number, accession: string): Promise<string | null> {
  const base = `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}`;
  let idx: any;
  try { idx = await (await fetch(`${base}/index.json`, { headers: { "User-Agent": UA } })).json(); } catch { return null; }
  const xn = (idx?.directory?.item || []).map((i: any) => i.name).find((n: string) => /\.xml$/i.test(n) && !n.includes("/"));
  await sleep(120);
  if (!xn) return null;
  try {
    const xml = await (await fetch(`${base}/${xn}`, { headers: { "User-Agent": UA } })).text();
    return dec((xml.match(/<remarks>([\s\S]*?)<\/remarks>/) || [])[1] || "");
  } catch { return null; }
}

async function main() {
  const apply = !process.argv.includes("--dry");
  const mi = process.argv.indexOf("--max"); const max = mi >= 0 ? Number(process.argv[mi + 1]) : Infinity;
  // 미확인(cover_tax IS NULL) code-S 비-10b5 매도의 distinct accession (+ CIK 용 대표 심볼)
  let accs = (await db.execute(sql`
    SELECT DISTINCT ON (acc) split_part(external_id, ':', 2) AS acc, symbol
    FROM insider_trades
    WHERE side = 'sell' AND plan10b5 IS NOT TRUE AND cover_tax IS NULL AND external_id LIKE 'fin:%'
    ORDER BY acc`)) as unknown as any[];
  if (max !== Infinity) accs = accs.slice(0, max);
  console.log(`sell-to-cover 보강 — accession ${accs.length}건 [${apply ? "APPLY" : "DRY"}]`);

  const cikMap = await tickerCikMap();
  let cover = 0, plain = 0, miss = 0, rowsCover = 0;
  for (let i = 0; i < accs.length; i++) {
    const { acc, symbol } = accs[i];
    const cik = cikMap.get(String(symbol).toUpperCase());
    const rem = cik && acc ? await form4Remarks(cik, acc) : null;
    if (rem == null) { miss++; continue; }            // 조회 실패 → cover_tax NULL 유지(다음 회차 재시도)
    const isCover = COVER.test(rem);
    if (isCover) cover++; else plain++;
    if (apply) {
      const r = (await db.execute(sql`
        UPDATE insider_trades SET cover_tax = ${isCover}
        WHERE side = 'sell' AND external_id LIKE ${"fin:" + acc + ":%"} AND cover_tax IS NULL
        RETURNING id`)) as unknown as any[];
      if (isCover) rowsCover += r.length;
    }
    if (isCover && cover <= 12) console.log(`  ✓cover ${String(symbol).padEnd(6)} acc=${acc} "${rem.slice(0, 60)}"`);
    if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${accs.length} … (cover ${cover})`);
  }
  console.log(`\n${apply ? "✅ 완료" : "(dry)"} — cover ${cover} · 일반매도 ${plain} · 조회실패 ${miss} / accession ${accs.length}${apply ? ` · cover 표시 행 ${rowsCover}` : ""}`);
  process.exit(0);
}
main().catch((e) => { console.error("보강 실패:", e); process.exit(1); });
