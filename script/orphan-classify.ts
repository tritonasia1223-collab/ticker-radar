// #24 스코핑 — 읽기전용 분류 하네스 (점수 복제 없음, raw 쿼리만 — dedup-report.ts 와 동일 철학).
//   실행: npx tsx script/orphan-classify.ts
//
// 배경(#23): 랭킹을 클러스터 단일소스(INNER JOIN insiders)로 일원화하자, insiders 에 없는
//   insider_id 를 참조하는 'orphan' 행(101행/19심볼)이 드롭됨. GOOG 는 전량 orphan(47행/$23.8M)
//   인데 GOOGL 과 수치가 동일 → GOOG 는 '링크 고칠 반쪽 데이터'가 아니라 GOOGL 의 교차티커 복제본일
//   가능성. 고치면 Alphabet 이중합산.
//
// 이 스크립트가 답하는 것:
//   ① orphan 101행/19심볼을 accession·튜플로 분류: 교차티커중복 / 진짜링크깨짐 / 기타.
//   ② 듀얼클래스 빙산: 한 accession 이 ≥2 심볼에 걸친 모든 경우 — 양쪽 다 healthy 면 '보이지 않는 이중합산'.
//   변경 없음(SELECT only). 처방은 사람이 결과 보고 확정.
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../server/storage";

const acc = (ext: string | null) => {
  const m = /^fin:([^:]+):/.exec(String(ext || ""));
  return m ? m[1] : "?";
};
const fmt$ = (v: number) => `$${(v / 1e6).toFixed(2)}M`;

async function main() {
  // P/S 전 행 + 링크 건강성(insiders 존재 여부) — 점수 무관, raw.
  const rows = (await db.execute(sql`
    SELECT it.id, it.symbol, it.insider_id AS iid, it.side, it.txn_code AS code,
           it.shares, it.shares_after AS after, COALESCE(it.value,0) AS value,
           it.txn_date AS txn, it.external_id AS ext,
           (i.id IS NOT NULL) AS healthy, i.name AS iname
    FROM insider_trades it
    LEFT JOIN insiders i ON i.id = it.insider_id
    WHERE it.side IN ('buy','sell')
  `)) as unknown as any[];

  const orphans = rows.filter((r) => !r.healthy);
  console.log(`\n전체 P/S 행: ${rows.length} · orphan(insiders 없음): ${orphans.length} · 심볼: ${new Set(orphans.map((r) => r.symbol)).size}`);

  // accession → 그 안의 모든 행 (심볼·건강성 분포)
  const byAcc = new Map<string, any[]>();
  for (const r of rows) { const k = acc(r.ext); const g = byAcc.get(k) || []; g.push(r); byAcc.set(k, g); }

  // 같은 accession 이 ≥2 심볼에 걸친 경우 = 교차티커 (accession 은 SEC 전역 유일 → 동일 제출 확정)
  const crossAcc = [...byAcc.entries()].filter(([, g]) => new Set(g.map((r) => r.symbol)).size >= 2);

  // ── ① orphan 분류 ──────────────────────────────────────────────
  // 각 orphan: 같은 accession 의 '다른 심볼' 행 중 healthy 가 있나? → 교차티커중복. 없으면 진짜깨짐/기타.
  const cls = { dup: [] as any[], broken: [] as any[], other: [] as any[] };
  for (const o of orphans) {
    const g = byAcc.get(acc(o.ext)) || [];
    const twinHealthyOtherSym = g.some((r) => r.symbol !== o.symbol && r.healthy);
    const twinAnyOtherSym = g.some((r) => r.symbol !== o.symbol);
    if (twinHealthyOtherSym) cls.dup.push(o);
    else if (!twinAnyOtherSym) cls.broken.push(o);   // accession 이 이 심볼에만 존재 → 진짜 링크깨짐
    else cls.other.push(o);                          // 교차티커지만 다른 심볼도 orphan (양쪽 깨짐 등)
  }
  const sym = (arr: any[]) => [...new Set(arr.map((r) => r.symbol))].sort();
  const sum$ = (arr: any[]) => arr.reduce((s, r) => s + Math.abs(Number(r.value)), 0);
  console.log(`\n=== ① orphan ${orphans.length}행 분류 ===`);
  console.log(`  A) 교차티커 중복 (다른 심볼에 healthy 쌍둥이 존재 → 되살리면 이중합산): ${cls.dup.length}행 / ${fmt$(sum$(cls.dup))} / 심볼 ${sym(cls.dup).join(",")}`);
  console.log(`  B) 진짜 링크깨짐 (accession 이 이 심볼에만 → 실거래, 링크만 복구): ${cls.broken.length}행 / ${fmt$(sum$(cls.broken))} / 심볼 ${sym(cls.broken).join(",")}`);
  console.log(`  C) 기타 (교차티커지만 다른 심볼도 orphan): ${cls.other.length}행 / ${fmt$(sum$(cls.other))} / 심볼 ${sym(cls.other).join(",")}`);

  // 심볼별 orphan 내역 (어느 분류인지 한눈에)
  console.log(`\n--- 심볼별 orphan (분류·행수·금액·healthy쌍둥이심볼) ---`);
  const bySym = new Map<string, any[]>();
  for (const o of orphans) { const a = bySym.get(o.symbol) || []; a.push(o); bySym.set(o.symbol, a); }
  for (const [s, arr] of [...bySym.entries()].sort((a, b) => sum$(b[1]) - sum$(a[1]))) {
    const twinSyms = new Set<string>();
    let dup = 0, brk = 0, oth = 0;
    for (const o of arr) {
      const g = byAcc.get(acc(o.ext)) || [];
      const hs = g.filter((r) => r.symbol !== o.symbol && r.healthy).map((r) => r.symbol);
      hs.forEach((x) => twinSyms.add(x));
      const anyOther = g.some((r) => r.symbol !== o.symbol);
      if (hs.length) dup++; else if (!anyOther) brk++; else oth++;
    }
    const tag = dup === arr.length ? "A:전량중복" : brk === arr.length ? "B:전량깨짐" : `혼합(A${dup}/B${brk}/C${oth})`;
    console.log(`  ${s.padEnd(7)} ${String(arr.length).padStart(3)}행 ${fmt$(sum$(arr)).padStart(10)}  [${tag}]  쌍둥이→${[...twinSyms].join(",") || "-"}`);
  }

  // ── ② 듀얼클래스 빙산: 교차티커 accession 전수 (orphan 여부 무관) ──────────
  console.log(`\n=== ② 교차티커 accession 전수 (한 제출이 ≥2 심볼에 — 빙산) : ${crossAcc.length}건 ===`);
  // 심볼쌍별로 집계
  const pairAgg = new Map<string, { accs: Set<string>; bothHealthy: number; rows: number; syms: Set<string> }>();
  for (const [a, g] of crossAcc) {
    const syms = [...new Set(g.map((r) => r.symbol))].sort();
    const key = syms.join("|");
    const p = pairAgg.get(key) || { accs: new Set(), bothHealthy: 0, rows: 0, syms: new Set(syms) };
    p.accs.add(a); p.rows += g.length;
    const allSidesHealthy = syms.every((s) => g.some((r) => r.symbol === s && r.healthy));
    if (allSidesHealthy) p.bothHealthy++;
    pairAgg.set(key, p);
  }
  console.log(`  심볼쌍별 (accession수 · 행수 · 그중 양쪽모두healthy=보이지않는이중합산):`);
  for (const [key, p] of [...pairAgg.entries()].sort((a, b) => b[1].rows - a[1].rows)) {
    const flag = p.bothHealthy > 0 ? " ⚠ 양쪽healthy(이중합산)" : "";
    console.log(`  ${key.padEnd(18)} accession ${String(p.accs.size).padStart(3)} · 행 ${String(p.rows).padStart(3)} · 양쪽healthy ${p.bothHealthy}${flag}`);
  }

  // 양쪽 다 healthy 인 교차티커 — 현재 클러스터/랭킹에서 이중계상 중인 실제 사례
  console.log(`\n--- ②-b 현재 이중합산 중(양쪽 healthy) 교차티커 accession 샘플 ---`);
  let shown = 0;
  for (const [a, g] of crossAcc) {
    const syms = [...new Set(g.map((r) => r.symbol))].sort();
    const allHealthy = syms.every((s) => g.some((r) => r.symbol === s && r.healthy));
    if (!allHealthy) continue;
    if (shown++ >= 20) break;
    const per = syms.map((s) => { const sg = g.filter((r) => r.symbol === s); return `${s}:${sg.length}행/${fmt$(sum$(sg))}`; });
    console.log(`  acc=${a} ${per.join("  ")}  insider=${(g[0].iname || "?").slice(0, 22)}`);
  }
  if (!shown) console.log("  (없음 — 모든 교차티커가 한쪽 orphan)");

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
