// #22 충돌 리포트 — joint-filer dedup 으로 병합될 그룹을 전 테이블에서 추출해 눈으로 검증.
//   실행: npx tsx script/dedup-report.ts
//   병합 키(구현과 동일): filerPrefix ∧ (symbol, side, txnDate, shares, sharesAfter, txnCode), 서로 다른 인사이더 ≥2.
//   조건2 검증: 튜플 동일하지만 filer-prefix 다른 그룹(=다른 제출배치, 우연 위험)은 '미병합'으로 분리 표시.
//   합격 기준: 병합 그룹이 전부 엔티티↔지배인 쌍 / 미병합·소수량 충돌이 안전하게 걸러지는지.
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../server/storage";

// ext = "fin:0001104659-26-023625:SYM:S:DATE:-QTY" → filerPrefix=0001104659, seq=023625
const parseAcc = (ext: string) => {
  const m = /^fin:(\d{10})-(\d{2})-(\d{6})/.exec(String(ext));
  return m ? { filer: m[1], yr: m[2], seq: m[3] } : { filer: "?", yr: "?", seq: "?" };
};

async function main() {
  const rows = (await db.execute(sql`
    SELECT i.name, i.slug, it.symbol, it.side, it.txn_code AS code, it.shares, it.shares_after AS after,
           it.value, it.txn_date AS txn, it.role, it.external_id AS ext
    FROM insider_trades it JOIN insiders i ON i.id = it.insider_id
    WHERE it.side IN ('buy','sell')
  `)) as unknown as any[];

  // 튜플(=동일 수익포지션 후보)로 그룹: symbol|side|txn|shares|after|code
  const byTuple = new Map<string, any[]>();
  for (const r of rows) {
    const k = [r.symbol, r.side, r.txn, r.shares, r.after, r.code].join("|");
    const g = byTuple.get(k) || []; g.push(r); byTuple.set(k, g);
  }

  const willMerge: any[] = []; // 튜플동일 ∧ filer동일 ∧ 인사이더≥2
  const tupleOnly: any[] = []; // 튜플동일 ∧ filer 다름 (조건2가 막음)
  for (const [k, g] of byTuple) {
    const distinctIns = new Set(g.map((r) => r.slug));
    if (distinctIns.size < 2) continue; // 단독 → 무관
    // filer-prefix 별로 다시 쪼갬
    const byFiler = new Map<string, any[]>();
    for (const r of g) { const f = parseAcc(r.ext).filer; const a = byFiler.get(f) || []; a.push(r); byFiler.set(f, a); }
    const filers = [...byFiler.keys()];
    const sameFilerMultiIns = filers.some((f) => new Set(byFiler.get(f)!.map((r) => r.slug)).size >= 2);
    if (sameFilerMultiIns) willMerge.push({ k, g });
    if (filers.length >= 2) tupleOnly.push({ k, g, filers }); // 같은 튜플인데 filer 갈림
  }

  console.log(`\n전체 P/S 행: ${rows.length} / 튜플 그룹: ${byTuple.size}`);
  console.log(`병합 그룹(튜플∧filer동일, 인사이더≥2): ${willMerge.length}`);
  console.log(`주의 그룹(튜플동일·filer다름 — 조건2가 미병합 처리): ${tupleOnly.length}\n`);

  console.log("=== ① 병합될 그룹 전부 (이름·accession seq·수량) ===");
  willMerge.sort((a, b) => Math.abs(Number(b.g[0].value)) - Math.abs(Number(a.g[0].value)));
  for (const { g } of willMerge) {
    const r0 = g[0];
    const names = [...new Set(g.map((r: any) => `${String(r.name).slice(0, 22)}[${parseAcc(r.ext).seq}/${String(r.role || "-").slice(0, 10)}]`))];
    const d = new Date(Number(r0.txn)).toISOString().slice(0, 10);
    console.log(`  ${r0.symbol}/${r0.side} ${d} ${r0.code} qty=${Number(r0.shares).toLocaleString()} after=${Number(r0.after).toLocaleString()} $${(Number(r0.value) / 1e6).toFixed(1)}M`);
    console.log(`      filer=${parseAcc(r0.ext).filer} ⟶ ${names.join("  +  ")}`);
  }

  console.log("\n=== ② 주의: 튜플 동일하지만 filer 다름 (병합 안 함 — 우연/별도배치 여부 확인) ===");
  if (!tupleOnly.length) console.log("  (없음 — 모든 튜플충돌이 같은 filer-prefix 안에서만 발생)");
  for (const { g, filers } of tupleOnly.slice(0, 40)) {
    const r0 = g[0]; const d = new Date(Number(r0.txn)).toISOString().slice(0, 10);
    const names = [...new Set(g.map((r: any) => `${String(r.name).slice(0, 18)}(${parseAcc(r.ext).filer})`))];
    console.log(`  ${r0.symbol}/${r0.side} ${d} qty=${Number(r0.shares).toLocaleString()} after=${Number(r0.after).toLocaleString()} filers=${filers.length} | ${names.join(" / ")}`);
  }

  // 소수량 충돌 점검: 병합 그룹 중 qty 작은(<10000) 것 — 우연 위험대
  const small = willMerge.filter(({ g }) => Math.abs(Number(g[0].shares)) < 10000);
  console.log(`\n=== ③ 병합 그룹 중 소수량(<10k주) — 우연 오병합 위험 점검: ${small.length}건 ===`);
  for (const { g } of small.slice(0, 30)) {
    const r0 = g[0]; const names = [...new Set(g.map((r: any) => String(r.name).slice(0, 20)))];
    const seqs = [...new Set(g.map((r: any) => parseAcc(r.ext).seq))];
    console.log(`  ${r0.symbol}/${r0.side} qty=${Number(r0.shares)} after=${Number(r0.after)} seq=${seqs.join(",")} | ${names.join(" + ")}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
