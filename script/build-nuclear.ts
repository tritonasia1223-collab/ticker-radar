// 미국 전체 원전 층 — HIFLD 발전소 미러(원전) + 큐레이션 퇴역 백필 → 정적 데이터
//   실행:  npm run nuclear:build
//   소스:  HIFLD Electricity Power Plants 공개 미러(ArcGIS, 토큰 불요). TYPE='NUCLEAR' 필터 = 가동+일부 퇴역.
//          HIFLD Open 포털은 2025-08 폐쇄 → 커뮤니티 미러 사용. 퇴역 일부만 있어 주요 퇴역은 큐레이션 백필.
//   산출:  client/src/data/us-nuclear-plants.json  { _meta, plants:[{id,name,status,state,lat,lng,capacity_mw,ai_linked,ai_note}] }
//   상태:  operating(가동) · retired(퇴역) · restarting(재가동 진행) · canceled(취소). SMR 신규 계획은 렌더에서 nuclear_deals 로.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "client/src/data/us-nuclear-plants.json");
const BASE = "https://services.arcgis.com/kbDdtKcFi2adamXa/arcgis/rest/services/Electricity_Power_Plants/FeatureServer/0/query";

// HIFLD STATUS → 우리 상태
const STATUS_MAP: Record<string, string> = { OP: "operating", RE: "retired", CN: "canceled", "NOT AVAILABLE": "retired" };
// 재가동 진행 중(퇴역 → 복귀). 이름 키워드로 오버라이드.
const RESTARTING = ["palisades", "three mile island", "crane"];
// AI 데이터센터 연계 원전(nuclear_deals 와 매칭). 이름 키워드.
const AI_LINK: Record<string, string> = { susquehanna: "아마존 Cumulus 직결", "three mile island": "MS Crane 재가동 PPA", clinton: "메타 Constellation PPA", "comanche peak": "메타 Vistra PPA" };
// HIFLD 에 없는 주요 퇴역 원전 백필(에이전트 확인 좌표).
const RETIRED_BACKFILL = [
  { name: "Kewaunee", state: "WI", lat: 44.343, lng: -87.536, year: 2013 },
  { name: "Crystal River 3", state: "FL", lat: 28.957, lng: -82.698, year: 2013 },
  { name: "Zion", state: "IL", lat: 42.446, lng: -87.8, year: 1998 },
  { name: "Maine Yankee", state: "ME", lat: 43.951, lng: -69.696, year: 1996 },
  { name: "Rancho Seco", state: "CA", lat: 38.345, lng: -121.121, year: 1989 },
  { name: "Trojan", state: "OR", lat: 46.033, lng: -122.883, year: 1992 },
];

const norm = (s: string) => s.toLowerCase();
function aiLinkOf(name: string): string | null { const n = norm(name); for (const k in AI_LINK) if (n.includes(k)) return AI_LINK[k]; return null; }
function isRestart(name: string): boolean { const n = norm(name); return RESTARTING.some((k) => n.includes(k)); }

async function main() {
  console.log("[nuclear:build] HIFLD 원전 발전소 받는 중…");
  const u = `${BASE}?where=${encodeURIComponent("TYPE='NUCLEAR'")}&outFields=NAME,STATUS,STATE,OPER_CAP&outSR=4326&f=geojson`;
  const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0 ticker-radar nuclear build" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const gj: any = await r.json();
  const seen = new Set<string>();
  const plants: any[] = [];
  for (const f of gj.features ?? []) {
    const p = f.properties ?? {}; const g = f.geometry;
    const name = (p.NAME ?? "").trim(); if (!name || !g) continue;
    const [lng, lat] = g.coordinates;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    let status = STATUS_MAP[p.STATUS] ?? "operating";
    if (status !== "operating" && isRestart(name)) status = "restarting";
    if (status === "operating" && isRestart(name)) status = "restarting"; // 재가동 진행분 표시
    const cap = Number(p.OPER_CAP); const capacity_mw = cap > 0 ? Math.round(cap) : null;
    const key = norm(name).replace(/[^a-z0-9]/g, "").slice(0, 16);
    seen.add(key);
    plants.push({ id: key, name, status, state: p.STATE ?? null, lat: Math.round(lat * 1e4) / 1e4, lng: Math.round(lng * 1e4) / 1e4, capacity_mw, ai_linked: !!aiLinkOf(name), ai_note: aiLinkOf(name) });
  }
  // 퇴역 백필(중복 제외)
  for (const b of RETIRED_BACKFILL) {
    const key = norm(b.name).replace(/[^a-z0-9]/g, "").slice(0, 16);
    if ([...seen].some((k) => k.includes(key.slice(0, 8)) || key.includes(k.slice(0, 8)))) continue;
    plants.push({ id: key, name: b.name, status: "retired", state: b.state, lat: b.lat, lng: b.lng, capacity_mw: null, retired_year: b.year, ai_linked: false, ai_note: null });
  }
  const byStatus: Record<string, number> = {};
  for (const p of plants) byStatus[p.status] = (byStatus[p.status] || 0) + 1;
  const out = {
    _meta: { source: "HIFLD Electricity Power Plants (공개 ArcGIS 미러) + 퇴역 큐레이션 백필", source_url: "https://hifld-geoplatform.hub.arcgis.com/", note: "가동·퇴역·재가동. HIFLD 퇴역은 일부만이라 주요 퇴역 원전 백필. AI 연계 = 데이터센터 PPA 매칭.", as_of: "2026-08" },
    plants,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out));
  console.log(`[nuclear:build] 완료 — ${plants.length}개 (${JSON.stringify(byStatus)}) · AI연계 ${plants.filter((p) => p.ai_linked).length} · ${(JSON.stringify(out).length / 1024).toFixed(0)}KB → ${OUT}`);
}
main().catch((e) => { console.error("[nuclear:build] 실패:", e); process.exit(1); });
