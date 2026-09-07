// 미국 데이터센터 전력지도 — ISO/RTO 권역 폴리곤 정적 데이터 (fable 명세 §B '전력시장' 면 채색)
//   실행:  npm run rto:build
//   소스:  HIFLD Independent System Operators (공개 ArcGIS 미러 services5/D509rM2leyoHuJvj) — 7개 ISO/RTO 경계
//          EIA Atlas RTO_Regions 는 토큰 잠김이라 이 공개 미러 사용. ⚠ RTO 경계는 겹침·공백 있는 '대략'(EIA 주석) — 근사 표기.
//   산출:  client/src/data/us-rto-regions.json  { as_of, source_url, note, regions:[{code, name, geometry(MultiPolygon)}] }
//          서버 일반화(maxAllowableOffset) + 좌표 3자리 반올림 + DP 로 경량화(전국 배경 채색용).
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { geoArea } from "d3-geo";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "client/src/data/us-rto-regions.json");
const BASE = "https://services5.arcgis.com/D509rM2leyoHuJvj/arcgis/rest/services/Independent_System_Operators/FeatureServer/0/query";
const EPS = 0.02; // DP 허용오차(도) ≈ 2km. 권역 배경이라 넉넉히.

const NAME_CODE: Record<string, string> = {
  "MIDCONTINENT INDEPENDENT TRANSMISSION SYSTEM OPERATOR, INC..": "MISO",
  "SOUTHWEST POWER POOL": "SPP",
  "PJM INTERCONNECTION, LLC": "PJM",
  "ELECTRIC RELIABILITY COUNCIL OF TEXAS, INC.": "ERCOT",
  "CALIFORNIA INDEPENDENT SYSTEM OPERATOR": "CAISO",
  "ISO NEW ENGLAND INC.": "ISONE",
  "NEW YORK INDEPENDENT SYSTEM OPERATOR": "NYISO",
};

function dp(pts: number[][], eps: number): number[][] {
  if (pts.length < 3) return pts;
  let maxD = 0, idx = 0;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1e-12;
  for (let i = 1; i < pts.length - 1; i++) { const [px, py] = pts[i]; const t = ((px - ax) * dx + (py - ay) * dy) / len2; const cx = ax + t * dx, cy = ay + t * dy; const d = Math.hypot(px - cx, py - cy); if (d > maxD) { maxD = d; idx = i; } }
  if (maxD > eps) { const l = dp(pts.slice(0, idx + 1), eps), r = dp(pts.slice(idx), eps); return l.slice(0, -1).concat(r); }
  return [pts[0], pts[pts.length - 1]];
}
const round = (p: number[]) => [Math.round(p[0] * 1e3) / 1e3, Math.round(p[1] * 1e3) / 1e3];
const shoelace = (r: number[][]) => { let a = 0; for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return a / 2; };
function ring(coords: number[][]): number[][] { let r = dp(coords.map(round), EPS); if (r.length < 4) r = coords.map(round); return r; }
// d3-geo 는 구면 winding 으로 내부를 판정 — 링이 반대로 감기면 '전 구면 − 권역'(여집합)을 채움(=전체 보라 wash).
// 폴리곤의 구면 면적(geoArea)이 2π 초과면 여집합 = 뒤집힌 것 → 외곽 링 반전. (planar shoelace 로는 부정확)
function fixWinding(polyRings: number[][][]): number[][][] {
  const a = geoArea({ type: "Polygon", coordinates: polyRings } as any);
  return a > 2 * Math.PI ? [polyRings[0].slice().reverse(), ...polyRings.slice(1)] : polyRings;
}
// 소스가 수백~수천 조각(유틸 서비스영역)이라 미소 슬리버(면적≈0)가 d3-geo 구면 채색을 깨뜨림(여집합 채색).
// 각 폴리곤 외곽 링 면적이 MIN_AREA 미만이면 버림 — 전국 배경 틴트 스케일에선 비가시.
const MIN_AREA = 0.03; // 제곱도(deg²)
function simplifyMulti(g: any): any {
  if (g.type === "Polygon") { const rings = fixWinding(g.coordinates.map(ring)); return { type: "Polygon", coordinates: rings }; }
  if (g.type === "MultiPolygon") {
    const polys = g.coordinates
      .map((poly: number[][][]) => poly.map(ring))
      .filter((poly: number[][][]) => Math.abs(shoelace(poly[0])) >= MIN_AREA)
      .map(fixWinding);
    return { type: "MultiPolygon", coordinates: polys };
  }
  return g;
}

async function main() {
  const regions: { code: string; name: string; geometry: any }[] = [];
  let rawPts = 0, keptPts = 0;
  for (let off = 0; off < 7; off++) {
    const u = `${BASE}?where=1%3D1&outFields=NAME&outSR=4326&resultRecordCount=1&resultOffset=${off}&maxAllowableOffset=0.015&geometryPrecision=3&f=geojson`;
    const r = await fetch(u, { headers: { "User-Agent": "ticker-radar dc-power-map build" } });
    if (!r.ok) throw new Error(`HTTP ${r.status} @off ${off}`);
    const gj: any = await r.json();
    const f = gj.features?.[0]; if (!f) { console.warn(`[rto:build] off ${off} 비어있음`); continue; }
    const name = f.properties?.NAME ?? "?"; const code = NAME_CODE[name] ?? name;
    const cnt = (g: any): number => g.type === "Polygon" ? g.coordinates.reduce((a: number, r: number[][]) => a + r.length, 0) : g.type === "MultiPolygon" ? g.coordinates.reduce((a: number, p: number[][][]) => a + p.reduce((b, r) => b + r.length, 0), 0) : 0;
    rawPts += cnt(f.geometry);
    const geometry = simplifyMulti(f.geometry);
    keptPts += cnt(geometry);
    regions.push({ code, name, geometry });
    console.log(`[rto:build] off ${off}: ${code} (${name})`);
  }
  const out = { as_of: "HIFLD", source_url: "https://services5.arcgis.com/D509rM2leyoHuJvj/arcgis/rest/services/Independent_System_Operators (HIFLD ISO)", note: "ISO/RTO 권역은 겹침·공백 있는 대략적 경계(EIA 주석). 근사.", regions };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out));
  console.log(`[rto:build] 완료 — ${regions.length}개 권역 · 점 ${rawPts}→${keptPts}(${(100 * keptPts / rawPts).toFixed(0)}%) · ${(JSON.stringify(out).length / 1024).toFixed(0)}KB → ${OUT}`);
}
main().catch((e) => { console.error("[rto:build] 실패:", e); process.exit(1); });
