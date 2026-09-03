// 세계 현황판 (/#/world) — Phase 1: L1 국가 기본(국경·한글 라벨·수도·팬줌·선택·인접국·국가카드).
//   정적 TopoJSON 직접 렌더(DB/서버 불요). d3-geo Equal Earth + d3-zoom. 표면 토큰(바다=배경/땅=카드/국경=헤어라인).
//   데이터: script/build-world-topo.ts 산출물(Natural Earth 110m, 한글명 NAME_KO 내장).
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { geoEqualEarth, geoPath, geoArea } from "d3-geo";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity } from "d3-zoom";
import "d3-transition"; // select(...).transition() 활성화
import { feature, neighbors } from "topojson-client";
import { Plus, Minus, X, Locate } from "lucide-react";
import topoData from "@/data/world-110m.json";
import capitalsData from "@/data/world-capitals.json";

type CtyProps = { iso: string; ko: string; en: string; lx: number; ly: number };
type Cty = { type: "Feature"; geometry: any; properties: CtyProps };
type Cap = { iso: string; ko: string; en: string; lng: number; lat: number };

const TEAL = "#0d9488";          // 선택 하이라이트(유동성 탭 팔레트)
const WORLD_LABEL_TOP = 28;      // 세계 뷰에서 라벨 붙일 대국 개수(면적순)
const K_REGION = 2.5, K_LOCAL = 6; // 시맨틱 줌 경계

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

  // ── 투영·패스(Equal Earth, 컨테이너에 맞춤) ──
  const projection = useMemo(() => geoEqualEarth().fitExtent([[14, 14], [dim.w - 14, dim.h - 14]], { type: "Sphere" } as any), [dim]);
  const pathGen = useMemo(() => geoPath(projection), [projection]);
  const paths = useMemo(() => features.map((f) => pathGen(f as any) || ""), [features, pathGen]);
  const spherePath = useMemo(() => pathGen({ type: "Sphere" } as any) || "", [pathGen]);

  // ── 줌/팬 ──
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<any>(null);
  const [t, setT] = useState<{ x: number; y: number; k: number }>({ x: 0, y: 0, k: 1 });
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = select(svgRef.current);
    const z = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 12])
      .translateExtent([[0, 0], [dim.w, dim.h]])
      .extent([[0, 0], [dim.w, dim.h]])
      .on("zoom", (e: any) => setT({ x: e.transform.x, y: e.transform.y, k: e.transform.k }));
    svg.call(z as any);
    zoomRef.current = z;
    return () => { svg.on(".zoom", null); };
  }, [dim]);

  const flyTo = useCallback((f: Cty) => {
    if (!zoomRef.current || !svgRef.current) return;
    const [[x0, y0], [x1, y1]] = pathGen.bounds(f as any);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const k = Math.max(1, Math.min(9, 0.55 / Math.max((x1 - x0) / dim.w, (y1 - y0) / dim.h)));
    const tr = zoomIdentity.translate(dim.w / 2 - k * cx, dim.h / 2 - k * cy).scale(k);
    select(svgRef.current).transition().duration(650).call(zoomRef.current.transform, tr);
  }, [pathGen, dim]);

  const zoomBy = (f: number) => zoomRef.current && svgRef.current &&
    select(svgRef.current).transition().duration(250).call(zoomRef.current.scaleBy, f);

  // ── 선택/hover ──
  const [sel, setSel] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const selNeighbors = useMemo(() => (sel == null ? new Set<number>() : new Set(adj[sel])), [sel, adj]);

  const pick = useCallback((i: number) => { setSel(i); flyTo(features[i]); }, [features, flyTo]);

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
        className="block cursor-grab active:cursor-grabbing"
        onClick={() => { setSel(null); }}>
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
                onClick={(e) => { e.stopPropagation(); pick(i); }}
                onMouseEnter={(e) => { setHover(i); setTip({ x: e.clientX, y: e.clientY, text: f.properties.ko || f.properties.en }); }}
                onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, text: f.properties.ko || f.properties.en })}
                onMouseLeave={() => { setHover(null); setTip(null); }} />
            );
          })}
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
      </svg>

      {/* hover 툴팁(라벨 생략 소국 대응) */}
      {tip && (
        <div className="pointer-events-none fixed z-50 rounded-md border border-border bg-popover px-2 py-1 text-[12px] text-popover-foreground shadow-md"
          style={{ left: tip.x + 12, top: tip.y + 12 }}>{tip.text}</div>
      )}

      {/* 우하: 줌 컨트롤 */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-1">
        <button onClick={() => zoomBy(1.6)} className="h-9 w-9 rounded-md border border-border bg-card/90 text-lg leading-none shadow-sm backdrop-blur hover:bg-muted" title="확대"><Plus className="mx-auto h-4 w-4" /></button>
        <button onClick={() => zoomBy(1 / 1.6)} className="h-9 w-9 rounded-md border border-border bg-card/90 shadow-sm backdrop-blur hover:bg-muted" title="축소"><Minus className="mx-auto h-4 w-4" /></button>
        <button onClick={() => svgRef.current && select(svgRef.current).transition().duration(400).call(zoomRef.current.transform, zoomIdentity)}
          className="h-9 w-9 rounded-md border border-border bg-card/90 shadow-sm backdrop-blur hover:bg-muted" title="세계 뷰로"><Locate className="mx-auto h-4 w-4" /></button>
      </div>

      {/* 좌상: 제목(Phase 1 — 검색/프리셋/층토글은 후속) */}
      <div className="absolute left-4 top-4 rounded-md border border-border bg-card/85 px-3 py-1.5 shadow-sm backdrop-blur">
        <div className="text-sm font-bold">세계 현황판</div>
        <div className="text-[11px] text-muted-foreground">국경·수도 · 클릭하면 인접국</div>
      </div>

      {/* 우측: 국가 카드 */}
      {selF && (
        <div className="absolute right-4 top-4 w-64 rounded-lg border border-border bg-card/95 p-3.5 shadow-lg backdrop-blur">
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
