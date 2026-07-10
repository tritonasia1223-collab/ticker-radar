// Fix ② 반증 하네스: 같은 카드에 '동시 저장'이 서로를 full-replace 로 덮어 노드가 손실되는지 실증.
//   실행: npm run probe:cap:race
// ⚠️ 실데이터 무접촉: 오직 '__racetest__' 슬러그의 임시 카드에서만 작업하고, 끝나면 삭제한다.
//    실제 1968~1994 사건은 절대 건드리지 않는다(슬러그 프리픽스 가드 + finally 정리).
//
// 이 프로브는 Phase 0 의 '기준선'이다: 지금은 손실이 재현돼야 하고(반증), Phase 4(저장 직렬화/버전)
// 적용 후 재실행하면 손실 0 이어야 한다(네거티브 컨트롤 통과).
import "dotenv/config";
import { upsertFlow, deleteFlow, listFlows, type FlowInput } from "../server/capitalism.js";

const SLUG = "__racetest__"; // 절대 실데이터와 겹치지 않는 격리 슬러그
const base = (nodes: FlowInput["nodes"]): FlowInput => ({
  slug: SLUG, date: "1900-01-01", endDate: null, year: 1900, title: "RACE TEST",
  category: "경제", layout: "stack", insight: null, nodes, edges: [],
});
const node = (key: string, text: string) => ({ nodeKey: key, kind: "effect", text });

async function readNodeKeys(): Promise<string[]> {
  const f = (await listFlows()).find((x) => x.slug === SLUG);
  return f ? f.nodes.map((n) => n.id).sort() : [];
}

async function main() {
  // 안전 가드: 혹시 남아있던 임시 카드 정리
  await deleteFlow(SLUG).catch(() => {});

  const TRIALS = 5;
  let lossCount = 0;
  console.log(`=== Fix② 레이스 프로브 (동시 저장 → 노드 손실?) · ${TRIALS}회 ===`);
  for (let i = 0; i < TRIALS; i++) {
    // 시드: [A]
    await upsertFlow(base([node("A", "base")]));
    // 동시 저장 2발: 하나는 [A,B], 다른 하나는 [A,C] (각자 다른 새 칸을 추가한 상태)
    await Promise.all([
      upsertFlow(base([node("A", "base"), node("B", "cell-B")])),
      upsertFlow(base([node("A", "base"), node("C", "cell-C")])),
    ]);
    const keys = await readNodeKeys();
    const hasB = keys.includes("B"), hasC = keys.includes("C");
    const lost = !(hasB && hasC); // full-replace 라면 B·C 둘 다 살아남을 수 없음
    if (lost) lossCount++;
    console.log(`  시도 ${i + 1}: 최종노드 [${keys.join(",")}] → ${lost ? `⚠ 손실(${hasB ? "C" : "B"} 사라짐)` : "✔ 둘 다 보존"}`);
  }

  // 대조군(직렬화): 순차 저장 + 누적 스냅샷이면 손실 0 이어야 함 → Phase 4a 방향 검증
  await upsertFlow(base([node("A", "base")]));
  await upsertFlow(base([node("A", "base"), node("B", "cell-B")]));
  await upsertFlow(base([node("A", "base"), node("B", "cell-B"), node("C", "cell-C")]));
  const seqKeys = await readNodeKeys();
  const seqOk = seqKeys.includes("A") && seqKeys.includes("B") && seqKeys.includes("C");

  console.log(`\n--- 결과 ---`);
  console.log(`  동시 저장: ${lossCount}/${TRIALS} 회 손실 발생 ${lossCount > 0 ? "→ ⚠ ② 재현됨(기준선)" : "→ 손실 없음"}`);
  console.log(`  직렬 저장(대조군): [${seqKeys.join(",")}] → ${seqOk ? "✔ 손실 0 (직렬화하면 안전 = Phase 4a 방향 유효)" : "✗ 예상외 손실"}`);
  console.log(`\n  ▶ Phase 4 적용 후 이 프로브 재실행 시 '동시 저장 0/${TRIALS} 손실'이 목표.`);
}

main()
  .catch((e) => { console.error("프로브 실패:", e); process.exitCode = 1; })
  .finally(async () => {
    // 격리 슬러그만 정리(실데이터 무접촉)
    await deleteFlow(SLUG).catch(() => {});
    console.log("\n(임시 카드 __racetest__ 정리 완료)");
    process.exit(process.exitCode ?? 0);
  });
