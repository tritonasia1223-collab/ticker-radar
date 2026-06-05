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
const MAX_TOTAL = 60;          // 비용/시간 안전 상한
const WINDOWS = [24, 72, 168]; // 보는 기간이 달라도 신규 급부상이 커버되게 합집합
const PER_WINDOW_NEW = 12;     // 기간×시장별 신규 급부상 상위 N (UI가 보여주는 만큼)
const PER_MARKET_TOP = 5;      // 시장별 상위 급상승(메이저) — 랭킹 클릭 시 레포트 보장
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MARKET_KO: Record<string, string> = { us: "미국", kr: "한국" };

function prompt(name: string, symbol: string, market: string): string {
  return `당신은 투자 뉴스 리서처입니다. 당신의 역할은 의견이나 투자 판단을 내리는 것이 아니라,
사용자가 스스로 판단할 수 있도록 **사실 자료를 정리**하는 것입니다.
아래 종목에 대해 **지금 시점 기준 최근 1~2주 뉴스**를 검색해서, 왜 최근 투자자들 사이에서 회자되는지 한국어로 간결하게 정리하세요.

종목: ${name} (${symbol}, ${MARKET_KO[market] || market} 증시)

형식(반드시 지킬 것):
한줄요약: (왜 지금 주목받는지 — 사실 위주 한 문장)
🔺 호재:
- (보도된 사실 — 가능하면 날짜)
🔻 악재:
- (보도된 사실 — 없으면 "특이사항 없음")

규칙:
- 검색으로 확인된 사실만 쓰고 추측·일반론은 금지. 확인된 뉴스가 없으면 한줄요약에 "최근 특이 뉴스 없음"이라고 쓰세요.
- **본인의 투자 의견·매수/매도 추천·목표가·전망 평가는 쓰지 마세요.** 호재/악재는 '좋다/나쁘다'는 평가가 아니라, 보도된 사실을 성격에 따라 분류해 나열하는 것입니다.
- 전체 8줄 이내.`;
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

  // 대상 = '신규 급부상'(prior 0, recent>=2) 우선. UI가 보는 기간에 따라 신규 목록이 바뀌므로
  // 여러 기간(24/72/168h)의 상위 12를 합집합으로 잡아 '보이는 신규'를 빠짐없이 커버. 그다음
  // 잔여 예산이 있으면 시장별 상위 급상승(메이저)도 — 랭킹/섹터 클릭 시 레포트가 비지 않게.
  const targets = new Map<string, { symbol: string; name: string; market: string }>();
  const add = (r: any, market: string) => {
    if (targets.size >= MAX_TOTAL || targets.has(r.symbol)) return;
    const name = market === "kr" ? (r.companyNameKo || r.companyName || r.symbol) : (r.companyName || r.companyNameKo || r.symbol);
    targets.set(r.symbol, { symbol: r.symbol, name, market });
  };
  // 1) 신규 급부상 (시장 × 기간별 상위 PER_WINDOW_NEW, 계정수 순)
  for (const market of ["us", "kr"]) {
    for (const w of WINDOWS) {
      const rows = await storage.surge(w, 1, market);
      rows.filter((r) => r.priorMentions === 0 && r.recentMentions >= 2)
        .sort((a, b) => b.recentAccounts - a.recentAccounts || b.recentMentions - a.recentMentions)
        .slice(0, PER_WINDOW_NEW)
        .forEach((r) => add(r, market));
    }
  }
  const newcomerCount = targets.size;
  // 2) 메이저(상위 급상승) 소수 보강
  for (const market of ["us", "kr"]) {
    (await storage.surge(72, 1, market)).slice(0, PER_MARKET_TOP).forEach((r) => add(r, market));
  }
  const list = [...targets.values()];
  console.log(`레포트 생성 대상 ${list.length}개 (신규 ${newcomerCount} + 메이저 ${list.length - newcomerCount}, ${MODEL}) …`);

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
