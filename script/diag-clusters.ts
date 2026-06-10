// 클러스터 점수 회귀 하네스 — 레버 손댈 때마다 before/after 줄세움 검증.
//   실행: npx tsx script/diag-clusters.ts
//   participantSignal/thinPenalty 를 server/storage.ts 에서 복제(검증용 독립 재계산) — 둘이 어긋나면 둘 다 의심.
//   출력: ① 고티어 n=2 old→new 순위 ② 하단30(노이즈 불변 확인) ③ percap 분포 ④ 지목종목 추적.
//   #21(thin→percap비례)에서 작성, #22(SPV 분모 보정) 검증에도 그대로 재사용 — 레버마다 새로 만들지 말 것.
import "dotenv/config";
import { storage } from "../server/storage";

const ROLE_W = (role: string | null): number => {
  if (!role) return 0.3;
  const r = role; const owner = /10\s*%/.test(r);
  if (/see\s*remarks/i.test(r)) return Math.max(0.3, owner ? 0.9 : 0);
  let w = 0.3;
  if (/\bceo\b/i.test(r) || /chief executive/i.test(r) || /chair(man|person|woman)?\b/i.test(r) || /\bcfo\b/i.test(r) || /chief financial/i.test(r)) w = 1.0;
  else if (/\bcoo\b/i.test(r) || /chief operating/i.test(r) || /\bcto\b/i.test(r) || /chief technology/i.test(r) || (/\bpresident\b/i.test(r) && !/vice[\s-]*president/i.test(r))) w = 0.7;
  else if (/\bclo\b/i.test(r) || /chief legal/i.test(r) || /general counsel/i.test(r) || /\bcounsel\b/i.test(r) || /\bcao\b/i.test(r) || /\bpao\b/i.test(r) || /chief accounting/i.test(r) || /controller/i.test(r) || /\bchro\b/i.test(r) || /\bcmo\b/i.test(r) || /chief\s+[\w\s]+officer/i.test(r) || /\b(?:e|s)?vp\b/i.test(r) || /vice\s*president/i.test(r) || /\bofficer\b/i.test(r)) w = 0.4;
  else if (/\bdirector\b/i.test(r)) w = 0.25;
  return Math.max(w, owner ? 0.9 : 0);
};
const tierName = (w: number) => w >= 1.0 ? "T1전사재무" : w >= 0.9 ? "대주주" : w >= 0.7 ? "T2운영" : w >= 0.4 ? "T3기능" : w >= 0.3 ? "미확인" : "T4이사";

// participantSignal 재현 (검증용) — storage.ts 와 동일해야 함
const isOwner = (r: string | null) => r != null && /10\s*%/.test(r);
const holdMult = (pct: number | null) => pct == null ? 1.0 : pct > 0.5 ? 1.5 : pct >= 0.1 ? 1.0 : 0.5;
const partSignal = (p: any, side: string, massPost0: boolean) => {
  let m = holdMult(p.pctOfHoldings);
  const capped = side === "sell" && isOwner(p.role) && p.pctOfHoldings != null && p.pctOfHoldings >= 0.80;
  if (capped) m = Math.min(m, 1.0);
  else if (side === "sell" && massPost0 && p.sharesAfter === 0) m *= 0.5;
  return ROLE_W(p.role) * (1 + Math.log10(1 + Math.abs(p.value) / 1e5)) * m;
};
const thinPen = (pc: number) => 0.65 + 0.25 * Math.max(0, Math.min(1, (pc - 0.5) / 1.0));

async function main() {
  const all = await storage.insiderClusters({ fromMs: 0, minInsiders: 2, limit: 100000, windowDays: 30 });
  // 각 클러스터의 sumSignal/percap 을 직접 재계산 → old(flat 0.65) vs new(percap비례) 점수 비교
  const rows = all.map((c) => {
    const dir = c.side === "buy" ? 2 : 1;
    const massPost0 = c.participants.filter((p) => p.sharesAfter === 0).length >= 3;
    const sumSignal = c.participants.reduce((s, p) => s + partSignal(p, c.side, massPost0), 0);
    const perCapita = sumSignal / c.insiderCount;
    const base = dir * sumSignal / Math.sqrt(c.insiderCount);
    const scoreOld = base * (c.thin ? 0.65 : 1);     // #21 이전(flat0.65)
    const density = 0.8 + 0.2 * (1 - Math.min(1, c.spanDays / 30)); // #4 윈도우 밀집도(storage 와 동일)
    const scoreBefore = base * (c.thin ? thinPen(perCapita) : 1);    // #4 적용 전(=#21 percap 공식)
    const scoreNew = scoreBefore * density;                          // #4 적용 후 (= c.score)
    const maxW = Math.max(...c.participants.map((p) => ROLE_W(p.role)));
    return { c, dir, sumSignal, perCapita, scoreOld, scoreBefore, scoreNew, density, scoreNoThin: base, maxW };
  });
  const byNew = [...rows].sort((a, b) => b.scoreNew - a.scoreNew);
  const byOld = [...rows].sort((a, b) => b.scoreOld - a.scoreOld);
  const byBefore = [...rows].sort((a, b) => b.scoreBefore - a.scoreBefore); // #4 적용 전 순위
  const newRank = new Map(byNew.map((r, i) => [r.c, i + 1]));
  const oldRank = new Map(byOld.map((r, i) => [r.c, i + 1]));
  const beforeRank = new Map(byBefore.map((r, i) => [r.c, i + 1]));
  byNew.forEach((r, i) => ((r as any).rank = i + 1));
  rows.length = 0; rows.push(...byNew);

  console.log(`\n총 클러스터: ${rows.length}  (thin n=2: ${rows.filter((r) => r.c.thin).length}, gated: ${rows.filter((r) => r.c.gated).length})`);

  // 드리프트 체크: 복제 scoreNew 가 실제 c.score(density 포함)와 일치해야
  const drift = rows.filter((r) => Math.abs(r.scoreNew - r.c.score) > 0.01);
  console.log(drift.length ? `⚠ 드리프트 ${drift.length}건 (복제≠c.score) — 둘 다 의심` : "✓ 복제=c.score 일치(density 포함)");

  // #4 밀집도 효과: 적용 전(percap)→후(×density) 순위 변동 큰 순. tight↑/spread↓ 가 의도, 하단 노이즈 불변.
  console.log("\n=== #4 밀집도 효과 — 순위 변동 큰 순 (before→after) ===");
  const movers = rows.map((r) => ({ r, d: beforeRank.get(r.c)! - newRank.get(r.c)! }))
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 14);
  for (const { r, d } of movers)
    console.log(`  ${d > 0 ? "▲" : d < 0 ? "▼" : "="}${String(Math.abs(d)).padStart(2)} #${beforeRank.get(r.c)}→#${newRank.get(r.c)} ${r.c.symbol}/${r.c.side} n=${r.c.insiderCount} span=${String(r.c.spanDays).padStart(2)}d ×${r.density.toFixed(2)} (${r.scoreBefore.toFixed(2)}→${r.scoreNew.toFixed(2)})`);


  // 1) thin n=2 중 고티어(maxW>=0.9) — old(flat0.65) → new(percap비례) 순위 변화
  console.log("=== ① 고티어 n=2 — old순위(flat0.65) → new순위(percap비례) ===");
  const hiThin = rows.filter((r) => r.c.thin && r.maxW >= 0.9).slice(0, 30);
  for (const r of hiThin) {
    const factor = thinPen(r.perCapita);
    const tcomp = r.c.participants.map((p) => `${p.name.split(" ")[0]}(${tierName(ROLE_W(p.role))},${p.pctOfHoldings == null ? "?" : (p.pctOfHoldings * 100).toFixed(0) + "%"})`).join(" + ");
    console.log(`  #${oldRank.get(r.c)}→#${newRank.get(r.c)} ${r.c.symbol}/${r.c.side} percap=${r.perCapita.toFixed(2)} ×${factor.toFixed(2)} (old${r.scoreOld.toFixed(2)}→new${r.scoreNew.toFixed(2)}) | ${tcomp}`);
  }

  // 2) 하단 30개 — old대비 변동 확인(노이즈는 그대로여야 함)
  console.log("\n=== ② 전체 하단 30개 (new기준) — old순위 대비 ===");
  for (const r of rows.slice(-30)) {
    const comp = r.c.participants.slice(0, 4).map((p) => `${tierName(ROLE_W(p.role))}`).join(",");
    const factor = r.c.thin ? thinPen(r.perCapita) : 1;
    console.log(`  #${r.rank}(old#${oldRank.get(r.c)}) ${r.c.symbol}/${r.c.side} n=${r.c.insiderCount} new=${r.scoreNew.toFixed(2)} percap=${r.perCapita.toFixed(2)} ×${factor.toFixed(2)} maxW=${r.maxW} [${comp}]`);
  }

  // 3) 고티어 n=2 percap 분포 vs n>=3 percap 분포 (thin 페널티가 정당한지)
  const hi2 = rows.filter((r) => r.c.thin && r.maxW >= 0.9);
  const lo2 = rows.filter((r) => r.c.thin && r.maxW < 0.9);
  const n3 = rows.filter((r) => r.c.insiderCount >= 3);
  const avg = (a: number[]) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
  console.log("\n=== ③ per-capita 분포(thin 페널티 전 Σsignal/n) ===");
  console.log(`  고티어 n=2 (maxW≥0.9): cnt=${hi2.length} avgPercap=${avg(hi2.map((r) => r.perCapita)).toFixed(2)}`);
  console.log(`  저티어 n=2 (maxW<0.9): cnt=${lo2.length} avgPercap=${avg(lo2.map((r) => r.perCapita)).toFixed(2)}`);
  console.log(`  n≥3:                   cnt=${n3.length} avgPercap=${avg(n3.map((r) => r.perCapita)).toFixed(2)}`);

  // 4) 특정 종목 추적 (WIT/AVT/JKHY/BLK)
  console.log("\n=== ④ 지목 종목 추적 (old→new 순위) ===");
  for (const sym of ["NCLH", "TKO", "AMRZ", "MDLN", "JKHY", "BLK", "ESLT", "DELL"]) {
    const found = rows.filter((r) => r.c.symbol === sym);
    if (!found.length) { console.log(`  ${sym}: 클러스터 없음`); continue; }
    for (const r of found) {
      const comp = r.c.participants.map((p) => `${p.name.split(" ")[0]}(${tierName(ROLE_W(p.role))},${p.pctOfHoldings == null ? "?" : (p.pctOfHoldings * 100).toFixed(0) + "%"},$${(p.value / 1e6).toFixed(1)}M)`).join(" + ");
      console.log(`  ${sym}/${r.c.side} #${beforeRank.get(r.c)}→#${newRank.get(r.c)} n=${r.c.insiderCount} span=${r.c.spanDays}d ×dens${r.density.toFixed(2)} (${r.scoreBefore.toFixed(2)}→${r.scoreNew.toFixed(2)}) | ${comp}`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
