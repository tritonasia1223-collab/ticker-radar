// 세계 현황판 (/#/world) — L1 국가 + 검색/프리셋 + L2 무역 인프라(항로·해협·항만) 개체 시스템.
//   정적 데이터 직접 렌더(DB/서버 불요). d3-geo Equal Earth + d3-zoom. 태평양 중심(회전 스핀).
//   L2 개편(개체 명세): 항로/해협/항만을 필드·경유지체인·상호 하이퍼링크를 가진 개체로. 카드 1컴포넌트, 유형별 필드.
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { geoEqualEarth, geoPath, geoArea } from "d3-geo";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity } from "d3-zoom";
import "d3-transition";
import { feature, neighbors } from "topojson-client";
import { Plus, Minus, X, Locate, Search, Anchor, Diamond, Route, ExternalLink, ChevronDown, Server, Flame, Atom, BatteryCharging, Zap, Info, Globe } from "lucide-react";
import topoData from "@/data/world-110m.json";
import capitalsData from "@/data/world-capitals.json";
import infraData from "@/data/world-infra.json";
import dcData from "@/data/ai-datacenters.json";
import usStatesTopo from "@/data/us-states-10m.json";
import txData from "@/data/us-transmission-345.json";
import dcPowerLinks from "@/data/dc-power-links.json";

type CtyProps = { iso: string; ko: string; en: string; lx: number; ly: number };
type Cty = { type: "Feature"; geometry: any; properties: CtyProps };
type Cap = { iso: string; ko: string; en: string; lng: number; lat: number };
type Choke = { id: string; ko: string; en: string; lng: number; lat: number; connects: string; tier: number; throughput_note: string; source_url: string };
type Port = { id: string; ko: string; en: string; country_iso: string; lng: number; lat: number; teu_m: number; rank: number };
type Waypoint = { type: "port" | "chokepoint"; ref: string };
type RouteT = { id: string; ko: string; coords: [number, number][]; waypoints: Waypoint[]; direction_note: string; alt_of: string | null; facts: string; source_url: string };
const infra = infraData as unknown as { chokepoints: Choke[]; ports: Port[]; routes: RouteT[]; _meta: { teu_source: string; data_year: number } };

type EntitySel =
  | { kind: "country"; idx: number }
  | { kind: "port"; id: string }
  | { kind: "choke"; id: string }
  | { kind: "route"; id: string };

const TEAL = "#0d9488";          // 선택 하이라이트
const AMBER = "#f59e0b";         // 해협
const SEA = "#2563eb";           // 항만(파랑 점)
// 항로별 색 — 앰버(해협)·청록(선택)·적(분쟁 예정) 회피한 범주형 팔레트
const ROUTE_COLOR: Record<string, string> = {
  "eu-asia-suez": "#2563eb", "cape": "#9333ea", "nsr": "#0891b2", "nwp": "#64748b",
  "trans-pacific": "#db2777", "panama": "#16a34a", "mideast-oil": "#4f46e5", "trans-atlantic": "#0ea5e9",
};
const routeColor = (id: string) => ROUTE_COLOR[id] ?? SEA;

// ── 미국 데이터센터 모드(지도 위 오버레이) ──
type Gen = { type: string; vendor: string | null; mw: number | null; status: string; note?: string };
type Power = { grid_operator: string; utility: string | null; grid_share: string; onsite_generation: Gen[]; utility_new_build: Gen[]; nuclear: boolean; note?: string; confidence: string };
type Fin = { type: string; party: string; amount_usd_bn: number | null; disclosure: string };
type Site = { id: string; group: "A" | "B" | "C"; name: string; location: { city: string | null; state: string | null; lat: number | null; lng: number | null }; capacity_operational_mw: number | null; capacity_target_mw: { min: number | null; max: number | null }; status_stage: string; status_note: string; landlord: string; tenant: string | null; lease_term_years: number | null; end_user: string | null; financing: Fin[]; financing_total_usd_bn: number | null; credit_wrapper: string | null; credit_wrapper_rating: string | null; notes: string; power?: Power };
type Nuke = { id: string; buyer: string; plant: string; reactor_type: string; mw: number; location: { state: string; grid: string; lat: number; lng: number }; deal: string; target_year: number; status: string; site_bound: boolean; confidence: string };
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
const primaryGen = (p?: Power): "gas" | "nuclear" | "battery" | "grid" => { if (!p) return "grid"; const ts = p.onsite_generation.map((g) => g.type); if (ts.some((t) => t.includes("nuclear") || t === "smr")) return "nuclear"; if (ts.some((t) => t.includes("gas"))) return "gas"; if (ts.some((t) => t.includes("battery") || t.includes("solar"))) return "battery"; return "grid"; };
const GEN_ICON = { gas: Flame, nuclear: Atom, battery: BatteryCharging, grid: Zap } as const;
const US_BBOX: [number, number, number, number] = [-125, 24, -66, 49]; // 본토 프레임
type DcMode = "group" | "grid" | "credit";
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
    for (const r of infra.routes) out.push({ kind: "route", label: r.ko, sub: r.direction_note, id: r.id, key: norm(r.ko) });
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
  const projection = useMemo(() => geoEqualEarth().rotate([-lon, 0]).fitExtent([[14, 14], [dim.w - 14, dim.h - 14]], { type: "Sphere" } as any), [dim, lon]);
  const pathGen = useMemo(() => geoPath(projection), [projection]);
  const paths = useMemo(() => features.map((f) => pathGen(f as any) || ""), [features, pathGen]);
  const spherePath = useMemo(() => pathGen({ type: "Sphere" } as any) || "", [pathGen]);
  const routePaths = useMemo(() => infra.routes.map((r) => pathGen({ type: "LineString", coordinates: r.coords } as any) || ""), [pathGen]);
  const [layers, setLayers] = useState({ routes: true, chokes: true, ports: true });
  const [listOpen, setListOpen] = useState(true); // 항로 목록 패널(접기 가능)
  const [compareSet, setCompareSet] = useState<Set<string>>(new Set()); // 목록 체크박스 = 다중 비교 활성
  const toggleCompare = useCallback((id: string) => setCompareSet((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }), []);
  // ── 데이터센터 모드(지도 위 오버레이) ──
  const [dcMode, setDcMode] = useState(false);
  const [dcColor, setDcColor] = useState<DcMode>("group");
  const [dcGroups, setDcGroups] = useState<Record<string, boolean>>({ A: true, B: true, C: true });
  const [dcNuke, setDcNuke] = useState(true);
  const [dcSel, setDcSel] = useState<string | null>(null);
  const [dcNotes, setDcNotes] = useState(false);
  const [dcTx, setDcTx] = useState(true); // 송전선 + 계통 스냅 레이어
  const [dcFill, setDcFill] = useState<"none" | "load">("none"); // 국가 뷰 면 채색(§B). RTO 권역은 폴리곤 확보 후.
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
  const txPath = useMemo(() => (dcMode && dcTx ? (pathGen({ type: "MultiLineString", coordinates: (txData as any).lines.map((l: any) => l.c) } as any) || "") : ""), [dcMode, dcTx, pathGen]);
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
  const dcColorOf = (s: Site) => (dcColor === "group" ? GROUP_COLOR[s.group] : dcColor === "grid" ? gridColor(s.power?.grid_operator) : creditColor(s.credit_wrapper_rating));

  // ── 줌/팬 ──
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<any>(null);
  const kRef = useRef(1);
  const fitKRef = useRef(1); // 마지막 fitTo 목표 배율(스케일 서사 분리용 기준)
  const dcBaseKRef = useRef(1); // DC 모드 진입 시 미국-핏 기준 배율. 사이트 줌 판정 기준값.
  const draggedRef = useRef(false);
  const [t, setT] = useState<{ x: number; y: number; k: number }>({ x: 0, y: 0, k: 1 });
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
    setLon(useLon);
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
  const toggleDc = useCallback(() => {
    setDcMode((m) => {
      const next = !m; setSel(null); setDcSel(null);
      if (next) { flyRegion({ lon: -95, bbox: US_BBOX }); dcBaseKRef.current = fitKRef.current; } // 미국 중심 회전+확대 + 기준 배율 기록
      else { setLon(CENTER_LON); svgRef.current && select(svgRef.current).transition().duration(500).call(zoomRef.current.transform, zoomIdentity); }
      return next;
    });
  }, [flyRegion]);

  // ── 선택(개체)/hover ──
  const [sel, setSel] = useState<EntitySel | null>(null);
  const [hoverCty, setHoverCty] = useState<number | null>(null);
  const [hoverInfra, setHoverInfra] = useState<{ kind: "route" | "choke" | "port"; id: string } | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string; sub?: string } | null>(null);

  const goTo = useCallback((ent: EntitySel) => {
    setSel(ent);
    if (ent.kind === "country") flyFeatureCentered(features[ent.idx]);
    else if (ent.kind === "port") { const p = portById.get(ent.id); if (p) flyPoint(p.lng, p.lat); }
    else if (ent.kind === "choke") { const c = chokeById.get(ent.id); if (c) flyPoint(c.lng, c.lat); }
    else if (ent.kind === "route") { const r = routeById.get(ent.id); if (r) flyRoute(r); }
  }, [features, portById, chokeById, routeById, flyFeatureCentered, flyPoint, flyRoute]);

  // 하이라이트 집합(선택 개체가 인프라면 그 기준, 아니면 hover 인프라)
  const focus = (sel && sel.kind !== "country" ? sel : hoverInfra) as { kind: "route" | "choke" | "port"; id: string } | null;
  const { hlRoutes, hlChokes, hlPorts } = useMemo(() => {
    // compareSet(목록 체크박스) = 상시 다중 하이라이트, focus(클릭·hover) = 단독 강조. 둘의 합집합.
    const R = new Set<string>(compareSet), C = new Set<string>(), P = new Set<string>();
    if (focus) {
      if (focus.kind === "route") R.add(focus.id);
      else { (focus.kind === "choke" ? C : P).add(focus.id); (routesByNode.get(focus.id) ?? []).forEach((rid) => R.add(rid)); }
    }
    // 하이라이트된 모든 항로의 경유지(해협·항만)도 함께 켠다 — 비교 시 경유지 대조가 핵심.
    for (const rid of R) { const r = routeById.get(rid); r?.waypoints.forEach((w) => (w.type === "chokepoint" ? C : P).add(w.ref)); }
    return { hlRoutes: R, hlChokes: C, hlPorts: P };
  }, [focus, compareSet, routeById, routesByNode]);
  const hasFocus = hlRoutes.size + hlChokes.size + hlPorts.size > 0;
  // 스케일 서사 분리(§A): 국가 뷰 = 면 채색/귀속, 사이트 줌 = 생산→송전→DC 흐름(연결선·애니메이션·스냅)
  const dcSiteZoom = dcMode && t.k >= dcBaseKRef.current * DC_SITE_ZOOM_MULT;

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
      <style>{`@keyframes wf-flow{to{stroke-dashoffset:-24}}.wf-flow{animation:wf-flow 1s linear infinite}`}</style>
      <svg ref={svgRef} width="100%" height="100%" viewBox={`0 0 ${dim.w} ${dim.h}`}
        className="block cursor-grab active:cursor-grabbing select-none"
        onPointerDown={onSpinDown} onPointerMove={onSpinMove} onPointerUp={onSpinUp} onPointerLeave={onSpinUp}
        onClick={() => { if (draggedRef.current) { draggedRef.current = false; return; } setSel(null); }}>
        <path d={spherePath} fill="hsl(var(--background))" stroke="hsl(var(--border))" strokeOpacity={0.6} />
        <g transform={`translate(${t.x},${t.y}) scale(${t.k})`}>
          {/* 육지 */}
          {features.map((f, i) => {
            const isSel = isSelCty(i), isNb = selCtyNeighbors.has(i), isHov = i === hoverCty;
            const fill = isSel ? TEAL : isNb ? "rgba(13,148,136,0.28)" : isHov ? "hsl(var(--muted))" : "hsl(var(--card))";
            return (
              <path key={i} d={paths[i]} fill={fill} stroke="hsl(var(--border))" strokeWidth={0.5 / t.k}
                style={{ cursor: "pointer", transition: "fill 0.12s" }}
                onClick={(e) => { e.stopPropagation(); if (draggedRef.current) { draggedRef.current = false; return; } goTo({ kind: "country", idx: i }); }}
                onMouseEnter={(e) => { setHoverCty(i); setTip({ x: e.clientX, y: e.clientY, text: f.properties.ko || f.properties.en }); }}
                onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, text: f.properties.ko || f.properties.en })}
                onMouseLeave={() => { setHoverCty(null); setTip(null); }} />
            );
          })}
          {/* DC 모드: 미국 주 경계 오버레이 */}
          {/* 국가 뷰 면 채색 §B — 주별 AI 부하 비중 램프 */}
          {dcMode && dcFill === "load" && usStates.map((f: any, i: number) => { const ab = US_NAME_ABBR[f.properties?.name]; const share = ab ? stateLoadShare.get(ab) : undefined; if (share == null) return null;
            return <path key={`fill${i}`} d={usStatePaths[i]} fill={loadFillColor(share)} stroke="none" style={{ cursor: "default" }}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY, text: `${US_STATE_KO[f.properties.name] || f.properties.name} · AI 부하 ${share.toFixed(0)}%`, sub: "주 평균 전력부하 대비(EIA 2023 소매판매÷8760)" })}
              onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, text: `${US_STATE_KO[f.properties.name] || f.properties.name} · AI 부하 ${share.toFixed(0)}%`, sub: "주 평균 전력부하 대비(EIA 2023)" })}
              onMouseLeave={() => setTip(null)} />; })}
          {dcMode && usStates.map((f: any, i: number) => <path key={`us${i}`} d={usStatePaths[i]} fill="none" stroke="hsl(var(--muted-foreground))" strokeOpacity={0.35} strokeWidth={0.5 / t.k} style={{ pointerEvents: "none" }} />)}
          {/* 송전선 345kV+ (기존 계통 2022 · 배경층). 무채색 — '배경은 회색, 색은 신호'(§D) */}
          {txPath && <path d={txPath} fill="none" stroke="hsl(var(--muted-foreground))" strokeOpacity={0.3} strokeWidth={0.7 / t.k} strokeLinejoin="round" strokeLinecap="round" style={{ pointerEvents: "none" }} />}
          {dcMode && usStateLabels.map((l: any, i: number) => (
            <text key={`usl${i}`} x={l.c[0]} y={l.c[1]} textAnchor="middle" dominantBaseline="middle" fontSize={8 / t.k} fontWeight={500} fill="hsl(var(--muted-foreground))" fillOpacity={0.75}
              style={{ paintOrder: "stroke", stroke: "hsl(var(--background))", strokeWidth: 2.5 / t.k, strokeLinejoin: "round", pointerEvents: "none" }}>{l.ko}</text>
          ))}
          {/* L2 항로 — 항로별 색. 선택/hover 시 진하게+흐름 애니메이션, 나머지 감쇠 */}
          {!dcMode && layers.routes && infra.routes.map((r, i) => {
            const on = hlRoutes.has(r.id); const dim2 = hasFocus && !on;
            return (
              <path key={`r${i}`} d={routePaths[i]} fill="none" stroke={routeColor(r.id)} strokeLinecap="round"
                className={on ? "wf-flow" : undefined}
                strokeWidth={(on ? 2.4 : 1.4) / t.k} strokeOpacity={dim2 ? 0.1 : on ? 0.95 : 0.72}
                strokeDasharray={`${(on ? 6 : 4) / t.k} ${3 / t.k}`} style={{ pointerEvents: "none" }} />
            );
          })}
        </g>

        {/* 국가 라벨 */}
        <g style={{ pointerEvents: "none" }}>
          {features.map((f, i) => {
            const show = isSelCty(i) || i === hoverCty || t.k >= K_REGION || worldLabelSet.has(i);
            if (!show) return null;
            const sc = toScreen(f.properties.lx, f.properties.ly); if (!sc || !inView(sc[0], sc[1])) return null;
            return (
              <text key={i} x={sc[0]} y={sc[1]} textAnchor="middle" fontSize={isSelCty(i) ? 12 : 10.5}
                fontWeight={isSelCty(i) ? 700 : 500} fill={isSelCty(i) ? TEAL : "hsl(var(--foreground))"}
                style={{ paintOrder: "stroke", stroke: "hsl(var(--background))", strokeWidth: 3, strokeLinejoin: "round" }}>{f.properties.ko}</text>
            );
          })}
        </g>

        {/* 항로 이름 라벨(경로 중간) — 클릭/hover로 항로 선택·하이라이트 */}
        {!dcMode && layers.routes && infra.routes.map((r, i) => {
          const mid = r.coords[Math.floor(r.coords.length / 2)]; const sc = toScreen(mid[0], mid[1]);
          if (!sc || !inView(sc[0], sc[1]) || t.k >= K_LOCAL) return null;
          const on = hlRoutes.has(r.id); if (hasFocus && !on) return null;
          return (
            <text key={`rl${i}`} x={sc[0]} y={sc[1] - 4} textAnchor="middle" fontSize={on ? 11 : 9.5} fontWeight={on ? 700 : 500} fill={routeColor(r.id)}
              style={{ paintOrder: "stroke", stroke: "hsl(var(--background))", strokeWidth: 3, strokeLinejoin: "round", cursor: "pointer" }}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseEnter={(e) => { setHoverInfra({ kind: "route", id: r.id }); setTip({ x: e.clientX, y: e.clientY, text: `➤ ${r.ko}`, sub: r.direction_note }); }}
              onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, text: `➤ ${r.ko}`, sub: r.direction_note })}
              onMouseLeave={() => { setHoverInfra(null); setTip(null); }}
              onClick={(e) => { e.stopPropagation(); if (draggedRef.current) { draggedRef.current = false; return; } goTo({ kind: "route", id: r.id }); }}>{r.ko}</text>
          );
        })}

        {/* 수도 점은 지도에서 제거(시각 복잡도↓). 수도 정보는 국가 카드·검색에서만 유지. */}

        {/* L2 항만 — 면적 ∝ TEU, 순위 뱃지. 세계뷰=클러스터 top / 권역+=전부 */}
        {!dcMode && layers.ports && infra.ports.map((p) => {
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

        {/* L2 해협 — 2계급 다이아. 1급 세계 라벨 상시, 2급 권역 라벨 */}
        {!dcMode && layers.chokes && infra.chokepoints.map((c) => {
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
          return <line key={`snap${sl.id}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#64748b" strokeOpacity={0.7} strokeWidth={1} strokeDasharray="1.5 2" style={{ pointerEvents: "none" }} />; })}

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

        {/* DC 모드: 원전·SMR PPA(회사 단위 — 선 안 이음) */}
        {dcMode && dcNuke && dc.nuclear_deals.map((n) => { const sc = toScreen(n.location.lng, n.location.lat); if (!sc || !inView(sc[0], sc[1])) return null;
          return (<g key={`n${n.id}`} style={{ cursor: "pointer" }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY, text: `⚛ ${n.plant}`, sub: `${n.buyer} · ${n.mw}MW · ${n.reactor_type}` })}
            onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, text: `⚛ ${n.plant}`, sub: `${n.buyer} · ${n.mw}MW` })}
            onMouseLeave={() => setTip(null)}>
            <circle cx={sc[0]} cy={sc[1]} r={4.5} fill="none" stroke="#a855f7" strokeWidth={1.4} strokeDasharray={n.site_bound ? undefined : "2 1.5"} />
            <text x={sc[0]} y={sc[1] + 2.6} textAnchor="middle" fontSize={6} fill="#a855f7" fontWeight={700} style={{ pointerEvents: "none" }}>⚛</text>
          </g>); })}

        {/* DC 모드: 데이터센터 마커 */}
        {dcMode && dcSites.filter((s) => dcGroups[s.group]).map((s) => {
          const sc = toScreen(s.location.lng!, s.location.lat!); if (!sc || !inView(sc[0], sc[1])) return null;
          const on = s.id === dcSel; const col = dcColorOf(s); const r = dcMarkerR(s); const GenI = GEN_ICON[primaryGen(s.power)];
          const frac = gridShareFrac(s.power?.grid_share); const RR = r + 3.2; const CIRC = 2 * Math.PI * RR;
          return (<g key={`dc${s.id}`} style={{ cursor: "pointer" }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); if (draggedRef.current) { draggedRef.current = false; return; } setDcSel(s.id); }}
            onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY, text: s.name, sub: `${s.location.city}, ${s.location.state} · ${capMW(s) ?? "?"}MW · ${s.power?.grid_operator ?? ""}` })}
            onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, text: s.name, sub: `${s.location.city}, ${s.location.state}` })}
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

      {/* 상단 중앙: 모드 전환(세계·무역 ↔ 미국 데이터센터) */}
      <div className="absolute left-1/2 top-4 -translate-x-1/2">
        <div className="flex rounded-full border border-border bg-card/90 p-0.5 text-[11.5px] shadow-sm backdrop-blur">
          <button onClick={() => { if (dcMode) toggleDc(); }} className={`flex items-center gap-1 rounded-full px-3 py-1 ${!dcMode ? "bg-muted font-semibold" : "text-muted-foreground hover:bg-muted/50"}`}><Globe className="h-3.5 w-3.5" />세계·무역</button>
          <button onClick={() => { if (!dcMode) toggleDc(); }} className={`flex items-center gap-1 rounded-full px-3 py-1 ${dcMode ? "bg-muted font-semibold" : "text-muted-foreground hover:bg-muted/50"}`}><Server className="h-3.5 w-3.5" />미국 데이터센터</button>
        </div>
      </div>

      {/* 우상: L2 층 토글 */}
      {!dcMode && (
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

      {/* 좌하: 권역 프리셋 */}
      {!dcMode && (
      <div className="absolute bottom-4 left-4 flex max-w-[16rem] flex-wrap gap-1">
        {REGIONS.map((r) => (<button key={r.name} onClick={() => { setSel(null); flyRegion(r); }} className="rounded-full border border-border bg-card/90 px-2.5 py-1 text-[11px] shadow-sm backdrop-blur hover:bg-muted">{r.name}</button>))}
      </div>
      )}

      {/* 우하: 줌 컨트롤 */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-1">
        <button onClick={() => zoomBy(1.6)} className="h-9 w-9 rounded-md border border-border bg-card/90 shadow-sm backdrop-blur hover:bg-muted"><Plus className="mx-auto h-4 w-4" /></button>
        <button onClick={() => zoomBy(1 / 1.6)} className="h-9 w-9 rounded-md border border-border bg-card/90 shadow-sm backdrop-blur hover:bg-muted"><Minus className="mx-auto h-4 w-4" /></button>
        <button onClick={() => { setLon(CENTER_LON); svgRef.current && select(svgRef.current).transition().duration(400).call(zoomRef.current.transform, zoomIdentity); }} className="h-9 w-9 rounded-md border border-border bg-card/90 shadow-sm backdrop-blur hover:bg-muted" title="세계 뷰"><Locate className="mx-auto h-4 w-4" /></button>
      </div>

      {/* 주요 항로 목록/범례 — 접기 가능(향후 층위 위해 상시 점유 안 함). 색=항로 신원 */}
      {!dcMode && layers.routes && (
        <div className="absolute left-4 top-[4.75rem] w-56 rounded-md border border-border bg-card/90 shadow-sm backdrop-blur">
          <button onClick={() => setListOpen((o) => !o)} className="flex w-full items-center justify-between px-2.5 py-1.5 text-[11px] font-semibold hover:bg-muted/50">
            <span>주요 항로 <span className="font-normal text-muted-foreground">{infra.routes.length}</span>{compareSet.size > 0 && <span className="ml-1 text-primary">· 비교 {compareSet.size}</span>}</span>
            <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${listOpen ? "" : "-rotate-90"}`} />
          </button>
          {listOpen && (
            <div className="border-t border-border py-1">
              {infra.routes.map((r) => { const cmp = compareSet.has(r.id); const on = hlRoutes.has(r.id) || (sel?.kind === "route" && sel.id === r.id);
                return (<div key={r.id} onMouseEnter={() => setHoverInfra({ kind: "route", id: r.id })} onMouseLeave={() => setHoverInfra(null)}
                  className={`flex items-center gap-1.5 pl-2 pr-2.5 text-[11.5px] ${on ? "bg-muted" : "hover:bg-muted/60"}`}>
                  <input type="checkbox" checked={cmp} onChange={() => toggleCompare(r.id)} title="비교에 켜기 (여러 개 동시 선택)" className="h-3 w-3 shrink-0 cursor-pointer" style={{ accentColor: routeColor(r.id) }} />
                  <button onClick={() => goTo({ kind: "route", id: r.id })} className={`flex flex-1 items-center gap-2 py-0.5 text-left ${on ? "font-semibold" : ""}`} title="클릭 = 단독 보기(카드)">
                    <span className="h-2 w-3 shrink-0 rounded-sm" style={{ background: routeColor(r.id) }} /><span className="truncate">{r.ko}</span></button></div>); })}
              {compareSet.size > 0 && (
                <div className="mt-0.5 border-t border-border px-2.5 pt-1">
                  <button onClick={() => setCompareSet(new Set())} className="text-[10.5px] text-muted-foreground hover:text-foreground">비교 전체 해제 ✕</button>
                </div>
              )}
              <div className="mt-0.5 border-t border-border px-2.5 pt-1 text-[10px] leading-tight text-muted-foreground">체크 = 여러 항로 동시 비교 · 이름 클릭 = 단독 카드</div>
            </div>
          )}
        </div>
      )}

      {/* 개체 카드 — 유형별 필드, 칩 = 크로스링크 */}
      {sel && (
        <div className="absolute right-4 top-16 w-72 rounded-lg border border-border bg-card/95 p-3.5 shadow-lg backdrop-blur">
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
          {sel.kind === "port" && (() => { const p = portById.get(sel.id)!; const ctyIdx = isoToIdx.get(p.country_iso); const rts = (routesByNode.get(p.id) ?? []).map((id) => routeById.get(id)!).filter(Boolean);
            return (<>
              <div className="flex items-center gap-1.5"><Anchor className="h-4 w-4" style={{ color: SEA }} /><span className="text-base font-bold leading-tight">{p.ko}</span></div>
              <div className="text-[11px] text-muted-foreground">{p.en}</div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
                <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold" style={{ color: SEA }}>세계 {p.rank}위</span>
                <span className="tabular-nums">{p.teu_m}M TEU</span><span className="text-[10.5px] text-muted-foreground">({infra._meta.data_year} 기준)</span>
              </div>
              {ctyIdx != null && <div className="mt-2 text-[11px] text-muted-foreground">소속 국가 <Chip color={TEAL} onClick={() => goTo({ kind: "country", idx: ctyIdx })}>{features[ctyIdx].properties.ko}</Chip></div>}
              {rts.length > 0 && <div className="mt-2"><div className="mb-1 text-[11px] text-muted-foreground">지나는 항로</div><div className="flex flex-wrap gap-1">{rts.map((r) => <Chip key={r.id} color={routeColor(r.id)} onClick={() => goTo({ kind: "route", id: r.id })}>{r.ko}</Chip>)}</div></div>}
              <Src url={`https://lloydslist.com`} label={infra._meta.teu_source} />
            </>); })()}
          {sel.kind === "choke" && (() => { const c = chokeById.get(sel.id)!; const rts = (routesByNode.get(c.id) ?? []).map((id) => routeById.get(id)!).filter(Boolean);
            return (<>
              <div className="flex items-center gap-1.5"><Diamond className="h-4 w-4" style={{ color: AMBER }} /><span className="text-base font-bold leading-tight">{c.ko}</span>
                <span className="rounded px-1 py-0.5 text-[9px] font-semibold" style={{ background: AMBER + "22", color: AMBER }}>{c.tier === 1 ? "1급" : "2급"}</span></div>
              <div className="text-[11px] text-muted-foreground">{c.en}</div>
              <div className="mt-2 text-[12px]"><span className="text-muted-foreground">연결</span> {c.connects}</div>
              <div className="mt-1.5 text-[11.5px] leading-snug">{c.throughput_note}</div>
              {rts.length > 0 && <div className="mt-2"><div className="mb-1 text-[11px] text-muted-foreground">지나는 항로</div><div className="flex flex-wrap gap-1">{rts.map((r) => <Chip key={r.id} color={routeColor(r.id)} onClick={() => goTo({ kind: "route", id: r.id })}>{r.ko}</Chip>)}</div></div>}
              <Src url={c.source_url} />
            </>); })()}
          {sel.kind === "route" && (() => { const r = routeById.get(sel.id)!; const alt = r.alt_of ? routeById.get(r.alt_of) : null;
            return (<>
              <div className="flex items-center gap-1.5"><Route className="h-4 w-4" style={{ color: routeColor(r.id) }} /><span className="text-base font-bold leading-tight">{r.ko}</span></div>
              <div className="mt-2"><div className="mb-1 text-[11px] text-muted-foreground">경유지 (순서)</div>
                <div className="flex flex-wrap items-center gap-1">{r.waypoints.map((w, wi) => { const node = w.type === "port" ? portById.get(w.ref) : chokeById.get(w.ref); if (!node) return null;
                  return (<span key={wi} className="flex items-center gap-1">{wi > 0 && <span className="text-muted-foreground">›</span>}<Chip color={w.type === "port" ? SEA : AMBER} onClick={() => goTo(w.type === "port" ? { kind: "port", id: w.ref } : { kind: "choke", id: w.ref })}>{node.ko}</Chip></span>); })}</div></div>
              <div className="mt-2 text-[11.5px] leading-snug"><span className="text-muted-foreground">방향</span> {r.direction_note} <span className="text-[10.5px] text-muted-foreground">· 양방향(주 무역 흐름 기준)</span></div>
              {r.facts && <div className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">{r.facts}</div>}
              {alt && <div className="mt-2 text-[11px] text-muted-foreground">대체 관계 <Chip color={routeColor(alt.id)} onClick={() => goTo({ kind: "route", id: alt.id })}>{alt.ko}</Chip></div>}
              <Src url={r.source_url} />
            </>); })()}
        </div>
      )}

      {/* ── 데이터센터 모드 패널 ── */}
      {dcMode && (<>
        <div className="absolute left-4 top-16 w-60 space-y-2">
          <div className="rounded-md border border-border bg-card/90 p-2.5 shadow-sm backdrop-blur">
            <div className="flex items-center gap-1.5 text-sm font-bold"><Server className="h-4 w-4" /> 미국 AI 데이터센터</div>
            <div className="text-[10.5px] text-muted-foreground">{dc.meta.as_of} · {dcSites.length}개 · 소유·자금·전력</div>
            <div className="mt-2 text-[10.5px] text-muted-foreground">색 기준</div>
            <div className="mt-0.5 flex overflow-hidden rounded border border-border text-[11px]">
              {(["group", "grid", "credit"] as DcMode[]).map((m) => (<button key={m} onClick={() => setDcColor(m)} className={`flex-1 px-1.5 py-0.5 ${dcColor === m ? "bg-muted font-semibold" : "text-muted-foreground hover:bg-muted/50"}`}>{m === "group" ? "그룹" : m === "grid" ? "전력계통" : "신용등급"}</button>))}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {(["A", "B", "C"] as const).map((g) => (<button key={g} onClick={() => setDcGroups((o) => ({ ...o, [g]: !o[g] }))} className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] ${dcGroups[g] ? "border-border bg-muted/40" : "border-border/40 opacity-45"}`}><span className="h-2 w-2 rounded-full" style={{ background: GROUP_COLOR[g] }} />{g} {GROUP_LABEL[g]}</button>))}
            </div>
            <label className="mt-2 flex items-center gap-1.5 text-[11px]"><input type="checkbox" checked={dcNuke} onChange={(e) => setDcNuke(e.target.checked)} className="accent-purple-500" /><Atom className="h-3 w-3 text-purple-500" />원전·SMR PPA ({dc.nuclear_deals.length})</label>
            <label className="mt-1 flex items-center gap-1.5 text-[11px]"><input type="checkbox" checked={dcTx} onChange={(e) => setDcTx(e.target.checked)} className="accent-blue-500" /><Zap className="h-3 w-3 text-blue-500" />송전선 345kV+ · 계통 스냅</label>
            <div className="mt-2 flex items-center gap-1 text-[10.5px] text-muted-foreground">면 채색<span title="AI 부하 비중 = 주내 AI DC 목표부하 합 ÷ 주 평균 전력부하(EIA 2023 소매판매량÷8760). RTO 권역 채색은 폴리곤 확보 후." className="cursor-help">ⓘ</span></div>
            <div className="mt-0.5 flex overflow-hidden rounded border border-border text-[11px]">
              {([["none", "없음"], ["load", "AI 부하 비중"]] as const).map(([m, lab]) => (<button key={m} onClick={() => setDcFill(m)} className={`flex-1 px-1.5 py-0.5 ${dcFill === m ? "bg-muted font-semibold" : "text-muted-foreground hover:bg-muted/50"}`}>{lab}</button>))}
            </div>
            {dcFill === "load" && (<div className="mt-1 flex items-center gap-1 text-[9.5px] text-muted-foreground"><span>낮음</span><span className="h-2 flex-1 rounded-sm" style={{ background: "linear-gradient(90deg, rgba(245,158,11,0.15), rgba(234,88,12,0.35), rgba(220,38,38,0.6))" }} /><span>높음 (부하 비중)</span></div>)}
          </div>
          <div className="rounded-md border border-border bg-card/90 p-2.5 text-[10.5px] shadow-sm backdrop-blur">
            <div className="mb-1 font-semibold">{dcColor === "group" ? "그룹" : dcColor === "grid" ? "전력계통(ISO)" : "신용등급(래퍼)"}</div>
            {dcColor === "group" && (["A", "B", "C"] as const).map((g) => <div key={g} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: GROUP_COLOR[g] }} />{g} · {GROUP_LABEL[g]}</div>)}
            {dcColor === "grid" && [["ERCOT", "텍사스"], ["PJM", "동부"], ["MISO", "중서부"], ["SPP", "대평원"], ["비ISO", "TVA·WECC 등"]].map(([k, v]) => <div key={k} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: gridColor(k) }} />{k} · {v}</div>)}
            {dcColor === "credit" && [["A~AAA", "#16a34a", "투자등급"], ["BBB-", "#f59e0b", "취약 IG(오라클)"], ["BB", "#dc2626", "정크"], ["미평가", "#94a3b8", "비상장"]].map(([k, c, v]) => <div key={k} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />{k} · {v}</div>)}
            <div className="mt-1.5 flex items-center gap-2 border-t border-border/50 pt-1.5 text-muted-foreground"><span className="flex items-center gap-1"><Flame className="h-3 w-3" />가스</span><span className="flex items-center gap-1"><Atom className="h-3 w-3" />원전</span><span className="flex items-center gap-1"><Zap className="h-3 w-3" />계통</span></div>
            <div className="mt-1 text-[9.5px] leading-tight text-muted-foreground">원 크기 = 용량 · 외곽 링 = 계통 의존도(꽉 참=100% 계통, 빈 링=현장발전 위주, 점선=미공개) · 점선 원판 = 페르미</div>
            <div className="mt-1.5 border-t border-border/50 pt-1.5 text-[9.5px] leading-tight text-muted-foreground">
              <div className="flex items-center gap-1"><span className="inline-block h-0 w-4 border-t-2 border-dashed" style={{ borderColor: "#f97316" }} /><b>①물리</b> 흐름 애니메이션 = 실제 조류 · <span className="inline-block h-0 w-4 border-t border-dotted" style={{ borderColor: "#16a34a" }} /><b>②계약</b> 물리 조류 아님</div>
              <div className="mt-0.5">▪ 발전소(사각) = ①·② 관련만 · <span style={{ color: "#3b82f6" }}>─</span> 송전선 <b>기존 계통 2022 기준</b>(신설선 미포함)</div>
              <div className="mt-0.5">③ 계통 스냅 점선 = <b>근사</b> — 실제 인입선·변전소 비공개. RTO 권역 채색은 후속(데이터 잠김)</div>
            </div>
          </div>
        </div>

        <div className="absolute bottom-4 left-4 w-72">
          <button onClick={() => setDcNotes((o) => !o)} className="flex w-full items-center gap-1.5 rounded-md border border-border bg-card/90 px-2.5 py-1.5 text-[11px] font-semibold shadow-sm backdrop-blur hover:bg-muted"><Info className="h-3.5 w-3.5" />구조 해설 {dcNotes ? "▾" : "▸"}</button>
          {dcNotes && <div className="mt-1 space-y-1.5 rounded-md border border-border bg-card/95 p-2.5 text-[11px] leading-snug shadow-sm backdrop-blur">{dc.analysis_notes.map((n, i) => <div key={i} className="text-muted-foreground">· {n}</div>)}</div>}
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
