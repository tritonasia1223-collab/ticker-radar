// Generate "왜 뜨나" news reports for surging stocks using Gemini + Google Search grounding.
// One grounded call per stock → real-time news → short 호재/악재 summary + source links,
// cached in the `reports` table. Shown in the 종목 상세 시트.
//
//   npm run reports
//
// Needs GEMINI_API_KEY in .env (aistudio.google.com, free tier). Optional GEMINI_MODEL.
import "dotenv/config";
import postgres from "postgres";
import { storage } from "../server/storage.js";

const KEY = process.env.GEMINI_TOKEN || process.env.GEMINI_API_KEY || "";
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const API = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const MAX_TOTAL = 30;          // 비용/시간 상한
const PER_MARKET_NEW = 10;     // 시장별 신규 급부상 상한
const PER_MARKET_TOP = 6;      // 시장별 상위 급상승 상한
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MARKET_KO: Record<string, string> = { us: "미국", kr: "한국" };

function prompt(name: string, symbol: string, market: string): string {
  return `당신은 투자 뉴스 리서처입니다. 아래 종목에 대해 **지금 시점 기준 최근 1~2주 뉴스**를 검색해서, 왜 최근 투자자들 사이에서 회자되는지 한국어로 간결하게 정리하세요.

종목: ${name} (${symbol}, ${MARKET_KO[market] || market} 증시)

형식(반드시 지킬 것):
한줄요약: (왜 지금 주목받는지 한 문장)
🔺 호재:
- (항목 — 가능하면 날짜)
🔻 악재:
- (항목 — 없으면 "특이사항 없음")

규칙: 검색으로 확인된 사실만 쓰고 추측·일반론은 금지. 확인된 뉴스가 없으면 한줄요약에 "최근 특이 뉴스 없음"이라고 쓰세요. 전체 8줄 이내.`;
}

async function gemini(name: string, symbol: string, market: string): Promise<{ summary: string; sources: { title: string; url: string }[] } | null> {
  const res = await fetch(`${API}?key=${encodeURIComponent(KEY)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt(name, symbol, market) }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.3 },
    }),
  });
  if (!res.ok) { console.error(`  ✗ ${symbol}: ${res.status} ${(await res.text()).slice(0, 160)}`); return null; }
  const j = (await res.json()) as any;
  const cand = j?.candidates?.[0];
  const summary = (cand?.content?.parts || []).map((p: any) => p.text).filter(Boolean).join("").trim();
  if (!summary) return null;
  const chunks = cand?.groundingMetadata?.groundingChunks || [];
  const seen = new Set<string>();
  const sources = chunks
    .map((c: any) => ({ title: String(c?.web?.title || "").trim(), url: String(c?.web?.uri || "").trim() }))
    .filter((s: any) => s.url && !seen.has(s.url) && seen.add(s.url));
  return { summary, sources };
}

async function run() {
  if (!KEY) { console.error("GEMINI_TOKEN 가 .env 에 없습니다. (aistudio.google.com 에서 발급)"); process.exit(1); }

  // 대상 선정: 시장별 신규 급부상 + 상위 급상승, 중복 제거.
  const targets = new Map<string, { symbol: string; name: string; market: string }>();
  for (const market of ["us", "kr"]) {
    const rows = await storage.surge(72, 1, market); // 최근 3일, 명>=1, 명 순 정렬
    const newcomers = rows.filter((r) => r.priorMentions === 0 && r.recentMentions >= 2).slice(0, PER_MARKET_NEW);
    const top = rows.slice(0, PER_MARKET_TOP);
    for (const r of [...newcomers, ...top]) {
      if (targets.size >= MAX_TOTAL) break;
      if (!targets.has(r.symbol)) {
        const name = market === "kr" ? (r.companyNameKo || r.companyName || r.symbol) : (r.companyName || r.companyNameKo || r.symbol);
        targets.set(r.symbol, { symbol: r.symbol, name, market });
      }
    }
  }
  const list = [...targets.values()];
  console.log(`레포트 생성 대상 ${list.length}개 (${MODEL}) …`);

  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 2 });
  let ok = 0, fail = 0;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    try {
      const r = await gemini(t.name, t.symbol, t.market);
      if (r) {
        await sql`
          insert into reports (symbol, summary, sources, model, generated_at)
          values (${t.symbol}, ${r.summary}, ${JSON.stringify(r.sources)}, ${MODEL}, ${Date.now()})
          on conflict (symbol) do update set
            summary = excluded.summary, sources = excluded.sources, model = excluded.model, generated_at = excluded.generated_at`;
        ok++;
        console.log(`  ✓ ${t.name} (${t.symbol}) — 출처 ${r.sources.length}`);
      } else fail++;
    } catch (e: any) { fail++; console.error(`  ✗ ${t.symbol}: ${String(e?.message || e).slice(0, 120)}`); }
    await sleep(4500); // free tier RPM 여유
  }
  console.log(`✅ done — 생성 ${ok} · 실패 ${fail}`);
  await sql.end();
  process.exit(0);
}

run().catch((e) => { console.error(e); process.exit(1); });
