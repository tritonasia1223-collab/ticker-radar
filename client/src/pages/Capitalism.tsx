// 자본주의 경제사 타임라인 — 상단 인과 플로우(마인드맵형) + 하단 FRED 그래프 스택.
// 슬라이더로 연도를 움직이면 현재 지점이 모든 그래프에 강조선으로 표시되고,
// 가장 가까운 사건 플로우가 하이라이트된다. 우측 카드 없음 — 플로우가 상단에 가로로 정렬.
import { useMemo, useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, History } from "lucide-react";
import { FlowColumn } from "@/components/CapFlow";
import { CapChartPanel } from "@/components/CapChartPanel";
import { CapFlowEditor } from "@/components/CapFlowEditor";
import { PANELS, CATEGORIES, CAT_COLORS, toFracYear } from "@/lib/capitalism-config";
import type { FlowDTO } from "@/lib/capitalism-types";
import seriesData from "@/data/capitalism-series.json";

type SeriesMap = Record<string, [string, number][]>;
const SERIES = seriesData as unknown as SeriesMap;

const YEAR_MIN = 1971;
const YEAR_MAX = 1980;

export default function Capitalism() {
  const qc = useQueryClient();
  const { data: flows, isLoading } = useQuery<FlowDTO[]>({ queryKey: ["/api/capitalism/flows"] });

  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(PANELS.map((p) => [p.id, p.on]))
  );
  const [playYear, setPlayYear] = useState(1973.8);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<FlowDTO | null>(null);

  const flowRowRef = useRef<HTMLDivElement>(null);

  // 슬라이더 범위: 데이터가 있으면 그 범위, 없으면 기본 1971~1980.
  const [fromY, toY] = useMemo(() => {
    if (!flows || flows.length === 0) return [YEAR_MIN, YEAR_MAX];
    const years = flows.map((f) => toFracYear(f.date));
    return [Math.floor(Math.min(...years, YEAR_MIN)), Math.ceil(Math.max(...years, YEAR_MAX))];
  }, [flows]);

  // 현재 playYear 에 가장 가까운 플로우 = 활성.
  const activeSlug = useMemo(() => {
    if (!flows || flows.length === 0) return null;
    let best = flows[0], bestD = Infinity;
    for (const f of flows) {
      const d = Math.abs(toFracYear(f.date) - playYear);
      if (d < bestD) { bestD = d; best = f; }
    }
    return best.slug;
  }, [flows, playYear]);

  // 활성 플로우로 가로 스크롤 이동.
  useEffect(() => {
    if (!activeSlug || !flowRowRef.current) return;
    const el = flowRowRef.current.querySelector(`[data-testid="flow-${activeSlug}"]`) as HTMLElement | null;
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [activeSlug]);

  const onPanels = PANELS.filter((p) => enabled[p.id]);

  function openNew() { setEditing(null); setEditorOpen(true); }
  function openEdit(f: FlowDTO) { setEditing(f); setEditorOpen(true); }
  function onSaved() { qc.invalidateQueries({ queryKey: ["/api/capitalism/flows"] }); }

  return (
    <div className="p-5 max-w-[1500px] mx-auto">
      {/* header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <History className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-xl font-semibold leading-tight">미국 자본주의 경제사</h1>
            <p className="text-xs text-muted-foreground">사건의 인과 흐름과 거시지표를 한 화면에서</p>
          </div>
        </div>
        <Button onClick={openNew} data-testid="button-new-flow"><Plus className="h-4 w-4 mr-1" /> 플로우 추가</Button>
      </div>

      {/* ── 상단: 인과 플로우 보드 (가로 정렬) ── */}
      <section className="mb-5">
        {isLoading ? (
          <div className="flex gap-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-64 w-[300px] rounded-lg" />)}
          </div>
        ) : !flows || flows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            아직 플로우가 없습니다. 오른쪽 위 “플로우 추가”로 첫 사건을 만들어 보세요.
          </div>
        ) : (
          <div ref={flowRowRef} className="flex gap-3 overflow-x-auto pb-2 items-start">
            {flows.map((f) => (
              <FlowColumn
                key={f.slug}
                flow={f}
                active={f.slug === activeSlug}
                onSelect={(ff) => setPlayYear(toFracYear(ff.date))}
                onEdit={openEdit}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── 슬라이더 (연도 스크럽) ── */}
      <section className="mb-5 rounded-lg border border-border bg-card/40 p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">연도</span>
          <span className="text-lg font-semibold tabular-nums text-primary">{playYear.toFixed(1)}</span>
        </div>
        <input
          type="range"
          min={fromY}
          max={toY}
          step={0.1}
          value={playYear}
          onChange={(e) => setPlayYear(Number(e.target.value))}
          className="w-full accent-primary"
          data-testid="slider-year"
        />
        <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums mt-1">
          <span>{fromY}</span><span>{toY}</span>
        </div>
      </section>

      {/* ── 체크박스 (카테고리별) ── */}
      <section className="mb-4 rounded-lg border border-border bg-card/40 p-3">
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {Object.entries(CATEGORIES).map(([catKey, cat]) => (
            <div key={catKey} className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold" style={{ color: cat.color }}>{cat.label}</span>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {PANELS.filter((p) => p.cat === catKey).map((p) => (
                  <label key={p.id} className="flex items-center gap-1.5 text-[12px] cursor-pointer" data-testid={`toggle-${p.id}`}>
                    <Checkbox
                      checked={enabled[p.id]}
                      onCheckedChange={(v) => setEnabled((prev) => ({ ...prev, [p.id]: !!v }))}
                    />
                    <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />
                    {p.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── 하단: 그래프 스택 (small multiples) ── */}
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {onPanels.length === 0 ? (
          <div className="col-span-full text-center text-sm text-muted-foreground py-8">
            표시할 지표를 위에서 선택하세요.
          </div>
        ) : (
          onPanels.map((p) => (
            <CapChartPanel
              key={p.id}
              panel={p}
              series={SERIES[p.series]}
              fromYear={fromY}
              toYear={toY}
              playYear={playYear}
            />
          ))
        )}
      </section>

      <CapFlowEditor open={editorOpen} onOpenChange={setEditorOpen} initial={editing} onSaved={onSaved} />
    </div>
  );
}
