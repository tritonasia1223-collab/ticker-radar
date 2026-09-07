// 세계 현황판 L4 분쟁 층 — UCDP GED 연간판 → 활성 분쟁 집계 정적 데이터 (분쟁 명세 §2·§3·§8.1)
//   실행:  npm run conflicts:build
//   소스:  UCDP GED v26.1 연간 CSV(무료·토큰 불요). 월간 Candidate 는 토큰 필요라 후속(GED 로 v1).
//          인용(다운로드 페이지 요구): Davies, Engström, Pettersson & Öberg (2024) JPR; Sundberg & Melander (2013) JPR.
//   산출:  client/src/data/world-conflicts.json  { _meta, conflicts:[...] }
//   원칙:  intensity·active·진앙은 이벤트 집계에서 자동 산출(수동 등급 금지). 진앙=직전 12개월 이벤트 기하중앙값(Weiszfeld).
//          이벤트 분포 캐시(권역 줌용)는 별도 후속(세계 뷰는 진앙만 — 수천 점 소음 방지).
import { unzipSync, strFromU8 } from "fflate";
import { geoArea } from "d3-geo";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "client/src/data/world-conflicts.json");
const ZIP = "https://ucdp.uu.se/downloads/ged/ged261-csv.zip";
const CSV = "GEDEvent_v26_1.csv";
const TYPE: Record<string, string> = { "1": "state", "2": "nonstate", "3": "onesided" };
// Gleditsch-Ward 국가번호 → ISO3 (활성 분쟁에 등장하는 국가 중심 + 주요국)
const GW_ISO: Record<string, string> = {
  "2": "USA", "20": "CAN", "40": "CUB", "41": "HTI", "42": "DOM", "70": "MEX", "100": "COL", "101": "VEN", "130": "ECU", "135": "PER", "140": "BRA",
  "200": "GBR", "220": "FRA", "255": "DEU", "290": "POL", "365": "RUS", "369": "UKR", "372": "GEO", "373": "AZE", "375": "FIN",
  "432": "MLI", "433": "SEN", "434": "BEN", "436": "NER", "437": "CIV", "439": "BFA", "450": "LBR", "451": "SLE", "461": "TGO", "471": "CMR", "475": "NGA", "482": "CAF", "483": "TCD", "484": "COG", "490": "COD", "500": "UGA", "501": "UGA", "510": "TZA", "516": "BDI", "517": "RWA", "520": "SOM", "522": "DJI", "530": "ETH", "531": "ERI", "540": "AGO", "541": "MOZ", "551": "ZMB", "552": "ZWE", "560": "ZAF",
  "600": "MAR", "615": "DZA", "620": "LBY", "625": "SDN", "626": "SSD", "630": "IRN", "640": "TUR", "645": "IRQ", "651": "EGY", "652": "SYR", "660": "LBN", "663": "JOR", "666": "ISR", "670": "SAU", "678": "YEM", "679": "YEM", "690": "KWT",
  "700": "AFG", "701": "TKM", "702": "TJK", "703": "KGZ", "704": "UZB", "705": "KAZ", "710": "CHN", "712": "MNG", "713": "TWN", "731": "PRK", "732": "KOR", "740": "JPN", "750": "IND", "770": "PAK", "771": "BGD", "775": "MMR", "780": "LKA", "790": "NPL", "800": "THA", "811": "KHM", "812": "LAO", "816": "VNM", "820": "MYS", "840": "PHL", "850": "IDN",
};
// 한글 이름 오버라이드(conflict_name 영문 → 한글). 미매핑은 영문 폴백. 주요 분쟁부터, 점진 확장.
const NAME_KO: Record<string, string> = {
  "Russia - Ukraine": "러시아–우크라이나", "Israel: Palestine": "이스라엘–팔레스타인", "Iran - Israel": "이란–이스라엘",
  "Sudan: Government": "수단 내전", "DR Congo (Zaire): Government": "DR콩고 내전", "Ethiopia: Government/Amhara": "에티오피아(암하라)",
  "Somalia: Government": "소말리아 내전", "Burkina Faso: Government": "부르키나파소 내전", "Pakistan: Government": "파키스탄 반군",
  "Myanmar (Burma): Government": "미얀마 내전", "Haiti: Government": "아이티 무장세력", "Mali: Government": "말리 내전",
  "Nigeria: Islamic State": "나이지리아(IS)", "Nigeria: Government": "나이지리아 내전", "Syria: Government": "시리아",
  "Afghanistan: Government": "아프가니스탄", "Iraq: Government": "이라크", "Yemen (North Yemen): Government": "예멘 내전",
  "Cameroon: Government": "카메룬(암바조니아)", "Mozambique: Government": "모잠비크(카보델가도)", "Colombia: Government": "콜롬비아",
  "India: Kashmir": "인도(카슈미르)", "Turkey: Kurdistan": "튀르키예(쿠르드)", "Philippines: Mindanao": "필리핀(민다나오)",
  "Niger: Government": "니제르", "Central African Republic: Government": "중앙아프리카공화국", "South Sudan: Government": "남수단",
};
const koName = (en: string) => NAME_KO[en] ?? en;

function* parseCSV(text: string): Generator<string[]> {
  let field = "", row: string[] = [], q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else { if (c === '"') q = true; else if (c === ",") { row.push(field); field = ""; } else if (c === "\n") { row.push(field); yield row; row = []; field = ""; } else if (c !== "\r") field += c; }
  }
  if (field.length || row.length) { row.push(field); yield row; }
}
// Weiszfeld 기하중앙값(이상치에 강함 — 진앙 근사)
function geoMedian(pts: [number, number][]): [number, number] {
  if (pts.length === 1) return pts[0];
  let [x, y] = pts.reduce(([ax, ay], [px, py]) => [ax + px, ay + py], [0, 0]).map((s) => s / pts.length) as [number, number];
  for (let it = 0; it < 60; it++) {
    let nx = 0, ny = 0, w = 0;
    for (const [px, py] of pts) { const d = Math.hypot(px - x, py - y) || 1e-9; nx += px / d; ny += py / d; w += 1 / d; }
    const ax = nx / w, ay = ny / w;
    if (Math.hypot(ax - x, ay - y) < 1e-7) { x = ax; y = ay; break; }
    x = ax; y = ay;
  }
  return [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4];
}
// 분쟁 구역 = 이벤트 볼록 헐(국가 전체 아님). 이상치(먼 단발 타격) 제거 후 헐 — 전장 코어만 남김.
function convexHull(points: [number, number][]): [number, number][] {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  const upper: [number, number][] = [];
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}
const r3 = (p: number[]): [number, number] => [Math.round(p[0] * 1e3) / 1e3, Math.round(p[1] * 1e3) / 1e3];
// 사건 점 캐시(상세 뷰 재생용) — 시간순 균등 씨닝, 상한. 좌표 2자리·날짜 일 단위.
function thinEvents(evs: { lng: number; lat: number; ms: number; best: number }[], cap: number) {
  const sorted = evs.slice().sort((a, b) => a.ms - b.ms);
  let sel = sorted;
  if (sorted.length > cap) { sel = []; const step = sorted.length / cap; for (let i = 0; i < sorted.length; i += step) sel.push(sorted[Math.floor(i)]); }
  return sel.map((e) => ({ c: [Math.round(e.lng * 100) / 100, Math.round(e.lat * 100) / 100], d: new Date(e.ms).toISOString().slice(0, 10), b: e.best }));
}
function conflictZone(coords: [number, number][], ep: [number, number]): [number, number][] | null {
  if (coords.length < 4) return null;
  const dists = coords.map((p) => Math.hypot(p[0] - ep[0], p[1] - ep[1])).sort((a, b) => a - b);
  const thr = dists[Math.floor(dists.length * 0.85)] || Infinity; // 코어 85% (먼 타격 제거)
  const core = coords.filter((p) => Math.hypot(p[0] - ep[0], p[1] - ep[1]) <= thr);
  if (core.length < 3) return null;
  const hull = convexHull(core).map(r3);
  if (hull.length < 3) return null;
  const close = (h: [number, number][]) => [...h, h[0]];
  let ring = close(hull);
  // d3-geo 구면 winding — 반대로 감기면 '전 구면 − 구역'(전체 채색). geoArea>2π 면 뒤집음.
  if (geoArea({ type: "Polygon", coordinates: [ring] } as any) > 2 * Math.PI) ring = close(hull.slice().reverse());
  return ring;
}

async function main() {
  console.log("[conflicts:build] UCDP GED v26.1 받는 중…");
  const buf = new Uint8Array(await (await fetch(ZIP, { headers: { "User-Agent": "Mozilla/5.0 ticker-radar conflict-layer build" } })).arrayBuffer());
  const text = strFromU8(unzipSync(buf)[CSV]);
  let H: Record<string, number> | null = null;
  type P = { name: string; iso: string | null };
  type Rec = { name: string; type: string; ev: { lng: number; lat: number; ms: number; best: number }[]; parties: Map<string, P>; start: number };
  const rec = new Map<string, Rec>();
  let maxMs = 0, total = 0;
  for (const row of parseCSV(text)) {
    if (!H) { H = {}; row.forEach((h, i) => (H![h] = i)); continue; }
    if (row.length < 5) continue;
    total++;
    const cid = row[H.conflict_new_id]; const year = +row[H.year];
    let r = rec.get(cid);
    if (!r) { r = { name: row[H.conflict_name], type: row[H.type_of_violence], ev: [], parties: new Map(), start: year }; rec.set(cid, r); }
    if (year < r.start) r.start = year;
    if (year >= 2024) {
      const ms = Date.parse(row[H.date_start]); if (ms > maxMs) maxMs = ms;
      const lat = +row[H.latitude], lng = +row[H.longitude];
      if (Number.isFinite(lat) && Number.isFinite(lng)) r.ev.push({ lng, lat, ms, best: +row[H.best] || 0 });
      for (const [side, gw] of [[row[H.side_a], row[H.gwnoa]], [row[H.side_b], row[H.gwnob]]] as [string, string][]) {
        if (side && !r.parties.has(side)) r.parties.set(side, { name: side, iso: gw && GW_ISO[gw] ? GW_ISO[gw] : null });
      }
    }
  }
  const win = maxMs - 365 * 864e5;
  const conflicts: any[] = [];
  for (const [cid, r] of rec) {
    const w = r.ev.filter((e) => e.ms >= win);
    if (!w.length) continue;
    const deaths = w.reduce((s, e) => s + e.best, 0);
    if (deaths < 25) continue; // UCDP 무력분쟁 최소 문턱
    const parties = [...r.parties.values()].map((p) => ({ ...p, is_state: !!p.iso }));
    const partyIsos = [...new Set(parties.map((p) => p.iso).filter(Boolean))];
    const lastMs = w.reduce((m, e) => Math.max(m, e.ms), 0);
    const type = TYPE[r.type] ?? "state";
    // category(파생): 국가간(당사국 2개+) / 내전(국가 vs 반군) / 무장세력(비국가) / 대민간폭력(일방)
    const category = type === "state" ? (partyIsos.length >= 2 ? "interstate" : "civil") : type === "nonstate" ? "nonstate" : "onesided";
    const coords = w.map((e) => [e.lng, e.lat] as [number, number]);
    const epicenter = geoMedian(coords);
    conflicts.push({
      id: cid, ucdp_conflict_id: cid, name_en: r.name, name_ko: koName(r.name),
      type, category, intensity: deaths >= 1000 ? "war" : "armed_conflict", active: true,
      deaths_12mo: deaths, events_12mo: w.length,
      epicenter, zone: conflictZone(coords, epicenter),
      geometry_type: "standoff", // territorial(통제지역 폴리곤)은 라이선스 확보 후. 소스 없으면 standoff(사건 재생).
      events: thinEvents(r.ev, 100), // 상세 뷰 재생용(직전 ~24개월, 균등 씨닝)
      parties, party_isos: partyIsos,
      started_year: r.start, last_event_date: new Date(lastMs).toISOString().slice(0, 10),
    });
  }
  conflicts.sort((a, b) => b.deaths_12mo - a.deaths_12mo);
  const out = {
    _meta: {
      source: "UCDP Georeferenced Event Dataset (GED) v26.1", source_url: "https://ucdp.uu.se/downloads/",
      citation: ["Davies, Engström, Pettersson & Öberg (2024) Journal of Peace Research 61(4)", "Sundberg & Melander (2013) Journal of Peace Research 50(4)"],
      window: `${new Date(win).toISOString().slice(0, 10)} ~ ${new Date(maxMs).toISOString().slice(0, 10)} (직전 12개월, 데이터셋 기준)`,
      note: "intensity(전쟁≥1000/무력분쟁≥25)·active·진앙 모두 이벤트 집계 자동 산출. 진앙=최근 사건 분포 기하중앙값(근사).",
    },
    conflicts,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out));
  const wars = conflicts.filter((c) => c.intensity === "war").length;
  console.log(`[conflicts:build] 완료 — ${conflicts.length}개 활성(전쟁 ${wars}·무력 ${conflicts.length - wars}) · 이벤트 ${total} 스캔 · ${(JSON.stringify(out).length / 1024).toFixed(0)}KB → ${OUT}`);
  console.log(`  검산: 러-우=${conflicts.find((c) => c.name_en === "Russia - Ukraine")?.intensity} · 홍해/예멘=${conflicts.some((c) => /Yemen/.test(c.name_en)) ? "있음" : "없음"}`);
}
main().catch((e) => { console.error("[conflicts:build] 실패:", e); process.exit(1); });
