// 자본주의 경제사 타임라인 — 상단 인과 플로우(연도 그룹) + 하단 FRED 그래프 스택.
// 연도가 대분류, 그 안의 사건들이 소분류로 묶인다. 슬라이더로 연도 스크럽.
import { useMemo, useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, History } from "lucide-react";
import { FlowColumn, type NodeAddReq } from "@/components/CapFlow";
import { CapChartPanel } from "@/components/CapChartPanel";
import { CapFlowEditor, type PendingAdd } from "@/components/CapFlowEditor";
import { PANELS, CATEGORIES, toFracYear, fracYearToLabel } from "@/lib/capitalism-config";
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
  const [pendingAdd, setPendingAdd] = useState<PendingAdd | null>(null);

  const flowRowRef = useRef<HTMLDivElement>(null);

  const [fromY, toY] = useMemo(() => {
    if (!flows || flows.length === 0) return [YEAR_MIN, YEAR_MAX];
    const years = flows.map((f) => toFracYear(f.date));
    return [Math.floor(Math.min(...years, YEAR_MIN)), Math.ceil(Math.max(...years, YEAR_MAX))];
  }, [flows]);

  const activeSlug = useMemo(() => {
    if (!flows || flows.length === 0) return null;
    let best = flows[0], bestD = Infinity;
    for (const f of flows) {
      const d = Math.abs(toFracYear(f.date) - playYear);
      if (d < bestD) { bestD = d; best = f; }
    }
    return best.slug;
  }, [flows, playYear]);

  useEffect(() => {
    if (!activeSlug || !flowRowRef.current) return;
    const el = flowRowRef.current.querySelector(`[data-testid="flow-${activeSlug}"]`) as HTMLElement | null;
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [activeSlug]);

  // 연도(대분류) → 사건(소분류) 그룹핑. flows 는 서버에서 날짜순 정렬되어 옴.
  const groups = useMemo(() => {
    if (!flows) return [] as { year: number; items: FlowDTO[] }[];
    const map = new Map<number, FlowDTO[]>();
    for (const f of flows) {
      const y = f.year || Number(f.date.slice(0, 4));
      (map.get(y) ?? map.set(y, []).get(y)!).push(f);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([year, items]) => ({ year, items }));
  }, [flows]);

  const onPanels = PANELS.filter((p) => enabled[p.id]);

  function openNew() { setEditing(null); setPendingAdd(null); setEditorOpen(true); }
  function openEdit(f: FlowDTO) { setEditing(f); setPendingAdd(null); setEditorOpen(true); }
  function onSaved() { qc.invalidateQueries({ queryKey: ["/api/capitalism/flows"] }); }

  // 호버 +버튼: 해당 플로우 편집기를 열되, 기준 노드 뒤에 빈 블록을 추가한 상태로 시작.
  function onAddNode(req: NodeAddReq) {
    setEditing(req.flow);
    setPendingAdd({ afterKey: req.afterKey, dir: req.dir });
    setEditorOpen(true);
  }

  return (
    <div className="p-5 max-w-[1500px] mx-auto">
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

      {/* ── 상단: 연도 그룹 → 사건 플로우 보드 ── */}
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
          <div ref={flowRowRef} className="cap-noscrollbar flex gap-5 overflow-x-auto pb-2 items-stretch">
            {groups.map((g) => (
              <div key={g.year} className="flex flex-col shrink-0">
                {/* 연도 대분류 헤더 */}
                <div className="flex items-center gap-2 mb-1.5 px-1">
                  <span className="text-base font-bold tabular-nums text-primary">{g.year}</span>
                  <span className="text-[11px] text-muted-foreground">· {g.items.length}건</span>
                </div>

                {/* 가로 레일(타임라인 선) + 사건별 원 마커 */}
                <div className="relative px-2 pt-1 pb-2">
                  {/* 레일 선: 첫 마커 ~ 마지막 마커 사이를 가로지름 */}
                  <div
                    className="absolute top-[10px] h-[2px] bg-border"
                    style={{ left: `calc(8px + 140px)`, right: `calc(8px + 140px)` }}
                  />
                  <div className="flex gap-2">
                    {g.items.map((f) => {
                      const isActive = f.slug === activeSlug;
                      return (
                        <button
                          key={f.slug}
                          type="button"
                          onClick={() => setPlayYear(toFracYear(f.date))}
                          className="relative flex w-[280px] shrink-0 flex-col items-center"
                          title={fracYearToLabel(toFracYear(f.date))}
                          data-testid={`marker-${f.slug}`}
                        >
                          <span
                            className={`block rounded-full transition-all ${
                              isActive
                                ? "h-4 w-4 bg-primary ring-4 ring-primary/25"
                                : "h-2.5 w-2.5 bg-muted-foreground/40 hover:bg-primary/60"
                            }`}
                          />
                          <span
                            className={`mt-1 text-[10px] tabular-nums transition-colors ${
                              isActive ? "font-semibold text-primary" : "text-muted-foreground/70"
                            }`}
                          >
                            {fracYearToLabel(toFracYear(f.date)).replace(/^\d+년 /, "")}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 같은 연도 사건들 = 소분류(가로로 인접, 그룹 배경으로 묶음) */}
                <div className="flex gap-2 rounded-xl bg-muted/30 p-2">
                  {g.items.map((f) => (
                    <FlowColumn
                      key={f.slug}
                      flow={f}
                      active={f.slug === activeSlug}
                      onSelect={(ff) => setPlayYear(toFracYear(ff.date))}
                      onEdit={openEdit}
                      onAddNode={onAddNode}
                      editable
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── 슬라이더 (연도 스크럽) ── */}
      <section className="mb-5 rounded-lg border border-border bg-card/40 p-4">
        <div className="mb-2 text-sm font-medium">연도</div>
        {/* 현재값 라벨 — 핸들(현재 지점) 바로 위에 따라감 */}
        <div className="relative h-6">
          {(() => {
            const pct = toY > fromY ? ((playYear - fromY) / (toY - fromY)) * 100 : 0;
            // 핸들 중심은 트랙 양 끝에서 안쪽으로 thumb 반지름만큼 들어감 → 보정.
            // 라벨이 컨테이너 밖으로 잘리지 않도록 6~94% 범위로 클램프.
            const clamped = Math.min(94, Math.max(6, pct));
            return (
              <div
                className="absolute -translate-x-1/2 whitespace-nowrap rounded-md bg-primary px-2 py-0.5 text-[12px] font-semibold tabular-nums text-primary-foreground shadow"
                style={{ left: `${clamped}%`, bottom: 0 }}
                data-testid="text-playyear"
              >
                {fracYearToLabel(playYear)}
              </div>
            );
          })()}
        </div>
        <input
          type="range"
          min={fromY}
          max={toY}
          step={1 / 12}
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

      {/* ── 하단: 그래프 스택 ── */}
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

      <CapFlowEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        initial={editing}
        pendingAdd={pendingAdd}
        onSaved={onSaved}
      />
    </div>
  );
}
