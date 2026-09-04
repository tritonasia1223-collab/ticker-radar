// 미국 AI 데이터센터 (/#/datacenters) — 소유·자금 구조 + 전력 조달(송전망) 레이어.
//   정적 데이터(ai-datacenters.json) + us-atlas 주 경계. geoAlbersUsa 투영. DB/서버 불요.
//   색 모드: 그룹(A/B/C) / 전력계통(ISO) / 신용등급. 크기=용량. 원전 PPA는 회사 단위라 사이트로 선 안 이음.
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { geoAlbersUsa, geoPath } from "d3-geo";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity } from "d3-zoom";
import "d3-transition";
import { feature } from "topojson-client";
import { Server, Flame, Atom, BatteryCharging, Zap, X, Plus, Minus, ExternalLink, Info } from "lucide-react";
import dcData from "@/data/ai-datacenters.json";
import statesTopo from "@/data/us-states-10m.json";

type Gen = { type: string; vendor: string | null; mw: number | null; status: string; note?: string };
type Power = { grid_operator: string; utility: string | null; grid_share: string; onsite_generation: Gen[]; utility_new_build: Gen[]; nuclear: boolean; note?: string; confidence: string };
type Fin = { type: string; party: string; amount_usd_bn: number | null; disclosure: string };
type Site = {
  id: string; group: "A" | "B" | "C"; name: string;
  location: { city: string | null; state: string | null; lat: number | null; lng: number | null };
  capacity_operational_mw: number | null; capacity_target_mw: { min: number | null; max: number | null };
  status_stage: string; status_note: string; landlord: string; tenant: string | null; lease_term_years: number | null; end_user: string | null;
  financing: Fin[]; financing_total_usd_bn: number | null; credit_wrapper: string | null; credit_wrapper_rating: string | null; notes: string; power?: Power;
};
type Nuke = { id: string; buyer: string; counterparty: string; plant: string; reactor_type: string; mw: number; mw_max?: number; location: { state: string; grid: string; lat: number; lng: number }; deal: string; target_year: number; status: string; site_bound: boolean; feeds_sites: string[]; confidence: string };
const dc = dcData as unknown as { meta: any; sites: Site[]; analysis_notes: string[]; nuclear_deals: Nuke[] };

const GROUP_COLOR: Record<string, string> = { A: "#7c3aed", B: "#2563eb", C: "#db2777" };
const GROUP_LABEL: Record<string, string> = { A: "스타게이트 계열", B: "하이퍼스케일러", C: "네오클라우드" };
const GRID_COLOR: Record<string, string> = { ERCOT: "#dc2626", PJM: "#2563eb", MISO: "#16a34a", SPP: "#f59e0b" };
const gridColor = (op?: string) => (op && GRID_COLOR[op]) || "#64748b"; // 비ISO=slate
const STAGES = ["announced", "approved", "construction", "partial_operation", "operating"];
const STAGE_KO: Record<string, string> = { announced: "발표", approved: "승인", construction: "건설", partial_operation: "부분가동", operating: "가동" };
// 신용등급 → 색. BBB-(오라클)만 앰버 강조(취약 IG), 정크(BB) 적, 미평가 회색.
const creditColor = (r: string | null) => {
  if (!r) return "#94a3b8";
  if (r === "BBB-") return "#f59e0b";
  if (r.startsWith("BB")) return "#dc2626";
  return "#16a34a"; // BBB 이상 IG
};
// 용량(사이징): 운영 우선, 없으면 목표. fermi 는 확보전력이라 축 왜곡 → 사이징 제외(고정).
const capMW = (s: Site) => s.capacity_operational_mw ?? s.capacity_target_mw.max ?? s.capacity_target_mw.min ?? null;
const markerR = (s: Site) => { if (s.id === "fermi-matador") return 7; const c = capMW(s); return c ? 4 + 0.16 * Math.sqrt(c) : 5; };
const primaryGen = (p?: Power): "gas" | "nuclear" | "battery" | "grid" => {
  if (!p) return "grid";
  const ts = p.onsite_generation.map((g) => g.type);
  if (ts.some((t) => t.includes("nuclear") || t === "smr")) return "nuclear";
  if (ts.some((t) => t.includes("gas"))) return "gas";
  if (ts.some((t) => t.includes("battery") || t.includes("solar"))) return "battery";
  return "grid";
};
const GEN_ICON = { gas: Flame, nuclear: Atom, battery: BatteryCharging, grid: Zap } as const;
const GEN_KO = { gas: "가스", nuclear: "원자력", battery: "배터리·태양광", grid: "계통" } as const;

type Mode = "group" | "grid" | "credit";

export default function DataCenters() {
  const states = useMemo(() => (feature(statesTopo as any, (statesTopo as any).objects.states) as any).features, []);
  const mapSites = useMemo(() => dc.sites.filter((s) => s.location.lat != null && s.location.lng != null), []);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [dim, setDim] = useState({ w: 960, h: 540 });
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); setDim({ w: Math.max(320, Math.round(r.width)), h: Math.max(240, Math.round(r.height)) }); });
    ro.observe(el); return () => ro.disconnect();
  }, []);

  const projection = useMemo(() => geoAlbersUsa().fitExtent([[16, 16], [dim.w - 16, dim.h - 16]], { type: "FeatureCollection", features: states } as any), [dim, states]);
  const pathGen = useMemo(() => geoPath(projection), [projection]);
  const statePaths = useMemo(() => states.map((f: any) => pathGen(f) || ""), [states, pathGen]);

  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<any>(null);
  const [t, setT] = useState({ x: 0, y: 0, k: 1 });
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = select(svgRef.current);
    const z = d3zoom<SVGSVGElement, unknown>().scaleExtent([1, 10]).translateExtent([[0, 0], [dim.w, dim.h]]).extent([[0, 0], [dim.w, dim.h]])
      .on("zoom", (e: any) => setT({ x: e.transform.x, y: e.transform.y, k: e.transform.k }));
    svg.call(z as any); zoomRef.current = z;
    return () => { svg.on(".zoom", null); };
  }, [dim]);
  const zoomBy = (f: number) => zoomRef.current && svgRef.current && select(svgRef.current).transition().duration(250).call(zoomRef.current.scaleBy, f);
  const resetZoom = () => svgRef.current && select(svgRef.current).transition().duration(400).call(zoomRef.current.transform, zoomIdentity);

  const [mode, setMode] = useState<Mode>("group");
  const [groupsOn, setGroupsOn] = useState<Record<string, boolean>>({ A: true, B: true, C: true });
  const [showNuke, setShowNuke] = useState(true);
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string; sub?: string } | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);

  const toScreen = (lng: number, lat: number): [number, number] | null => { const p = projection([lng, lat]); if (!p) return null; return [p[0] * t.k + t.x, p[1] * t.k + t.y]; };
  const colorOf = (s: Site) => mode === "group" ? GROUP_COLOR[s.group] : mode === "grid" ? gridColor(s.power?.grid_operator) : creditColor(s.credit_wrapper_rating);
  const selSite = sel ? dc.sites.find((s) => s.id === sel) : null;

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-background text-foreground">
      <svg ref={svgRef} width="100%" height="100%" viewBox={`0 0 ${dim.w} ${dim.h}`} className="block cursor-grab active:cursor-grabbing"
        onClick={() => setSel(null)}>
        <g transform={`translate(${t.x},${t.y}) scale(${t.k})`}>
          {states.map((f: any, i: number) => (
            <path key={i} d={statePaths[i]} fill="hsl(var(--card))" stroke="hsl(var(--border))" strokeWidth={0.5 / t.k} />
          ))}
        </g>

        {/* 원전·SMR PPA (회사 단위 — 사이트로 선 안 이음) */}
        {showNuke && dc.nuclear_deals.map((n) => {
          const sc = toScreen(n.location.lng, n.location.lat); if (!sc) return null;
          return (
            <g key={n.id} style={{ cursor: "pointer" }}
              onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY, text: `⚛ ${n.plant}`, sub: `${n.buyer} · ${n.mw}MW · ${n.reactor_type}` })}
              onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, text: `⚛ ${n.plant}`, sub: `${n.buyer} · ${n.mw}MW` })}
              onMouseLeave={() => setTip(null)}>
              <circle cx={sc[0]} cy={sc[1]} r={4.5} fill="none" stroke="#a855f7" strokeWidth={1.4} strokeDasharray={n.site_bound ? undefined : "2 1.5"} />
              <text x={sc[0]} y={sc[1] + 2.6} textAnchor="middle" fontSize={6} fill="#a855f7" fontWeight={700} style={{ pointerEvents: "none" }}>⚛</text>
            </g>
          );
        })}

        {/* 데이터센터 마커 */}
        {mapSites.filter((s) => groupsOn[s.group]).map((s) => {
          const sc = toScreen(s.location.lng!, s.location.lat!); if (!sc) return null;
          const on = s.id === sel || s.id === hover; const col = colorOf(s); const r = markerR(s);
          const gen = primaryGen(s.power); const GenI = GEN_ICON[gen];
          return (
            <g key={s.id} style={{ cursor: "pointer" }}
              onClick={(e) => { e.stopPropagation(); setSel(s.id); }}
              onMouseEnter={(e) => { setHover(s.id); setTip({ x: e.clientX, y: e.clientY, text: s.name, sub: `${s.location.city}, ${s.location.state} · ${capMW(s) ?? "?"}MW · ${s.power?.grid_operator ?? ""}` }); }}
              onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, text: s.name, sub: `${s.location.city}, ${s.location.state}` })}
              onMouseLeave={() => { setHover(null); setTip(null); }}>
              <circle cx={sc[0]} cy={sc[1]} r={r} fill={col} fillOpacity={on ? 0.55 : 0.32} stroke={col} strokeWidth={on ? 2 : 1.2}
                strokeDasharray={s.id === "fermi-matador" ? "3 2" : undefined} />
              {/* 전력원 글리프(작게) */}
              <GenI x={sc[0] - 3.5} y={sc[1] - 3.5} width={7} height={7} style={{ color: col, pointerEvents: "none" }} />
              {(on || t.k >= 2.2) && <text x={sc[0]} y={sc[1] - r - 3} textAnchor="middle" fontSize={9.5} fontWeight={600} fill={col}
                style={{ paintOrder: "stroke", stroke: "hsl(var(--background))", strokeWidth: 2.5, strokeLinejoin: "round", pointerEvents: "none" }}>{s.name}</text>}
            </g>
          );
        })}
      </svg>

      {tip && (<div className="pointer-events-none fixed z-50 rounded-md border border-border bg-popover px-2 py-1 text-[12px] text-popover-foreground shadow-md" style={{ left: tip.x + 12, top: tip.y + 12 }}>
        <div>{tip.text}</div>{tip.sub && <div className="text-[10.5px] text-muted-foreground">{tip.sub}</div>}</div>)}

      {/* 좌상: 제목 + 색 모드 + 필터 */}
      <div className="absolute left-4 top-4 w-60 space-y-2">
        <div className="rounded-md border border-border bg-card/90 p-2.5 shadow-sm backdrop-blur">
          <div className="flex items-center gap-1.5 text-sm font-bold"><Server className="h-4 w-4" /> 미국 AI 데이터센터</div>
          <div className="text-[10.5px] text-muted-foreground">{dc.meta.as_of} · {mapSites.length}개 사이트 · 소유·자금·전력</div>
          <div className="mt-2 text-[10.5px] text-muted-foreground">색 기준</div>
          <div className="mt-0.5 flex rounded border border-border overflow-hidden text-[11px]">
            {(["group", "grid", "credit"] as Mode[]).map((m) => (
              <button key={m} onClick={() => setMode(m)} className={`flex-1 px-1.5 py-0.5 ${mode === m ? "bg-muted font-semibold" : "text-muted-foreground hover:bg-muted/50"}`}>{m === "group" ? "그룹" : m === "grid" ? "전력계통" : "신용등급"}</button>
            ))}
          </div>
          {/* 그룹 필터 */}
          <div className="mt-2 flex flex-wrap gap-1">
            {(["A", "B", "C"] as const).map((g) => (
              <button key={g} onClick={() => setGroupsOn((o) => ({ ...o, [g]: !o[g] }))}
                className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] ${groupsOn[g] ? "border-border bg-muted/40" : "border-border/40 opacity-45"}`}>
                <span className="h-2 w-2 rounded-full" style={{ background: GROUP_COLOR[g] }} />{g} {GROUP_LABEL[g]}</button>
            ))}
          </div>
          <label className="mt-2 flex items-center gap-1.5 text-[11px]"><input type="checkbox" checked={showNuke} onChange={(e) => setShowNuke(e.target.checked)} className="accent-purple-500" /><Atom className="h-3 w-3 text-purple-500" />원전·SMR PPA ({dc.nuclear_deals.length})</label>
        </div>

        {/* 범례 */}
        <div className="rounded-md border border-border bg-card/90 p-2.5 text-[10.5px] shadow-sm backdrop-blur">
          <div className="mb-1 font-semibold">{mode === "group" ? "그룹" : mode === "grid" ? "전력계통(ISO)" : "신용등급(래퍼)"}</div>
          {mode === "group" && (["A", "B", "C"] as const).map((g) => <div key={g} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: GROUP_COLOR[g] }} />{g} · {GROUP_LABEL[g]}</div>)}
          {mode === "grid" && [["ERCOT", "텍사스"], ["PJM", "동부"], ["MISO", "중서부"], ["SPP", "대평원"], ["비ISO", "TVA·Southern·WECC 등"]].map(([k, v]) => <div key={k} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: gridColor(k) }} />{k} · {v}</div>)}
          {mode === "credit" && [["A~AAA", "#16a34a", "투자등급"], ["BBB-", "#f59e0b", "취약 IG(오라클)"], ["BB", "#dc2626", "정크"], ["미평가", "#94a3b8", "비상장"]].map(([k, c, v]) => <div key={k} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />{k} · {v}</div>)}
          <div className="mt-1.5 flex items-center gap-2 border-t border-border/50 pt-1.5 text-muted-foreground">
            <span className="flex items-center gap-1"><Flame className="h-3 w-3" />가스</span><span className="flex items-center gap-1"><Atom className="h-3 w-3" />원전</span><span className="flex items-center gap-1"><Zap className="h-3 w-3" />계통</span>
          </div>
          <div className="mt-1 text-[9.5px] text-muted-foreground">원 크기 = 용량(MW) · 점선원 = 페르미(확보전력)</div>
        </div>
      </div>

      {/* 우하: 줌 */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-1">
        <button onClick={() => zoomBy(1.6)} className="h-9 w-9 rounded-md border border-border bg-card/90 shadow-sm backdrop-blur hover:bg-muted"><Plus className="mx-auto h-4 w-4" /></button>
        <button onClick={() => zoomBy(1 / 1.6)} className="h-9 w-9 rounded-md border border-border bg-card/90 shadow-sm backdrop-blur hover:bg-muted"><Minus className="mx-auto h-4 w-4" /></button>
        <button onClick={resetZoom} className="h-9 w-9 rounded-md border border-border bg-card/90 shadow-sm backdrop-blur hover:bg-muted" title="전체"><Server className="mx-auto h-4 w-4" /></button>
      </div>

      {/* 좌하: 해설 노트(접기) */}
      <div className="absolute bottom-4 left-4 w-72">
        <button onClick={() => setNotesOpen((o) => !o)} className="flex w-full items-center gap-1.5 rounded-md border border-border bg-card/90 px-2.5 py-1.5 text-[11px] font-semibold shadow-sm backdrop-blur hover:bg-muted"><Info className="h-3.5 w-3.5" />구조 해설 {notesOpen ? "▾" : "▸"}</button>
        {notesOpen && <div className="mt-1 space-y-1.5 rounded-md border border-border bg-card/95 p-2.5 text-[11px] leading-snug shadow-sm backdrop-blur">
          {dc.analysis_notes.map((n, i) => <div key={i} className="text-muted-foreground">· {n}</div>)}
        </div>}
      </div>

      {/* 우측: 사이트 상세 카드 */}
      {selSite && (() => { const s = selSite; const stageIdx = STAGES.indexOf(s.status_stage); const gen = primaryGen(s.power);
        return (
          <div className="absolute right-4 top-4 max-h-[calc(100%-2rem)] w-80 overflow-auto rounded-lg border border-border bg-card/95 p-3.5 shadow-lg backdrop-blur">
            <button onClick={() => setSel(null)} className="absolute right-2 top-2 rounded p-0.5 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
            <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: GROUP_COLOR[s.group] }} /><span className="text-base font-bold leading-tight">{s.name}</span></div>
            <div className="text-[11px] text-muted-foreground">{s.location.city}, {s.location.state} · {GROUP_LABEL[s.group]}</div>
            {/* 용량 + 단계 */}
            <div className="mt-2 flex items-baseline gap-1.5 text-[12px]">
              <b className="tabular-nums">{s.capacity_operational_mw ?? "—"}MW</b><span className="text-muted-foreground">운영</span>
              <span className="text-muted-foreground">/ 목표 {s.capacity_target_mw.max ? (s.capacity_target_mw.min === s.capacity_target_mw.max ? `${s.capacity_target_mw.max}` : `${s.capacity_target_mw.min}~${s.capacity_target_mw.max}`) : "—"}MW</span>
            </div>
            <div className="mt-1.5 flex gap-0.5">{STAGES.map((st, i) => <div key={st} className="h-1.5 flex-1 rounded-sm" style={{ background: i <= stageIdx ? GROUP_COLOR[s.group] : "hsl(var(--muted))" }} title={STAGE_KO[st]} />)}</div>
            <div className="mt-0.5 text-[10.5px] text-muted-foreground">{STAGE_KO[s.status_stage]} · {s.status_note}</div>
            {/* 소유·임차 */}
            <div className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11.5px]">
              <span className="text-muted-foreground">개발/소유</span><span>{s.landlord}</span>
              <span className="text-muted-foreground">임차</span><span>{s.tenant ?? "—"}{s.lease_term_years ? ` · ${s.lease_term_years}년` : ""}</span>
              <span className="text-muted-foreground">최종 사용</span><span>{s.end_user ?? "—"}</span>
            </div>
            {/* 신용 래퍼 */}
            <div className="mt-2 flex items-center gap-1.5 text-[11.5px]">
              <span className="text-muted-foreground">신용 래퍼</span><span className="font-medium">{s.credit_wrapper ?? "—"}</span>
              {s.credit_wrapper_rating && <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: creditColor(s.credit_wrapper_rating) + "22", color: creditColor(s.credit_wrapper_rating) }}>{s.credit_wrapper_rating}</span>}
            </div>
            {/* 전력 조달 */}
            {s.power && (() => { const GenI = GEN_ICON[gen];
              return (<div className="mt-2.5 rounded-md border border-border/60 p-2">
                <div className="flex items-center gap-1.5 text-[11.5px] font-semibold"><GenI className="h-3.5 w-3.5" style={{ color: gridColor(s.power.grid_operator) }} />전력 조달 <span className="ml-auto text-[10px] font-normal text-muted-foreground">신뢰도 {s.power.confidence}</span></div>
                <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
                  <span className="text-muted-foreground">계통</span><span><b style={{ color: gridColor(s.power.grid_operator) }}>{s.power.grid_operator}</b>{s.power.utility ? ` · ${s.power.utility}` : ""} <span className="text-muted-foreground">({s.power.grid_share})</span></span>
                  {s.power.onsite_generation.length > 0 && <><span className="text-muted-foreground">현장 발전</span><span>{s.power.onsite_generation.map((g) => `${GEN_KO[gen] && g.type.includes("gas") ? "가스" : g.type.includes("nuclear") || g.type === "smr" ? "원전" : g.type.includes("battery") ? "배터리" : g.type.includes("solar") ? "태양광" : g.type}${g.mw ? ` ${g.mw}MW` : ""}${g.status === "planned" ? "(계획)" : ""}`).join(" · ")}</span></>}
                  {s.power.utility_new_build.length > 0 && <><span className="text-muted-foreground">유틸 신설</span><span>{s.power.utility_new_build.map((g) => `${g.type} ${g.mw ?? ""}MW`).join(" · ")}</span></>}
                </div>
                {s.power.note && <div className="mt-1 text-[10.5px] text-muted-foreground">{s.power.note}</div>}
              </div>); })()}
            {/* 자금 */}
            <div className="mt-2.5">
              <div className="mb-1 text-[11px] text-muted-foreground">자금 조달 {s.financing_total_usd_bn ? `· 총 $${s.financing_total_usd_bn}B` : ""}</div>
              <div className="space-y-0.5">{s.financing.map((f, i) => (
                <div key={i} className="flex items-baseline gap-1.5 text-[11px]"><span className="rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground">{f.type}</span><span className="truncate">{f.party}</span><span className="ml-auto shrink-0 tabular-nums">{f.amount_usd_bn != null ? `$${f.amount_usd_bn}B` : "미공개"}</span></div>
              ))}</div>
            </div>
            {s.notes && <div className="mt-2 text-[11px] leading-snug text-muted-foreground">{s.notes}</div>}
          </div>
        );
      })()}
    </div>
  );
}
