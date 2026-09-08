// 세계 현황판 (/#/world) — L1 국가 + 검색/프리셋 + L2 무역 인프라(항로·해협·항만) 개체 시스템.
//   정적 데이터 직접 렌더(DB/서버 불요). d3-geo Equal Earth + d3-zoom. 태평양 중심(회전 스핀).
//   L2 개편(개체 명세): 항로/해협/항만을 필드·경유지체인·상호 하이퍼링크를 가진 개체로. 카드 1컴포넌트, 유형별 필드.
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { geoEqualEarth, geoPath, geoArea } from "d3-geo";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity } from "d3-zoom";
import "d3-transition";
import { feature, neighbors } from "topojson-client";
import { Plus, Minus, X, Locate, Search, Anchor, Diamond, Route, ExternalLink, ChevronDown, Server, Flame, Atom, BatteryCharging, Zap, Info, Globe, Swords, Hexagon, Clapperboard } from "lucide-react";
import topoData from "@/data/world-110m.json";
import capitalsData from "@/data/world-capitals.json";
import infraData from "@/data/world-infra.json";
import dcData from "@/data/ai-datacenters.json";
import usStatesTopo from "@/data/us-states-10m.json";
import txData from "@/data/us-transmission-345.json";
import dcPowerLinks from "@/data/dc-power-links.json";
import rtoData from "@/data/us-rto-regions.json";
import conflictsData from "@/data/world-conflicts.json";
import episodesData from "@/data/war-episodes.json";
import disputesData from "@/data/territorial-disputes.json";
import conflictCardsData from "@/data/conflict-cards.json";
import routeCardsData from "@/data/route-cards.json";
import fabsData from "@/data/ai-fabs.json";
import nuclearData from "@/data/us-nuclear-plants.json";

type CtyProps = { iso: string; ko: string; en: string; lx: number; ly: number };
type Cty = { type: "Feature"; geometry: any; properties: CtyProps };
type Cap = { iso: string; ko: string; en: string; lng: number; lat: number };
type Choke = { id: string; ko: string; en: string; lng: number; lat: number; connects: string; tier: number; throughput_note: string; source_url: string };
type Port = { id: string; ko: string; en: string; country_iso: string; lng: number; lat: number; teu_m: number; rank: number };
type MinorPort = { id: string; ko: string; en: string; country_iso: string; lng: number; lat: number; note: string };
type Waypoint = { type: "port" | "chokepoint" | "minor_port"; ref: string };
type RouteT = { id: string; ko: string; coords: [number, number][]; waypoints: Waypoint[]; direction_note: string; alt_of: string | null; facts: string; source_url: string };
const infra = infraData as unknown as { chokepoints: Choke[]; ports: Port[]; minor_ports: MinorPort[]; routes: RouteT[]; _meta: { teu_source: string; data_year: number } };

// L4 분쟁 층 (UCDP GED)
type ConflictParty = { name: string; iso: string | null; is_state: boolean };
type ConflictEvent = { c: [number, number]; d: string; b: number };
type Conflict = { id: string; name_en: string; name_ko: string; type: string; category: string; intensity: string; active: boolean; deaths_12mo: number; events_12mo: number; epicenter: [number, number]; zone: [number, number][] | null; geometry_type: string; events: ConflictEvent[]; parties: ConflictParty[]; party_isos: string[]; started_year: number; last_event_date: string };
const conflictsAll = (conflictsData as unknown as { _meta: any; conflicts: Conflict[] }).conflicts;
const conflictsMeta = (conflictsData as unknown as { _meta: any })._meta;
// 과거 전쟁 에피소드(개별 재생 진입점 — 현재 전부 '준비 중'). 티어 파급 규모순.
type Episode = { id: string; title: string; period: string; tier: number; summary: string };
const episodesAll = (episodesData as unknown as { episodes: Episode[] }).episodes;
// 영토·주권 분쟁 층(별도 데이터 — UCDP 무력분쟁과 분리). 노랑 마커. 말풍선 claim = 공표 입장의 의역.
type DisputeParty = { iso: string; name_ko: string; controls: boolean; control_note?: string; claim: string };
type DisputeStake = { type: "industry" | "route" | "resource" | "military" | "symbolic"; note: string };
type Dispute = { id: string; name_ko: string; region: string; lat: number; lng: number; star?: boolean; note?: string; parties: DisputeParty[]; stakes: DisputeStake[]; linked_conflict_id?: string | null; linked_choke_ids: string[]; linked_route_ids: string[]; source_url: string; layout?: "axis" | "grid" | "radial" | "split"; internal?: string; center?: { name: string; sub: string }; rows?: { label?: string; parties: number[] }[]; sponsors?: { name: string; note?: string; side?: string }[] };
const disputesAll = (disputesData as unknown as { disputes: Dispute[] }).disputes;
const STAKE_KO: Record<string, string> = { industry: "산업", route: "항로", resource: "자원", military: "군사", symbolic: "상징" };
const disputeCtrl = (d: { parties: { controls: boolean; name_ko: string }[] }) => { const c = d.parties.filter((p) => p.controls); return c.length ? (c.length > 1 ? "분할 지배" : c[0].name_ko) : "미획정"; };
// 분쟁 카드 큐레이션 콘텐츠(id → 좌/우 당사자·기간·니즈). UCDP 분쟁 위에 얹음.
type ConflictCard = { title: string; left: string; right: string; period: string; need_left: string; need_right: string };
const conflictCards = (conflictCardsData as unknown as { cards: Record<string, ConflictCard> }).cards;
// 항로 카드 신포맷(노선도·화물막대·설명·관계칩). 색: 화물 4종.
const CARGO_BAR_COLOR: Record<string, string> = { container: "#378ADD", oil: "#EF9F27", grain: "#1D9E75", other: "#B4B2A9" };
type RouteStop = { l: string; t: "port" | "strait" | "seg"; ref?: string; note?: string };
type RouteCard = { candidate?: boolean; stops: RouteStop[]; fork_note?: string; bar?: { l: string; p: number; c: string }[]; status?: string[]; lines: string[]; rel?: { k: string; rk: "route" | "dispute"; ref: string; l: string } };
const routeCards = (routeCardsData as unknown as { cards: Record<string, RouteCard> }).cards;
// 최근 사건 펄스 기준 = 데이터셋 최신 사건일(실 '지금' 대용). 이후 30일 이내 = 라이브.
const CONFLICT_MAX_MS = Math.max(...conflictsAll.map((c) => (c.last_event_date ? Date.parse(c.last_event_date) : 0)));
// 유형색(§2, 2026-09 4색 확정 — 상징성 배제·구분 최우선, 색상환 등거리+색각 고려). 색=유형, 폭·진하기=강도.
const CONFLICT_TYPE_COLOR: Record<string, string> = { interstate: "#E24B4A", civil: "#378ADD", nonstate: "#1D9E75", onesided: "#1D9E75" };
const conflictColor = (cat: string) => CONFLICT_TYPE_COLOR[cat] || "#1D9E75";
const TERRITORIAL_YELLOW = "#F2C40F"; // 영토·주권 — 지도 요소(점선 마커·주장선)
const TERRITORIAL_TEXT = "#8A6D00";   // 투톤 — 텍스트·뱃지(노랑은 밝은 배경 소자 가독 불가)
// 유형 그룹(칩=범례+스위치). territorial 은 별도 층. category → group.
const catGroup = (cat: string) => (cat === "interstate" ? "interstate" : cat === "civil" ? "civil" : "nonstate");
const CONFLICT_LEGEND: { group: string; ko: string; color: string }[] = [
  { group: "interstate", ko: "국가간전", color: CONFLICT_TYPE_COLOR.interstate },
  { group: "civil", ko: "내전", color: CONFLICT_TYPE_COLOR.civil },
  { group: "nonstate", ko: "무장세력·대민간", color: CONFLICT_TYPE_COLOR.nonstate },
  { group: "territorial", ko: "영토·주권", color: TERRITORIAL_YELLOW },
];
const CONFLICT_RED = CONFLICT_TYPE_COLOR.interstate; // 상단 알약 아이콘 등 잔여 참조용
// category(파생) × 강도 → 직관 라벨.
const CONFLICT_CAT_KO: Record<string, string> = { interstate: "국가간전", civil: "내전", nonstate: "무장세력 충돌", onesided: "대민간 폭력" };
function conflictLabel(cat: string, war: boolean): string {
  if (cat === "interstate") return war ? "국가간 전면전" : "국가간 교전";
  if (cat === "civil") return war ? "내전(대규모)" : "내전·반군";
  if (cat === "nonstate") return war ? "무장세력 전쟁" : "무장세력 교전";
  return war ? "대민간 폭력(대규모)" : "대민간 폭력·테러";
}

type EntitySel =
  | { kind: "country"; idx: number }
  | { kind: "port"; id: string }
  | { kind: "choke"; id: string }
  | { kind: "route"; id: string }
  | { kind: "conflict"; id: string }
  | { kind: "dispute"; id: string };

const TEAL = "#0d9488";          // 선택 하이라이트
const AMBER = "#f59e0b";         // 해협
const SEA = "#2563eb";           // 항만(파랑 점)
// 항로별 색 — 앰버(해협)·청록(선택)·적(분쟁 예정) 회피한 범주형 팔레트
const ROUTE_COLOR: Record<string, string> = {
  "eu-asia-suez": "#2563eb", "cape": "#9333ea", "arctic": "#0891b2", "nsr": "#0891b2", "nwp": "#64748b",
  "trans-pacific": "#db2777", "panama": "#16a34a", "mideast-oil": "#4f46e5", "trans-atlantic": "#0ea5e9",
};
const routeColor = (id: string) => ROUTE_COLOR[id] ?? SEA;
// 북극항로 패밀리 = 통합 개체(arctic) + 두 지선(nsr·nwp). 통합 렌더/라벨/리스트에서 하나로 취급.
const ARCTIC_IDS = new Set(["arctic", "nsr", "nwp"]);
const isArcticFam = (r: { id?: string; branch_of?: string }) => r.id === "arctic" || r.branch_of === "북극항로";
// ── 항로 배 흐름(밀도=물동량 등급) ──
const TIER_SHIPS: Record<string, number> = { high: 5, mid: 3, low: 1, none: 0 }; // 동시 척수(합 상한 40). none=배 0(상업 통항 없음)
const CARGO_COLOR: Record<string, string> = { container: "#2563eb", crude: "#f59e0b", mixed: "#9333ea", bulk: "#78716c" };
const CARGO_KO: Record<string, string> = { container: "컨테이너", crude: "원유", mixed: "혼합", bulk: "벌크" };
const shipSymbol = (cargo: string) => (cargo === "crude" ? "ship-tanker" : "ship-container");
const LANE_OFFSETS: Record<string, number[]> = { high: [-7, 0, 7], mid: [-4, 4], low: [0], none: [0] }; // 등급→차선(회랑 폭=2차 인코딩)
// 항로선·배 공용 지리 좌표 — 웨이포인트 사이 직선(꺾인 폴리라인). 매프레임 재투영이라 회전 대응.
function densifyRoute(coords: number[][]): { pts: number[][]; len: number } {
  const pts = coords; let len = 0;
  for (let i = 0; i < pts.length - 1; i++) len += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  return { pts, len: Math.max(len, 1) };
}
function shipLngLat(samples: number[][], offset: number): [number, number] {
  const N = samples.length; const f = ((offset % 1) + 1) % 1 * (N - 1); const i0 = Math.floor(f), i1 = Math.min(N - 1, i0 + 1), fr = f - i0;
  const a = samples[i0], b = samples[i1];
  // 날짜변경선(§3-2): 경도를 짧은 쪽으로 보간 → 이음새 넘는 항로 배가 지도를 가로지르는 유령 비행 방지
  let dlng = b[0] - a[0]; if (dlng > 180) dlng -= 360; else if (dlng < -180) dlng += 360;
  let lng = a[0] + dlng * fr; if (lng > 180) lng -= 360; else if (lng < -180) lng += 360;
  return [lng, a[1] + (b[1] - a[1]) * fr];
}
// 이미 클리핑된 geoPath d 문자열을 서브패스별로 파싱해 법선 방향으로 ±off 평행 이동한 두 d 문자열 반환(혼합 항로 겹선용).
// 클리핑된 좌표에서 offset 하므로 날짜변경선 유령선 없음(§3-2와 동형).
function offsetPolylines(d: string, off: number): [string, string] {
  let plus = "", minus = "";
  for (const sub of d.split("M")) {
    if (!sub) continue;
    const pts = sub.split("L").map((s) => s.split(",").map(Number)).filter((p) => p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (pts.length < 2) continue;
    const P: string[] = [], N: string[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1]; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
      const nx = -dy * off, ny = dx * off, x = pts[i][0], y = pts[i][1];
      P.push(`${(x + nx).toFixed(1)},${(y + ny).toFixed(1)}`); N.push(`${(x - nx).toFixed(1)},${(y - ny).toFixed(1)}`);
    }
    plus += "M" + P.join("L"); minus += "M" + N.join("L");
  }
  return [plus, minus];
}

// ── 미국 데이터센터 모드(지도 위 오버레이) ──
type Gen = { type: string; vendor: string | null; mw: number | null; status: string; note?: string };
type Power = { grid_operator: string; utility: string | null; grid_share: string; onsite_generation: Gen[]; utility_new_build: Gen[]; nuclear: boolean; note?: string; confidence: string };
type Fin = { type: string; party: string; amount_usd_bn: number | null; disclosure: string };
type Site = { id: string; group: "A" | "B" | "C"; name: string; location: { city: string | null; state: string | null; lat: number | null; lng: number | null }; capacity_operational_mw: number | null; capacity_target_mw: { min: number | null; max: number | null }; status_stage: string; status_note: string; landlord: string; tenant: string | null; lease_term_years: number | null; end_user: string | null; financing: Fin[]; financing_total_usd_bn: number | null; credit_wrapper: string | null; credit_wrapper_rating: string | null; notes: string; power?: Power };
type Nuke = { id: string; buyer: string; plant: string; reactor_type: string; mw: number; location: { state: string; grid: string; lat: number; lng: number }; deal: string; target_year: number; status: string; site_bound: boolean; confidence: string; site_type?: string };
// §C 원전 부지 유형: 기존·퇴역 부지 재활용(빠른 접속) vs 신규 건설(느림·불확실)
const SITE_TYPE_KO: Record<string, string> = { restart: "퇴역 원전 재가동", existing: "기존 원전 활용", new: "신규 건설", unconfirmed: "미확인", none: "원자력 없음" };
const isReuseNuke = (t?: string) => t === "restart" || t === "existing";
const dc = dcData as unknown as { meta: any; sites: Site[]; analysis_notes: string[]; nuclear_deals: Nuke[] };
const GROUP_COLOR: Record<string, string> = { A: "#7c3aed", B: "#2563eb", C: "#db2777" };
const GROUP_LABEL: Record<string, string> = { A: "스타게이트 계열", B: "하이퍼스케일러", C: "네오클라우드" };
const GRID_COLOR: Record<string, string> = { ERCOT: "#dc2626", PJM: "#2563eb", MISO: "#16a34a", SPP: "#f59e0b" };
const gridColor = (op?: string) => (op && GRID_COLOR[op]) || "#64748b";
const STAGES = ["announced", "approved", "construction", "partial_operation", "operating"];
const STAGE_KO: Record<string, string> = { announced: "발표", approved: "승인", construction: "건설", partial_operation: "부분가동", operating: "가동" };
const creditColor = (r: string | null) => (!r ? "#94a3b8" : r === "BBB-" ? "#f59e0b" : r.startsWith("BB") ? "#dc2626" : "#16a34a");
const capMW = (s: Site) => s.capacity_operational_mw ?? s.capacity_target_mw.max ?? s.capacity_target_mw.min ?? null;
const dcMarkerR = (s: Site) => { if (s.id === "fermi-matador") return 7; const c = capMW(s); return c ? 4 + 0.16 * Math.sqrt(c) : 5; };
// 계통 의존도(grid_share) → 외곽 링 채움 비율. null = undisclosed(점선 링). "100% (…)"·"minimal (200MW ESA)" 등 접미어 허용.
const gridShareFrac = (share?: string): number | null => { if (!share) return null; const s = share.toLowerCase(); if (s.includes("100%") || s.includes("majority")) return s.includes("majority") ? 0.72 : 1; if (s.includes("mixed")) return 0.5; if (s.includes("minority")) return 0.3; if (s.includes("minimal")) return 0.12; return null; };
const dcLoadStr = (mw: number | null) => (mw == null ? "용량 미공개" : mw >= 1000 ? `${(mw / 1000).toFixed(mw % 1000 === 0 ? 0 : 1)}GW` : `${mw}MW`);
// 마커 hover 문장 — 인코딩을 말로 풂(§E-4). 예: '1.2GW · 현장 가스 위주(계통 minimal)'
function dcHoverSub(s: Site): string {
  const load = dcLoadStr(s.capacity_target_mw.max ?? s.capacity_target_mw.min ?? s.capacity_operational_mw);
  if (s.id === "fermi-matador") return `${load} · 사설 전력망(가스 6GW + AP1000 4기, 계획)`;
  const p = s.power; if (!p) return load;
  const frac = gridShareFrac(p.grid_share);
  const ts = p.onsite_generation.map((g) => g.type);
  const genKo = ts.some((t) => t.includes("nuclear") || t === "smr") ? "원전" : ts.some((t) => t.includes("gas")) ? "가스" : ts.some((t) => t.includes("battery") || t.includes("solar")) ? "배터리" : null;
  let phrase: string;
  if (genKo && frac != null && frac <= 0.5) phrase = `현장 ${genKo} 위주(계통 ${p.grid_share})`;
  else if (genKo) phrase = `현장 ${genKo} + 계통 ${p.grid_operator}`;
  else phrase = `계통 ${p.grid_operator} ${p.grid_share}`;
  return `${load} · ${phrase}`;
}
const primaryGen = (p?: Power): "gas" | "nuclear" | "battery" | "grid" => { if (!p) return "grid"; const ts = p.onsite_generation.map((g) => g.type); if (ts.some((t) => t.includes("nuclear") || t === "smr")) return "nuclear"; if (ts.some((t) => t.includes("gas"))) return "gas"; if (ts.some((t) => t.includes("battery") || t.includes("solar"))) return "battery"; return "grid"; };
const GEN_ICON = { gas: Flame, nuclear: Atom, battery: BatteryCharging, grid: Zap } as const;
// ── 미국 전체 원전 층 ──
type NukePlant = { id: string; name: string; status: string; state: string | null; lat: number; lng: number; capacity_mw: number | null; ai_linked: boolean; ai_note: string | null; retired_year?: number };
const nuclearPlants = (nuclearData as unknown as { _meta: any; plants: NukePlant[] }).plants;
const nuclearMeta = (nuclearData as unknown as { _meta: any })._meta;
const NUKE_STATUS_COLOR: Record<string, string> = { operating: "#16a34a", retired: "#94a3b8", restarting: "#f59e0b", canceled: "#cbd5e1" };
const NUKE_STATUS_KO: Record<string, string> = { operating: "가동", retired: "퇴역", restarting: "재가동 진행", canceled: "취소" };
const AI_SMR = "#a855f7"; // AI 연계·신규 SMR 색
// ── 반도체 팹 층(DC 모드 안 레이어) ──
type FabLog = { status: string; changed_on: string; note: string; source_url: string };
type Fab = { id: string; company: string; site_name: string; location: { city: string; state: string; lat: number; lng: number }; category: string; node_note: string; invest_announced_usd_bn: number; chips_award_usd_bn: number | null; target_year: number | null; status: string; status_as_of: string; status_note: string; status_source_url: string; status_log: FabLog[]; source_url: string };
const fabs = (fabsData as unknown as { _meta: any; fabs: Fab[] }).fabs;
const fabsMeta = (fabsData as unknown as { _meta: any })._meta;
const FAB_COLOR: Record<string, string> = { intel: "#2563eb", tsmc: "#dc2626", samsung: "#7c3aed", skhynix: "#ea580c", micron: "#059669", ti: "#b45309", other: "#64748b" };
const FAB_COMPANY_KO: Record<string, string> = { intel: "인텔", tsmc: "TSMC", samsung: "삼성", skhynix: "SK하이닉스", micron: "마이크론", ti: "TI", other: "기타" };
const FAB_STATUS_KO: Record<string, string> = { operating: "가동", construction: "건설 중", announced: "발표만", paused: "지연·보류" };
const FAB_CAT_KO: Record<string, string> = { logic: "로직", memory: "메모리", packaging: "패키징", other: "기타" };
const FAB_STATUS_ORDER: Record<string, number> = { operating: 0, construction: 1, announced: 2, paused: 3 };
const fabFillOpacity = (s: string) => (s === "operating" ? 0.85 : s === "construction" || s === "paused" ? 0.4 : 0);
const fabMarkerR = (f: Fab) => 5 + 0.5 * Math.sqrt(f.invest_announced_usd_bn || 1);
function hexPath(cx: number, cy: number, r: number): string {
  let d = "";
  for (let i = 0; i < 6; i++) { const a = (Math.PI / 180) * (60 * i - 90); d += (i ? "L" : "M") + (cx + r * Math.cos(a)).toFixed(1) + " " + (cy + r * Math.sin(a)).toFixed(1); }
  return d + "Z";
}
const US_BBOX: [number, number, number, number] = [-125, 24, -66, 49]; // 본토 프레임
// 주 이름(us-atlas properties.name → 한글). DC 모드에서 주 경계 라벨용.
// 전력 조달 연결선(§1 3계급) — 발전소 + DC↔발전소 링크
type Plant = { id: string; name: string; fuel: string; capacity_mw: number | null; lat: number; lng: number; eia_plant_id: string | null; source_url: string; note: string };
type DcLink = { dc_id: string; plant_id: string; tier: "physical" | "contract" | "grid"; note: string; source_url: string };
const dcPower = dcPowerLinks as unknown as { plants: Plant[]; links: DcLink[] };
const PLANT_BY_ID = new Map(dcPower.plants.map((p) => [p.id, p]));
const FUEL_COLOR: Record<string, string> = { gas: "#f97316", nuclear: "#16a34a", solar: "#facc15", coal: "#57534e", hydro: "#0ea5e9" };
const FUEL_KO: Record<string, string> = { gas: "가스", nuclear: "원전", solar: "태양광", coal: "석탄", hydro: "수력" };
const FUEL_ICON: Record<string, any> = { gas: Flame, nuclear: Atom, solar: Zap, coal: Flame, hydro: Zap };
// 주별 총 소매 전력판매량 MWh (EIA 2023 State Electricity Profiles). AI 부하 비중 분모.
const STATE_RETAIL_MWH_2023: Record<string, number> = { TX: 404603980, LA: 95374457, WI: 68563904, OH: 146640983, GA: 142028831, IN: 95995350, MI: 97588690, MS: 48421762, NJ: 71096939, NM: 28347490, ND: 28202179, PA: 138710993, TN: 89880852 };
// 부하 비중 단계 램프(누적 임계 desc): AI DC 부하 ÷ 주 평균부하(연 판매량/8760) %.
const LOAD_FILL_STEPS: [number, string][] = [[45, "rgba(220,38,38,0.60)"], [30, "rgba(220,38,38,0.42)"], [15, "rgba(234,88,12,0.30)"], [5, "rgba(245,158,11,0.20)"], [0, "rgba(245,158,11,0.09)"]];
const loadFillColor = (share: number) => { for (const [th, c] of LOAD_FILL_STEPS) if (share >= th) return c; return "transparent"; };
// ISO/RTO 권역 채색(§B '전력시장'). 비ISO(TVA·WECC·SERC 등)는 무채색.
type RtoRegion = { code: string; name: string; geometry: any };
const rtoRegions = (rtoData as unknown as { regions: RtoRegion[] }).regions;
const RTO_FILL: Record<string, string> = { ERCOT: "#dc2626", PJM: "#2563eb", MISO: "#16a34a", SPP: "#f59e0b", CAISO: "#db2777", ISONE: "#9333ea", NYISO: "#0891b2" };
// 전력계통 용어 사전(§1·§2) — 채색 뷰 해설 패널 + 지도 hover 한 줄 신원. 표시 순서·한글 병기·권역·설명.
const RTO_ORDER = ["ERCOT", "PJM", "MISO", "SPP", "CAISO", "ISONE", "NYISO"] as const;
const rtoAbbr = (c: string) => (c === "ISONE" ? "ISO-NE" : c); // 표시용 약칭
const RTO_KO: Record<string, string> = { ERCOT: "텍사스 전기신뢰성위원회", PJM: "펜실베이니아·뉴저지·메릴랜드 연합(기원)", MISO: "미드컨티넌트 독립계통운영자", SPP: "사우스웨스트 전력풀", CAISO: "캘리포니아 독립계통운영자", ISONE: "뉴잉글랜드 독립계통운영자", NYISO: "뉴욕 독립계통운영자" };
const RTO_REGION_KO: Record<string, string> = { ERCOT: "텍사스 대부분 (주 부하의 ~90%)", PJM: "중부대서양~중서부 13개 주 + DC", MISO: "중서부~루이지애나, 남북 종단 15개 주", SPP: "대평원 (다코타~오클라호마·캔자스)", CAISO: "캘리포니아 + 네바다 일부", ISONE: "북동부 6개 주", NYISO: "뉴욕주 단독" };
const RTO_DESC: Record<string, string> = {
  ERCOT: "미국에서 유일하게 독립된 텍사스 계통을 운영합니다. 다른 주와 사실상 안 이어져 연방(FERC) 규제 밖이고, 용량시장 없는 에너지 단독 시장이라 가격 변동이 크고 신규 진입이 빠릅니다 — 데이터센터·현장발전이 몰리는 제도적 이유.",
  PJM: "세계 최대 규모의 전력시장입니다. 버지니아 '데이터센터 앨리'를 품고 있어 AI 전력 수요 논쟁의 최전선이기도 합니다.",
  MISO: "미네소타에서 멕시코만까지 대륙을 세로로 관통합니다. 루이지애나(엔터지 권역)가 여기 속해 하이페리온의 시장이 MISO입니다.",
  SPP: "대평원 풍력 벨트의 시장 — 풍력 비중이 미국 RTO 중 선두권입니다. 서부 비ISO 유틸들을 위한 신시장(Markets+)도 준비 중.",
  CAISO: "태양광 '덕 커브'의 본고장. 자기 권역 외에도 서부 전역 유틸들이 참여하는 실시간 불균형 시장(WEIM)을 운영합니다.",
  ISONE: "가스 의존도가 높아 겨울 한파 때 수급이 타이트해지는 시장입니다.",
  NYISO: "뉴욕주 하나를 단독 운영 — 업스테이트(수력·원전)와 뉴욕시(가스) 사이의 송전 병목이 만성 이슈입니다.",
};
// 비ISO 지역(§2) — 물리 계통 소속 + 운영(공급) 주체. 유틸 폴리곤은 후속(EIA-861), 여기선 표로만.
const NONISO_ROWS: { region: string; grid: string; op: string; desc: string }[] = [
  { region: "남동부 (조지아·앨라배마)", grid: "동부 계통", op: "Southern Company", desc: "RTO 없이 서던컴퍼니가 발전~배전을 통합 운영합니다. 규제 인가 수익 구조라 데이터센터와의 전용 딜(요금 계약·발전 신설)이 빠른 지역." },
  { region: "캐롤라이나", grid: "동부 계통", op: "Duke Energy", desc: "듀크에너지의 수직통합 권역. 2021년부터 남동부 유틸 간 거래 플랫폼(SEEM)에 참여합니다." },
  { region: "플로리다", grid: "동부 계통", op: "NextEra(FPL) 등", desc: "반도 지형상 외부 연계가 약한 수직통합 지역." },
  { region: "테네시밸리", grid: "동부 계통", op: "TVA (연방 공기업)", desc: "뉴딜 때 세워진 테네시밸리청이 발전·송전을 맡고 지역 배전사(멤피스 MLGW 등)가 공급합니다. xAI 멤피스가 이 권역." },
  { region: "서부 산악·북서부 (CAISO 밖)", grid: "서부 계통", op: "PacifiCorp·NV Energy·APS·Xcel·BPA 등", desc: "유틸별 수직통합이되 다수가 CAISO의 WEIM 실시간 시장에 참여 — 비ISO 지역도 점진적으로 시장화 중입니다." },
];
const GRID_INTERCONNECT_NOTE = "미 본토는 동부·서부·텍사스 3개 물리 계통(Interconnection) 위에서, RTO/ISO(시장·급전) 또는 비ISO 유틸이 운영합니다. 경계는 근사(HIFLD).";
const TX_WIDTH: Record<string, number> = { "345": 0.75, "500": 1.3, "735 and Above": 2.0 }; // 화면 px, 전압 등급별
const TX_OPACITY: Record<string, number> = { "345": 0.5, "500": 0.72, "735 and Above": 0.95 }; // 전압 낮을수록 투명
const US_NAME_ABBR: Record<string, string> = { Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO", Connecticut: "CT", Delaware: "DE", "District of Columbia": "DC", Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY" };
const US_STATE_KO: Record<string, string> = { Alabama: "앨라배마", Alaska: "알래스카", Arizona: "애리조나", Arkansas: "아칸소", California: "캘리포니아", Colorado: "콜로라도", Connecticut: "코네티컷", Delaware: "델라웨어", "District of Columbia": "워싱턴 D.C.", Florida: "플로리다", Georgia: "조지아", Hawaii: "하와이", Idaho: "아이다호", Illinois: "일리노이", Indiana: "인디애나", Iowa: "아이오와", Kansas: "캔자스", Kentucky: "켄터키", Louisiana: "루이지애나", Maine: "메인", Maryland: "메릴랜드", Massachusetts: "매사추세츠", Michigan: "미시간", Minnesota: "미네소타", Mississippi: "미시시피", Missouri: "미주리", Montana: "몬태나", Nebraska: "네브래스카", Nevada: "네바다", "New Hampshire": "뉴햄프셔", "New Jersey": "뉴저지", "New Mexico": "뉴멕시코", "New York": "뉴욕", "North Carolina": "노스캐롤라이나", "North Dakota": "노스다코타", Ohio: "오하이오", Oklahoma: "오클라호마", Oregon: "오리건", Pennsylvania: "펜실베이니아", "Rhode Island": "로드아일랜드", "South Carolina": "사우스캐롤라이나", "South Dakota": "사우스다코타", Tennessee: "테네시", Texas: "텍사스", Utah: "유타", Vermont: "버몬트", Virginia: "버지니아", Washington: "워싱턴", "West Virginia": "웨스트버지니아", Wisconsin: "위스콘신", Wyoming: "와이오밍" };
const WORLD_LABEL_TOP = 26;
const K_REGION = 2.5, K_LOCAL = 6;
const CENTER_LON = 150;
const DC_SITE_ZOOM_MULT = 1.4; // DC 모드: 기준(미국-핏) 배율 × 이 값 이상이면 '사이트 줌'(연결선·흐름·스냅 활성). 미국핏~최대 줌 폭이 좁아(~2.2×) 낮게 잡음

const REGIONS: { name: string; lon: number; bbox: [number, number, number, number] }[] = [
  { name: "유럽", lon: 15, bbox: [-11, 34, 42, 60] },
  { name: "중동", lon: 47, bbox: [32, 12, 63, 42] },
  { name: "아프리카", lon: 20, bbox: [-18, -35, 52, 38] },
  { name: "동남아", lon: 113, bbox: [92, -11, 142, 28] },
  { name: "남미", lon: -60, bbox: [-82, -56, -34, 13] },
];
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
const portR = (teu_m: number) => 2 + 1.35 * Math.sqrt(Math.max(teu_m, 0)); // 면적 ∝ TEU

export default function World() {
  const topo = topoData as any;
  const features = useMemo<Cty[]>(() => {
    const fs: Cty[] = (feature(topo, topo.objects.countries) as any).features;
    const OVERRIDE: Record<string, string> = { TWN: "대만", PRK: "북한" }; // NAME_KO(중화민국·조선민주주의인민공화국) 교정
    for (const f of fs) if (OVERRIDE[f.properties.iso]) f.properties.ko = OVERRIDE[f.properties.iso];
    return fs;
  }, []);
  const adj = useMemo<number[][]>(() => neighbors(topo.objects.countries.geometries as any), []);
  const areas = useMemo(() => features.map((f) => geoArea(f as any)), [features]);
  const worldLabelSet = useMemo(() => new Set(features.map((_, i) => i).sort((a, b) => areas[b] - areas[a]).slice(0, WORLD_LABEL_TOP)), [features, areas]);
  const capByIso = useMemo(() => { const m = new Map<string, Cap>(); for (const c of capitalsData as Cap[]) if (c.iso) m.set(c.iso, c); return m; }, []);
  const isoToIdx = useMemo(() => { const m = new Map<string, number>(); features.forEach((f, i) => m.set(f.properties.iso, i)); return m; }, [features]);

  // ── L2 개체 인덱스 + 경유지 역인덱스(노드 id → 지나는 항로들) ──
  const portById = useMemo(() => new Map(infra.ports.map((p) => [p.id, p])), []);
  const minorPortById = useMemo(() => new Map((infra.minor_ports ?? []).map((p) => [p.id, p])), []);
  const chokeById = useMemo(() => new Map(infra.chokepoints.map((c) => [c.id, c])), []);
  const routeById = useMemo(() => new Map(infra.routes.map((r) => [r.id, r])), []);
  const routesByNode = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const r of infra.routes) for (const w of r.waypoints) { const a = m.get(w.ref) ?? []; a.push(r.id); m.set(w.ref, a); }
    return m;
  }, []);
  const portsRanked = useMemo(() => [...infra.ports].sort((a, b) => a.rank - b.rank), []);

  // 검색 색인 — 국가·수도·해협·항만
  type Hit = { kind: "country"; label: string; sub: string; idx: number; key: string }
    | { kind: "capital"; label: string; sub: string; iso: string; lng: number; lat: number; key: string }
    | { kind: "choke" | "port" | "route"; label: string; sub: string; id: string; key: string };
  const searchIndex = useMemo<Hit[]>(() => {
    const out: Hit[] = [];
    features.forEach((f, i) => out.push({ kind: "country", label: f.properties.ko, sub: f.properties.en, idx: i, key: norm(f.properties.ko) + " " + norm(f.properties.en) }));
    for (const c of capitalsData as Cap[]) out.push({ kind: "capital", label: c.ko, sub: c.en, iso: c.iso, lng: c.lng, lat: c.lat, key: norm(c.ko) + " " + norm(c.en) });
    for (const c of infra.chokepoints) out.push({ kind: "choke", label: c.ko, sub: c.en, id: c.id, key: norm(c.ko) + " " + norm(c.en) });
    for (const p of infra.ports) out.push({ kind: "port", label: p.ko, sub: p.en, id: p.id, key: norm(p.ko) + " " + norm(p.en) });
    for (const r of infra.routes) { if ((r as any).branch_of) continue; out.push({ kind: "route", label: r.ko, sub: r.direction_note, id: r.id, key: norm(r.ko) }); }
    return out;
  }, [features]);

  // ── 반응형 ──
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dim, setDim] = useState({ w: 960, h: 540 });
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); setDim({ w: Math.max(320, Math.round(r.width)), h: Math.max(240, Math.round(r.height)) }); });
    ro.observe(el); return () => ro.disconnect();
  }, []);

  // ── 투영 ──
  const [lon, setLon] = useState(CENTER_LON);
  const lonRef = useRef(lon); lonRef.current = lon;
  const lonTweenRaf = useRef(0);
  // 경도(투영 회전) 부드러운 트윈 — 순간 점프 대신 zoom 트랜지션과 함께 회전(먼 경도 비행이 자연스럽게).
  const tweenLon = useCallback((to: number, dur: number) => {
    cancelAnimationFrame(lonTweenRaf.current);
    const from = lonRef.current; let dd = to - from; while (dd > 180) dd -= 360; while (dd < -180) dd += 360;
    if (Math.abs(dd) < 0.5) { setLon(to); return; }
    const t0 = performance.now();
    const tick = (now: number) => { const p = Math.min(1, (now - t0) / dur); const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; setLon(from + dd * e); if (p < 1) lonTweenRaf.current = requestAnimationFrame(tick); };
    lonTweenRaf.current = requestAnimationFrame(tick);
  }, []);
  const projection = useMemo(() => geoEqualEarth().rotate([-lon, 0]).fitExtent([[14, 14], [dim.w - 14, dim.h - 14]], { type: "Sphere" } as any), [dim, lon]);
  const pathGen = useMemo(() => geoPath(projection), [projection]);
  const paths = useMemo(() => features.map((f) => pathGen(f as any) || ""), [features, pathGen]);
  const spherePath = useMemo(() => pathGen({ type: "Sphere" } as any) || "", [pathGen]);
  const routePaths = useMemo(() => infra.routes.map((r) => pathGen({ type: "LineString", coordinates: densifyRoute(r.coords).pts } as any) || ""), [pathGen]);
  // 관문 밖 페이드 스텁 경로(geoPath — 지오 클리핑으로 스핀·이음새 안전). {선 d, 라벨 앵커[lng,lat]}
  const routeStubs = useMemo(() => infra.routes.map((r) => { const s = (r as any).stub as number[][] | undefined; if (!s) return null; return { d: pathGen({ type: "LineString", coordinates: s } as any) || "", anchor: s[s.length - 1] as [number, number], label: (r as any).stub_label as string | undefined }; }), [pathGen]);
  // 북극항로 통합 지오메트리 — 공통 줄기(1회) + NSR/NWP 지선. 줄기·지선은 nsr·nwp의 coords[0..branch_start]가 동일.
  const arcticBits = useMemo(() => {
    const nsr = routeById.get("nsr") as any, nwp = routeById.get("nwp") as any;
    if (!nsr || !nwp) return null;
    const k = nsr.branch_start ?? 0;
    const trunkC = nsr.coords.slice(0, k + 1) as number[][];
    const nsrC = nsr.coords.slice(k) as number[][];
    const nwpC = nwp.coords.slice(nwp.branch_start ?? k) as number[][];
    const geo = (c: number[][]) => pathGen({ type: "LineString", coordinates: c } as any) || "";
    return {
      trunk: geo(trunkC), nsr: geo(nsrC), nwp: geo(nwpC),
      trunkStart: trunkC[0] as [number, number], // 상하이 = 공통 구간 포물선 시작점
      trunkMid: trunkC[Math.floor(trunkC.length / 2)] as [number, number],
      branchPt: trunkC[trunkC.length - 1] as [number, number], // 베링 = 분기점(포물선 끝점)
      nsrAt: (nsrC[Math.min(2, nsrC.length - 1)]) as [number, number],
      nwpAt: (nwpC[Math.min(2, nwpC.length - 1)]) as [number, number],
    };
  }, [pathGen, routeById]);
  const [layers, setLayers] = useState({ routes: true, chokes: true, ports: true });
  // 배 흐름: 함대(항로별 등급 척수), densify 캐시, 화물색 토글, 절제 가드
  const [shipCargoView, setShipCargoView] = useState(false);
  const [cargoFilter, setCargoFilter] = useState<"container" | "crude" | null>(null); // 화물별 뷰 필터 — null=둘 다
  // 항로가 싣는 화물 가닥(strand): 혼합=[컨테이너,원유] 2줄, 그 외=단일.
  const routeStrands = (r: { cargo_type?: string }): string[] => (r.cargo_type === "mixed" ? ["container", "crude"] : [r.cargo_type || "container"]);
  // 색 기준(§5): 항로별=항로 신원색 / 화물별=화물색. 혼합은 파랑 기본(필터 시 그 색). 라벨·체크박스·단일선 공통.
  const rCol = (r: { id: string; cargo_type?: string }) => {
    if (!shipCargoView) return routeColor(r.id);
    const ct = r.cargo_type || "container";
    if (ct === "mixed") return CARGO_COLOR[cargoFilter || "container"];
    return CARGO_COLOR[ct] || SEA;
  };
  const reducedMotion = useMemo(() => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches, []);
  const routeSamples = useMemo(() => { const m = new Map<string, { pts: number[][]; len: number }>(); for (const r of infra.routes) m.set(r.id, densifyRoute(r.coords)); return m; }, []);
  const fleet = useMemo(() => { const s: { routeId: string; cargo: string; offset: number; speed: number; lane: number }[] = []; for (const r of infra.routes as any[]) { const n = TIER_SHIPS[r.volume_tier] ?? 1; const lanes = LANE_OFFSETS[r.volume_tier] ?? [0]; const len = routeSamples.get(r.id)?.len ?? 100; const strands = r.cargo_type === "mixed" ? ["container", "crude"] : [r.cargo_type || "container"]; for (let i = 0; i < n; i++) s.push({ routeId: r.id, cargo: strands[i % strands.length], offset: (i + 0.5) / n, speed: (0.004 / len) * (0.9 + 0.2 * ((i * 37) % 100) / 100), lane: lanes[i % lanes.length] }); } return s; }, [routeSamples]);
  const fleetRefs = useRef<(SVGGElement | null)[]>([]);
  // L4 분쟁 층 — 국경 내부 글로우 + 진앙 마커. 기본 전쟁(≥1000)만, 무력분쟁 토글. 색=유형·진하기=강도.
  const [conflictMode, setConflictMode] = useState(false);
  const [showArmed, setShowArmed] = useState(false);
  const [hoverConflict, setHoverConflict] = useState<string | null>(null);
  // 칩=범례+스위치(§1): 유형별 on/off. 꺼짐=그 유형의 글로우·마커·목록·카운트 제외.
  const [typeOn, setTypeOn] = useState<Record<string, boolean>>({ interstate: true, civil: true, nonstate: true, territorial: true });
  const [listExpanded, setListExpanded] = useState(false); // 목록 아코디언 — 기본 접힘(패널 3줄)
  // 에피소드: 화면 미노출(§1 각주) — war-episodes.json 은 보존, 재개 시 접힌 아코디언 문법으로 추가. episodesAll 참조 유지.
  const conflictById = useMemo(() => new Map(conflictsAll.map((c) => [c.id, c])), []);
  const disputeById = useMemo(() => new Map(disputesAll.map((d) => [d.id, d])), []);
  const visConflicts = useMemo(() => conflictsAll.filter((c) => (showArmed || c.intensity === "war") && typeOn[catGroup(c.category)]), [showArmed, typeOn]);
  const visDisputes = useMemo(() => (typeOn.territorial ? disputesAll : []), [typeOn]);
  // 분쟁 당사국 채움(기본) — 국가별 집계: 색=최강 분쟁의 유형·강도. interstate 양국 모두 채색(비인접도 보이게).
  //   + 분쟁→당사국 매핑(hover 연동: 어느 당사국·진앙에 올려도 그 분쟁의 모든 당사국을 함께 강조). hover 시 국경 내부 그라데이션 추가.
  const CAT_RANK: Record<string, number> = { interstate: 3, civil: 2, onesided: 1, nonstate: 0 };
  const { countryGlows, conflictParties } = useMemo(() => {
    const cg = new Map<number, { color: string; war: boolean; rank: number; repId: string; ids: string[] }>();
    const cp = new Map<string, number[]>();
    for (const c of visConflicts) {
      const war = c.intensity === "war", color = conflictColor(c.category), rank = CAT_RANK[c.category] ?? 0; const idxs: number[] = [];
      for (const iso of c.party_isos || []) {
        const idx = isoToIdx.get(iso); if (idx == null) continue; idxs.push(idx);
        const cur = cg.get(idx);
        if (!cur) cg.set(idx, { color, war, rank, repId: c.id, ids: [c.id] });
        else { cur.ids.push(c.id); if ((war && !cur.war) || (war === cur.war && rank > cur.rank)) { cur.color = color; cur.war = war; cur.rank = rank; cur.repId = c.id; } }
      }
      if (idxs.length) cp.set(c.id, idxs);
    }
    return { countryGlows: [...cg.entries()].map(([idx, v]) => ({ idx, ...v })), conflictParties: cp };
  }, [visConflicts, isoToIdx]);
  const countryConflicts = useMemo(() => { const m = new Map<number, string[]>(); for (const g of countryGlows) m.set(g.idx, g.ids); return m; }, [countryGlows]);
  const conflictCountrySet = useMemo(() => new Set(countryGlows.map((g) => g.idx)), [countryGlows]); // 분쟁 당사국 = 전체 뷰에서 라벨 노출(그 외는 확대 시)
  const [listOpen, setListOpen] = useState(true); // 항로 목록 패널(접기 가능)
  const [compareSet, setCompareSet] = useState<Set<string>>(new Set()); // 목록 체크박스 = 다중 비교 활성 (toggleCompare 는 flyRoute 이후 정의)
  // ── 데이터센터 모드(지도 위 오버레이) ──
  const [dcMode, setDcMode] = useState(false);
  // 마커 색은 그룹(A/B/C) 고정 — ISO/전력계통 차원은 면 채색(전력시장)이 전담(중복 제거). 신용등급은 사이트 카드에만.
  const [dcGroups, setDcGroups] = useState<Record<string, boolean>>({ A: true, B: true, C: true });
  const [dcNuke, setDcNuke] = useState(true);
  const [dcSel, setDcSel] = useState<string | null>(null);
  const [dcNotes, setDcNotes] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false); // 모드별 사용 가이드(처음 쓰는 사람용)
  const [dcTx, setDcTx] = useState(true); // 송전선 + 계통 스냅 레이어
  const [dcFill, setDcFill] = useState<"none" | "rto" | "load">("none"); // 국가 뷰 면 채색(§B) — 상호배타
  // 전력계통 해설 패널(전력시장 채색 시 부속) — 펼친 권역·hover·접힘(세션 기억). 지도↔행 양방향.
  const [dcGridSel, setDcGridSel] = useState<string | null>(null);
  const [dcGridHover, setDcGridHover] = useState<string | null>(null);
  const [gridPanelOpen, setGridPanelOpen] = useState(() => { try { return localStorage.getItem("tr-gridpanel") !== "0"; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem("tr-gridpanel", gridPanelOpen ? "1" : "0"); } catch { /* noop */ } }, [gridPanelOpen]);
  const [dcFabs, setDcFabs] = useState(false); // 반도체 팹 레이어
  const [fabSel, setFabSel] = useState<string | null>(null);
  const [nukeSel, setNukeSel] = useState<string | null>(null);
  // AI 신규 SMR/원전 계획(데이터센터 PPA 중 기존 원전 아닌 신규) — 기존 원전 매칭분은 fleet 에 ai_linked 로 이미 표시
  const newSmrDeals = useMemo(() => dc.nuclear_deals.filter((n) => n.location?.lat != null && !["amzn-susquehanna", "msft-crane", "meta-constellation-clinton", "meta-vistra", "stargate-none", "orcl-smr-claim"].includes(n.id)), []);
  const fabsSorted = useMemo(() => [...fabs].sort((a, b) => (FAB_STATUS_ORDER[a.status] - FAB_STATUS_ORDER[b.status]) || (b.invest_announced_usd_bn - a.invest_announced_usd_bn)), []);
  const rtoPaths = useMemo(() => (dcMode && dcFill === "rto" ? rtoRegions.map((r) => ({ code: r.code, d: pathGen(r.geometry) || "" })) : []), [dcMode, dcFill, pathGen]);
  const usStates = useMemo(() => (feature(usStatesTopo as any, (usStatesTopo as any).objects.states) as any).features, []);
  const usStatePaths = useMemo(() => (dcMode ? usStates.map((f: any) => pathGen(f) || "") : []), [dcMode, usStates, pathGen]);
  // 주 이름 라벨 — 투영 후 중심점(그룹 transform 좌표계). NaN(클립됨) 제외.
  const usStateLabels = useMemo(() => (dcMode ? usStates.map((f: any) => { const c = pathGen.centroid(f); return { c, ko: US_STATE_KO[f.properties?.name] || f.properties?.name || "" }; }).filter((l: any) => Number.isFinite(l.c[0]) && Number.isFinite(l.c[1])) : []), [dcMode, usStates, pathGen]);
  const dcSites = useMemo(() => dc.sites.filter((s) => s.location.lat != null && s.location.lng != null), []);
  // 주별 AI 부하 비중(§B) = Σ(주내 DC 목표부하 MW, 페르미 제외) ÷ 주 평균부하(연 판매량/8760) × 100
  const stateLoadShare = useMemo(() => {
    const load: Record<string, number> = {};
    for (const s of dc.sites) { if (s.id === "fermi-matador") continue; const st = s.location.state; if (!st || !STATE_RETAIL_MWH_2023[st]) continue; const mw = s.capacity_target_mw.max ?? s.capacity_target_mw.min ?? s.capacity_operational_mw; if (mw) load[st] = (load[st] || 0) + mw; }
    const m = new Map<string, number>();
    for (const st in load) m.set(st, (100 * load[st]) / (STATE_RETAIL_MWH_2023[st] / 8760));
    return m;
  }, []);
  // ── 전력 조달 레이어(§1~§3) ──
  const txPoints = useMemo(() => { const pts: number[][] = []; for (const l of (txData as any).lines) for (const c of l.c) pts.push(c); return pts; }, []);
  // 전압 등급별로 묶어 굵기 차등(345 < 500 < 765kV = 전송 용량 프록시). 각 등급 = 한 MultiLineString path.
  const txPathsByClass = useMemo(() => {
    if (!(dcMode && dcTx)) return [] as { v: string; d: string }[];
    const groups: Record<string, number[][][]> = {};
    for (const l of (txData as any).lines) (groups[l.v] ||= []).push(l.c);
    const order = ["345", "500", "735 and Above"];
    return order.filter((v) => groups[v]?.length).map((v) => ({ v, d: pathGen({ type: "MultiLineString", coordinates: groups[v] } as any) || "" }));
  }, [dcMode, dcTx, pathGen]);
  const linkedDcIds = useMemo(() => new Set(dcPower.links.map((l) => l.dc_id)), []);
  const dcLinksR = useMemo(() => dcPower.links.map((l) => { const p = PLANT_BY_ID.get(l.plant_id); const s = dcSites.find((x) => x.id === l.dc_id); return p && s ? { link: l, plant: p, dc: s } : null; }).filter(Boolean) as { link: DcLink; plant: Plant; dc: Site }[], [dcSites]);
  // ③ 계통 급전 = grid_share 우세(≥0.5) & 명시 링크(①②) 없는 DC → 최근접 345kV 선로로 스냅(근사)
  const snapLines = useMemo(() => {
    if (!dcMode || !dcTx) return [] as { id: string; dc: [number, number]; snap: [number, number] }[];
    const out: { id: string; dc: [number, number]; snap: [number, number] }[] = [];
    for (const s of dcSites) {
      const frac = gridShareFrac(s.power?.grid_share);
      if (frac == null || frac < 0.5 || linkedDcIds.has(s.id)) continue;
      const dlng = s.location.lng!, dlat = s.location.lat!;
      let best = Infinity, bx = dlng, by = dlat;
      for (const pt of txPoints) { const dx = pt[0] - dlng, dy = pt[1] - dlat, d = dx * dx + dy * dy; if (d < best) { best = d; bx = pt[0]; by = pt[1]; } }
      out.push({ id: s.id, dc: [dlng, dlat], snap: [bx, by] });
    }
    return out;
  }, [dcMode, dcTx, dcSites, txPoints, linkedDcIds]);
  const dcColorOf = (s: Site) => GROUP_COLOR[s.group];

  // ── 줌/팬 ──
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<any>(null);
  const kRef = useRef(1);
  const fitKRef = useRef(1); // 마지막 fitTo 목표 배율(스케일 서사 분리용 기준)
  const dcBaseKRef = useRef(1); // DC 모드 진입 시 미국-핏 기준 배율. 사이트 줌 판정 기준값.
  const draggedRef = useRef(false);
  const [t, setT] = useState<{ x: number; y: number; k: number }>({ x: 0, y: 0, k: 1 });
  // 혼합 항로 겹선(§ 화물별) — 컨테이너/원유 각각 법선 offset 경로(살짝 간격). 화면 간격 일정(off=px/2 ÷ k).
  const routeDualPaths = useMemo(() => {
    const m = new Map<string, { container: string; crude: string }>();
    if (!shipCargoView) return m;
    const off = 1.7 / t.k;
    infra.routes.forEach((r: any, i) => { if (r.cargo_type !== "mixed") return; const [plus, minus] = offsetPolylines(routePaths[i], off); m.set(r.id, { container: plus, crude: minus }); });
    return m;
  }, [shipCargoView, routePaths, t.k]);
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = select(svgRef.current);
    const z = d3zoom<SVGSVGElement, unknown>().scaleExtent([1, 12]).translateExtent([[0, 0], [dim.w, dim.h]]).extent([[0, 0], [dim.w, dim.h]])
      .filter((e: any) => (e.type === "mousedown" ? kRef.current > 1.02 : true))
      .on("zoom", (e: any) => { if (e.sourceEvent?.type === "mousemove") draggedRef.current = true; kRef.current = e.transform.k; setT({ x: e.transform.x, y: e.transform.y, k: e.transform.k }); });
    svg.call(z as any); zoomRef.current = z;
    return () => { svg.on(".zoom", null); };
  }, [dim]);

  const spinRef = useRef<{ x: number; lon: number } | null>(null);
  const onSpinDown = (e: React.PointerEvent) => {
    draggedRef.current = false;
    cancelAnimationFrame(lonTweenRaf.current); // 사용자가 잡으면 진행 중 회전 트윈 중단
    if (e.pointerType !== "mouse" || kRef.current > 1.02) return;
    spinRef.current = { x: e.clientX, lon }; // ⚠ setPointerCapture 안 함 — 클릭(선택) 스틸 방지. 스핀은 svg onPointerMove/Up 으로 추적.
  };
  const onSpinMove = (e: React.PointerEvent) => { if (!spinRef.current) return; const dx = e.clientX - spinRef.current.x; if (Math.abs(dx) > 4) draggedRef.current = true; setLon(spinRef.current.lon - (dx / dim.w) * 360); };
  const onSpinUp = () => { spinRef.current = null; };

  const projFor = useCallback((useLon: number) => geoEqualEarth().rotate([-useLon, 0]).fitExtent([[14, 14], [dim.w - 14, dim.h - 14]], { type: "Sphere" } as any), [dim]);
  const fitTo = useCallback((useLon: number, b: [number, number, number, number], fill: number) => {
    if (!zoomRef.current || !svgRef.current) return;
    const [x0, y0, x1, y1] = b, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const k = Math.max(1, Math.min(9, fill / Math.max((x1 - x0) / dim.w || 1e-3, (y1 - y0) / dim.h || 1e-3)));
    fitKRef.current = k;
    tweenLon(useLon, 700); // 회전도 부드럽게(즉시 점프 제거) → 먼 경도 비행이 '내려꽂힘' 대신 자연스러운 이동
    const tr = zoomIdentity.translate(dim.w / 2 - k * cx, dim.h / 2 - k * cy).scale(k);
    select(svgRef.current).transition().duration(700).call(zoomRef.current.transform, tr);
  }, [dim]);
  const flyRegion = useCallback((r: { lon: number; bbox: [number, number, number, number] }) => {
    const proj = projFor(r.lon); const [w, s, e, n] = r.bbox, N = 8;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i <= N; i++) { const fx = w + (e - w) * (i / N), fy = s + (n - s) * (i / N);
      for (const pt of [[fx, s], [fx, n], [w, fy], [e, fy]] as [number, number][]) { const p = proj(pt); if (!p) continue; x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); } }
    if (Number.isFinite(x0)) fitTo(r.lon, [x0, y0, x1, y1], 0.85);
  }, [projFor, fitTo]);
  const flyFeatureCentered = useCallback((f: Cty) => {
    const useLon = Number.isFinite(f.properties.lx) ? f.properties.lx : CENTER_LON;
    const [[x0, y0], [x1, y1]] = geoPath(projFor(useLon)).bounds(f as any);
    fitTo(useLon, [x0, y0, x1, y1], 0.55);
  }, [projFor, fitTo]);
  const flyPoint = useCallback((lng: number, lat: number) => flyRegion({ lon: lng, bbox: [lng - 9, lat - 9, lng + 9, lat + 9] }), [flyRegion]);
  const flyRoute = useCallback((r: RouteT) => {
    const lo = r.coords.map((c) => c[0]), la = r.coords.map((c) => c[1]);
    const midLon = r.coords[Math.floor(r.coords.length / 2)][0];
    flyRegion({ lon: midLon, bbox: [Math.min(...lo), Math.min(...la), Math.max(...lo), Math.max(...la)] });
  }, [flyRegion]);
  const zoomBy = (f: number) => zoomRef.current && svgRef.current && select(svgRef.current).transition().duration(250).call(zoomRef.current.scaleBy, f);
  const resetWorldView = useCallback(() => { setLon(CENTER_LON); svgRef.current && select(svgRef.current).transition().duration(500).call(zoomRef.current.transform, zoomIdentity); }, []);
  // 3-way 모드: trade(세계·무역) / dc(데이터센터) / conflict(분쟁). 상호배타.
  const enterMode = useCallback((m: "trade" | "dc" | "conflict") => {
    setSel(null); setDcSel(null); setDcMode(m === "dc"); setConflictMode(m === "conflict");
    if (m === "dc") { flyRegion({ lon: -95, bbox: US_BBOX }); dcBaseKRef.current = fitKRef.current; }
    else if (m === "conflict") { setLon(25); svgRef.current && select(svgRef.current).transition().duration(500).call(zoomRef.current.transform, zoomIdentity); } // 분쟁 밀집 반구(유럽·중동·아프리카) 중심
    else resetWorldView();
  }, [flyRegion, resetWorldView]);

  // ── 선택(개체)/hover ──
  const [sel, setSel] = useState<EntitySel | null>(null);
  const [hoverCty, setHoverCty] = useState<number | null>(null);
  const [hoverInfra, setHoverInfra] = useState<{ kind: "route" | "choke" | "port"; id: string } | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string; sub?: string } | null>(null);
  // hover/선택 → 국경 그라데이션으로 강조할 당사국 집합. 진앙·목록·국가 fill 어디에 올려도 그 분쟁의 모든 당사국 동시(비인접 이란-이스라엘 포함).
  const hlCountryIdx = useMemo(() => {
    const ids = new Set<string>();
    if (sel?.kind === "conflict") ids.add(sel.id);
    if (hoverConflict) ids.add(hoverConflict);
    if (conflictMode && hoverCty != null) for (const id of countryConflicts.get(hoverCty) || []) ids.add(id);
    const s = new Set<number>();
    for (const id of ids) for (const idx of conflictParties.get(id) || []) s.add(idx);
    return s;
  }, [sel, hoverConflict, hoverCty, conflictMode, countryConflicts, conflictParties]);

  const goTo = useCallback((ent: EntitySel) => {
    setSel(ent);
    if (ent.kind === "country") flyFeatureCentered(features[ent.idx]);
    else if (ent.kind === "port") { const p = portById.get(ent.id) ?? minorPortById.get(ent.id); if (p) flyPoint(p.lng, p.lat); }
    else if (ent.kind === "choke") { const c = chokeById.get(ent.id); if (c) flyPoint(c.lng, c.lat); }
    else if (ent.kind === "route") { const r = routeById.get(ent.id); if (r) flyRoute(r); }
    else if (ent.kind === "conflict") { const c = conflictById.get(ent.id); if (c) flyPoint(c.epicenter[0], c.epicenter[1]); }
    else if (ent.kind === "dispute") { const d = disputeById.get(ent.id); if (d) flyPoint(d.lng, d.lat); }
  }, [features, portById, minorPortById, chokeById, routeById, conflictById, disputeById, flyFeatureCentered, flyPoint, flyRoute]);


  // 여러 항로를 한 화면에 — 중심 경도는 항로 중점들의 원형 평균, 투영 후 좌표로 bbox(경계 넘김 안전)
  const flyToRoutes = useCallback((ids: string[]) => {
    const routes = ids.map((id) => routeById.get(id)).filter(Boolean) as RouteT[];
    if (!routes.length) return;
    let sx = 0, sy = 0;
    for (const r of routes) { const ml = (r.coords[Math.floor(r.coords.length / 2)][0] * Math.PI) / 180; sx += Math.cos(ml); sy += Math.sin(ml); }
    const lon = (Math.atan2(sy, sx) * 180) / Math.PI;
    const proj = projFor(lon);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of routes) for (const c of r.coords) { const p = proj(c as [number, number]); if (!p) continue; x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    if (Number.isFinite(x0)) fitTo(lon, [x0, y0, x1, y1], 0.72);
  }, [routeById, projFor, fitTo]);

  // 항로 토글 = 체크박스·지도 라벨·목록 이름 공통 진입점(§연동). compareSet 이 하이라이트+카메라+카드를 몰이.
  const toggleCompare = useCallback((id: string) => {
    const n = new Set(compareSet); const adding = !n.has(id);
    adding ? n.add(id) : n.delete(id);
    setCompareSet(n);
    const ids = [...n];
    if (ids.length) flyToRoutes(ids);
    setSel(adding ? { kind: "route", id } : (ids.length ? { kind: "route", id: ids[ids.length - 1] } : null));
  }, [compareSet, flyToRoutes]);

  // 하이라이트 집합(선택 개체가 인프라면 그 기준, 아니면 hover 인프라)
  const focus = (sel && sel.kind !== "country" ? sel : hoverInfra) as { kind: "route" | "choke" | "port"; id: string } | null;
  const { hlRoutes, hlChokes, hlPorts } = useMemo(() => {
    // compareSet(목록 체크박스) = 상시 다중 하이라이트, focus(클릭·hover) = 단독 강조. 둘의 합집합.
    const R = new Set<string>(compareSet), C = new Set<string>(), P = new Set<string>();
    if (focus) {
      if (focus.kind === "route") R.add(focus.id);
      else { (focus.kind === "choke" ? C : P).add(focus.id); (routesByNode.get(focus.id) ?? []).forEach((rid) => R.add(rid)); }
    }
    // 북극 패밀리는 한 몸 — 통합 개체·두 지선이 함께 켜져야(지선 선·배 dim 방지, 경유지 귀속).
    if ([...R].some((rid) => ARCTIC_IDS.has(rid))) ARCTIC_IDS.forEach((id) => R.add(id));
    // 하이라이트된 모든 항로의 경유지(해협·항만)도 함께 켠다 — 비교 시 경유지 대조가 핵심.
    for (const rid of R) { const r = routeById.get(rid); r?.waypoints.forEach((w) => { if (w.type === "chokepoint") C.add(w.ref); else if (w.type === "port") P.add(w.ref); }); }
    return { hlRoutes: R, hlChokes: C, hlPorts: P };
  }, [focus, compareSet, routeById, routesByNode]);
  const hasFocus = hlRoutes.size + hlChokes.size + hlPorts.size > 0;
  // 스케일 서사 분리(§A): 국가 뷰 = 면 채색/귀속, 사이트 줌 = 생산→송전→DC 흐름(연결선·애니메이션·스냅)
  const dcSiteZoom = dcMode && t.k >= dcBaseKRef.current * DC_SITE_ZOOM_MULT;
  const tradeMode = !dcMode && !conflictMode; // 세계·무역 뷰(항로·항만·해협)

  // 검색
  const [query, setQuery] = useState("");
  const results = useMemo<Hit[]>(() => { const q = norm(query); if (!q) return []; return searchIndex.filter((it) => it.key.includes(q)).slice(0, 9); }, [query, searchIndex]);
  const onSelectResult = useCallback((it: Hit) => {
    setQuery("");
    if (it.kind === "country") goTo({ kind: "country", idx: it.idx });
    else if (it.kind === "capital") { const ci = isoToIdx.get(it.iso); if (ci != null) goTo({ kind: "country", idx: ci }); else flyPoint(it.lng, it.lat); }
    else if (it.kind === "choke") goTo({ kind: "choke", id: it.id });
    else if (it.kind === "route") goTo({ kind: "route", id: it.id });
    else goTo({ kind: "port", id: it.id });
  }, [goTo, isoToIdx, flyPoint]);

  const toScreen = (lng: number, lat: number): [number, number] | null => { const p = projection([lng, lat]); if (!p) return null; return [p[0] * t.k + t.x, p[1] * t.k + t.y]; };
  const inView = (x: number, y: number) => x >= -30 && x <= dim.w + 30 && y >= -30 && y <= dim.h + 30;
  // 배 흐름 rAF — 최신 투영/줌은 ref 로 읽어 스핀·줌 자연 대응. 배는 스크린 공간이라 크기 고정.
  const projRef = useRef(projection); projRef.current = projection;
  const tRef = useRef(t); tRef.current = t;
  const shipsOn = tradeMode && layers.routes;
  useEffect(() => {
    if (!shipsOn) return;
    const place = () => { const proj = projRef.current, tt = tRef.current;
      for (let i = 0; i < fleet.length; i++) { const ship = fleet[i], el = fleetRefs.current[i]; if (!el) continue; const samples = routeSamples.get(ship.routeId); if (!samples) continue;
        const [lng, lat] = shipLngLat(samples.pts, ship.offset); const p = proj([lng, lat] as any); if (!p) { el.style.display = "none"; continue; }
        const x = p[0] * tt.k + tt.x, y = p[1] * tt.k + tt.y;
        const [al, at] = shipLngLat(samples.pts, ship.offset + 0.004); const p2 = proj([al, at] as any); const angR = p2 ? Math.atan2((p2[1] * tt.k + tt.y) - y, (p2[0] * tt.k + tt.x) - x) : 0;
        const seam = !!p2 && Math.abs(p2[0] - p[0]) > dim.w * 0.5; // 이음새 edge 점프(투영폭 절반↑) = 화면 가로지름 → 숨김
        const lx = x + ship.lane * -Math.sin(angR), ly = y + ship.lane * Math.cos(angR); // 회랑 차선(진행방향 수직, 스크린 px)
        const fy = Math.cos(angR) < 0 ? -0.78 : 0.78; // 서쪽행(옆모습 배 180° 뒤집힘) → 세로 반전으로 갑판 위 유지
        el.style.display = seam || lx < -20 || lx > dim.w + 20 || ly < -20 || ly > dim.h + 20 ? "none" : "";
        el.setAttribute("transform", `translate(${lx.toFixed(1)},${ly.toFixed(1)}) rotate(${(angR * 180 / Math.PI).toFixed(1)}) scale(0.78,${fy})`);
      }
    };
    if (reducedMotion) { place(); return; } // 정지: 정적 배치(밀도 정보 유지)
    let raf = 0, last = performance.now(), running = true;
    const tick = (now: number) => { if (!running) return; const dt = Math.min(50, now - last); last = now; for (const ship of fleet) ship.offset = (ship.offset + ship.speed * dt) % 1; place(); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    const onVis = () => { if (document.hidden) { running = false; cancelAnimationFrame(raf); } else if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(tick); } };
    document.addEventListener("visibilitychange", onVis);
    return () => { running = false; cancelAnimationFrame(raf); document.removeEventListener("visibilitychange", onVis); };
  }, [shipsOn, fleet, routeSamples, reducedMotion, dim]);
  // 정적(reducedMotion)·스핀/줌 시 재배치
  useEffect(() => { if (shipsOn && reducedMotion) { const proj = projRef.current, tt = tRef.current; for (let i = 0; i < fleet.length; i++) { const ship = fleet[i], el = fleetRefs.current[i]; if (!el) continue; const samples = routeSamples.get(ship.routeId); if (!samples) continue; const [lng, lat] = shipLngLat(samples.pts, ship.offset); const p = proj([lng, lat] as any); if (!p) continue; const x = p[0] * tt.k + tt.x, y = p[1] * tt.k + tt.y; const [al, at] = shipLngLat(samples.pts, ship.offset + 0.004); const p2 = proj([al, at] as any); el.style.display = p2 && Math.abs(p2[0] - p[0]) > dim.w * 0.5 ? "none" : ""; const angR = p2 ? Math.atan2((p2[1] * tt.k + tt.y) - y, (p2[0] * tt.k + tt.x) - x) : 0; el.setAttribute("transform", `translate(${(x + ship.lane * -Math.sin(angR)).toFixed(1)},${(y + ship.lane * Math.cos(angR)).toFixed(1)}) rotate(${(angR * 180 / Math.PI).toFixed(1)}) scale(0.78,${Math.cos(angR) < 0 ? -0.78 : 0.78})`); } } });

  // 항만 라벨 클러스터(세계 뷰에서 밀집 시 최상위 1개만) — 순위 오름차순 그리디, 44px 이내 중복 제거
  const portLabelSet = useMemo(() => {
    if (t.k >= K_REGION) return new Set(infra.ports.map((p) => p.id)); // 권역+ 전부
    const kept: { x: number; y: number }[] = []; const set = new Set<string>();
    for (const p of portsRanked) { const sc = toScreen(p.lng, p.lat); if (!sc || !inView(sc[0], sc[1])) continue; if (kept.every((q) => Math.hypot(q.x - sc[0], q.y - sc[1]) > 44)) { kept.push({ x: sc[0], y: sc[1] }); set.add(p.id); } }
    return set;
  }, [t, dim, portsRanked, projection]);

  const isSelCty = (i: number) => sel?.kind === "country" && sel.idx === i;
  const selCtyNeighbors = useMemo(() => (sel?.kind === "country" ? new Set(adj[sel.idx]) : new Set<number>()), [sel, adj]);

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-background text-foreground">
      <style>{`@keyframes wf-flow{to{stroke-dashoffset:-24}}.wf-flow{animation:wf-flow 1s linear infinite}.wf-flow-slow{animation:wf-flow 3.2s linear infinite}@keyframes cf-pulse{0%{transform:scale(1);opacity:.7}70%{transform:scale(2.6);opacity:0}100%{transform:scale(2.6);opacity:0}}.cf-pulse{animation:cf-pulse 1.8s ease-out infinite}@keyframes dz-in{from{opacity:0}to{opacity:1}}.dz-in{animation:dz-in .4s ease-out}@media(prefers-reduced-motion:reduce){.cf-pulse{animation:none;opacity:0}.dz-in{animation:none}}`}</style>
      <svg ref={svgRef} width="100%" height="100%" viewBox={`0 0 ${dim.w} ${dim.h}`}
        className="block cursor-grab active:cursor-grabbing select-none"
        onPointerDown={onSpinDown} onPointerMove={onSpinMove} onPointerUp={onSpinUp} onPointerLeave={onSpinUp}
        onClick={() => { if (draggedRef.current) { draggedRef.current = false; return; } setSel(null); }}>
        <defs>
          <symbol id="ship-container" viewBox="0 0 16 8"><path d="M0 5 L2 7.6 L14 7.6 L16 5 Z" /><path d="M2.5 2.2 h3.4 v2.4 h-3.4 Z M6.6 2.2 h3.4 v2.4 h-3.4 Z M10.7 2.2 h2.6 v2.4 h-2.6 Z" opacity="0.7" /></symbol>
          <symbol id="ship-tanker" viewBox="0 0 16 8"><path d="M0 4.6 L2 7.4 L14 7.4 L16 4.6 Z" /><rect x="3" y="3" width="7.6" height="1.8" rx="0.9" opacity="0.7" /><rect x="12" y="1.8" width="1.8" height="2.8" opacity="0.7" /></symbol>
          {/* 분쟁 진앙 번짐 — 유형색 방사 그라데이션(중심 → 투명) */}
          {CONFLICT_LEGEND.map((l) => (
            <radialGradient key={l.color} id={`cfdot-${l.color.slice(1)}`}>
              <stop offset="0%" stopColor={l.color} stopOpacity="0.55" /><stop offset="45%" stopColor={l.color} stopOpacity="0.22" /><stop offset="100%" stopColor={l.color} stopOpacity="0" />
            </radialGradient>
          ))}
        </defs>
        <path d={spherePath} fill="hsl(var(--background))" stroke="hsl(var(--border))" strokeOpacity={0.6} />
        <g transform={`translate(${t.x},${t.y}) scale(${t.k})`}>
          {/* 육지 */}
          {features.map((f, i) => {
            const isSel = isSelCty(i), isNb = selCtyNeighbors.has(i), isHov = i === hoverCty;
            const fill = isSel ? TEAL : isNb ? "rgba(13,148,136,0.28)" : isHov ? "hsl(var(--muted))" : "hsl(var(--card))";
            return (
              <path key={i} d={paths[i]} fill={fill} stroke="hsl(var(--border))" strokeWidth={0.5 / t.k}
                style={{ cursor: dcMode ? "default" : "pointer", transition: "fill 0.12s", pointerEvents: dcMode ? "none" : undefined }}
                onClick={(e) => { e.stopPropagation(); if (draggedRef.current) { draggedRef.current = false; return; } goTo({ kind: "country", idx: i }); }}
                onMouseEnter={(e) => { setHoverCty(i); setTip({ x: e.clientX, y: e.clientY, text: f.properties.ko || f.properties.en }); }}
                onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, text: f.properties.ko || f.properties.en })}
                onMouseLeave={() => { setHoverCty(null); setTip(null); }} />
            );
          })}
          {/* L4 분쟁 당사국 — 기본=국가 전체 옅은 채움(색=유형), hover/선택 시 국경 내부 그라데이션 추가 + 당사국 동시 강조(비인접 포함) */}
          {conflictMode && countryGlows.map((g) => {
            const d = paths[g.idx]; if (!d) return null;
            const hot = hlCountryIdx.has(g.idx);
            const rc = conflictById.get(g.repId);
            const fillOp = Math.min(0.36, (g.war ? 0.16 : 0.10) * (hot ? 1.6 : 1));
            const layers = g.war ? [[34, 0.05], [22, 0.09], [13, 0.16], [6, 0.30], [2.5, 0.55]] : [[18, 0.05], [10, 0.10], [5, 0.20], [2, 0.36]];
            return (
              <g key={`cg${g.idx}`}>
                <clipPath id={`cgclip-${g.idx}`} clipPathUnits="userSpaceOnUse"><path d={d} /></clipPath>
                <g clipPath={`url(#cgclip-${g.idx})`}>
                  <path d={d} fill={g.color} fillOpacity={fillOp} stroke="none" style={{ cursor: "pointer", transition: "fill-opacity 0.12s" }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); if (draggedRef.current) { draggedRef.current = false; return; } goTo({ kind: "conflict", id: g.repId }); }}
                    onMouseEnter={(e) => { setHoverCty(g.idx); if (rc) setTip({ x: e.clientX, y: e.clientY, text: rc.name_ko, sub: `${conflictLabel(rc.category, rc.intensity === "war")} · 사망 ${rc.deaths_12mo.toLocaleString()}` }); }}
                    onMouseMove={(e) => { if (rc) setTip({ x: e.clientX, y: e.clientY, text: rc.name_ko, sub: `${conflictLabel(rc.category, rc.intensity === "war")} · 사망 ${rc.deaths_12mo.toLocaleString()}` }); }}
                    onMouseLeave={() => { setHoverCty(null); setTip(null); }} />
                  {hot && layers.map(([w, op], i) => <path key={i} d={d} fill="none" stroke={g.color} strokeOpacity={op} strokeWidth={w / t.k} strokeLinejoin="round" strokeLinecap="round" style={{ pointerEvents: "none" }} />)}
                </g>
              </g>
            );
          })}
          {/* DC 모드: 미국 주 경계 오버레이 */}
          {/* 국가 뷰 면 채색 §B — 전력시장(RTO) 권역. 비ISO 지역은 무채색(안 그림) */}
          {dcMode && dcFill === "rto" && rtoPaths.map((r, i) => { if (!r.d) return null; const active = dcGridSel === r.code || dcGridHover === r.code; const col = RTO_FILL[r.code] || "#94a3b8";
            return <path key={`rto${i}`} d={r.d} fill={col} fillOpacity={active ? 0.34 : 0.14} stroke={col} strokeOpacity={active ? 0.85 : 0.3} strokeWidth={(active ? 1.3 : 0.5) / t.k} style={{ cursor: "pointer" }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); if (draggedRef.current) { draggedRef.current = false; return; } setDcGridSel((c) => (c === r.code ? null : r.code)); setGridPanelOpen(true); }}
              onMouseEnter={(e) => { setDcGridHover(r.code); setTip({ x: e.clientX, y: e.clientY, text: `${rtoAbbr(r.code)} · ${RTO_KO[r.code]}` }); }}
              onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, text: `${rtoAbbr(r.code)} · ${RTO_KO[r.code]}` })}
              onMouseLeave={() => { setDcGridHover(null); setTip(null); }} />; })}
          {/* 국가 뷰 면 채색 §B — 주별 AI 부하 비중 램프 */}
          {dcMode && dcFill === "load" && usStates.map((f: any, i: number) => { const ab = US_NAME_ABBR[f.properties?.name]; const share = ab ? stateLoadShare.get(ab) : undefined; if (share == null) return null;
            return <path key={`fill${i}`} d={usStatePaths[i]} fill={loadFillColor(share)} stroke="none" style={{ cursor: "default" }}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY, text: `${US_STATE_KO[f.properties.name] || f.properties.name} · AI 부하 ${share.toFixed(0)}%`, sub: "주 평균 전력부하 대비(EIA 2023 소매판매÷8760)" })}
              onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, text: `${US_STATE_KO[f.properties.name] || f.properties.name} · AI 부하 ${share.toFixed(0)}%`, sub: "주 평균 전력부하 대비(EIA 2023)" })}
              onMouseLeave={() => setTip(null)} />; })}
          {dcMode && usStates.map((f: any, i: number) => <path key={`us${i}`} d={usStatePaths[i]} fill="none" stroke="hsl(var(--muted-foreground))" strokeOpacity={0.35} strokeWidth={0.5 / t.k} style={{ pointerEvents: "none" }} />)}
          {/* 송전선 345kV+ (기존 계통 2022). 전압 등급별 굵기 + 흐르는 점선(전력이 흐르는 느낌). 정적 언더레이로 그물망은 상시 보임. */}
          {txPathsByClass.map(({ v, d }) => d ? (
            <g key={`tx${v}`} style={{ pointerEvents: "none" }}>
              <path d={d} fill="none" stroke="#38bdf8" strokeOpacity={TX_OPACITY[v] * 0.3} strokeWidth={(TX_WIDTH[v] + 1.4) / t.k} strokeLinejoin="round" strokeLinecap="round" />
              <path d={d} className="wf-flow-slow" fill="none" stroke="#0ea5e9" strokeOpacity={TX_OPACITY[v]} strokeWidth={TX_WIDTH[v] / t.k} strokeLinecap="round" strokeDasharray={`${6 / t.k} ${5 / t.k}`} />
            </g>
          ) : null)}
          {dcMode && usStateLabels.map((l: any, i: number) => (
            <text key={`usl${i}`} x={l.c[0]} y={l.c[1]} textAnchor="middle" dominantBaseline="middle" fontSize={8 / t.k} fontWeight={500} fill="hsl(var(--muted-foreground))" fillOpacity={0.75}
              style={{ paintOrder: "stroke", stroke: "hsl(var(--background))", strokeWidth: 2.5 / t.k, strokeLinejoin: "round", pointerEvents: "none" }}>{l.ko}</text>
          ))}
          {/* L2 항로 — 항로별 색. 화물별 뷰: 화물색, 혼합=파랑+노랑 평행 겹선(법선 offset, 살짝 간격), 필터 시 해당 가닥만. 선택/hover 시 진하게+흐름. */}
          {tradeMode && layers.routes && infra.routes.flatMap((r, i) => {
            if (isArcticFam(r as any)) return []; // 북극 패밀리는 아래 통합 블록이 전담(줄기 1회 + 지선별 상태 스타일)
            const on = hlRoutes.has(r.id); const dim2 = hasFocus && !on; const d = (on ? 6 : 4) / t.k;
            const tierNone = (r as any).volume_tier === "none"; // 배 0 · 선은 유지하되 더 옅게(잠든 선)
            const dual = routeDualPaths.get(r.id); // 혼합 항로면 {container, crude} offset 경로
            const strands = shipCargoView ? routeStrands(r as any) : [null];
            return strands.map((strand) => {
              if (shipCargoView && cargoFilter && strand !== cargoFilter) return null;
              const col = strand ? (CARGO_COLOR[strand] || SEA) : routeColor(r.id);
              const dPath = (dual && strand && (strand === "container" || strand === "crude")) ? dual[strand] : routePaths[i];
              return (
                <path key={`r${i}-${strand}`} d={dPath} fill="none" stroke={col} strokeLinecap="round"
                  className={on ? "wf-flow" : undefined}
                  strokeWidth={(on ? 2.4 : 1.4) / t.k} strokeOpacity={dim2 ? 0.1 : on ? 0.95 : tierNone ? 0.24 : 0.5}
                  strokeDasharray={`${d} ${3 / t.k}`} style={{ pointerEvents: "none" }} />
              );
            });
          })}
          {/* 관문 밖 페이드 스텁 선 — geoPath(클리핑) · 변환 그룹 내 · 배 없음 */}
          {tradeMode && layers.routes && infra.routes.map((r, i) => { const st = routeStubs[i]; if (!st?.d) return null; const on = hlRoutes.has(r.id); const dim2 = hasFocus && !on;
            return <path key={`stub${i}`} d={st.d} fill="none" stroke={rCol(r as any)} strokeOpacity={dim2 ? 0.05 : on ? 0.5 : 0.22} strokeWidth={(on ? 1.6 : 1.2) / t.k} strokeLinecap="round" strokeDasharray={`${2 / t.k} ${3.5 / t.k}`} style={{ pointerEvents: "none" }} />; })}
          {/* 북극항로 통합 렌더 — 공통 줄기(실선) + NSR 지선(실선·운영) + NWP 지선(회색 점선·잠김). 선 스타일이 상태를 말한다. */}
          {tradeMode && layers.routes && arcticBits && (() => {
            const on = hlRoutes.has("arctic") || hlRoutes.has("nsr") || hlRoutes.has("nwp");
            const dim2 = hasFocus && !on; const arc = routeColor("nsr"); const lock = routeColor("nwp");
            return (
              <g key="arctic-lines" className="dz-in">
                {/* 공통 줄기(상하이~베링) — 실선 */}
                <path d={arcticBits.trunk} fill="none" stroke={arc} strokeLinecap="round" strokeLinejoin="round"
                  strokeWidth={(on ? 2.4 : 1.5) / t.k} strokeOpacity={dim2 ? 0.1 : on ? 0.95 : 0.6} style={{ pointerEvents: "none" }} />
                {/* NSR 지선 — 실선(운영 중) */}
                <path d={arcticBits.nsr} fill="none" stroke={arc} strokeLinecap="round" strokeLinejoin="round"
                  strokeWidth={(on ? 2.4 : 1.5) / t.k} strokeOpacity={dim2 ? 0.1 : on ? 0.95 : 0.6} style={{ pointerEvents: "none" }} />
                {/* NWP 지선 — 회색 점선 + 한 단계 옅게(잠김·배 0) */}
                <path d={arcticBits.nwp} fill="none" stroke={lock} strokeLinecap="round" strokeLinejoin="round"
                  strokeWidth={(on ? 1.6 : 1.1) / t.k} strokeOpacity={dim2 ? 0.06 : on ? 0.55 : 0.3}
                  strokeDasharray={`${3 / t.k} ${3.5 / t.k}`} style={{ pointerEvents: "none" }} />
              </g>
            );
          })()}
        </g>

        {/* 항로 배 흐름 — 밀도=물동량 등급(§1). 스크린 공간(크기 고정), 위치·회전은 rAF 로. */}
        {shipsOn && fleet.map((ship, i) => { const col = shipCargoView ? (CARGO_COLOR[ship.cargo] || SEA) : routeColor(ship.routeId); const dim2 = hasFocus && !hlRoutes.has(ship.routeId);
          const filteredOut = shipCargoView && !!cargoFilter && ship.cargo !== cargoFilter; // 필터 시 다른 화물 배 숨김(place는 display만 건드림)
          return <g key={`ship${i}`} ref={(el) => { fleetRefs.current[i] = el; }} transform="translate(-99,-99) scale(0.78)" style={{ opacity: filteredOut ? 0 : dim2 ? 0.1 : 0.92, pointerEvents: "none" }}><use href={`#${shipSymbol(ship.cargo)}`} x={-8} y={-4} width={16} height={8} fill={col} /></g>; })}

        {/* 국가 라벨 */}
        <g style={{ pointerEvents: "none" }}>
          {features.map((f, i) => {
            const isCf = conflictMode && conflictCountrySet.has(i);
            // 분쟁 모드: 기본 뷰에서 분쟁 당사국만 라벨(비분쟁국은 확대 시). 그 외 모드: 기존 worldLabelSet.
            const show = isSelCty(i) || i === hoverCty || t.k >= K_REGION || isCf || (!conflictMode && worldLabelSet.has(i));
            if (!show) return null;
            const dimLabel = conflictMode && !isCf && !isSelCty(i) && i !== hoverCty; // 분쟁 무관국(확대 시 나타남) = 흐리게
            const sc = toScreen(f.properties.lx, f.properties.ly); if (!sc || !inView(sc[0], sc[1])) return null;
            return (
              <text key={i} x={sc[0]} y={sc[1]} textAnchor="middle" fontSize={isSelCty(i) ? 12 : isCf ? 11 : 10.5}
                fontWeight={isSelCty(i) ? 700 : isCf ? 700 : 500} fill={isSelCty(i) ? TEAL : "hsl(var(--foreground))"} opacity={dimLabel ? 0.4 : 1}
                style={{ paintOrder: "stroke", stroke: "hsl(var(--background))", strokeWidth: 3, strokeLinejoin: "round" }}>{f.properties.ko}</text>
            );
          })}
        </g>

        {/* 항로 이름 라벨(경로 중간) — 클릭/hover로 항로 선택·하이라이트 */}
        {tradeMode && layers.routes && infra.routes.map((r, i) => {
          if (isArcticFam(r as any)) return null; // 북극 라벨은 아래 통합 블록(단일 "북극항로" + 분기 소자)
          const mid = r.coords[Math.floor(r.coords.length / 2)]; const sc = toScreen(mid[0], mid[1]);
          if (!sc || !inView(sc[0], sc[1]) || t.k >= K_LOCAL) return null;
          const on = hlRoutes.has(r.id); if (hasFocus && !on) return null;
          return (
            <text key={`rl${i}`} x={sc[0]} y={sc[1] - 4} textAnchor="middle" fontSize={on ? 11 : 9.5} fontWeight={on ? 700 : 500} fill={rCol(r as any)}
              style={{ paintOrder: "stroke", stroke: "hsl(var(--background))", strokeWidth: 3, strokeLinejoin: "round", cursor: "pointer" }}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseEnter={(e) => { setHoverInfra({ kind: "route", id: r.id }); setTip({ x: e.clientX, y: e.clientY, text: `➤ ${r.ko}`, sub: r.direction_note }); }}
              onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, text: `➤ ${r.ko}`, sub: r.direction_note })}
              onMouseLeave={() => { setHoverInfra(null); setTip(null); }}
              onClick={(e) => { e.stopPropagation(); if (draggedRef.current) { draggedRef.current = false; return; } toggleCompare(r.id); }}>{r.ko}</text>
          );
        })}
        {/* 스텁 라벨(스크린 공간) — 선은 위 변환그룹에서 geoPath로 그림. 이음새/뒷면이면 라벨 숨김. */}
        {tradeMode && layers.routes && infra.routes.map((r, i) => { const st = routeStubs[i]; if (!st?.label) return null;
          const stub = (r as any).stub as number[][]; const a = toScreen(stub[stub.length - 2][0], stub[stub.length - 2][1]); const b = toScreen(st.anchor[0], st.anchor[1]);
          if (!a || !b || !inView(b[0], b[1])) return null;
          if (Math.abs(b[0] - a[0]) > dim.w * 0.5 || Math.abs(b[1] - a[1]) > dim.h * 0.5) return null; // 이음새 wrap → 숨김
          const on = hlRoutes.has(r.id); const dim2 = hasFocus && !on;
          return <text key={`stubl${i}`} x={b[0] + 4} y={b[1] + 3} fontSize={8.5} fontWeight={500} fill={rCol(r as any)} fillOpacity={dim2 ? 0.15 : 0.62} style={{ paintOrder: "stroke", stroke: "hsl(var(--background))", strokeWidth: 2.5, strokeLinejoin: "round", pointerEvents: "none" }}>{st.label} →</text>;
        })}
        {/* 북극항로 통합 라벨 — 단일 "북극항로"(줄기 중점, 클릭 가능) + 분기점 부근 북동/북서 소자 */}
        {tradeMode && layers.routes && arcticBits && t.k < K_LOCAL && (() => {
          const on = hlRoutes.has("arctic") || hlRoutes.has("nsr") || hlRoutes.has("nwp");
          if (hasFocus && !on) return null;
          // 주석(분기 화살표·공통 구간)은 선택(클릭) 시에만 — 스쳐가는 hover 툴팁과 겹침 방지.
          const sticky = compareSet.has("arctic") || (sel?.kind === "route" && ARCTIC_IDS.has(sel.id));
          const arc = routeColor("nsr"); const lock = routeColor("nwp");
          const RED = "#E24B4A"; // 분기 화살표 — 항로선과 분리된 별도 주석색
          const mid = toScreen(arcticBits.trunkMid[0], arcticBits.trunkMid[1]);
          const ns = toScreen(arcticBits.nsrAt[0], arcticBits.nsrAt[1]);
          const nw = toScreen(arcticBits.nwpAt[0], arcticBits.nwpAt[1]);
          const guard = (p: [number, number] | null) => p && inView(p[0], p[1]);
          const st = toScreen(arcticBits.trunkStart[0], arcticBits.trunkStart[1]);
          const bp = toScreen(arcticBits.branchPt[0], arcticBits.branchPt[1]);
          // "공통 구간" — 상하이↔분기점을 바깥으로 휜 점선 포물선. 정점(sag)에 라벨(현 방향으로 회전, 정립).
          let paraD = "", labX = 0, labY = 0, labAng = 0;
          if (st && bp) {
            const A = st, B = bp; const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
            const dx = B[0] - A[0], dy = B[1] - A[1]; const L = Math.hypot(dx, dy) || 1;
            let nx = -dy / L, ny = dx / L; if (ny < 0) { nx = -nx; ny = -ny; } // 남쪽(아래)으로 볼록
            const sag = Math.min(Math.max(L * 0.3, 70), 160);
            const cx = mx + nx * sag * 2, cy = my + ny * sag * 2; // 2차 베지어 제어점(정점 offset = sag)
            paraD = `M${A[0].toFixed(1)},${A[1].toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${B[0].toFixed(1)},${B[1].toFixed(1)}`;
            labX = mx + nx * sag + nx * 4; labY = my + ny * sag + ny * 4; // 정점 살짝 바깥
            let ang = Math.atan2(dy, dx) * 180 / Math.PI; if (ang > 90) ang -= 180; else if (ang < -90) ang += 180;
            labAng = ang;
          }
          // 분기 화살표(빨강) — 항로선 위에 겹치지 않게 분기점 '위쪽'에 별도 표기. 좌 ↖ 북동 / 우 ↗ 북서.
          const redArrow = (sx: number, sy: number, angDeg: number, len: number) => {
            const a = angDeg * Math.PI / 180, ex = sx + Math.cos(a) * len, ey = sy + Math.sin(a) * len, hl = 8, a1 = a + Math.PI * 0.83, a2 = a - Math.PI * 0.83;
            return `M${sx.toFixed(1)},${sy.toFixed(1)} L${ex.toFixed(1)},${ey.toFixed(1)} M${(ex + Math.cos(a1) * hl).toFixed(1)},${(ey + Math.sin(a1) * hl).toFixed(1)} L${ex.toFixed(1)},${ey.toFixed(1)} L${(ex + Math.cos(a2) * hl).toFixed(1)},${(ey + Math.sin(a2) * hl).toFixed(1)}`;
          };
          const aL = bp ? redArrow(bp[0] - 16, bp[1] - 34, 213, 26) : ""; // 좌 위로(북동)
          const aR = bp ? redArrow(bp[0] + 16, bp[1] - 34, -33, 26) : "";  // 우 위로(북서)
          return (
            <g key="arctic-labels">
              {sticky && paraD && (<g style={{ pointerEvents: "none" }}>
                <path d={paraD} fill="none" stroke={arc} strokeWidth={2.4} strokeLinecap="round" strokeDasharray="9 8" strokeOpacity={0.9} />
                <text x={labX} y={labY} textAnchor="middle" transform={`rotate(${labAng.toFixed(1)} ${labX.toFixed(1)} ${labY.toFixed(1)})`}
                  fontSize={15} fontWeight={800} fill={arc} letterSpacing="1"
                  style={{ paintOrder: "stroke", stroke: "hsl(var(--background))", strokeWidth: 3.5, strokeLinejoin: "round" }}>공통 구간</text>
              </g>)}
              {guard(mid) && <text x={mid![0]} y={mid![1] - 4} textAnchor="middle" fontSize={on ? 11 : 9.5} fontWeight={on ? 700 : 500} fill={arc}
                style={{ paintOrder: "stroke", stroke: "hsl(var(--background))", strokeWidth: 3, strokeLinejoin: "round", cursor: "pointer" }}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseEnter={(e) => { setHoverInfra({ kind: "route", id: "arctic" }); setTip({ x: e.clientX, y: e.clientY, text: "➤ 북극항로", sub: "베링에서 북동(NSR)/북서(NWP)로 분기" }); }}
                onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, text: "➤ 북극항로", sub: "베링에서 북동(NSR)/북서(NWP)로 분기" })}
                onMouseLeave={() => { setHoverInfra(null); setTip(null); }}
                onClick={(e) => { e.stopPropagation(); if (draggedRef.current) { draggedRef.current = false; return; } toggleCompare("arctic"); }}>북극항로</text>}
              {guard(ns) && <text x={ns![0]} y={ns![1] - 3} textAnchor="middle" fontSize={8} fontWeight={600} fill={arc} fillOpacity={0.85}
                style={{ paintOrder: "stroke", stroke: "hsl(var(--background))", strokeWidth: 2.5, strokeLinejoin: "round", pointerEvents: "none" }}>북동(NSR)</text>}
              {guard(nw) && <text x={nw![0]} y={nw![1] - 3} textAnchor="middle" fontSize={8} fontWeight={600} fill={lock} fillOpacity={0.8}
                style={{ paintOrder: "stroke", stroke: "hsl(var(--background))", strokeWidth: 2.5, strokeLinejoin: "round", pointerEvents: "none" }}>북서(NWP)</text>}
              {/* 분기 화살표(빨강) — 분기점 위쪽 별도 표기, 항로선과 미겹침. 배경 헤일로 + 빨강. */}
              {sticky && bp && guard(bp) && (<g style={{ pointerEvents: "none" }}>
                <path d={aL} fill="none" stroke="hsl(var(--background))" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
                <path d={aR} fill="none" stroke="hsl(var(--background))" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
                <path d={aL} fill="none" stroke={RED} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
                <path d={aR} fill="none" stroke={RED} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
              </g>)}
            </g>
          );
        })()}

        {/* 수도 점은 지도에서 제거(시각 복잡도↓). 수도 정보는 국가 카드·검색에서만 유지. */}

        {/* L2 항만 — 면적 ∝ TEU, 순위 뱃지. 세계뷰=클러스터 top / 권역+=전부 */}
        {tradeMode && layers.ports && infra.ports.map((p) => {
          const sc = toScreen(p.lng, p.lat); if (!sc || !inView(sc[0], sc[1])) return null;
          const on = hlPorts.has(p.id); const show = portLabelSet.has(p.id) || on;
          if (!show) return null;
          const dim2 = hasFocus && !on; const r = portR(p.teu_m); const showLabel = true;
          return (
            <g key={`p${p.id}`} style={{ cursor: "pointer", opacity: dim2 ? 0.28 : 1 }}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseEnter={(e) => { setHoverInfra({ kind: "port", id: p.id }); setTip({ x: e.clientX, y: e.clientY, text: `⚓ ${p.ko}`, sub: `${p.rank}위 · ${p.teu_m}M TEU` }); }}
              onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, text: `⚓ ${p.ko}`, sub: `${p.rank}위 · ${p.teu_m}M TEU` })}
              onMouseLeave={() => { setHoverInfra(null); setTip(null); }}
              onClick={(e) => { e.stopPropagation(); if (draggedRef.current) { draggedRef.current = false; return; } goTo({ kind: "port", id: p.id }); }}>
              <circle cx={sc[0]} cy={sc[1]} r={r} fill={SEA} fillOpacity={on ? 0.45 : 0.28} stroke={SEA} strokeWidth={on ? 1.6 : 1} />
              {showLabel && <text x={sc[0]} y={sc[1] - r - 3} textAnchor="middle" fontSize={on ? 10.5 : 9.5} fontWeight={600} fill={SEA}
                style={{ paintOrder: "stroke", stroke: "hsl(var(--background))", strokeWidth: 2.5, strokeLinejoin: "round" }}>{`${p.rank} ${p.ko}`}</text>}
            </g>
          );
        })}
        {/* 부속 항만(TOP20 아님) — 북극 관문·캐나다 서안 등. 순위 없음, 작은 링 마커 · 클릭 = 개체 카드 */}
        {tradeMode && layers.ports && (infra.minor_ports ?? []).map((p) => {
          const sc = toScreen(p.lng, p.lat); if (!sc || !inView(sc[0], sc[1])) return null;
          const on = (sel?.kind === "port" && sel.id === p.id);
          return (
            <g key={`mp${p.id}`} style={{ cursor: "pointer" }} onPointerDown={(e) => e.stopPropagation()}
              onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY, text: `⚓ ${p.ko}`, sub: p.note })}
              onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, text: `⚓ ${p.ko}`, sub: p.note })}
              onMouseLeave={() => setTip(null)}
              onClick={(e) => { e.stopPropagation(); if (draggedRef.current) { draggedRef.current = false; return; } goTo({ kind: "port", id: p.id }); }}>
              <circle cx={sc[0]} cy={sc[1]} r={on ? 4 : 3} fill="hsl(var(--background))" stroke={SEA} strokeWidth={on ? 2 : 1.4} />
              <text x={sc[0]} y={sc[1] - 6} textAnchor="middle" fontSize={9} fontWeight={600} fill={SEA}
                style={{ paintOrder: "stroke", stroke: "hsl(var(--background))", strokeWidth: 2.5, strokeLinejoin: "round" }}>{p.ko}</text>
            </g>
          );
        })}

        {/* L2 해협 — 2계급 다이아. 1급 세계 라벨 상시, 2급 권역 라벨 */}
        {tradeMode && layers.chokes && infra.chokepoints.map((c) => {
          const sc = toScreen(c.lng, c.lat); if (!sc || !inView(sc[0], sc[1])) return null;
          const on = hlChokes.has(c.id); const dim2 = hasFocus && !on; const s = (c.tier === 1 ? 6 : 4.2) * (on ? 1.25 : 1);
          const showLabel = c.tier === 1 || t.k >= K_REGION || on;
          return (
            <g key={`c${c.id}`} style={{ cursor: "pointer", opacity: dim2 ? 0.3 : 1 }}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseEnter={(e) => { setHoverInfra({ kind: "choke", id: c.id }); setTip({ x: e.clientX, y: e.clientY, text: `◆ ${c.ko}`, sub: c.connects }); }}
              onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, text: `◆ ${c.ko}`, sub: c.connects })}
              onMouseLeave={() => { setHoverInfra(null); setTip(null); }}
              onClick={(e) => { e.stopPropagation(); if (draggedRef.current) { draggedRef.current = false; return; } goTo({ kind: "choke", id: c.id }); }}>
              <path d={`M${sc[0]},${sc[1] - s} L${sc[0] + s},${sc[1]} L${sc[0]},${sc[1] + s} L${sc[0] - s},${sc[1]} Z`} fill={AMBER} stroke="hsl(var(--background))" strokeWidth={on ? 1.4 : 0.8} />
              {showLabel && <text x={sc[0]} y={sc[1] - s - 3} textAnchor="middle" fontSize={c.tier === 1 ? 10 : 9} fontWeight={600} fill={AMBER}
                style={{ paintOrder: "stroke", stroke: "hsl(var(--background))", strokeWidth: 2.5, strokeLinejoin: "round" }}>{c.ko}</text>}
            </g>
          );
        })}

        {/* ③ 계통 급전 — 최근접 345kV 스냅(근사) 점선. 사이트 줌에서만(§A) */}
        {dcSiteZoom && snapLines.map((sl) => { const a = toScreen(sl.dc[0], sl.dc[1]), b = toScreen(sl.snap[0], sl.snap[1]); if (!a || !b) return null;
          return <line key={`snap${sl.id}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#0ea5e9" strokeOpacity={0.8} strokeWidth={1.2} strokeDasharray="1.5 2" style={{ pointerEvents: "none" }} />; })}

        {/* ①②  연결선 — ①물리(흐름 애니메이션 = 실제 조류), ②계약(긴 대시). 사이트 줌에서만(§A) */}
        {dcMode && dcSiteZoom && dcLinksR.map(({ link, plant, dc: s }) => { const a = toScreen(s.location.lng!, s.location.lat!), b = toScreen(plant.lng, plant.lat); if (!a || !b) return null;
          const phys = link.tier === "physical"; const col = FUEL_COLOR[plant.fuel] || "#f97316";
          const txt = phys ? "물리 전용 · 실제 조류" : "계약 관계 · 물리 조류 아님";
          return <line key={`lk${link.dc_id}-${link.plant_id}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={col} strokeOpacity={0.9} strokeWidth={phys ? 2 : 1.6}
            strokeDasharray={phys ? "4 4" : "7 5"} strokeLinecap="round" className={phys ? "wf-flow" : undefined} style={{ cursor: "pointer" }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY, text: txt, sub: link.note })}
            onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, text: txt, sub: link.note })}
            onMouseLeave={() => setTip(null)} />; })}

        {/* 발전소 점 (②·① 관련만) — 연료색 사각 + 글리프. DC(원)와 형태로 구분 */}
        {dcMode && dcLinksR.map(({ plant }) => { const sc = toScreen(plant.lng, plant.lat); if (!sc || !inView(sc[0], sc[1])) return null; const col = FUEL_COLOR[plant.fuel] || "#f97316"; const FI = FUEL_ICON[plant.fuel] || Flame;
          return <g key={`pl${plant.id}`} style={{ cursor: "pointer" }} onPointerDown={(e) => e.stopPropagation()}
            onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY, text: `${FUEL_KO[plant.fuel] || plant.fuel} · ${plant.name}`, sub: `${plant.capacity_mw ? plant.capacity_mw + "MW · " : ""}${plant.note}` })}
            onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, text: `${FUEL_KO[plant.fuel] || plant.fuel} · ${plant.name}` })}
            onMouseLeave={() => setTip(null)}>
            <rect x={sc[0] - 4.5} y={sc[1] - 4.5} width={9} height={9} rx={1.5} fill={col} fillOpacity={0.92} stroke="hsl(var(--background))" strokeWidth={1} />
            <FI x={sc[0] - 3} y={sc[1] - 3} width={6} height={6} style={{ color: "#fff", pointerEvents: "none" }} />
          </g>; })}

        {/* L4 분쟁 진앙 마커 — 색=유형. 넓게 번지는 방사 광훈 + 또렷한 코어(클릭 타깃). 최근 30일+전쟁 = 라이브 펄스. */}
        {conflictMode && visConflicts.map((c) => { const sc = toScreen(c.epicenter[0], c.epicenter[1]); if (!sc || !inView(sc[0], sc[1])) return null;
          const war = c.intensity === "war"; const on = (sel?.kind === "conflict" && sel.id === c.id) || hoverConflict === c.id;
          const col = conflictColor(c.category);
          const live = war && !!c.last_event_date && CONFLICT_MAX_MS - Date.parse(c.last_event_date) <= 30 * 864e5;
          const halo = (war ? 21 : 15) * (on ? 1.25 : 1); const r = (war ? 4.4 : 3.5) * (on ? 1.2 : 1);
          return (<g key={`cf${c.id}`} style={{ cursor: "pointer" }} onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); if (draggedRef.current) { draggedRef.current = false; return; } goTo({ kind: "conflict", id: c.id }); }}
            onMouseEnter={(e) => { setHoverConflict(c.id); setTip({ x: e.clientX, y: e.clientY, text: c.name_ko, sub: `${conflictLabel(c.category, war)} · 최근 12개월 사망 ${c.deaths_12mo.toLocaleString()}` }); }}
            onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, text: c.name_ko, sub: `${war ? "전면" : "무력분쟁"} · 사망 ${c.deaths_12mo.toLocaleString()}` })}
            onMouseLeave={() => { setHoverConflict(null); setTip(null); }}>
            <circle cx={sc[0]} cy={sc[1]} r={halo} fill={`url(#cfdot-${col.slice(1)})`} />
            {live && <circle className="cf-pulse" cx={sc[0]} cy={sc[1]} r={r} fill="none" stroke={col} strokeWidth={1.4} style={{ transformOrigin: `${sc[0]}px ${sc[1]}px` }} />}
            <circle cx={sc[0]} cy={sc[1]} r={r} fill={col} fillOpacity={0.95} stroke="hsl(var(--background))" strokeWidth={on ? 1.7 : 1.1} />
          </g>); })}

        {/* 영토·주권 분쟁 마커 — 노랑 꽉 찬 원 + 광훈, ★(최근 활발)은 펄스. 클릭=분쟁지 카드 */}
        {conflictMode && visDisputes.map((d) => { const sc = toScreen(d.lng, d.lat); if (!sc || !inView(sc[0], sc[1])) return null;
          const on = sel?.kind === "dispute" && sel.id === d.id;
          const halo = 15 * (on ? 1.25 : 1); const r = 3.5 * (on ? 1.2 : 1);
          return (<g key={`td${d.id}`} style={{ cursor: "pointer" }} onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); if (draggedRef.current) { draggedRef.current = false; return; } goTo({ kind: "dispute", id: d.id }); }}
            onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY, text: `${d.name_ko}${d.star ? " ★" : ""}`, sub: `영토·주권 · ${disputeCtrl(d)}` })}
            onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, text: `${d.name_ko}${d.star ? " ★" : ""}`, sub: `영토·주권 · ${disputeCtrl(d)}` })}
            onMouseLeave={() => setTip(null)}>
            <circle cx={sc[0]} cy={sc[1]} r={halo} fill={`url(#cfdot-${TERRITORIAL_YELLOW.slice(1)})`} />
            {d.star && <circle className="cf-pulse" cx={sc[0]} cy={sc[1]} r={r} fill="none" stroke={TERRITORIAL_YELLOW} strokeWidth={1.4} style={{ transformOrigin: `${sc[0]}px ${sc[1]}px` }} />}
            <circle cx={sc[0]} cy={sc[1]} r={r} fill={TERRITORIAL_YELLOW} fillOpacity={0.98} stroke={TERRITORIAL_TEXT} strokeWidth={on ? 1.3 : 0.9} />
          </g>); })}

        {/* DC 모드: 미국 전체 원전 — 상태 색(가동·퇴역·재가동·취소) + AI 연계 보라 링 */}
        {dcMode && dcNuke && nuclearPlants.map((p) => { const sc = toScreen(p.lng, p.lat); if (!sc || !inView(sc[0], sc[1])) return null;
          const col = NUKE_STATUS_COLOR[p.status] || "#94a3b8"; const on = p.id === nukeSel; const r = 4.5 * (on ? 1.2 : 1);
          const solid = p.status === "operating" || p.status === "restarting";
          return (<g key={`nk${p.id}`} style={{ cursor: "pointer" }} onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); if (draggedRef.current) { draggedRef.current = false; return; } setNukeSel(p.id); setDcSel(null); setFabSel(null); }}
            onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY, text: `⚛ ${p.name}`, sub: `${NUKE_STATUS_KO[p.status]}${p.capacity_mw ? ` · ${p.capacity_mw.toLocaleString()}MW` : ""}${p.ai_linked ? " · AI 연계" : ""}` })}
            onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, text: `⚛ ${p.name}`, sub: NUKE_STATUS_KO[p.status] })}
            onMouseLeave={() => setTip(null)}>
            {p.ai_linked && <circle cx={sc[0]} cy={sc[1]} r={r + 2.6} fill="none" stroke={AI_SMR} strokeWidth={1.4} strokeDasharray="2 1.5" />}
            <circle cx={sc[0]} cy={sc[1]} r={r} fill={col} fillOpacity={solid ? 0.85 : 0.25} stroke={col} strokeWidth={on ? 2 : 1.3} strokeDasharray={p.status === "canceled" ? "2 1.5" : undefined} />
            <text x={sc[0]} y={sc[1] + 2.3} textAnchor="middle" fontSize={5.5} fill={solid ? "#fff" : col} fontWeight={700} style={{ pointerEvents: "none" }}>⚛</text>
          </g>); })}
        {/* AI 신규 SMR/원전 계획(데이터센터 PPA — 기존 원전 아닌 신규) */}
        {dcMode && dcNuke && newSmrDeals.map((n) => { const sc = toScreen(n.location.lng, n.location.lat); if (!sc || !inView(sc[0], sc[1])) return null;
          return (<g key={`smr${n.id}`} style={{ cursor: "pointer" }} onPointerDown={(e) => e.stopPropagation()}
            onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY, text: `⚛ ${n.plant}`, sub: `AI 신규 계획 · ${n.buyer} · ${n.reactor_type}` })}
            onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, text: `⚛ ${n.plant}`, sub: `${n.buyer} · ${n.reactor_type}` })}
            onMouseLeave={() => setTip(null)}>
            <circle cx={sc[0]} cy={sc[1]} r={4.2} fill={AI_SMR} fillOpacity={0.12} stroke={AI_SMR} strokeWidth={1.4} strokeDasharray="2 1.5" />
            <text x={sc[0]} y={sc[1] + 2.3} textAnchor="middle" fontSize={5.5} fill={AI_SMR} fontWeight={700} style={{ pointerEvents: "none" }}>⚛</text>
          </g>); })}

        {/* DC 모드: 반도체 팹 — 육각(원=DC·사각=발전소와 형태 구분). 회사색·상태 채움 */}
        {dcMode && dcFabs && fabs.map((f) => { const sc = toScreen(f.location.lng, f.location.lat); if (!sc || !inView(sc[0], sc[1])) return null;
          const on = f.id === fabSel; const col = FAB_COLOR[f.company] || FAB_COLOR.other; const r = fabMarkerR(f) * (on ? 1.15 : 1);
          return (<g key={`fab${f.id}`} style={{ cursor: "pointer" }} onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); if (draggedRef.current) { draggedRef.current = false; return; } setFabSel(f.id); setDcSel(null); }}
            onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY, text: `${FAB_COMPANY_KO[f.company]} ${f.site_name.replace(/^[^ ]+ /, "")}`, sub: `${FAB_STATUS_KO[f.status]} · ${FAB_CAT_KO[f.category]}` })}
            onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, text: `${FAB_COMPANY_KO[f.company]} · ${FAB_STATUS_KO[f.status]}`, sub: f.node_note })}
            onMouseLeave={() => setTip(null)}>
            <path d={hexPath(sc[0], sc[1], r)} fill={col} fillOpacity={fabFillOpacity(f.status)} stroke={col} strokeWidth={on ? 2 : 1.4} strokeDasharray={f.status === "announced" ? "2.5 2" : undefined} />
            {f.status === "paused" && <circle cx={sc[0] + r * 0.7} cy={sc[1] - r * 0.7} r={2.2} fill="#f59e0b" stroke="hsl(var(--background))" strokeWidth={0.8} />}
          </g>); })}

        {/* DC 모드: 데이터센터 마커 */}
        {dcMode && dcSites.filter((s) => dcGroups[s.group]).map((s) => {
          const sc = toScreen(s.location.lng!, s.location.lat!); if (!sc || !inView(sc[0], sc[1])) return null;
          const on = s.id === dcSel; const col = dcColorOf(s); const r = dcMarkerR(s); const GenI = GEN_ICON[primaryGen(s.power)];
          const frac = gridShareFrac(s.power?.grid_share); const RR = r + 3.2; const CIRC = 2 * Math.PI * RR;
          return (<g key={`dc${s.id}`} style={{ cursor: "pointer" }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); if (draggedRef.current) { draggedRef.current = false; return; } setDcSel(s.id); }}
            onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY, text: `${s.name} · ${s.location.state}`, sub: dcHoverSub(s) })}
            onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, text: `${s.name} · ${s.location.state}`, sub: dcHoverSub(s) })}
            onMouseLeave={() => setTip(null)}>
            {/* 외곽 링 = 계통 의존도(grid_share): 꽉 참=100% 계통 → 빈 링=현장발전 위주. 점선=미공개 */}
            <circle cx={sc[0]} cy={sc[1]} r={RR} fill="none" stroke="hsl(var(--muted-foreground))" strokeOpacity={0.16} strokeWidth={1.6} style={{ pointerEvents: "none" }} />
            <circle cx={sc[0]} cy={sc[1]} r={RR} fill="none" stroke={col} strokeOpacity={0.9} strokeWidth={1.6} strokeLinecap="round"
              strokeDasharray={frac == null ? "1.5 3" : `${(frac * CIRC).toFixed(2)} ${CIRC.toFixed(2)}`} transform={`rotate(-90 ${sc[0]} ${sc[1]})`} style={{ pointerEvents: "none" }} />
            <circle cx={sc[0]} cy={sc[1]} r={r} fill={col} fillOpacity={on ? 0.55 : 0.32} stroke={col} strokeWidth={on ? 2 : 1.2} strokeDasharray={s.id === "fermi-matador" ? "3 2" : undefined} />
            <GenI x={sc[0] - 3.5} y={sc[1] - 3.5} width={7} height={7} style={{ color: col, pointerEvents: "none" }} />
            {/* 이름은 호버 툴팁으로(마커 크기=규모가 주인공). 선택 시에만 지도에 라벨 고정. */}
            {on && <text x={sc[0]} y={sc[1] - r - 3} textAnchor="middle" fontSize={9.5} fontWeight={600} fill={col}
              style={{ paintOrder: "stroke", stroke: "hsl(var(--background))", strokeWidth: 2.5, strokeLinejoin: "round", pointerEvents: "none" }}>{s.name}</text>}
          </g>);
        })}
      </svg>

      {/* hover 툴팁 */}
      {tip && (
        <div className="pointer-events-none fixed z-50 rounded-md border border-border bg-popover px-2 py-1 text-[12px] text-popover-foreground shadow-md" style={{ left: tip.x + 12, top: tip.y + 12 }}>
          <div>{tip.text}</div>{tip.sub && <div className="text-[10.5px] text-muted-foreground">{tip.sub}</div>}
        </div>
      )}


      {/* 상단 중앙: 모드 전환(세계·무역 / 미국 데이터센터 / 분쟁) */}
      <div className="absolute left-1/2 top-4 -translate-x-1/2">
        <div className="flex rounded-full border border-border bg-card/90 p-0.5 text-[11.5px] shadow-sm backdrop-blur">
          {([["trade", "세계·무역", Globe], ["dc", "미국 데이터센터", Server], ["conflict", "분쟁", Swords]] as const).map(([m, label, Icon]) => {
            const on = m === "dc" ? dcMode : m === "conflict" ? conflictMode : tradeMode;
            return <button key={m} onClick={() => enterMode(m)} className={`flex items-center gap-1 rounded-full px-3 py-1 ${on ? "bg-muted font-semibold" : "text-muted-foreground hover:bg-muted/50"}`}><Icon className="h-3.5 w-3.5" style={m === "conflict" && on ? { color: CONFLICT_RED } : undefined} />{label}</button>;
          })}
        </div>
      </div>
      {/* 좌하단: 사용 가이드 */}
      <button onClick={() => setGuideOpen((o) => !o)} className="absolute bottom-4 left-4 z-10 flex items-center gap-1.5 rounded-md border border-border bg-card/90 px-2.5 py-1.5 text-[11px] font-semibold shadow-sm backdrop-blur hover:bg-muted"><Info className="h-3.5 w-3.5" />사용 가이드</button>
      {guideOpen && <GuideCard mode={dcMode ? "dc" : conflictMode ? "conflict" : "trade"} onClose={() => setGuideOpen(false)} />}

      {/* 우상: L2 층 토글 (세계·무역 모드에서만) */}
      {tradeMode && (
      <div className="absolute right-4 top-4 flex gap-1">
        {([["routes", "항로", Route, SEA], ["ports", "항만", Anchor, SEA], ["chokes", "해협", Diamond, AMBER]] as const).map(([k, label, Icon, color]) => (
          <button key={k} onClick={() => setLayers((l) => ({ ...l, [k]: !l[k] }))}
            className={`flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] shadow-sm backdrop-blur transition-opacity ${layers[k] ? "border-border bg-card/90" : "border-border/50 bg-card/50 text-muted-foreground opacity-55"}`}
            title={`${label} ${layers[k] ? "끄기" : "켜기"}`}><Icon className="h-3 w-3" style={{ color: layers[k] ? color : undefined }} />{label}</button>
        ))}
      </div>
      )}

      {/* 좌상: 검색 */}
      {!dcMode && (
      <div className="absolute left-4 top-4 w-64">
        <div className="rounded-md border border-border bg-card/90 shadow-sm backdrop-blur">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && results[0]) onSelectResult(results[0]); if (e.key === "Escape") setQuery(""); }}
              placeholder="나라·수도·해협·항만 검색" spellCheck={false} className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground" />
            {query && <button onClick={() => setQuery("")} className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted"><X className="h-3.5 w-3.5" /></button>}
          </div>
          {results.length > 0 && (
            <div className="max-h-64 overflow-auto border-t border-border">
              {results.map((it, ri) => { const col = it.kind === "country" ? TEAL : it.kind === "choke" ? AMBER : (it.kind === "port" || it.kind === "route") ? SEA : "#94a3b8"; const lab = it.kind === "country" ? "국가" : it.kind === "capital" ? "수도" : it.kind === "choke" ? "해협" : it.kind === "route" ? "항로" : "항만";
                return (<button key={ri} onClick={() => onSelectResult(it)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-muted">
                  <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-medium" style={{ background: col + "26", color: col === "#94a3b8" ? "hsl(var(--muted-foreground))" : col }}>{lab}</span>
                  <span className="text-[12.5px] font-medium">{it.label}</span><span className="truncate text-[10px] text-muted-foreground">{it.sub}</span></button>); })}
            </div>
          )}
        </div>
        <div className="mt-1 pl-1 text-[10.5px] text-muted-foreground">좌우로 끌어 회전 · 클릭하면 상세</div>
      </div>
      )}


      {/* 우하: 줌 컨트롤 */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-1">
        <button onClick={() => zoomBy(1.6)} className="h-9 w-9 rounded-md border border-border bg-card/90 shadow-sm backdrop-blur hover:bg-muted"><Plus className="mx-auto h-4 w-4" /></button>
        <button onClick={() => zoomBy(1 / 1.6)} className="h-9 w-9 rounded-md border border-border bg-card/90 shadow-sm backdrop-blur hover:bg-muted"><Minus className="mx-auto h-4 w-4" /></button>
        <button onClick={() => { setLon(CENTER_LON); svgRef.current && select(svgRef.current).transition().duration(400).call(zoomRef.current.transform, zoomIdentity); }} className="h-9 w-9 rounded-md border border-border bg-card/90 shadow-sm backdrop-blur hover:bg-muted" title="세계 뷰"><Locate className="mx-auto h-4 w-4" /></button>
      </div>

      {/* 주요 항로 목록/범례 — 접기 가능(향후 층위 위해 상시 점유 안 함). 색=항로 신원 */}
      {((tradeMode && layers.routes) || conflictMode) && (
      <div className="absolute left-4 top-[4.75rem] flex max-h-[calc(100%-6rem)] w-60 flex-col gap-2">
        {tradeMode && layers.routes && (
        <div className="shrink-0 rounded-md border border-border bg-card/90 shadow-sm backdrop-blur">
          <button onClick={() => setListOpen((o) => !o)} className="flex w-full items-center gap-1.5 p-2.5 pb-1 text-left hover:bg-muted/30">
            <Route className="h-4 w-4" /><span className="text-sm font-bold">주요 항로</span>
            <ChevronDown className={`ml-auto h-4 w-4 text-muted-foreground transition-transform ${listOpen ? "" : "-rotate-90"}`} />
          </button>
          <div className="px-2.5 pb-1.5 text-[10.5px] text-muted-foreground">{infra.routes.filter((r) => !(r as any).branch_of).length}개 · 체크 = 여러 항로 비교{compareSet.size > 0 && <span className="text-primary"> · 비교 {compareSet.size}</span>}<span title="체크박스·지도 라벨·목록 이름 클릭이 모두 연동 — 켜면 그 항로로 이동(여럿이면 다 보이게), 카드도 뜸." className="ml-1 cursor-help">ⓘ</span></div>
          <div className="flex items-center gap-1.5 px-2.5 pb-2 text-[10px] text-muted-foreground">
            <span>배 색</span>
            <div className="flex overflow-hidden rounded border border-border">
              {([["route", "항로별"], ["cargo", "화물별"]] as const).map(([v, lab]) => (<button key={v} onClick={() => { setShipCargoView(v === "cargo"); if (v !== "cargo") setCargoFilter(null); }} className={`px-1.5 py-0.5 ${(v === "cargo") === shipCargoView ? "bg-muted font-semibold text-foreground" : "hover:bg-muted/50"}`}>{lab}</button>))}
            </div>
            <span title="배 흐름 = 항로별 연간 물동량 등급의 연출(밀도 비례) · 실시간 선박 위치 아님 · 등급 출처: 운하청 통계·UNCTAD" className="cursor-help">ⓘ</span>
          </div>
          {/* 화물별 뷰: 칩 줄 = 컨테이너/원유 필터(§5, 칩=범례+토글). 클릭 = 그 화물 라인만 · 다시 클릭 = 둘 다. 혼합은 두 색을 모두 가짐. */}
          {shipCargoView && (
            <div className="flex flex-wrap items-center gap-1 px-2.5 pb-2 text-[10px]">
              {(["container", "crude"] as const).map((c) => { const act = cargoFilter === c;
                return <button key={c} onClick={() => setCargoFilter((f) => (f === c ? null : c))} title="클릭 = 이 화물 라인만 보기 (다시 클릭 = 둘 다)"
                  className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 ${act ? "border-border bg-muted font-semibold" : "border-border/50 text-muted-foreground hover:bg-muted/50"}`}>
                  <span className="h-2 w-2 rounded-sm" style={{ background: CARGO_COLOR[c] }} />{CARGO_KO[c]}</button>; })}
              {cargoFilter && <button onClick={() => setCargoFilter(null)} className="text-muted-foreground hover:text-foreground">✕</button>}
              <span className="text-muted-foreground/70">· 혼합=두 색</span>
            </div>
          )}
          {listOpen && (
            <div className="border-t border-border py-1">
              {infra.routes.filter((r) => !(r as any).branch_of).map((r) => { const cmp = compareSet.has(r.id); const on = hlRoutes.has(r.id) || (sel?.kind === "route" && sel.id === r.id);
                const strands = routeStrands(r as any); const faded = shipCargoView && !!cargoFilter && !strands.includes(cargoFilter); // 필터 화물 안 싣는 항로 = 감쇠
                return (<div key={r.id} onMouseEnter={() => setHoverInfra({ kind: "route", id: r.id })} onMouseLeave={() => setHoverInfra(null)}
                  className={`flex items-center gap-1.5 pl-2 pr-2.5 text-[11.5px] ${on ? "bg-muted" : "hover:bg-muted/60"} ${faded ? "opacity-35" : ""}`}>
                  <input type="checkbox" checked={cmp} onChange={() => toggleCompare(r.id)} title="비교에 켜기 (여러 개 동시 선택)" className="h-3 w-3 shrink-0 cursor-pointer" style={{ accentColor: rCol(r as any) }} />
                  <button onClick={() => toggleCompare(r.id)} className={`flex flex-1 items-center gap-2 py-0.5 text-left ${on ? "font-semibold" : ""}`} title="클릭 = 비교 켜기/끄기 + 이동 + 카드">
                    {shipCargoView && strands.length > 1
                      ? <span className="flex h-2 w-3 shrink-0 overflow-hidden rounded-sm">{strands.map((st) => <span key={st} className="flex-1" style={{ background: CARGO_COLOR[st] }} />)}</span>
                      : <span className="h-2 w-3 shrink-0 rounded-sm" style={{ background: rCol(r as any) }} />}
                    <span className="truncate">{r.ko}</span></button></div>); })}
              {compareSet.size > 0 && (
                <div className="mt-0.5 border-t border-border px-2.5 pt-1">
                  <button onClick={() => setCompareSet(new Set())} className="text-[10.5px] text-muted-foreground hover:text-foreground">비교 전체 해제 ✕</button>
                </div>
              )}
            </div>
          )}
        </div>
        )}
        {/* 분쟁 패널(§1 3줄 다이어트) — 제목 / 칩 토글 / 접힌 카운트(아코디언). 에피소드는 화면 미노출(각주 — war-episodes.json 보존). */}
        {conflictMode && (
        <div className="flex min-h-0 flex-col rounded-md border border-border bg-card/90 shadow-sm backdrop-blur">
          {/* 1줄: 제목 */}
          <div className="flex items-center gap-1.5 px-2.5 pt-2.5 pb-1"><Swords className="h-4 w-4" style={{ color: CONFLICT_RED }} /><span className="text-sm font-bold">분쟁</span><span className="ml-auto text-[9px] text-muted-foreground" title={`출처: ${conflictsMeta.source} · 집계 ${conflictsMeta.window} · 영토·주권 = 직접 큐레이션`}>UCDP · 직접</span></div>
          {/* 2줄: 칩=범례+스위치 (유형별 on/off) */}
          <div className="flex flex-wrap gap-1 px-2.5 pb-1.5">
            {CONFLICT_LEGEND.map((l) => { const on = typeOn[l.group];
              return <button key={l.group} onClick={() => setTypeOn((o) => ({ ...o, [l.group]: !o[l.group] }))} title="클릭 = 이 유형 켜기/끄기 (글로우·마커·목록·카운트 함께)"
                className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] ${on ? "border-border" : "border-border/40 text-muted-foreground/50"}`}>
                <span className="h-2 w-2 rounded-full" style={{ background: on ? l.color : "#9ca3af" }} /><span className={on ? "" : "line-through"}>{l.ko}</span></button>; })}
          </div>
          {/* 3줄: 접힌 목록 헤더(기본 접힘) */}
          <button onClick={() => setListExpanded((v) => !v)} className="flex items-center gap-1.5 border-t border-border px-2.5 py-1.5 text-left text-[11px] hover:bg-muted/30">
            <span className="font-medium">분쟁 {visConflicts.length}</span><span className="text-muted-foreground/60">·</span><span className="font-medium" style={{ color: TERRITORIAL_TEXT }}>분쟁지 {visDisputes.length}</span>
            <ChevronDown className={`ml-auto h-4 w-4 text-muted-foreground transition-transform ${listExpanded ? "" : "-rotate-90"}`} />
          </button>
          {listExpanded && (
          <div className="min-h-0 overflow-auto border-t border-border">
            <div className="px-2.5 py-1 text-[10px] text-muted-foreground">강도순 · <button onClick={() => setShowArmed((v) => !v)} className="text-primary hover:underline">{showArmed ? "전쟁만 보기" : "무력분쟁 포함"}</button></div>
            {visConflicts.map((c) => { const on = (sel?.kind === "conflict" && sel.id === c.id) || hoverConflict === c.id; const war = c.intensity === "war";
              return (<button key={c.id} onMouseEnter={() => setHoverConflict(c.id)} onMouseLeave={() => setHoverConflict(null)} onClick={() => goTo({ kind: "conflict", id: c.id })}
                className={`flex w-full items-center gap-1.5 px-2.5 py-0.5 text-left text-[11.5px] ${on ? "bg-muted font-semibold" : "hover:bg-muted/60"}`}>
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: conflictColor(c.category) }} />
                <span className="flex-1 truncate">{c.name_ko}</span><span className="shrink-0 text-[9px] text-muted-foreground">{CONFLICT_CAT_KO[c.category]}{war ? "" : " · 무력분쟁"}</span></button>); })}
            {visDisputes.length > 0 && <div className="mt-0.5 border-t border-border px-2.5 pt-1 pb-0.5 text-[9px] font-semibold" style={{ color: TERRITORIAL_TEXT }}>영토·주권 분쟁 {visDisputes.length}</div>}
            {visDisputes.map((d) => { const on = sel?.kind === "dispute" && sel.id === d.id;
              return (<button key={d.id} onClick={() => goTo({ kind: "dispute", id: d.id })}
                className={`flex w-full items-center gap-1.5 px-2.5 py-0.5 text-left text-[11.5px] ${on ? "bg-muted font-semibold" : "hover:bg-muted/60"}`}>
                <span className="h-2 w-2 shrink-0 rounded-full border" style={{ borderColor: TERRITORIAL_YELLOW, background: TERRITORIAL_YELLOW + "33" }} />
                <span className="flex-1 truncate">{d.star ? "★ " : ""}{d.name_ko}</span><span className="shrink-0 text-[9px] text-muted-foreground">{d.region}</span></button>); })}
          </div>
          )}
        </div>
        )}
      </div>
      )}

      {/* 개체 카드 — 유형별 필드, 칩 = 크로스링크 */}
      {sel && (
        <div className="absolute right-4 top-16 max-h-[calc(100%-5rem)] w-80 overflow-auto rounded-lg border border-border bg-card/95 p-3.5 shadow-lg backdrop-blur">
          <button onClick={() => setSel(null)} className="absolute right-2 top-2 rounded p-0.5 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
          {sel.kind === "country" && (() => { const f = features[sel.idx]; const cap = capByIso.get(f.properties.iso);
            return (<>
              <div className="text-base font-bold leading-tight">{f.properties.ko}</div>
              <div className="text-[11px] text-muted-foreground">{f.properties.en}</div>
              <div className="mt-2.5 flex items-center gap-1.5 text-[12px]"><span className="text-muted-foreground">수도</span><span className="font-medium">{cap ? cap.ko : "—"}</span>{cap?.en && <span className="text-[11px] text-muted-foreground">{cap.en}</span>}</div>
              <div className="mt-2.5"><div className="mb-1 text-[11px] text-muted-foreground">인접국 {adj[sel.idx].length ? `· ${adj[sel.idx].length}` : ""}</div>
                <div className="flex flex-wrap gap-1">{adj[sel.idx].length === 0 && <span className="text-[11px] text-muted-foreground">인접 국경 없음</span>}
                  {adj[sel.idx].map((ni) => <Chip key={ni} color={TEAL} onClick={() => goTo({ kind: "country", idx: ni })}>{features[ni].properties.ko}</Chip>)}</div></div>
            </>); })()}
          {sel.kind === "port" && portById.has(sel.id) && (() => { const p = portById.get(sel.id)!; const ctyIdx = isoToIdx.get(p.country_iso); const rts = (routesByNode.get(p.id) ?? []).map((id) => routeById.get(id)!).filter(Boolean);
            return (<>
              <div className="flex items-center gap-1.5"><Anchor className="h-4 w-4" style={{ color: SEA }} /><span className="text-base font-bold leading-tight">{p.ko}</span></div>
              <div className="text-[11px] text-muted-foreground">{p.en}</div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
                <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold" style={{ color: SEA }}>세계 {p.rank}위</span>
                <span className="tabular-nums">{p.teu_m}M TEU</span><span className="text-[10.5px] text-muted-foreground">({infra._meta.data_year} 기준)</span>
              </div>
              {ctyIdx != null && <div className="mt-2 text-[11px] text-muted-foreground">소속 국가 <Chip color={TEAL} onClick={() => goTo({ kind: "country", idx: ctyIdx })}>{features[ctyIdx].properties.ko}</Chip></div>}
              {rts.length > 0 && <div className="mt-2"><div className="mb-1 text-[11px] text-muted-foreground">지나는 항로</div><div className="flex flex-wrap gap-1">{rts.map((r) => <Chip key={r.id} color={routeColor(r.id)} onClick={() => toggleCompare(r.id)}>{r.ko}</Chip>)}</div></div>}
              <Src url={`https://lloydslist.com`} label={infra._meta.teu_source} />
            </>); })()}
          {sel.kind === "port" && !portById.has(sel.id) && minorPortById.has(sel.id) && (() => { const p = minorPortById.get(sel.id)! as any; const ctyIdx = isoToIdx.get(p.country_iso);
            const rids: string[] = (p.linked_route_ids && p.linked_route_ids.length) ? p.linked_route_ids : (routesByNode.get(p.id) ?? []);
            const rts = rids.map((id) => routeById.get(id)!).filter(Boolean);
            return (<>
              <div className="flex items-center gap-1.5"><Anchor className="h-4 w-4" style={{ color: SEA }} /><span className="text-base font-bold leading-tight">{p.ko}</span></div>
              <div className="text-[11px] text-muted-foreground">{p.en}</div>
              <div className="mt-2 text-[11.5px] leading-snug">{p.note}</div>
              {ctyIdx != null && <div className="mt-2 text-[11px] text-muted-foreground">소속 국가 <Chip color={TEAL} onClick={() => goTo({ kind: "country", idx: ctyIdx })}>{features[ctyIdx].properties.ko}</Chip></div>}
              {rts.length > 0 && <div className="mt-2"><div className="mb-1 text-[11px] text-muted-foreground">연동 항로</div><div className="flex flex-wrap gap-1">{rts.map((r) => <Chip key={r.id} color={routeColor(r.id)} onClick={() => toggleCompare(r.id)}>{r.ko}</Chip>)}</div></div>}
              {p.source_url && <Src url={p.source_url} />}
            </>); })()}
          {sel.kind === "choke" && (() => { const c = chokeById.get(sel.id)!; const rts = (routesByNode.get(c.id) ?? []).map((id) => routeById.get(id)!).filter(Boolean);
            return (<>
              <div className="flex items-center gap-1.5"><Diamond className="h-4 w-4" style={{ color: AMBER }} /><span className="text-base font-bold leading-tight">{c.ko}</span>
                <span className="rounded px-1 py-0.5 text-[9px] font-semibold" style={{ background: AMBER + "22", color: AMBER }}>{c.tier === 1 ? "1급" : "2급"}</span></div>
              <div className="text-[11px] text-muted-foreground">{c.en}</div>
              <div className="mt-2 text-[12px]"><span className="text-muted-foreground">연결</span> {c.connects}</div>
              <div className="mt-1.5 text-[11.5px] leading-snug">{c.throughput_note}</div>
              {rts.length > 0 && <div className="mt-2"><div className="mb-1 text-[11px] text-muted-foreground">지나는 항로</div><div className="flex flex-wrap gap-1">{rts.map((r) => <Chip key={r.id} color={routeColor(r.id)} onClick={() => toggleCompare(r.id)}>{r.ko}</Chip>)}</div></div>}
              <Src url={c.source_url} />
            </>); })()}
          {sel.kind === "route" && (() => { const r = routeById.get(sel.id)!; const rc = routeCards[r.id];
            if (!rc) return (<><div className="flex items-center gap-1.5"><Route className="h-4 w-4" style={{ color: routeColor(r.id) }} /><span className="text-base font-bold">{r.ko}</span></div><div className="mt-2 text-[11.5px] text-muted-foreground">{r.facts}</div></>);
            return (<>
              <div className="flex items-center gap-1.5 pr-5"><Route className="h-4 w-4 shrink-0" style={{ color: routeColor(r.id) }} /><span className="text-[15px] font-bold leading-tight">{r.ko}</span>
                {rc.candidate && <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[9px] font-semibold text-muted-foreground">후보 항로</span>}</div>
              {/* ① 노선도식 경유지 — 원=항만·다이아=해협/운하, 클릭=개체 카드로 점프 */}
              <div className="mt-2.5 overflow-x-auto pb-0.5">
                <div className="relative flex items-start" style={{ minWidth: Math.max(rc.stops.length * 56, 240) }}>
                  <div className="absolute left-7 right-7 top-[7px] h-[2px]" style={{ background: "hsl(var(--border))" }} />
                  {rc.stops.map((s, i) => { const clk = (s.t === "port" && !!s.ref && (portById.has(s.ref) || minorPortById.has(s.ref))) || (s.t === "strait" && !!s.ref && chokeById.has(s.ref));
                    return (<div key={i} className="relative z-10 flex flex-1 flex-col items-center px-0.5" style={{ minWidth: 56 }}>
                      <button disabled={!clk} onClick={() => { if (!clk) return; s.t === "port" ? goTo({ kind: "port", id: s.ref! }) : goTo({ kind: "choke", id: s.ref! }); }} className={clk ? "cursor-pointer hover:opacity-70" : "cursor-default"} title={clk ? "개체로 이동" : undefined}>
                        {s.t === "strait" ? <span className="block h-3 w-3 rotate-45 border-[1.6px] bg-background" style={{ borderColor: AMBER }} />
                          : s.t === "seg" ? <span className="mx-auto mt-[3px] block h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
                            : <span className="block h-3 w-3 rounded-full border-[1.6px] bg-background" style={{ borderColor: SEA }} />}
                      </button>
                      <span className={`mt-1 text-center text-[9px] leading-tight ${clk ? "font-medium" : "text-muted-foreground"}`}>{s.l}</span>
                      {s.note && <span className="text-center text-[8px] leading-tight text-muted-foreground">{s.note}</span>}
                    </div>); })}
                </div>
              </div>
              {rc.fork_note && <div className="mt-1 text-[9.5px] leading-snug text-muted-foreground">⑂ {rc.fork_note}</div>}
              {/* ② 화물 구성 막대(톤 기준 개략) 또는 상태 칩 */}
              {rc.bar ? (<div className="mt-2.5">
                <div className="mb-1 text-[10.5px] text-muted-foreground">화물 구성 <span className="text-[9px]">(톤 기준 개략)</span></div>
                <div className="flex h-2.5 w-full overflow-hidden rounded-full" title="톤 기준 개략 · 연도별 변동">
                  {rc.bar.map((b, i) => <div key={i} style={{ width: `${b.p}%`, background: CARGO_BAR_COLOR[b.c] || CARGO_BAR_COLOR.other, boxShadow: i > 0 ? "inset 1.5px 0 0 hsl(var(--card))" : undefined }} />)}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5">
                  {rc.bar.map((b, i) => <span key={i} className="flex items-center gap-1 text-[9.5px] text-muted-foreground"><span className="h-2 w-2 rounded-full" style={{ background: CARGO_BAR_COLOR[b.c] || CARGO_BAR_COLOR.other }} />{b.l}</span>)}
                </div>
              </div>) : rc.status ? (<div className="mt-2.5 flex flex-col gap-1">
                {rc.status.map((s, i) => <span key={i} className="rounded-md border border-border bg-muted/40 px-2 py-1 text-[10.5px] leading-snug text-muted-foreground">{s}</span>)}
              </div>) : null}
              {/* ③ 설명 — 끊긴 문장, 줄바꿈 유지 */}
              <div className="mt-2.5 flex flex-col gap-1 text-[11.5px] leading-snug text-foreground/85">
                {rc.lines.map((l, i) => <div key={i}>{l}</div>)}
              </div>
              {/* ④ 관계 칩 */}
              {rc.rel && <div className="mt-2.5"><button onClick={() => rc.rel!.rk === "route" ? goTo({ kind: "route", id: rc.rel!.ref }) : goTo({ kind: "dispute", id: rc.rel!.ref })}
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium hover:bg-muted"
                style={rc.rel.k === "연동" ? { borderColor: TERRITORIAL_YELLOW, color: TERRITORIAL_TEXT } : { borderColor: SEA + "66", color: SEA }}>
                {rc.rel.k} — {rc.rel.l}</button></div>}
            </>); })()}
          {sel.kind === "conflict" && (() => { const c = conflictById.get(sel.id); if (!c) return null; const cc = conflictColor(c.category);
            const card = conflictCards[c.id]; const title = card?.title ?? c.name_ko; const badge = CONFLICT_LEGEND.find((l) => l.group === catGroup(c.category))?.ko ?? CONFLICT_CAT_KO[c.category];
            const pd = card?.period ?? `${c.started_year}~`; const pi = pd.indexOf("("); const pBig = pi >= 0 ? pd.slice(0, pi).trim() : pd; const pSub = pi >= 0 ? pd.slice(pi + 1).replace(")", "").trim() : "";
            return (<>
              <div className="flex items-center gap-1.5 pr-5"><Swords className="h-4 w-4 shrink-0" style={{ color: cc }} /><span className="text-[15px] font-bold leading-tight">{title}</span>
                <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold" style={{ background: cc + "22", color: cc }}>{badge}</span></div>
              {card && (card.left || card.right) && (
                <div className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5">
                  {card.left && <span className="rounded-full border border-border bg-muted/50 px-2.5 py-1 text-center text-[11.5px] font-semibold">{card.left}</span>}
                  {card.left && card.right && <span className="text-[10px] text-muted-foreground">vs</span>}
                  {card.right && <span className="rounded-full border px-2.5 py-1 text-center text-[11.5px] font-semibold" style={{ borderColor: cc + "66", color: cc, background: cc + "0f" }}>{card.right}</span>}
                </div>
              )}
              <div className="mt-2.5 text-center"><div className="text-[15px] font-bold leading-tight tabular-nums">{pBig}</div>{pSub && <div className="text-[10.5px] text-muted-foreground">{pSub}</div>}</div>
              {card && (card.need_left || card.need_right) && (
                <div className="mt-2.5 border-t border-border pt-2 text-[11px] leading-snug">
                  {card.need_left && <div><span className="font-semibold">{card.left}</span> — {card.need_left}</div>}
                  {card.need_right && <div className={card.need_left ? "mt-1" : ""}><span className="font-semibold" style={{ color: cc }}>{card.right}</span> — {card.need_right}</div>}
                </div>
              )}
              <div className="mt-2 text-[9.5px] text-muted-foreground">{badge} · 최근 12개월 사망 {c.deaths_12mo.toLocaleString()} · 집계 {conflictsMeta.window}</div>
              <Src url={conflictsMeta.source_url} label="UCDP GED" />
            </>); })()}
          {sel.kind === "dispute" && (() => { const d = disputeById.get(sel.id); if (!d) return null; const lc = d.linked_conflict_id ? conflictById.get(d.linked_conflict_id) : null;
            // 당사국 말풍선 열(공용). gray=주장만/후원(색 없음), 실효(◎)=노랑. 방사형은 전원 gray(대칭).
            const pcol = (p: DisputeParty, key: React.Key, gray?: boolean) => { const idx = isoToIdx.get(p.iso);
              const pillSt = gray ? { borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" } : p.controls ? { borderColor: TERRITORIAL_YELLOW, background: TERRITORIAL_YELLOW + "22", color: TERRITORIAL_TEXT } : { borderColor: "hsl(var(--border))" };
              const bubSt = gray ? { borderColor: "hsl(var(--border))" } : p.controls ? { background: TERRITORIAL_YELLOW + "1a", borderColor: TERRITORIAL_YELLOW + "55" } : { borderColor: "hsl(var(--border))" };
              const inner = <>{p.controls && !gray ? "◎ " : ""}{p.name_ko}{p.control_note ? <span className="font-normal text-muted-foreground"> ·{p.control_note}</span> : null}</>;
              return (<div key={key} className="flex min-w-0 flex-col gap-1">
                {idx != null && !gray ? <button onClick={() => goTo({ kind: "country", idx })} className="w-fit max-w-full truncate rounded-full border px-1.5 py-0.5 text-[10.5px] font-semibold hover:bg-muted" style={pillSt}>{inner}</button>
                  : <span className="w-fit max-w-full truncate rounded-full border px-1.5 py-0.5 text-[10.5px] font-semibold" style={pillSt}>{inner}</span>}
                <div className="rounded-lg border px-2 py-1.5 text-[10.5px] leading-snug" style={bubSt}>{p.claim}</div>
              </div>); };
            const layout = d.layout ?? "axis";
            return (<>
              <div className="flex items-center gap-1.5 pr-5"><Diamond className="h-4 w-4 shrink-0" style={{ color: TERRITORIAL_TEXT, fill: TERRITORIAL_YELLOW }} /><span className="text-[15px] font-bold leading-tight">{d.star ? "★ " : ""}{d.name_ko}</span>
                <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold" style={{ background: TERRITORIAL_YELLOW + "33", color: TERRITORIAL_TEXT }}>영토·주권</span></div>
              {d.note && <div className="mt-0.5 text-[10px] text-muted-foreground">{d.note}</div>}
              {lc && <button onClick={() => goTo({ kind: "conflict", id: lc.id })} className="mt-1.5 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold" style={{ borderColor: CONFLICT_RED + "66", color: CONFLICT_RED }}><Swords className="h-3 w-3" />활성 분쟁 연동 · {lc.name_ko}</button>}
              <div className="mt-2 flex flex-wrap gap-1">
                {d.stakes.map((s, i) => <span key={i} className="rounded-full border px-1.5 py-0.5 text-[10px]" style={{ borderColor: TERRITORIAL_YELLOW + "88", background: TERRITORIAL_YELLOW + "14" }}><b style={{ color: TERRITORIAL_TEXT }}>{STAKE_KO[s.type]}</b> <span className="text-muted-foreground">— {s.note}</span></span>)}
              </div>
              {layout === "grid" ? (
                <div className="mt-2.5 grid grid-cols-2 gap-x-2 gap-y-2">{d.parties.map((p, i) => pcol(p, i, !p.controls))}</div>
              ) : layout === "radial" ? (
                <div className="mt-2.5 flex flex-col items-center gap-2">
                  {d.parties[0] && <div className="w-full max-w-[55%]">{pcol(d.parties[0], 0, true)}</div>}
                  {d.center && <div className="rounded-full border-2 border-dashed px-4 py-2 text-center" style={{ borderColor: TERRITORIAL_YELLOW, background: TERRITORIAL_YELLOW + "12" }}><div className="text-[11px] font-semibold" style={{ color: TERRITORIAL_TEXT }}>{d.center.name}</div><div className="text-[9px] text-muted-foreground">{d.center.sub}</div></div>}
                  <div className="grid grid-cols-2 gap-2 self-stretch">{d.parties.slice(1).map((p, i) => pcol(p, i + 1, true))}</div>
                  <div className="text-center text-[9px] text-muted-foreground">모든 주장이 같은 대상을 향함 — 실효 지배자 없음, 전원 동일 비중</div>
                </div>
              ) : layout === "split" && d.rows ? (
                <div className="mt-2.5 flex flex-col gap-2">
                  {d.rows.map((row, ri) => (
                    <div key={ri} className={ri > 0 ? "border-t border-border pt-2" : ""}>
                      {row.label && <div className="mb-1 text-[10px] font-semibold" style={{ color: TERRITORIAL_TEXT }}>{row.label}</div>}
                      <div className="grid grid-cols-2 gap-2">{row.parties.map((pi) => (d.parties[pi] ? pcol(d.parties[pi], `${ri}-${pi}`) : null))}</div>
                    </div>
                  ))}
                </div>
              ) : (() => { const left = d.parties.filter((p) => p.controls); const right = d.parties.filter((p) => !p.controls);
                return (<>
                  <div className="mt-2.5 grid grid-cols-[1fr_auto_1fr] items-start gap-1.5">
                    <div className="flex flex-col gap-1.5">{left.map((p, i) => (<div key={`L${i}`}>{i > 0 && d.internal && <div className="mb-1.5 flex items-center gap-1 text-[8.5px] text-muted-foreground"><span className="h-px flex-1 bg-border" />내부 쟁점 — {d.internal}<span className="h-px flex-1 bg-border" /></div>}{pcol(p, `l${i}`)}</div>))}</div>
                    <div className="self-center pt-4 text-[10px] text-muted-foreground">vs</div>
                    <div className="flex flex-col gap-1.5">{right.map((p, i) => pcol(p, `r${i}`))}</div>
                  </div>
                  {d.sponsors && d.sponsors.length > 0 && <div className="mt-1.5 flex flex-wrap items-center gap-1"><span className="text-[9px] text-muted-foreground">후원·개입</span>{d.sponsors.map((s, i) => <span key={i} className="rounded-full border border-border px-1.5 py-0.5 text-[9.5px] text-muted-foreground">{s.name}{s.note ? ` ·${s.note}` : ""}</span>)}</div>}
                </>); })()}
              {(d.linked_choke_ids.length > 0 || d.linked_route_ids.length > 0) && (
                <div className="mt-2.5 flex flex-wrap items-center gap-1"><span className="text-[10px] text-muted-foreground">무역 지도</span>
                  {d.linked_choke_ids.map((id) => { const ch = chokeById.get(id); return ch ? <Chip key={id} color={AMBER} onClick={() => goTo({ kind: "choke", id })}>{ch.ko}</Chip> : null; })}
                  {d.linked_route_ids.map((id) => { const rt = routeById.get(id); return rt ? <Chip key={id} color={SEA} onClick={() => goTo({ kind: "route", id })}>{rt.ko}</Chip> : null; })}</div>
              )}
              <div className="mt-2 text-[9px] text-muted-foreground/80">말풍선 = 공표 입장 요지 (직접 인용 아님) · ◎ = 실효 지배</div>
              <Src url={d.source_url} label="출처(직접 큐레이션)" />
            </>); })()}
        </div>
      )}

      {/* ── 데이터센터 모드 패널 ── */}
      {dcMode && (<>
        {/* 우상단 레이어 토글 — 세계·무역 모드의 항로/항만/해협 알약과 통일 */}
        <div className="absolute right-4 top-4 flex gap-1">
          <button onClick={() => setDcNuke((v) => !v)} title={`미국 전체 원전 ${nuclearPlants.length}기 — 상태별 색(가동 초록·퇴역 회색·재가동 앰버·취소). 보라 링 = AI 데이터센터 연계 · 보라 점선 ⚛ = AI 신규 SMR 계획.`}
            className={`flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] shadow-sm backdrop-blur transition-opacity ${dcNuke ? "border-border bg-card/90" : "border-border/50 bg-card/50 text-muted-foreground opacity-55"}`}><Atom className="h-3 w-3" style={{ color: dcNuke ? "#16a34a" : undefined }} />원전</button>
          <button onClick={() => setDcTx((v) => !v)} title="345kV+ 고압 송전선(HIFLD, 2022년 기준·신설선 미포함) 배경 + 사이트 줌에서 계통 급전 DC를 최근접 선로로 잇는 스냅 점선(근사)."
            className={`flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] shadow-sm backdrop-blur transition-opacity ${dcTx ? "border-border bg-card/90" : "border-border/50 bg-card/50 text-muted-foreground opacity-55"}`}><Zap className="h-3 w-3" style={{ color: dcTx ? "#0ea5e9" : undefined }} />송전선</button>
          <button onClick={() => { setDcFabs((v) => !v); setFabSel(null); }} title={`반도체 팹 ${dcFabs ? "끄기" : "켜기"} — 육각 마커(회사색·상태 채움). 발표≠착공≠가동을 상태 필드로 추적.`}
            className={`flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] shadow-sm backdrop-blur transition-opacity ${dcFabs ? "border-border bg-card/90" : "border-border/50 bg-card/50 text-muted-foreground opacity-55"}`}><Hexagon className="h-3 w-3" style={{ color: dcFabs ? "#2563eb" : undefined }} />반도체 팹</button>
        </div>

        <div className="absolute left-4 top-16 w-60 space-y-2">
          <div className="rounded-md border border-border bg-card/90 p-2.5 shadow-sm backdrop-blur">
            <div className="flex items-center gap-1.5 text-sm font-bold"><Server className="h-4 w-4" /> 미국 AI 데이터센터
              <span className="ml-auto cursor-help text-[12px] font-normal text-muted-foreground" title="원 = 데이터센터(크기=IT 용량) · 외곽 링 = 계통 의존도(꽉 참=100% 계통, 빈 링=현장발전 위주, 점선=미공개) · 내부 아이콘 = 발전원(가스·원전·배터리) · 사각 = 발전소(①·② 관련) · 점선 원판 = 페르미(확보전력)">ⓘ</span>
            </div>
            <div className="text-[10.5px] text-muted-foreground">{dc.meta.as_of} · {dcSites.length}개 · 소유·자금·전력</div>
            {/* 마커 색 = 그룹 고정. A/B/C 칩 = 범례 겸 필터. (전력계통·신용등급은 각각 면 채색·사이트 카드로) */}
            <div className="mt-2 flex items-center gap-1 text-[10.5px] text-muted-foreground">그룹 (마커 색)<span title="개발/자금 구조로 마커 색 구분. A 스타게이트 계열(개발사 SPV+투자등급 임차인 리스) · B 하이퍼스케일러 자체보유 · C 네오클라우드. 칩 클릭 = 필터. (전력계통 = 아래 '면 채색·전력시장', 신용등급 = 사이트 카드)" className="cursor-help">ⓘ</span></div>
            <div className="mt-1 flex flex-wrap gap-1">
              {(["A", "B", "C"] as const).map((g) => (<button key={g} onClick={() => setDcGroups((o) => ({ ...o, [g]: !o[g] }))} title="클릭 = 필터" className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] ${dcGroups[g] ? "border-border bg-muted/40" : "border-border/40 opacity-45"}`}><span className="h-2 w-2 rounded-full" style={{ background: GROUP_COLOR[g] }} />{g} {GROUP_LABEL[g]}</button>))}
            </div>
            <div className="mt-2 flex items-center gap-1 text-[10.5px] text-muted-foreground">면 채색<span title={"지도 배경을 색칠 (둘 중 하나만).\n▸ 전력시장 = 이 지역이 어느 그리드에서 전기를 받나 (누구 전기인가·귀속)\n▸ AI 부하 비중 = 그 주 전체 전력 수요 중 AI 데이터센터가 차지하는 몫 (얼마나 무겁게·부담)"} className="cursor-help">ⓘ</span></div>
            <div className="mt-0.5 flex overflow-hidden rounded border border-border text-[10.5px]">
              {([["none", "없음", "배경 채색 없음"], ["rto", "전력시장", "ISO/RTO 권역 — 이 지역이 누구 그리드 전기를 받나 (귀속).\nERCOT·PJM·MISO·SPP·CAISO·ISONE·NYISO 색, 비ISO(TVA·WECC 등)는 무채색.\n경계는 겹침·공백 있는 근사 (HIFLD)."], ["load", "AI 부하 비중", "그 주 전체 전력 수요 대비, 주 안 데이터센터들의 예상 전력 부하가 차지하는 비율.\n\n= (주내 DC 예상 IT 부하 합, MW)\n  ÷ (주 평균 전력 수요 = 연간 전력판매량 ÷ 8760시간, EIA 2023)\n\n예) 루이지애나 ≈ 5GW ÷ 10.9GW ≈ 46%.\n진할수록 그 주 전력망이 AI에 무겁게 눌림. (페르미는 단위 달라 제외)"]] as const).map(([m, lab, help]) => (<button key={m} onClick={() => setDcFill(m)} title={help} className={`flex-1 px-1 py-0.5 ${dcFill === m ? "bg-muted font-semibold" : "text-muted-foreground hover:bg-muted/50"}`}>{lab}</button>))}
            </div>
            {dcFill === "load" && (<div className="mt-1 flex items-center gap-1 text-[9.5px] text-muted-foreground"><span>낮음</span><span className="h-2 flex-1 rounded-sm" style={{ background: "linear-gradient(90deg, rgba(245,158,11,0.15), rgba(234,88,12,0.35), rgba(220,38,38,0.6))" }} /><span>높음</span></div>)}
            {dcFill === "rto" && (<div className="mt-1 text-[9px] text-muted-foreground/70">아래 <b className="font-semibold text-muted-foreground">전력계통</b> 목록 = 범례. 행·지도 권역 클릭 = 설명.</div>)}
          </div>
          {/* 채색 뷰 해설 패널(§3) — '전력시장' 채색 시에만. 아코디언 = 세로 범례, 행/지도 양방향, 접힘 기억 */}
          {dcFill === "rto" && (
          <div className="flex max-h-[calc(100vh-15rem)] min-h-0 flex-col rounded-md border border-border bg-card/90 shadow-sm backdrop-blur">
            <button onClick={() => setGridPanelOpen((o) => !o)} className="flex items-center gap-1.5 p-2.5 pb-2 text-left hover:bg-muted/30">
              <Zap className="h-4 w-4 text-muted-foreground" /><span className="text-sm font-bold">전력계통</span><span className="text-[9px] text-muted-foreground">RTO/ISO 7 · 비ISO</span>
              <ChevronDown className={`ml-auto h-4 w-4 text-muted-foreground transition-transform ${gridPanelOpen ? "" : "-rotate-90"}`} />
            </button>
            {gridPanelOpen && (
            <div className="min-h-0 overflow-auto border-t border-border py-1">
              {RTO_ORDER.map((code) => { const open = dcGridSel === code; const hl = open || dcGridHover === code;
                return (<div key={code}>
                  <button onClick={() => setDcGridSel((c) => (c === code ? null : code))} onMouseEnter={() => setDcGridHover(code)} onMouseLeave={() => setDcGridHover(null)}
                    className={`flex w-full items-center gap-1.5 px-2.5 py-1 text-left text-[11.5px] ${hl ? "bg-muted" : "hover:bg-muted/60"}`}>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: RTO_FILL[code] }} />
                    <span className="shrink-0 font-semibold">{rtoAbbr(code)}</span>
                    <span className="truncate text-[10px] text-muted-foreground">{RTO_KO[code]}</span>
                    <ChevronDown className={`ml-auto h-3 w-3 shrink-0 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`} />
                  </button>
                  {open && (<div className="px-2.5 pb-2 pl-6 text-[10.5px] leading-snug text-muted-foreground"><div className="mb-0.5 font-medium text-foreground/75">{RTO_REGION_KO[code]}</div>{RTO_DESC[code]}</div>)}
                </div>); })}
              {(() => { const open = dcGridSel === "noniso";
                return (<div>
                  <button onClick={() => setDcGridSel((c) => (c === "noniso" ? null : "noniso"))} className={`flex w-full items-center gap-1.5 px-2.5 py-1 text-left text-[11.5px] ${open ? "bg-muted" : "hover:bg-muted/60"}`}>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-muted-foreground/50" />
                    <span className="shrink-0 font-semibold">비ISO</span>
                    <span className="truncate text-[10px] text-muted-foreground">수직통합 유틸 (무채색)</span>
                    <ChevronDown className={`ml-auto h-3 w-3 shrink-0 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`} />
                  </button>
                  {open && (<div className="px-2.5 pb-2 text-[10px] leading-snug text-muted-foreground">
                    {NONISO_ROWS.map((r) => (<div key={r.region} className="mb-1.5"><div className="text-foreground/80"><b>{r.region}</b></div><div className="text-muted-foreground/80">{r.grid} · {r.op}</div><div>{r.desc}</div></div>))}
                  </div>)}
                </div>); })()}
              <div className="px-2.5 pb-0.5 pt-1 text-[9px] leading-tight text-muted-foreground/70">{GRID_INTERCONNECT_NOTE}</div>
            </div>
            )}
          </div>
          )}
          {dcFabs && (
          <div className="flex max-h-[calc(100vh-22rem)] min-h-0 flex-col rounded-md border border-border bg-card/90 shadow-sm backdrop-blur">
            <div className="flex items-center gap-1.5 p-2.5 pb-1"><Hexagon className="h-4 w-4" style={{ color: "#2563eb" }} /><span className="text-sm font-bold">반도체 팹</span><span className="ml-auto cursor-help text-[11px] text-muted-foreground" title="육각 = 팹(원=DC · 사각=발전소). 채움 = 상태(가동 꽉참 · 건설 반채움 · 발표 점선 · 지연 앰버 플래그). 크기 = 발표 투자액. 색 = 회사.">ⓘ</span></div>
            <div className="px-2.5 pb-1 text-[10.5px] text-muted-foreground">{fabs.length}개 · 상태순 · 투자 발표치</div>
            <div className="flex flex-wrap gap-1 px-2.5 pb-1.5">{[...new Set(fabs.map((f) => f.company))].map((co) => <span key={co} className="flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[9px]"><span className="h-2 w-2 rounded-sm" style={{ background: FAB_COLOR[co] }} />{FAB_COMPANY_KO[co]}</span>)}</div>
            <div className="min-h-0 overflow-auto border-t border-border py-1">
              {fabsSorted.map((f) => { const on = f.id === fabSel;
                return (<button key={f.id} onMouseEnter={() => setTip(null)} onClick={() => { setFabSel(f.id); setDcSel(null); flyPoint(f.location.lng, f.location.lat); }}
                  className={`flex w-full items-center gap-1.5 px-2.5 py-0.5 text-left text-[11.5px] ${on ? "bg-muted font-semibold" : "hover:bg-muted/60"}`}>
                  <span className="h-2 w-2 shrink-0 rotate-45" style={{ background: FAB_COLOR[f.company], opacity: f.status === "announced" ? 0.4 : 1 }} />
                  <span className="flex-1 truncate">{f.site_name}</span><span className="shrink-0 text-[9px] text-muted-foreground">{FAB_STATUS_KO[f.status]}</span></button>); })}
            </div>
          </div>
          )}
        </div>

        {dcSel && (() => { const s = dc.sites.find((x) => x.id === dcSel); if (!s) return null; const stageIdx = STAGES.indexOf(s.status_stage); const gen = primaryGen(s.power); const GenI = GEN_ICON[gen];
          return (<div className="absolute right-4 top-16 max-h-[calc(100%-5rem)] w-80 overflow-auto rounded-lg border border-border bg-card/95 p-3.5 shadow-lg backdrop-blur">
            <button onClick={() => setDcSel(null)} className="absolute right-2 top-2 rounded p-0.5 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
            <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: GROUP_COLOR[s.group] }} /><span className="text-base font-bold leading-tight">{s.name}</span></div>
            <div className="text-[11px] text-muted-foreground">{s.location.city}, {s.location.state} · {GROUP_LABEL[s.group]}</div>
            <div className="mt-2 flex items-baseline gap-1.5 text-[12px]"><b className="tabular-nums">{s.capacity_operational_mw ?? "—"}MW</b><span className="text-muted-foreground">운영 / 목표 {s.capacity_target_mw.max ? (s.capacity_target_mw.min === s.capacity_target_mw.max ? `${s.capacity_target_mw.max}` : `${s.capacity_target_mw.min}~${s.capacity_target_mw.max}`) : "—"}MW</span></div>
            <div className="mt-1.5 flex gap-0.5">{STAGES.map((st, i) => <div key={st} className="h-1.5 flex-1 rounded-sm" style={{ background: i <= stageIdx ? GROUP_COLOR[s.group] : "hsl(var(--muted))" }} title={STAGE_KO[st]} />)}</div>
            <div className="mt-0.5 text-[10.5px] text-muted-foreground">{STAGE_KO[s.status_stage]} · {s.status_note}</div>
            <div className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11.5px]">
              <span className="text-muted-foreground">개발/소유</span><span>{s.landlord}</span>
              <span className="text-muted-foreground">임차</span><span>{s.tenant ?? "—"}{s.lease_term_years ? ` · ${s.lease_term_years}년` : ""}</span>
              <span className="text-muted-foreground">최종 사용</span><span>{s.end_user ?? "—"}</span></div>
            <div className="mt-2 flex items-center gap-1.5 text-[11.5px]"><span className="text-muted-foreground">신용 래퍼</span><span className="font-medium">{s.credit_wrapper ?? "—"}</span>{s.credit_wrapper_rating && <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: creditColor(s.credit_wrapper_rating) + "22", color: creditColor(s.credit_wrapper_rating) }}>{s.credit_wrapper_rating}</span>}</div>
            {s.power && (<div className="mt-2.5 rounded-md border border-border/60 p-2">
              <div className="flex items-center gap-1.5 text-[11.5px] font-semibold"><GenI className="h-3.5 w-3.5" style={{ color: gridColor(s.power.grid_operator) }} />전력 조달 <span className="ml-auto text-[10px] font-normal text-muted-foreground">신뢰도 {s.power.confidence}</span></div>
              <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
                <span className="text-muted-foreground">계통</span><span><b style={{ color: gridColor(s.power.grid_operator) }}>{s.power.grid_operator}</b>{s.power.utility ? ` · ${s.power.utility}` : ""} <span className="text-muted-foreground">({s.power.grid_share})</span></span>
                {s.power.onsite_generation.length > 0 && <><span className="text-muted-foreground">현장 발전</span><span>{s.power.onsite_generation.map((g) => `${g.type.includes("gas") ? "가스" : g.type.includes("nuclear") || g.type === "smr" ? "원전" : g.type.includes("battery") ? "배터리" : g.type.includes("solar") ? "태양광" : g.type}${g.mw ? ` ${g.mw}MW` : ""}${g.status === "planned" ? "(계획)" : ""}`).join(" · ")}</span></>}
                {s.power.utility_new_build.length > 0 && <><span className="text-muted-foreground">유틸 신설</span><span>{s.power.utility_new_build.map((g) => `${g.type} ${g.mw ?? ""}MW`).join(" · ")}</span></>}</div>
              {s.power.note && <div className="mt-1 text-[10.5px] text-muted-foreground">{s.power.note}</div>}</div>)}
            <div className="mt-2.5"><div className="mb-1 text-[11px] text-muted-foreground">자금 조달 {s.financing_total_usd_bn ? `· 총 $${s.financing_total_usd_bn}B` : ""}</div>
              <div className="space-y-0.5">{s.financing.map((f, i) => (<div key={i} className="flex items-baseline gap-1.5 text-[11px]"><span className="rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground">{f.type}</span><span className="truncate">{f.party}</span><span className="ml-auto shrink-0 tabular-nums">{f.amount_usd_bn != null ? `$${f.amount_usd_bn}B` : "미공개"}</span></div>))}</div></div>
            {s.notes && <div className="mt-2 text-[11px] leading-snug text-muted-foreground">{s.notes}</div>}
          </div>);
        })()}

        {nukeSel && (() => { const p = nuclearPlants.find((x) => x.id === nukeSel); if (!p) return null; const col = NUKE_STATUS_COLOR[p.status] || "#94a3b8";
          return (<div className="absolute right-4 top-16 w-72 rounded-lg border border-border bg-card/95 p-3.5 shadow-lg backdrop-blur">
            <button onClick={() => setNukeSel(null)} className="absolute right-2 top-2 rounded p-0.5 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
            <div className="flex items-center gap-1.5"><Atom className="h-4 w-4 shrink-0" style={{ color: col }} /><span className="text-base font-bold leading-tight">{p.name}</span></div>
            <div className="text-[11px] text-muted-foreground">{p.state ?? ""} · 원자력</div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]"><span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: col + "22", color: col }}>{NUKE_STATUS_KO[p.status]}</span>{p.capacity_mw && <span className="tabular-nums text-muted-foreground">{p.capacity_mw.toLocaleString()}MW</span>}{p.retired_year && <span className="text-[11px] text-muted-foreground">{p.retired_year} 퇴역</span>}</div>
            {p.ai_linked && (<div className="mt-2 rounded-md border border-border/60 p-2 text-[11.5px]"><span className="rounded px-1 py-0.5 text-[9px] font-semibold" style={{ background: AI_SMR + "22", color: AI_SMR }}>AI 연계</span> <span className="text-muted-foreground">{p.ai_note}</span></div>)}
            <div className="mt-2 text-[10px] leading-tight text-muted-foreground">출처: {nuclearMeta.source}</div>
          </div>); })()}

        {fabSel && (() => { const f = fabs.find((x) => x.id === fabSel); if (!f) return null; const col = FAB_COLOR[f.company] || FAB_COLOR.other;
          return (<div className="absolute right-4 top-16 max-h-[calc(100%-5rem)] w-80 overflow-auto rounded-lg border border-border bg-card/95 p-3.5 shadow-lg backdrop-blur">
            <button onClick={() => setFabSel(null)} className="absolute right-2 top-2 rounded p-0.5 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
            <div className="flex items-center gap-1.5"><Hexagon className="h-4 w-4 shrink-0" style={{ color: col }} /><span className="text-base font-bold leading-tight">{f.site_name}</span></div>
            <div className="text-[11px] text-muted-foreground">{FAB_COMPANY_KO[f.company]} · {f.location.city}, {f.location.state} · {FAB_CAT_KO[f.category]}</div>
            <div className="mt-2 flex items-center gap-1.5 text-[12px]"><span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: col + "22", color: col }}>{FAB_STATUS_KO[f.status]}</span><span className="text-muted-foreground">{f.status_as_of} 기준</span>{f.status === "paused" && <span className="rounded px-1 py-0.5 text-[9px] font-semibold" style={{ background: "#f59e0b22", color: "#b45309" }}>지연 플래그</span>}</div>
            <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{f.status_note}</div>
            <div className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11.5px]">
              <span className="text-muted-foreground">공정</span><span>{f.node_note}</span>
              <span className="text-muted-foreground">발표 투자</span><span>{f.invest_announced_usd_bn ? `$${f.invest_announced_usd_bn}B` : "미공개"} <span className="text-[10px] text-muted-foreground">(발표 기준)</span></span>
              <span className="text-muted-foreground">CHIPS 보조</span><span>{f.chips_award_usd_bn != null ? `$${f.chips_award_usd_bn}B` : "—"}</span>
              <span className="text-muted-foreground">목표 가동</span><span>{f.target_year ?? "—"}</span></div>
            <div className="mt-2.5"><div className="mb-1 text-[11px] text-muted-foreground">상태 이력 <span className="text-[10px]">(트래킹의 실체)</span></div>
              <div className="space-y-1">{f.status_log.map((l, i) => (<div key={i} className="flex items-baseline gap-1.5 text-[11px]"><span className="shrink-0 tabular-nums text-muted-foreground">{l.changed_on}</span><span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold" style={{ background: col + "18", color: col }}>{FAB_STATUS_KO[l.status]}</span><span className="text-muted-foreground">{l.note}</span></div>))}</div></div>
            <Src url={f.source_url} label="출처" />
          </div>); })()}
      </>)}
    </div>
  );
}

// 모드별 사용 가이드 — 처음 쓰는 사람용. "이 아이콘은 뭐고, X를 보려면 Y를 해라."
function GRow({ mark, children }: { mark: React.ReactNode; children: React.ReactNode }) {
  return <div className="flex items-start gap-2"><span className="mt-[3px] flex h-3.5 w-5 shrink-0 items-center justify-center">{mark}</span><span className="flex-1">{children}</span></div>;
}
function GSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="mt-3"><div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{title}</div><div className="space-y-1 text-[12px] leading-snug">{children}</div></div>;
}
const dot = (c: string, sq = false) => <span className={`inline-block h-2.5 w-2.5 ${sq ? "rounded-sm" : "rounded-full"}`} style={{ background: c }} />;
function GuideCard({ mode, onClose }: { mode: "trade" | "dc" | "conflict"; onClose: () => void }) {
  const title = mode === "dc" ? "미국 데이터센터 — AI 인프라 지도" : mode === "conflict" ? "분쟁 — 전 세계 활성 분쟁 (UCDP)" : "세계·무역 — 무역 동맥 지도";
  const lead = mode === "dc" ? "AI 데이터센터가 미국 내 어디에 있으며, 전기는 얼마나 쓰는지를 봅니다." : mode === "conflict" ? "지금 벌어지는 무력 분쟁의 위치·규모·유형을 봅니다." : "배가 다니는 항로·항구·병목 해협과 나라를 봅니다.";
  return (
    <div className="absolute bottom-14 left-4 z-20 max-h-[calc(100%-6rem)] w-[29rem] max-w-[calc(100%-2rem)] overflow-auto rounded-xl border border-border bg-card/97 p-4 shadow-xl backdrop-blur">
      <button onClick={onClose} className="absolute right-2.5 top-2.5 rounded p-0.5 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
      <div className="flex items-center gap-1.5 pr-6 text-[15px] font-bold"><Info className="h-4 w-4 shrink-0 text-muted-foreground" />{title}</div>
      <div className="mt-1 text-[12px] text-muted-foreground">{lead}</div>
      <div className="mt-2 text-[11px] text-muted-foreground">지도를 좌우로 끌면 지구가 돌고, 스크롤로 확대. 무엇이든 클릭하면 상세 카드가 뜹니다.</div>

      {mode === "trade" && (<>
        <div className="mt-1 text-[12px] leading-snug">세계 주요 항로, 항구, 주요 해협과 근접국들을 볼 수 있습니다.</div>
        <GSection title="레이어 (우측 상단 버튼으로 껐다 켜기)">
          <GRow mark={<span className="h-0 w-4 border-t-2" style={{ borderColor: "#2563eb" }} />}><b>항로</b> — 색깔 있는 선 (색이 곧 항로 이름)</GRow>
          <GRow mark={<Diamond className="h-3 w-3" style={{ color: "#f59e0b" }} />}><b>해협</b> — ◆ 좁은 병목 지점</GRow>
          <GRow mark={dot("#2563eb")}><b>항만</b> — ● 상위 20개 표기. <b>이름 앞 숫자 = 순위</b> (원이 클수록 물동량 많음)</GRow>
        </GSection>
        <GSection title="🚢 배 흐름 = 그 항로의 운송량 (이번 추가)">
          <GRow mark="→"><b>진행 방향</b> = 그 항로의 주 무역 흐름 방향.</GRow>
          <GRow mark="⋯"><b>배 밀도(동시 몇 척)</b> = 연간 물동량 등급. 많을수록 큰 항로(주항로 여러 척 · 북극항로 1척).</GRow>
          <GRow mark={<span className="text-[10px]">◗</span>}><b>유조선 실루엣</b> = 원유 항로. 왼쪽 패널 '배 색' 토글로 항로별↔화물별 전환.</GRow>
          <GRow mark="ⓘ">실시간 선박 위치(AIS) 아님 — <b>연간 물동량 등급의 연출</b>(출처: 운하청·UNCTAD).</GRow>
        </GSection>
        <GSection title="이걸 보고 싶으면">
          <GRow mark="▸"><b>특정 항로만 집중</b> → 왼쪽 상단 '주요 항로' 패널의 체크박스(여러 개 동시). 켠 항로가 다 보이게 이동.</GRow>
          <GRow mark="▸">이 해협을 <b>지나는 항로</b> → 해협 클릭 → 카드의 '지나는 항로'.</GRow>
          <GRow mark="▸"><b>나라·항만 찾기</b> → 왼쪽 위 검색창(자동 이동).</GRow>
        </GSection>
      </>)}

      {mode === "dc" && (<>
        <GSection title="우측 상단 버튼으로 일부 뱃지 껐다 켜기">
          <GRow mark={dot("#7c3aed")}><b>데이터센터</b> (크기=용량, 색깔=그룹 구분)</GRow>
          <GRow mark={<Hexagon className="h-3 w-3" style={{ color: "#2563eb" }} />}><b>반도체 팹</b></GRow>
          <GRow mark={<Atom className="h-3 w-3" style={{ color: "#16a34a" }} />}><b>원전</b> (색깔=가동 상태. 초록=가동 중 · 노랑=재가동(퇴역 복귀) · 회색=퇴역)</GRow>
          <GRow mark={dot("#f97316", true)}><b>발전소</b></GRow>
          <GRow mark={<Zap className="h-3 w-3" style={{ color: "#0ea5e9" }} />}><b>송전선</b> (미국 고압 송전망. 하늘색으로 흐르며, 굵을수록 높은 전압)</GRow>
        </GSection>
        <div className="mt-2 text-[11px] text-muted-foreground">마커는 <b>모양</b>으로 구분 — 원=데이터센터 · 육각형=반도체 팹 · ⚛=원전 · 사각형=발전소.</div>
        <GSection title="면 채색 (지도 배경) — 왼쪽 패널에서 선택">
          <div className="text-[11px] text-muted-foreground">"전기를 얼마나 쓰는지"의 핵심입니다.</div>
          <GRow mark="▸"><b>AI 부하 비중</b>: 그 주 전체 전력 수요 중 AI 데이터센터가 차지하는 몫. 진할수록 무겁게 앉은 주.</GRow>
          <GRow mark="▸"><b>전력시장</b>: 이 지역이 어느 그리드(ERCOT=텍사스 · PJM=동부 등)에 속하는지.</GRow>
        </GSection>
      </>)}

      {mode === "conflict" && (<>
        <GSection title="지도 읽는 법">
          <GRow mark={<span className="h-2.5 w-2.5 rounded-sm" style={{ background: CONFLICT_TYPE_COLOR.civil, opacity: 0.45 }} />}>분쟁 당사국은 <b>유형색으로 옅게 칠</b>해집니다. <b>색 = 유형</b>, <b>진하기 = 강도</b>(전면전일수록 진함).</GRow>
          <GRow mark={dot(CONFLICT_TYPE_COLOR.interstate)}>마우스를 올리면 <b>국경 안쪽에 그라데이션</b>이 번지고, 국가간전은 <b>양쪽 당사국이 함께</b> 켜집니다(비인접이라도).</GRow>
          <GRow mark={dot(CONFLICT_TYPE_COLOR.nonstate)}>작은 <b>점 = 진앙</b>(클릭용). 최근 활동 중인 전쟁은 <b>깜빡</b>입니다.</GRow>
        </GSection>
        <GSection title="유형색 (왼쪽 패널 상단 범례)">
          <GRow mark={dot(CONFLICT_TYPE_COLOR.interstate)}><b>국가간전</b> — 나라 대 나라.</GRow>
          <GRow mark={dot(CONFLICT_TYPE_COLOR.civil)}><b>내전</b> — 한 나라 안 정부 대 반군.</GRow>
          <GRow mark={dot(CONFLICT_TYPE_COLOR.nonstate)}><b>무장세력·대민간</b> — 비국가 무장세력 충돌·민간인 대상 폭력.</GRow>
        </GSection>
        <GSection title="이걸 보고 싶으면">
          <GRow mark="▸">큰 전쟁 말고 <b>작은 분쟁까지 다</b> → 왼쪽 '무력분쟁 포함'.</GRow>
          <GRow mark="▸"><b>유형·당사국·사망자</b> → 진앙/목록 클릭하면 카드에.</GRow>
          <GRow mark="▸"><b>과거 전쟁</b>은 왼쪽 '에피소드' — 개별 재생은 준비 중입니다.</GRow>
        </GSection>
        <div className="mt-3 text-[11px] text-muted-foreground">정직성: 글로우·진앙은 최근 사건 <b>분포의 근사</b>이지 확정 전선·통제선이 아닙니다.</div>
      </>)}
    </div>
  );
}

function Chip({ children, color, onClick }: { children: React.ReactNode; color: string; onClick: () => void }) {
  return <button onClick={onClick} className="rounded-full border px-2 py-0.5 text-[11px] hover:bg-muted" style={{ borderColor: color + "66" }}>{children}</button>;
}
function Src({ url, label }: { url: string; label?: string }) {
  return <a href={url} target="_blank" rel="noreferrer" className="mt-2.5 flex items-center gap-1 text-[10.5px] text-muted-foreground hover:text-foreground"><ExternalLink className="h-3 w-3" />{label ?? "출처"}</a>;
}
