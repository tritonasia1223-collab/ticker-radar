// 미국 데이터센터 전력지도 — HIFLD 345kV+ 송전선 정적 데이터 파이프라인 (fable 명세 §2·§8.1)
//   실행:  npm run tx:build   (재현 가능 — 원본 커밋 안 함, 이 스크립트가 미러에서 받아 필터·경량화)
//   소스:  HIFLD Electric Power Transmission Lines (Montana DNRC 공개 미러, ArcGIS FeatureServer)
//          원 HIFLD Open 포털은 2025-08 폐쇄. 빈티지 = 2022-12(HIFLD 최종 갱신). "기존 계통 2022 기준" 각주 필수.
//   필터:  VOLT_CLASS IN ('345','500','735 and Above')  ← VOLTAGE 필드엔 -999999 센티넬 다수라 VOLT_CLASS 사용
//   산출:  client/src/data/us-transmission-345.json  — 경량 포맷 { as_of, source_url, note, lines:[{v, c:[[lng,lat],…]}] }
//          좌표는 4자리 반올림 + 연속 중복 제거 + 라이트 Douglas-Peucker 로 경량화(전국 뷰라 ~수백m 허용).
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "client/src/data/us-transmission-345.json");
const BASE = "https://services2.arcgis.com/LYMgRMwHfrWWEg3s/arcgis/rest/services/HIFLD_US_Electric_Power_Transmission_Lines/FeatureServer/0/query";
const WHERE = "VOLT_CLASS IN ('345','500','735 and Above')";
const PAGE = 2000;
const EPS = 0.006; // DP 단순화 허용오차(도) ≈ 500~600m, 전국 뷰에서 비가시

// Douglas-Peucker (경도/위도 평면 근사 — 전국 스케일 단순화엔 충분)
function dp(pts: number[][], eps: number): number[][] {
  if (pts.length < 3) return pts;
  let maxD = 0, idx = 0;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1e-12;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i];
    const t = ((px - ax) * dx + (py - ay) * dy) / len2;
    const cx = ax + t * dx, cy = ay + t * dy;
    const d = Math.hypot(px - cx, py - cy);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD > eps) { const l = dp(pts.slice(0, idx + 1), eps), r = dp(pts.slice(idx), eps); return l.slice(0, -1).concat(r); }
  return [pts[0], pts[pts.length - 1]];
}
const round = (p: number[]) => [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4];
function clean(coords: number[][]): number[][] {
  const r = coords.map(round);
  const dedup: number[][] = [];
  for (const p of r) { const last = dedup[dedup.length - 1]; if (!last || last[0] !== p[0] || last[1] !== p[1]) dedup.push(p); }
  return dp(dedup, EPS);
}

async function fetchPage(offset: number): Promise<any> {
  const u = `${BASE}?where=${encodeURIComponent(WHERE)}&outFields=VOLT_CLASS&outSR=4326&resultRecordCount=${PAGE}&resultOffset=${offset}&f=geojson`;
  const r = await fetch(u, { headers: { "User-Agent": "ticker-radar dc-power-map build" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} @offset ${offset}`);
  return r.json();
}

async function main() {
  const lines: { v: string; c: number[][] }[] = [];
  let offset = 0, rawPts = 0, keptPts = 0;
  for (;;) {
    const gj = await fetchPage(offset);
    const feats = gj.features ?? [];
    for (const f of feats) {
      const g = f.geometry; if (!g) continue;
      const v = f.properties?.VOLT_CLASS ?? "?";
      const parts = g.type === "MultiLineString" ? g.coordinates : g.type === "LineString" ? [g.coordinates] : [];
      for (const seg of parts) { if (!seg || seg.length < 2) continue; rawPts += seg.length; const c = clean(seg); if (c.length >= 2) { keptPts += c.length; lines.push({ v, c }); } }
    }
    console.log(`[tx:build] offset ${offset}: +${feats.length} feats (누적 lines ${lines.length})`);
    if (feats.length < PAGE) break;
    offset += PAGE;
    if (offset > 20000) { console.warn("[tx:build] 안전 상한 도달"); break; }
  }
  const out = {
    as_of: "2022-12", source_url: "https://hifld-geoplatform.hub.arcgis.com/ (HIFLD Electric Power Transmission Lines)",
    note: "기존 계통 · 2022년 기준 — 이후 신설선 미포함. VOLT_CLASS 345kV 이상.",
    lines,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out));
  const kb = (JSON.stringify(out).length / 1024).toFixed(0);
  console.log(`[tx:build] 완료 — ${lines.length}개 라인 · 점 ${rawPts}→${keptPts}(${(100 * keptPts / rawPts).toFixed(0)}%) · ${kb}KB → ${OUT}`);
}
main().catch((e) => { console.error("[tx:build] 실패:", e); process.exit(1); });
