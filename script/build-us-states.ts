// 미국 데이터센터 탭(/#/datacenters) 정적 지오 데이터 — us-atlas 주 경계 → 트림 → 앱 data.
//   실행:  npm run us:build   (재현 가능 — 원본은 커밋 안 함, 이 스크립트가 CDN 에서 받아 트림)
//   산출:  client/src/data/us-states-10m.json  (states 오브젝트만; geoAlbersUsa 로 투영)
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "client/src/data/us-states-10m.json");
const SRC = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";

async function main() {
  console.log("[us:build] us-atlas states-10m 받는 중…");
  const r = await fetch(SRC, { headers: { "User-Agent": "ticker-radar us-tab build" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const topo: any = await r.json();
  // states 오브젝트만 남기고 nation 등 제거(용량 축소). arcs·transform 유지(지오메트리 참조).
  const out = { type: "Topology", transform: topo.transform, arcs: topo.arcs, objects: { states: topo.objects.states } };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out));
  console.log(`[us:build] 완료 — states ${topo.objects.states.geometries.length}개 · ${(JSON.stringify(out).length / 1024).toFixed(0)}KB → ${OUT}`);
}
main().catch((e) => { console.error("[us:build] 실패:", e); process.exit(1); });
