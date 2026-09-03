// 세계 현황판(/#/world) 정적 데이터 파이프라인 — Natural Earth(퍼블릭 도메인) → 트림 → TopoJSON.
//   실행:  npm run world:build   (재현 가능 — 원본 shp/geojson 은 커밋 안 함, 이 스크립트가 GitHub raw 에서 받아 변환)
//   산출:  client/src/data/world-110m.json     (countries 토폴로지 — 국경·한글명·라벨점, topojson.neighbors 용 공유아크 포함)
//          client/src/data/world-capitals.json  (수도 점 — iso·한/영·좌표)
//   ⚠ 이 탭은 DB/서버 불요(Phase 1). 정적 import 로 /world 청크에서 코드스플릿(App.tsx lazy).
import { topology } from "topojson-server";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(ROOT, "client/src/data");
const UA = "ticker-radar world-tab build (admin@tritonasia1223.com)";
const BASE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson";

// Natural Earth 110m: 세계 저해상(admin-0 국경 + 수도 점). 권역 중해상(50m)은 Phase 1 이후.
const SRC = {
  countries: `${BASE}/ne_110m_admin_0_countries.geojson`,
  places: `${BASE}/ne_110m_populated_places.geojson`,
};

async function getJson(url: string): Promise<any> {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status} — ${url}`);
  return r.json();
}

// ISO_A3 가 -99(분쟁·미승인 영토 등 5개국)인 경우 대체 식별자 유도. neighbors 는 인덱스 기반이라
//   iso 는 수도 조인·카드 표기용일 뿐 — 없으면 이름 슬러그로라도 유일 키를 준다.
function isoOf(p: any): string {
  for (const k of ["ISO_A3", "ISO_A3_EH", "ADM0_A3", "SOV_A3"]) {
    const v = p[k];
    if (v && v !== "-99") return v;
  }
  return "X-" + String(p.NAME || p.NAME_LONG || "unknown").replace(/\s+/g, "_");
}

async function main() {
  console.log("[world:build] Natural Earth 110m 받는 중…");
  const [countriesFc, placesFc] = await Promise.all([getJson(SRC.countries), getJson(SRC.places)]);

  // 1) 국가 — 속성 트림(iso·한글명·영문명·라벨점). 지오메트리는 원본 유지(topology 가 공유아크 계산).
  const trimmed = {
    type: "FeatureCollection",
    features: countriesFc.features.map((f: any) => {
      const p = f.properties;
      return {
        type: "Feature",
        geometry: f.geometry,
        properties: {
          iso: isoOf(p),
          ko: p.NAME_KO || p.NAME || "",
          en: p.NAME || p.NAME_LONG || "",
          lx: Number(p.LABEL_X), // 라벨 앵커(면 중심 근방)
          ly: Number(p.LABEL_Y),
        },
      };
    }),
  };

  // TopoJSON 변환(양자화로 용량 축소 — 110m 엔 1e5 로 충분). objects.countries 로 접근.
  const topo = topology({ countries: trimmed as any }, 1e5);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, "world-110m.json"), JSON.stringify(topo));

  // 2) 수도 — Admin-0 capital 만(권역 수도), 국가당 대표 1개. 좌표·한/영.
  const seen = new Set<string>();
  const capitals: { iso: string; ko: string; en: string; lng: number; lat: number }[] = [];
  for (const f of placesFc.features) {
    const p = f.properties;
    if (p.FEATURECLA !== "Admin-0 capital") continue;
    const iso = p.ADM0_A3 && p.ADM0_A3 !== "-99" ? p.ADM0_A3 : "";
    if (iso && seen.has(iso)) continue;
    if (iso) seen.add(iso);
    const [lng, lat] = f.geometry.coordinates;
    capitals.push({ iso, ko: p.NAME_KO || p.NAME || "", en: p.NAME || "", lng: Number(lng), lat: Number(lat) });
  }
  writeFileSync(resolve(OUT_DIR, "world-capitals.json"), JSON.stringify(capitals));

  const bytes = (o: any) => (JSON.stringify(o).length / 1024).toFixed(0);
  console.log(`[world:build] 완료 — countries ${trimmed.features.length}개(${bytes(topo)}KB) · capitals ${capitals.length}개(${bytes(capitals)}KB)`);
  console.log(`  → ${OUT_DIR}/world-110m.json, world-capitals.json`);
}
main().catch((e) => { console.error("[world:build] 실패:", e); process.exit(1); });
