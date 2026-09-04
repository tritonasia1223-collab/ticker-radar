// 세계 현황판 (/#/world) — L1 국가 기본(국경·한글 라벨·수도·팬줌·선택·인접국·카드) + 검색/프리셋 + L2 인프라(항로·항만·초크포인트).
//   정적 데이터 직접 렌더(DB/서버 불요). d3-geo Equal Earth + d3-zoom. 표면 토큰(바다=배경/땅=카드/국경=헤어라인).
//   데이터: script/build-world-topo.ts 산출(NE 110m·수도) + world-infra.json(항로·항만·초크포인트 수기 시드).
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { geoEqualEarth, geoPath, geoArea } from "d3-geo";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity } from "d3-zoom";
import "d3-transition"; // select(...).transition() 활성화
import { feature, neighbors } from "topojson-client";
import { Plus, Minus, X, Locate, Search, Anchor, Diamond, Route } from "lucide-react";
import topoData from "@/data/world-110m.json";
import capitalsData from "@/data/world-capitals.json";
import infraData from "@/data/world-infra.json";

type CtyProps = { iso: string; ko: string; en: string; lx: number; ly: number };
type Cty = { type: "Feature"; geometry: any; properties: CtyProps };
type Cap = { iso: string; ko: string; en: string; lng: number; lat: number };
type Choke = { ko: string; en: string; lng: number; lat: number; connects: string };
type Port = { ko: string; en: string; lng: number; lat: number };
type RouteT = { ko: string; coords: [number, number][] };
const infra = infraData as { chokepoints: Choke[]; ports: Port[]; routes: RouteT[] };

const TEAL = "#0d9488";          // 선택 하이라이트(유동성 탭 팔레트)
const AMBER = "#f59e0b";         // 초크포인트(해협) 다이아몬드
const SEA = "#2563eb";           // 항로(점선) · 항만(점)
const WORLD_LABEL_TOP = 28;      // 세계 뷰에서 라벨 붙일 대국 개수(면적순)
const K_REGION = 2.5, K_LOCAL = 6; // 시맨틱 줌 경계
const CENTER_LON = 150;          // 중심 경도(동아시아 중심 = 아메리카가 오른쪽). 컷은 ~30°W 대서양.

// 권역 프리셋(§8 Phase2) — 클릭 시 중심 경도 재정렬 + 바운딩박스로 플라이투. bbox = [W, S, E, N].
const REGIONS: { name: string; lon: number; bbox: [number, number, number, number] }[] = [
  { name: "유럽", lon: 15, bbox: [-11, 34, 42, 60] },
  { name: "중동", lon: 47, bbox: [32, 12, 63, 42] },
  { name: "아프리카", lon: 20, bbox: [-18, -35, 52, 38] },
  { name: "동남아", lon: 113, bbox: [92, -11, 142, 28] },
  { name: "남미", lon: -60, bbox: [-82, -56, -34, 13] },
];
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ""); // 검색 정규화(공백·대소문자 무시)

export default function World() {
  // ── 정적 데이터: 토폴로지 → 피처 + 인접(공유아크) + 면적 + 수도 인덱스 ──
  const topo = topoData as any;
  const features = useMemo<Cty[]>(() => (feature(topo, topo.objects.countries) as any).features, []);
  const adj = useMemo<number[][]>(() => neighbors(topo.objects.countries.geometries as any), []);
  const areas = useMemo(() => features.map((f) => geoArea(f as any)), [features]);
  const worldLabelSet = useMemo(() => {
    const idx = features.map((_, i) => i).sort((a, b) => areas[b] - areas[a]).slice(0, WORLD_LABEL_TOP);
    return new Set(idx);
  }, [features, areas]);
  const capByIso = useMemo(() => {
    const m = new Map<string, Cap>();
    for (const c of capitalsData as Cap[]) if (c.iso) m.set(c.iso, c);
    return m;
  }, []);
  const isoToIdx = useMemo(() => {
    const m = new Map<string, number>();
    features.forEach((f, i) => m.set(f.properties.iso, i));
    return m;
  }, [features]);
  // 검색 색인 — 국가(한/영) + 수도 + 초크포인트(해협) + 항만.
  type Hit = { kind: "country"; label: string; sub: string; idx: number; key: string }
    | { kind: "capital" | "choke" | "port"; label: string; sub: string; lng: number; lat: number; iso?: string; key: string };
  const searchIndex = useMemo<Hit[]>(() => {
    const out: Hit[] = [];
    features.forEach((f, i) => out.push({ kind: "country", label: f.properties.ko, sub: f.properties.en, idx: i, key: norm(f.properties.ko) + " " + norm(f.properties.en) }));
    for (const c of capitalsData as Cap[]) out.push({ kind: "capital", label: c.ko, sub: c.en, iso: c.iso, lng: c.lng, lat: c.lat, key: norm(c.ko) + " " + norm(c.en) });
    for (const c of infra.chokepoints) out.push({ kind: "choke", label: c.ko, sub: c.en, lng: c.lng, lat: c.lat, key: norm(c.ko) + " " + norm(c.en) });
    for (const p of infra.ports) out.push({ kind: "port", label: p.ko, sub: p.en, lng: p.lng, lat: p.lat, key: norm(p.ko) + " " + norm(p.en) });
    return out;
  }, [features]);

  // ── 반응형 크기 ──
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dim, setDim] = useState({ w: 960, h: 540 });
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setDim({ w: Math.max(320, Math.round(r.width)), h: Math.max(240, Math.round(r.height)) });
    });
    ro.observe(el); return () => ro.disconnect();
  }, []);

  // ── 투영·패스(Equal Earth, 컨테이너에 맞춤) ── 중심 경도(lon)를 스핀으로 회전. Sphere 피팅은 회전 불변이라 크기 고정.
  const [lon, setLon] = useState(CENTER_LON);
  const projection = useMemo(() => geoEqualEarth().rotate([-lon, 0]).fitExtent([[14, 14], [dim.w - 14, dim.h - 14]], { type: "Sphere" } as any), [dim, lon]);
  const pathGen = useMemo(() => geoPath(projection), [projection]);
  const paths = useMemo(() => features.map((f) => pathGen(f as any) || ""), [features, pathGen]);
  const spherePath = useMemo(() => pathGen({ type: "Sphere" } as any) || "", [pathGen]);
  const routePaths = useMemo(() => infra.routes.map((r) => pathGen({ type: "LineString", coordinates: r.coords } as any) || ""), [pathGen]);
  const [layers, setLayers] = useState({ routes: true, chokes: true, ports: true }); // L2 독립 토글

  // ── 줌/팬 ──
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<any>(null);
  const kRef = useRef(1); // 최신 줌배율(줌 filter·스핀 게이트에서 참조)
  const draggedRef = useRef(false); // 드래그(스핀·팬) 발생 → 뒤따르는 click(선택해제/선택) 억제
  const [t, setT] = useState<{ x: number; y: number; k: number }>({ x: 0, y: 0, k: 1 });
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = select(svgRef.current);
    const z = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 12])
      .translateExtent([[0, 0], [dim.w, dim.h]])
      .extent([[0, 0], [dim.w, dim.h]])
      // 세계 뷰(k≈1)에선 마우스 드래그를 스핀 핸들러에 양보, 확대 상태에선 팬. 휠·더블클릭·터치는 항상 줌.
      .filter((e: any) => (e.type === "mousedown" ? kRef.current > 1.02 : true))
      .on("zoom", (e: any) => { if (e.sourceEvent?.type === "mousemove") draggedRef.current = true; kRef.current = e.transform.k; setT({ x: e.transform.x, y: e.transform.y, k: e.transform.k }); });
    svg.call(z as any);
    zoomRef.current = z;
    return () => { svg.on(".zoom", null); };
  }, [dim]);

  // ── 좌우 스핀(세계 뷰에서 마우스 드래그 → 중심 경도 회전) ──
  const spinRef = useRef<{ x: number; lon: number } | null>(null);
  const onSpinDown = (e: React.PointerEvent) => {
    draggedRef.current = false; // 팬·스핀 공통 리셋(zoom filter 로 팬은 여기서 스핀 안 함)
    if (e.pointerType !== "mouse" || kRef.current > 1.02) return; // 확대 상태는 d3-zoom 팬에 맡김
    spinRef.current = { x: e.clientX, lon };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onSpinMove = (e: React.PointerEvent) => {
    if (!spinRef.current) return;
    const dx = e.clientX - spinRef.current.x;
    if (Math.abs(dx) > 4) draggedRef.current = true;
    setLon(spinRef.current.lon - (dx / dim.w) * 360); // 폭 전체 드래그 ≈ 360° 회전
  };
  const onSpinUp = () => { spinRef.current = null; };

  const flyTo = useCallback((f: Cty) => {
    if (!zoomRef.current || !svgRef.current) return;
    const [[x0, y0], [x1, y1]] = pathGen.bounds(f as any);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const k = Math.max(1, Math.min(9, 0.55 / Math.max((x1 - x0) / dim.w, (y1 - y0) / dim.h)));
    const tr = zoomIdentity.translate(dim.w / 2 - k * cx, dim.h / 2 - k * cy).scale(k);
    select(svgRef.current).transition().duration(650).call(zoomRef.current.transform, tr);
  }, [pathGen, dim]);

  // 지정 중심경도(useLon)로 재정렬 + 대상 화면bbox 에 맞춰 플라이투(검색·권역 프리셋 공용).
  const projFor = useCallback((useLon: number) => geoEqualEarth().rotate([-useLon, 0]).fitExtent([[14, 14], [dim.w - 14, dim.h - 14]], { type: "Sphere" } as any), [dim]);
  const fitTo = useCallback((useLon: number, b: [number, number, number, number], fill: number) => {
    if (!zoomRef.current || !svgRef.current) return;
    const [x0, y0, x1, y1] = b, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const k = Math.max(1, Math.min(9, fill / Math.max((x1 - x0) / dim.w || 1e-3, (y1 - y0) / dim.h || 1e-3)));
    setLon(useLon);
    const tr = zoomIdentity.translate(dim.w / 2 - k * cx, dim.h / 2 - k * cy).scale(k);
    select(svgRef.current).transition().duration(700).call(zoomRef.current.transform, tr);
  }, [dim]);
  const flyRegion = useCallback((r: { lon: number; bbox: [number, number, number, number] }) => {
    // bbox 둘레를 직접 투영해 화면 bbox 산출(합성 폴리곤의 구면 winding 문제 회피).
    const proj = projFor(r.lon);
    const [w, s, e, n] = r.bbox, N = 8;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i <= N; i++) {
      const fx = w + (e - w) * (i / N), fy = s + (n - s) * (i / N);
      for (const pt of [[fx, s], [fx, n], [w, fy], [e, fy]] as [number, number][]) {
        const p = proj(pt); if (!p) continue;
        x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
      }
    }
    if (Number.isFinite(x0)) fitTo(r.lon, [x0, y0, x1, y1], 0.85);
  }, [projFor, fitTo]);
  const flyFeatureCentered = useCallback((f: Cty) => {
    const useLon = Number.isFinite(f.properties.lx) ? f.properties.lx : CENTER_LON;
    const [[x0, y0], [x1, y1]] = geoPath(projFor(useLon)).bounds(f as any);
    fitTo(useLon, [x0, y0, x1, y1], 0.55);
  }, [projFor, fitTo]);

  const zoomBy = (f: number) => zoomRef.current && svgRef.current &&
    select(svgRef.current).transition().duration(250).call(zoomRef.current.scaleBy, f);

  // ── 선택/hover ──
  const [sel, setSel] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string; sub?: string } | null>(null);
  const selNeighbors = useMemo(() => (sel == null ? new Set<number>() : new Set(adj[sel])), [sel, adj]);

  const pick = useCallback((i: number) => { setSel(i); flyTo(features[i]); }, [features, flyTo]);

  // 검색(§8 Phase2) — 클라이언트 부분일치. 선택 시 중심경도 재정렬 + 플라이투 + 국가 선택.
  const [query, setQuery] = useState("");
  const results = useMemo<Hit[]>(() => {
    const q = norm(query); if (!q) return [];
    return searchIndex.filter((it) => it.key.includes(q)).slice(0, 8);
  }, [query, searchIndex]);
  const onSelectResult = useCallback((it: Hit) => {
    setQuery("");
    if (it.kind === "country") { setSel(it.idx); flyFeatureCentered(features[it.idx]); return; }
    const ci = it.iso ? isoToIdx.get(it.iso) : undefined;
    if (ci != null) { setSel(ci); flyFeatureCentered(features[ci]); }
    else flyRegion({ lon: it.lng, bbox: [it.lng - 6, it.lat - 6, it.lng + 6, it.lat + 6] });
  }, [features, isoToIdx, flyFeatureCentered, flyRegion]);

  // 화면 좌표 헬퍼(라벨/수도 오버레이 — 줌 변환 적용, 텍스트는 스케일 안 함)
  const toScreen = (lng: number, lat: number): [number, number] | null => {
    const p = projection([lng, lat]); if (!p) return null;
    return [p[0] * t.k + t.x, p[1] * t.k + t.y];
  };
  const inView = (x: number, y: number) => x >= -20 && x <= dim.w + 20 && y >= -20 && y <= dim.h + 20;

  const selF = sel != null ? features[sel] : null;
  const selCap = selF ? capByIso.get(selF.properties.iso) : undefined;

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-background text-foreground">
      <svg ref={svgRef} width="100%" height="100%" viewBox={`0 0 ${dim.w} ${dim.h}`}
        className="block cursor-grab active:cursor-grabbing select-none"
        onPointerDown={onSpinDown} onPointerMove={onSpinMove} onPointerUp={onSpinUp} onPointerLeave={onSpinUp}
        onClick={() => { if (draggedRef.current) { draggedRef.current = false; return; } setSel(null); }}>
        {/* 바다(구면) — 배경 톤. 빈 곳 클릭 = 선택 해제 */}
        <path d={spherePath} fill="hsl(var(--background))" stroke="hsl(var(--border))" strokeOpacity={0.6} />
        <g transform={`translate(${t.x},${t.y}) scale(${t.k})`}>
          {/* 육지 */}
          {features.map((f, i) => {
            const isSel = i === sel, isNb = selNeighbors.has(i), isHov = i === hover;
            const fill = isSel ? TEAL : isNb ? "rgba(13,148,136,0.28)" : isHov ? "hsl(var(--muted))" : "hsl(var(--card))";
            return (
              <path key={i} d={paths[i]} fill={fill} stroke="hsl(var(--border))" strokeWidth={0.5 / t.k}
                style={{ cursor: "pointer", transition: "fill 0.12s" }}
                onClick={(e) => { e.stopPropagation(); if (draggedRef.current) { draggedRef.current = false; return; } pick(i); }}
                onMouseEnter={(e) => { setHover(i); setTip({ x: e.clientX, y: e.clientY, text: f.properties.ko || f.properties.en }); }}
                onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, text: f.properties.ko || f.properties.en })}
                onMouseLeave={() => { setHover(null); setTip(null); }} />
            );
          })}
          {/* L2 항로 — 파랑 점선(투영 좌표, 줌 변환 안에서 굵기 보정) */}
          {layers.routes && infra.routes.map((r, i) => (
            <path key={`r${i}`} d={routePaths[i]} fill="none" stroke={SEA} strokeWidth={1.3 / t.k}
              strokeDasharray={`${4 / t.k} ${3 / t.k}`} strokeOpacity={0.7} strokeLinecap="round" style={{ pointerEvents: "none" }} />
          ))}
        </g>

        {/* 국가 라벨 오버레이(줌 변환 후 좌표, 텍스트는 고정 크기) */}
        <g style={{ pointerEvents: "none" }}>
          {features.map((f, i) => {
            const show = i === sel || i === hover || t.k >= K_REGION || worldLabelSet.has(i);
            if (!show) return null;
            const sc = toScreen(f.properties.lx, f.properties.ly); if (!sc || !inView(sc[0], sc[1])) return null;
            return (
              <text key={i} x={sc[0]} y={sc[1]} textAnchor="middle" fontSize={i === sel ? 12 : 10.5}
                fontWeight={i === sel ? 700 : 500} fill={i === sel ? TEAL : "hsl(var(--foreground))"}
                style={{ paintOrder: "stroke", stroke: "hsl(var(--background))", strokeWidth: 3, strokeLinejoin: "round" }}>
                {f.properties.ko}
              </text>
            );
          })}
        </g>

        {/* 수도 점·이름(권역 뷰부터 점, 국지 뷰부터 이름) */}
        {t.k >= K_REGION && (
          <g style={{ pointerEvents: "none" }}>
            {(capitalsData as Cap[]).map((c, i) => {
              const sc = toScreen(c.lng, c.lat); if (!sc || !inView(sc[0], sc[1])) return null;
              return (
                <g key={i}>
                  <circle cx={sc[0]} cy={sc[1]} r={2.6} fill="hsl(var(--foreground))" fillOpacity={0.55} />
                  {t.k >= K_LOCAL && (
                    <text x={sc[0] + 4} y={sc[1] + 3} fontSize={9.5} fill="hsl(var(--muted-foreground))"
                      style={{ paintOrder: "stroke", stroke: "hsl(var(--background))", strokeWidth: 2.5, strokeLinejoin: "round" }}>{c.ko}</text>
                  )}
                </g>
              );
            })}
          </g>
        )}

        {/* L2 항만 — 파랑 점(권역 뷰부터). hover 이름. */}
        {layers.ports && t.k >= K_REGION && infra.ports.map((p, i) => {
          const sc = toScreen(p.lng, p.lat); if (!sc || !inView(sc[0], sc[1])) return null;
          return (
            <g key={`p${i}`} style={{ cursor: "pointer" }}
              onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY, text: `⚓ ${p.ko}`, sub: p.en })}
              onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, text: `⚓ ${p.ko}`, sub: p.en })}
              onMouseLeave={() => setTip(null)}>
              <circle cx={sc[0]} cy={sc[1]} r={3} fill={SEA} stroke="hsl(var(--background))" strokeWidth={0.8} />
              {t.k >= K_LOCAL && <text x={sc[0] + 5} y={sc[1] + 3} fontSize={9.5} fill={SEA}
                style={{ paintOrder: "stroke", stroke: "hsl(var(--background))", strokeWidth: 2.5, strokeLinejoin: "round" }}>{p.ko}</text>}
            </g>
          );
        })}

        {/* L2 초크포인트 — 앰버 다이아몬드(상시). hover 이름 + 연결 수역. */}
        {layers.chokes && infra.chokepoints.map((c, i) => {
          const sc = toScreen(c.lng, c.lat); if (!sc || !inView(sc[0], sc[1])) return null;
          return (
            <g key={`c${i}`} style={{ cursor: "pointer" }}
              onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY, text: `◆ ${c.ko}`, sub: c.connects })}
              onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, text: `◆ ${c.ko}`, sub: c.connects })}
              onMouseLeave={() => setTip(null)}>
              <path d={`M${sc[0]},${sc[1] - 5} L${sc[0] + 5},${sc[1]} L${sc[0]},${sc[1] + 5} L${sc[0] - 5},${sc[1]} Z`}
                fill={AMBER} stroke="hsl(var(--background))" strokeWidth={0.8} />
              {t.k >= K_REGION && <text x={sc[0]} y={sc[1] - 8} textAnchor="middle" fontSize={9.5} fontWeight={600} fill={AMBER}
                style={{ paintOrder: "stroke", stroke: "hsl(var(--background))", strokeWidth: 2.5, strokeLinejoin: "round" }}>{c.ko}</text>}
            </g>
          );
        })}
      </svg>

      {/* hover 툴팁(라벨 생략 소국 · 항만/해협 팩트) */}
      {tip && (
        <div className="pointer-events-none fixed z-50 rounded-md border border-border bg-popover px-2 py-1 text-[12px] text-popover-foreground shadow-md"
          style={{ left: tip.x + 12, top: tip.y + 12 }}>
          <div>{tip.text}</div>
          {tip.sub && <div className="text-[10.5px] text-muted-foreground">{tip.sub}</div>}
        </div>
      )}

      {/* 우상: L2 층 토글(항로·항만·해협 독립) */}
      <div className="absolute right-4 top-4 flex gap-1">
        {([["routes", "항로", Route, SEA], ["ports", "항만", Anchor, SEA], ["chokes", "해협", Diamond, AMBER]] as const).map(([k, label, Icon, color]) => (
          <button key={k} onClick={() => setLayers((l) => ({ ...l, [k]: !l[k] }))}
            className={`flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] shadow-sm backdrop-blur transition-opacity ${layers[k] ? "border-border bg-card/90" : "border-border/50 bg-card/50 text-muted-foreground opacity-55"}`}
            title={`${label} ${layers[k] ? "끄기" : "켜기"}`}>
            <Icon className="h-3 w-3" style={{ color: layers[k] ? color : undefined }} />{label}
          </button>
        ))}
      </div>

      {/* 우하: 줌 컨트롤 */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-1">
        <button onClick={() => zoomBy(1.6)} className="h-9 w-9 rounded-md border border-border bg-card/90 text-lg leading-none shadow-sm backdrop-blur hover:bg-muted" title="확대"><Plus className="mx-auto h-4 w-4" /></button>
        <button onClick={() => zoomBy(1 / 1.6)} className="h-9 w-9 rounded-md border border-border bg-card/90 shadow-sm backdrop-blur hover:bg-muted" title="축소"><Minus className="mx-auto h-4 w-4" /></button>
        <button onClick={() => { setLon(CENTER_LON); svgRef.current && select(svgRef.current).transition().duration(400).call(zoomRef.current.transform, zoomIdentity); }}
          className="h-9 w-9 rounded-md border border-border bg-card/90 shadow-sm backdrop-blur hover:bg-muted" title="세계 뷰로(태평양 중심)"><Locate className="mx-auto h-4 w-4" /></button>
      </div>

      {/* 좌상: 검색(국가·수도) */}
      <div className="absolute left-4 top-4 w-64">
        <div className="rounded-md border border-border bg-card/90 shadow-sm backdrop-blur">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && results[0]) onSelectResult(results[0]); if (e.key === "Escape") setQuery(""); }}
              placeholder="나라·수도 검색" spellCheck={false}
              className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground" />
            {query && <button onClick={() => setQuery("")} className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted" title="지우기"><X className="h-3.5 w-3.5" /></button>}
          </div>
          {results.length > 0 && (
            <div className="max-h-64 overflow-auto border-t border-border">
              {results.map((it, ri) => (
                <button key={ri} onClick={() => onSelectResult(it)}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-muted">
                  <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-medium" style={{ background: (it.kind === "country" ? TEAL : it.kind === "choke" ? AMBER : it.kind === "port" ? SEA : "#94a3b8") + "26", color: it.kind === "country" ? TEAL : it.kind === "choke" ? AMBER : it.kind === "port" ? SEA : "hsl(var(--muted-foreground))" }}>{it.kind === "country" ? "국가" : it.kind === "capital" ? "수도" : it.kind === "choke" ? "해협" : "항만"}</span>
                  <span className="text-[12.5px] font-medium">{it.label}</span>
                  <span className="truncate text-[10px] text-muted-foreground">{it.sub}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="mt-1 pl-1 text-[10.5px] text-muted-foreground">좌우로 끌어 회전 · 클릭하면 인접국</div>
      </div>

      {/* 좌하: 권역 프리셋 */}
      <div className="absolute bottom-4 left-4 flex max-w-[16rem] flex-wrap gap-1">
        {REGIONS.map((r) => (
          <button key={r.name} onClick={() => { setSel(null); flyRegion(r); }}
            className="rounded-full border border-border bg-card/90 px-2.5 py-1 text-[11px] shadow-sm backdrop-blur hover:bg-muted">{r.name}</button>
        ))}
      </div>

      {/* 우측: 국가 카드 (층 토글 아래) */}
      {selF && (
        <div className="absolute right-4 top-16 w-64 rounded-lg border border-border bg-card/95 p-3.5 shadow-lg backdrop-blur">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-base font-bold leading-tight">{selF.properties.ko}</div>
              <div className="text-[11px] text-muted-foreground">{selF.properties.en}</div>
            </div>
            <button onClick={() => setSel(null)} className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted" title="닫기"><X className="h-4 w-4" /></button>
          </div>
          <div className="mt-2.5 flex items-center gap-1.5 text-[12px]">
            <span className="text-muted-foreground">수도</span>
            <span className="font-medium">{selCap ? selCap.ko : "—"}</span>
            {selCap?.en && <span className="text-[11px] text-muted-foreground">{selCap.en}</span>}
          </div>
          <div className="mt-2.5">
            <div className="mb-1 text-[11px] text-muted-foreground">인접국 {adj[sel!].length ? `· ${adj[sel!].length}` : ""}</div>
            <div className="flex flex-wrap gap-1">
              {adj[sel!].length === 0 && <span className="text-[11px] text-muted-foreground">인접 국경 없음(섬·해양 경계)</span>}
              {adj[sel!].map((ni) => (
                <button key={ni} onClick={() => pick(ni)}
                  className="rounded-full border border-border px-2 py-0.5 text-[11px] hover:border-[color:var(--tw-ring-color)] hover:bg-muted"
                  style={{ ["--tw-ring-color" as any]: TEAL }}>{features[ni].properties.ko}</button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
