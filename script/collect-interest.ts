// Collect today's "국내주식 관심종목등록 상위" (top stocks by watchlist registration) from
// the KIS Open API and store a daily snapshot. Accumulating snapshots lets the 관심종목 tab
// chart registration-count trends — which names gained / lost retail interest over time.
//
//   npm run collect:interest
//
// Needs KIS app key/secret in .env:
//   KIS_APP_KEY=...
//   KIS_APP_SECRET=...
// (optional) KIS_DOMAIN=https://openapi.koreainvestment.com:9443   # real (default)
//
// API: [국내주식] 순위분석 > 국내주식 관심종목등록 상위 [v1_국내주식-102], tr_id FHPST01800000.
// Idempotent per day (upsert on (date, symbol)).
import "dotenv/config";
import postgres from "postgres";

const DOMAIN = process.env.KIS_DOMAIN || "https://openapi.koreainvestment.com:9443";
const APP_KEY = process.env.KIS_APP_KEY || "";
const APP_SECRET = process.env.KIS_APP_SECRET || "";
const RANK_PATH = "/uapi/domestic-stock/v1/ranking/top-interest-stock";
const TR_ID = "FHPST01800000";

// today's date in KST as YYYY-MM-DD (toISOString is UTC, so shift +9h then take the date).
function kstDate(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

async function getToken(): Promise<string> {
  const res = await fetch(`${DOMAIN}/oauth2/tokenP`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", appkey: APP_KEY, appsecret: APP_SECRET }),
  });
  const j = (await res.json()) as any;
  if (!res.ok || !j.access_token) throw new Error(`KIS token failed: ${res.status} ${JSON.stringify(j)}`);
  return j.access_token;
}

async function fetchRanking(token: string): Promise<any[]> {
  const params = new URLSearchParams({
    fid_input_iscd_2: "000000",
    fid_cond_mrkt_div_code: "J",   // J: KRX
    fid_cond_scr_div_code: "20180",
    fid_input_iscd: "0000",        // 0000: 전체
    fid_trgt_cls_code: "0",
    fid_trgt_exls_cls_code: "0",
    fid_input_price_1: "",
    fid_input_price_2: "",
    fid_vol_cnt: "",
    fid_div_cls_code: "0",         // 0: 전체
    fid_input_cnt_1: "1",          // 1위부터
  });
  const res = await fetch(`${DOMAIN}${RANK_PATH}?${params}`, {
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      appkey: APP_KEY,
      appsecret: APP_SECRET,
      tr_id: TR_ID,
      custtype: "P",
    },
  });
  const j = (await res.json()) as any;
  if (!res.ok || j.rt_cd !== "0") throw new Error(`KIS ranking failed: ${res.status} rt_cd=${j.rt_cd} ${j.msg1 || ""}`);
  return Array.isArray(j.output) ? j.output : [];
}

const num = (v: any) => { const n = Number(String(v ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };

async function run() {
  if (!APP_KEY || !APP_SECRET) {
    console.error("KIS_APP_KEY / KIS_APP_SECRET 가 .env 에 없습니다. (KIS Developers 에서 발급)");
    process.exit(1);
  }
  const date = kstDate();
  console.log(`[kis] token …`);
  const token = await getToken();
  console.log(`[kis] fetching 관심종목등록 상위 (${date}) …`);
  const out = await fetchRanking(token);
  console.log(`[kis] ${out.length} rows`);
  if (out.length === 0) throw new Error("빈 응답 — 장 시간 외이거나 파라미터 확인 필요");

  const now = Date.now();
  const rows = out
    .filter((r) => /^\d{6}$/.test(String(r.mksc_shrn_iscd || "")))
    .map((r) => ({
      date,
      symbol: String(r.mksc_shrn_iscd),
      name: String(r.hts_kor_isnm || "") || null,
      rank: num(r.data_rank),
      reg_count: num(r.inter_issu_reg_csnu),
      price: num(r.stck_prpr),
      change_pct: num(r.prdy_ctrt),
      collected_at: now,
    }));

  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  await sql`
    insert into interest_snapshots ${sql(rows, "date", "symbol", "name", "rank", "reg_count", "price", "change_pct", "collected_at")}
    on conflict (date, symbol) do update set
      name = excluded.name, rank = excluded.rank, reg_count = excluded.reg_count,
      price = excluded.price, change_pct = excluded.change_pct, collected_at = excluded.collected_at`;
  console.log(`✅ ${date}: ${rows.length} 종목 저장. top5:`,
    rows.slice(0, 5).map((r) => `${r.name}(${r.reg_count.toLocaleString()})`).join(", "));
  await sql.end();
}

run().catch((e) => { console.error(e); process.exit(1); });
