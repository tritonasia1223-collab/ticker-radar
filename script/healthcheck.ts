// #27 — 내부자 데이터 정합 헬스체크 (수집 직후 자동 실행). 읽기전용 raw 하네스 — 점수 복제 없음.
//   지표: ① orphan(전체/P/S, 분류 A/B/C) ② 교차티커 이중합산(양쪽 healthy ⚠) ③ joint-filer 병합건수 ④ 심볼수.
//   RED(exit 1): B(진짜 링크깨짐)>0 — orphan 능동 생성 의심 = 조사 필요. A·교차티커⚠ 는 정상(query-time 가드가 처리).
//   상세 뷰: orphan-classify.ts(①②) · dedup-report.ts(③). 병합건수는 실제 dedupeJointFilers 재사용(드리프트 0).
//   실행: npm run healthcheck   (수집 워크플로 congress.yml 마지막 스텝에서 자동)
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, dedupeJointFilers } from "../server/storage";

const accOf = (ext: string | null) => { const m = /^fin:([^:]+):/.exec(String(ext || "")); return m ? m[1] : ""; };

async function main() {
  // 전 P/S 행 + 링크 건강성 (raw). 필드명은 dedupeJointFilers 가 읽는 이름에 맞춤.
  const rows = (await db.execute(sql`
    SELECT it.id, it.symbol AS symbol, i.slug AS slug, i.name AS name, it.role AS role,
           it.side AS side, it.txn_code AS code, it.shares AS shares, it.shares_after AS "sharesAfter",
           it.txn_date AS "txnDate", it.value AS value, it.external_id AS ext, (i.id IS NOT NULL) AS healthy
    FROM insider_trades it LEFT JOIN insiders i ON i.id = it.insider_id
    WHERE it.side IN ('buy','sell')`)) as unknown as any[];

  const totRows = (await db.execute(sql`
    SELECT count(*)::int AS n FROM insider_trades it LEFT JOIN insiders i ON i.id = it.insider_id
    WHERE i.id IS NULL`)) as unknown as any[];
  const totalOrphans = Number(totRows[0]?.n ?? 0);

  // accession → 그 안의 모든 P/S 행
  const byAcc = new Map<string, any[]>();
  for (const r of rows) { const k = accOf(r.ext); const g = byAcc.get(k) || []; g.push(r); byAcc.set(k, g); }

  // ① orphan 분류 (P/S) — orphan-classify 와 동일 정의(accession 교차여부). 정합 로직(점수 아님).
  const orphans = rows.filter((r) => !r.healthy);
  let A = 0, B = 0, C = 0;
  for (const o of orphans) {
    const g = byAcc.get(accOf(o.ext)) || [];
    if (g.some((r) => r.symbol !== o.symbol && r.healthy)) A++;        // 다른 심볼에 healthy 쌍둥이 → 교차티커중복
    else if (!g.some((r) => r.symbol !== o.symbol)) B++;              // 이 심볼에만 → 진짜 링크깨짐
    else C++;
  }

  // ② 교차티커 이중합산: 한 accession 이 ≥2 심볼 + 모든 심볼에 healthy 행 (현재 가드가 집계서 dedup 중)
  let crossDouble = 0; const crossPairs = new Set<string>();
  for (const g of byAcc.values()) {
    const syms = [...new Set(g.map((r) => r.symbol))];
    if (syms.length < 2) continue;
    if (syms.every((s) => g.some((r) => r.symbol === s && r.healthy))) { crossDouble++; crossPairs.add([...syms].sort().join("|")); }
  }

  // ③ joint-filer 병합건수 — 실제 dedupeJointFilers(healthy P/S) 재사용 → 드롭 행수 (exact, 드리프트 0)
  const healthy = rows.filter((r) => r.healthy);
  const jointDropped = healthy.length - dedupeJointFilers(healthy).length;

  // ④ 심볼수 (P/S)
  const symbolCount = new Set(rows.map((r) => r.symbol)).size;

  const red = B > 0;
  console.log(`\n[insider 헬스체크] P/S행 ${rows.length} · 심볼 ${symbolCount}`);
  console.log(`  ① orphan: 전체 ${totalOrphans}행 · P/S ${orphans.length}행 → A(교차티커중복) ${A} · B(진짜깨짐) ${B} · C(기타) ${C}`);
  console.log(`  ② 교차티커 이중합산(양쪽healthy ⚠, #24 가드 처리): accession ${crossDouble}건 · 쌍 ${[...crossPairs].join(", ") || "-"}`);
  console.log(`  ③ joint-filer 병합: ${jointDropped}행 드롭 (${healthy.length}→${healthy.length - jointDropped})`);
  console.log(`  ④ 심볼수(P/S): ${symbolCount}`);
  console.log(red
    ? `\n❌ RED — B(진짜 링크깨짐) ${B}행: orphan 능동생성 의심. orphan-classify.ts 분류 후 repair-orphan-links.ts 로 복구.`
    : `\n✅ PASS — 진짜 링크깨짐(B) 0. A(교차티커)·② ⚠ 는 정상(query-time 가드가 처리).`);
  process.exit(red ? 1 : 0);
}
main().catch((e) => { console.error("헬스체크 실패:", e); process.exit(1); });
