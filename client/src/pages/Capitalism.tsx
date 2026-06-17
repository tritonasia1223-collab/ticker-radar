// 자본주의 경제사 타임라인 — 상단 인과 플로우(연도 그룹) + 하단 FRED 그래프 스택.
// 연도가 대분류, 그 안의 사건들이 소분류로 묶인다. 슬라이더로 연도 스크럽.
// 편집은 전부 인라인(팝업 없음): 카드 클릭→텍스트 편집, 호버 +버튼→칸 추가, X→칸 삭제.
import { useMemo, useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus } from "lucide-react";
import { FlowColumn, type MutateNodes, type MutateMeta } from "@/components/CapFlow";
import { CapChartPanel } from "@/components/CapChartPanel";
import { PANELS, CATEGORIES, toFracYear, fracYearToLabel } from "@/lib/capitalism-config";
import { persistNodes, toInput, newNodeKey } from "@/lib/capitalism-flowops";
import { apiRequest } from "@/lib/queryClient";
import type { FlowDTO, FlowNodeDTO, FlowInputDTO } from "@/lib/capitalism-types";
import seriesData from "@/data/capitalism-series.json";

type SeriesMap = Record<string, [string, number][]>;
const SERIES = seriesData as unknown as SeriesMap;

const YEAR_MIN = 1971;
const YEAR_MAX = 1980;

// 소수 연도 → YYYY-MM-DD (월 1일). 새 사건 기본 날짜 산출용.
function fracYearToDate(frac: number): string {
  const year = Math.floor(frac);
  let month = Math.floor((frac - year) * 12) + 1;
  if (month < 1) month = 1;
  if (month > 12) month = 12;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

export default function Capitalism() {
  const qc = useQueryClient();
  const { data: flows, isLoading } = useQuery<FlowDTO[]>({ queryKey: ["/api/capitalism/flows"] });

  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(PANELS.map((p) => [p.id, p.on]))
  );
  const [playYear, setPlayYear] = useState(1973.8);
  // 어느 노드가 인라인 편집 중인지 — 전역으로 1개만.
  const [editingId, setEditingId] = useState<string | null>(null);
  // 가로 보드 컨테이너 ref — active 카드 가로 추적용(세로는 절대 안 건드림).
  const boardRef = useRef<HTMLDivElement | null>(null);

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

  // active 카드가 보드 뷰포트 밖이면 가로로만 부드럽게 스크롤(세로는 절대 안 건드림).
  // scrollIntoView 는 세로까지 움직이므로 쓰지 않고 scrollLeft 만 직접 조정.
  useEffect(() => {
    const board = boardRef.current;
    if (!board || !activeSlug) return;
    const card = board.querySelector<HTMLElement>(`[data-testid="flow-${activeSlug}"]`);
    if (!card) return;
    // 보드 컴테이너 기준 카드의 좌/우 위치(현재 스크롤 포함).
    const boardBox = board.getBoundingClientRect();
    const cardBox = card.getBoundingClientRect();
    const cardLeft = cardBox.left - boardBox.left + board.scrollLeft;
    const cardRight = cardLeft + cardBox.width;
    const viewLeft = board.scrollLeft;
    const viewRight = viewLeft + board.clientWidth;
    const pad = 24; // 가장자리 여백
    let next = viewLeft;
    if (cardLeft < viewLeft + pad) next = cardLeft - pad;            // 왼쪽 밖 → 당겨오기
    else if (cardRight > viewRight - pad) next = cardRight - board.clientWidth + pad; // 오른쪽 밖 → 밀어주기
    if (Math.abs(next - viewLeft) > 1) {
      board.scrollTo({ left: Math.max(0, next), behavior: "smooth" });
    }
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

  // 시대(decade) 네비 — 데이터에 존재하는 연대만 자동 생성. 각 연대의 첫 사건(slug/연도) 보관.
  // 80년대 이후 사건을 추가하면 자동으로 1980s 칩이 생긴다.
  const decades = useMemo(() => {
    if (!flows || flows.length === 0) return [] as { decade: number; label: string; firstFrac: number; firstSlug: string }[];
    const map = new Map<number, { firstFrac: number; firstSlug: string }>();
    for (const f of flows) {
      const frac = toFracYear(f.date);
      const decade = Math.floor(frac / 10) * 10;
      const cur = map.get(decade);
      if (!cur || frac < cur.firstFrac) map.set(decade, { firstFrac: frac, firstSlug: f.slug });
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([decade, v]) => ({ decade, label: `${decade}s`, firstFrac: v.firstFrac, firstSlug: v.firstSlug }));
  }, [flows]);

  // 현재 active 사건이 속한 연대(칩 하이라이트용).
  const activeDecade = useMemo(() => Math.floor(playYear / 10) * 10, [playYear]);

  const onPanels = PANELS.filter((p) => enabled[p.id]);

  // 노드 배열 통째 저장(빈 칸 정리, 전부 비면 플로우 삭제). 낙관적 캐시 갱신.
  const mutate = useMutation({
    mutationFn: ({ flow, nodes }: { flow: FlowDTO; nodes: FlowNodeDTO[] }) =>
      persistNodes(flow, nodes),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/capitalism/flows"] }),
  });

  // 카드 안에서 칸을 추가만 할 때(빈 칸) — 캐시에만 반영, 서버 저장은 입력 완료(commit) 시.
  // 전달된 flow의 layout도 함께 동기화(stack→branch 자동 전환 시 캐시 layout 갱신).
  const onAddLocal: MutateNodes = (flow, nextNodes) => {
    qc.setQueryData<FlowDTO[]>(["/api/capitalism/flows"], (prev) =>
      prev ? prev.map((f) => (f.slug === flow.slug ? { ...f, layout: flow.layout, nodes: nextNodes } : f)) : prev
    );
  };

  // 칸 내용 확정/삭제 — 캐시 즉시 반영 + 서버 저장(빈 칸 정리, 전부 비면 플로우 삭제).
  const onMutateNodes: MutateNodes = (flow, nextNodes) => {
    qc.setQueryData<FlowDTO[]>(["/api/capitalism/flows"], (prev) => {
      if (!prev) return prev;
      const clean = nextNodes.filter((n) => n.text.trim());
      if (clean.length === 0) return prev.filter((f) => f.slug !== flow.slug);
      return prev.map((f) => (f.slug === flow.slug ? { ...f, nodes: clean } : f));
    });
    mutate.mutate({ flow, nodes: nextNodes });
  };

  // 카드 메타(날짜/제목/레이아웃) 변경 — year 자동 재산출, 날짜순 재정렬, 서버 upsert 저장.
  // 날짜를 바꾸면 그룹/슬라이더 범위가 자동으로 갱신되어 다른 연도로 카드가 이동한다.
  const onMutateMeta: MutateMeta = (flow, patch) => {
    const nextDate = patch.date ?? flow.date;
    const nextYear = patch.date ? Number(patch.date.slice(0, 4)) : flow.year;
    const merged: FlowDTO = {
      ...flow,
      date: nextDate,
      year: nextYear,
      title: patch.title ?? flow.title,
      layout: patch.layout ?? flow.layout,
    };
    qc.setQueryData<FlowDTO[]>(["/api/capitalism/flows"], (prev) => {
      if (!prev) return prev;
      const updated = prev.map((f) => (f.slug === flow.slug ? merged : f));
      return [...updated].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.sortOrder - b.sortOrder));
    });
    const cleanNodes = merged.nodes.filter((n) => n.text.trim());
    apiRequest("POST", "/api/capitalism/flows", toInput(merged, cleanNodes.length ? cleanNodes : merged.nodes))
      .then(() => qc.invalidateQueries({ queryKey: ["/api/capitalism/flows"] }))
      .catch(() => qc.invalidateQueries({ queryKey: ["/api/capitalism/flows"] }));
  };

  // 새 사건(플로우) 추가 — 팝업 없이 기본값으로 생성하고 첫 칸을 편집 모드로.
  const addFlow = useMutation({
    mutationFn: async () => {
      const date = fracYearToDate(playYear);
      const slug = `flow-${Date.now().toString(36)}`;
      const firstKey = newNodeKey();
      const payload: FlowInputDTO = {
        slug,
        title: "새 사건",
        date,
        year: Number(date.slice(0, 4)),
        category: "경제",
        layout: "stack",
        nodes: [{ nodeKey: firstKey, kind: "effect", inLabel: null, text: "새 사건", ref: null, col: null }],
        edges: [],
      };
      await apiRequest("POST", "/api/capitalism/flows", payload);
      return { slug, firstKey };
    },
    onSuccess: async ({ firstKey }) => {
      await qc.invalidateQueries({ queryKey: ["/api/capitalism/flows"] });
      setEditingId(firstKey);
    },
  });

  return (
    <div className="p-5 max-w-[1500px] mx-auto">
      {/* 상단 안내 헤더 제거 — 세로 공간 최대 확보. 사건 추가는 타임라인 맨 오른쪽 빈 칸으로. */}

      {/* ── 상단: 연도 그룹 → 사건 플로우 보드 ── */}
      <section className="mb-4">
        {isLoading ? (
          <div className="flex gap-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-64 w-[300px] rounded-lg" />)}
          </div>
        ) : (
          <div ref={boardRef} className="cap-noscrollbar flex gap-5 overflow-x-auto pb-2 items-stretch">
            {groups.map((g) => (
              <div key={g.year} className="flex flex-col shrink-0">
                {/* 연도 대분류 헤더 */}
                <div className="flex items-center gap-2 mb-1.5 px-1">
                  <span className="text-base font-bold tabular-nums text-primary">{g.year}</span>
                  <span className="text-[11px] text-muted-foreground">· {g.items.length}건</span>
                </div>

                {/* 가로 레일(타임라인 선) + 사건별 원 마커 — 마커 영역 높이 고정(active여도 카드가 안 밀림) */}
                <div className="relative px-2 pt-1 pb-2">
                  {/* 레일 선: 첫 마커 ~ 마지막 마커 사이를 가로지름 */}
                  <div
                    className="absolute top-[12px] h-[2px] bg-border"
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
                          {/* 고정 높이 슬롯 안에서 점만 커짐 → 레이아웃 흔들림 없음 */}
                          <span className="flex h-6 w-6 items-center justify-center">
                            <span
                              className={`block rounded-full transition-all ${
                                isActive
                                  ? "h-4 w-4 bg-primary ring-4 ring-primary/25"
                                  : "h-2.5 w-2.5 bg-muted-foreground/40 hover:bg-primary/60"
                              }`}
                            />
                          </span>
                          <span
                            className={`mt-0.5 text-[10px] tabular-nums transition-colors ${
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

                {/* 같은 연도 사건들 = 소분류. flex-1 + items-stretch 로 그룹 높이를 채워
                    연도 그룹끼리(1971 vs 1973) 카드 높이가 동일하게 맞춰짐. */}
                <div className="flex flex-1 items-stretch gap-2 rounded-xl bg-muted/30 p-2">
                  {g.items.map((f) => (
                    <FlowColumn
                      key={f.slug}
                      flow={f}
                      active={f.slug === activeSlug}
                      onSelect={(ff) => setPlayYear(toFracYear(ff.date))}
                      onMutateNodes={onMutateNodes}
                      onAddLocal={onAddLocal}
                      onMutateMeta={onMutateMeta}
                      editingId={editingId}
                      setEditingId={setEditingId}
                      editable
                    />
                  ))}
                </div>
              </div>
            ))}

            {/* ── 타임라인 맨 오른쪽 “+ 사건 추가” 빈 칸 — 클릭 시 현재 연도에 새 사건 생성 ── */}
            <div className="flex flex-col shrink-0">
              {/* 연도 헤더 자리 — 높이 정렬용 빈 공간 */}
              <div className="flex items-center gap-2 mb-1.5 px-1">
                <span className="text-base font-bold tabular-nums text-transparent select-none">+</span>
              </div>
              {/* 마커 레일 자리 — 높이 정렬용 빈 공간 */}
              <div className="relative px-2 pt-1 pb-2">
                <span className="flex h-6 w-6 items-center justify-center" />
                <span className="mt-0.5 block text-[10px]">&nbsp;</span>
              </div>
              {/* 본문 자리 — 점선 추가 버튼(그룹 높이만큼 세로로 채움) */}
              <button
                type="button"
                onClick={() => addFlow.mutate()}
                disabled={addFlow.isPending}
                className="flex w-[180px] flex-1 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border/70 bg-muted/10 p-4 text-muted-foreground transition-colors hover:border-primary/60 hover:bg-primary/5 hover:text-primary disabled:opacity-50"
                data-testid="button-new-flow"
                title="현재 연도에 새 사건 추가"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-current">
                  <Plus className="h-5 w-5" />
                </span>
                <span className="text-xs font-medium">사건 추가</span>
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── 연도 슬라이더 (좌: 연도·시대칩 / 우: 슬라이더) — 한 줄로 압축해 세로 공간 확보 ── */}
      <section className="mb-3 flex items-center gap-4 rounded-lg border border-border bg-card/40 px-4 py-2.5">
        {/* 좌측: “연도” 라벨 + 10년 단위 시대 네비 칩 */}
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-sm font-medium">연도</span>
          {decades.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1" data-testid="decade-nav">
              {decades.map((d) => {
                const isActive = d.decade === activeDecade;
                return (
                  <button
                    key={d.decade}
                    type="button"
                    onClick={() => setPlayYear(d.firstFrac)}
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium tabular-nums transition-colors ${
                      isActive
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border/70 text-muted-foreground hover:border-primary/50 hover:text-foreground"
                    }`}
                    data-testid={`decade-${d.decade}`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        {/* 우측: 현재값 라벨 + 슬라이더 트랙 + 범위 */}
        <div className="min-w-0 flex-1">
          {/* 현재값 라벨 — 핸들(현재 지점) 바로 위에 따라감 */}
          <div className="relative h-5">
            {(() => {
              const pct = toY > fromY ? ((playYear - fromY) / (toY - fromY)) * 100 : 0;
              // 라벨이 컨테이너 밖으로 잘리지 않도록 6~94% 범위로 클램프.
              const clamped = Math.min(94, Math.max(6, pct));
              return (
                <div
                  className="absolute -translate-x-1/2 whitespace-nowrap rounded-md bg-primary px-2 py-0.5 text-[11px] font-semibold tabular-nums text-primary-foreground shadow"
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
          <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
            <span>{fromY}</span><span>{toY}</span>
          </div>
        </div>
      </section>

      {/* ── 그래프 스택 (체크박스보다 위) ── */}
      <section className="mb-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {onPanels.length === 0 ? (
          <div className="col-span-full text-center text-sm text-muted-foreground py-8">
            표시할 지표를 아래에서 선택하세요.
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

      {/* ── 하단: 체크박스 (카테고리별) ── */}
      <section className="rounded-lg border border-border bg-card/40 p-3">
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
    </div>
  );
}
