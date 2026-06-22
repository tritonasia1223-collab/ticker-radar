// 사건 인사이트 패널 — 오른쪽(그래프 자리)에 떠서 과거↔현재 연결 인사이트를 편집/표시.
// 리치텍스트 본문 + 참고 그래프 블록 N개(지표 선택 + 범위, 사건 시점 마커).
import { useState, useRef, useEffect } from "react";
import { X, Star, Plus, Pencil } from "lucide-react";
import { CapRichEditor } from "@/components/CapRichEditor";
import { CapRichText } from "@/components/CapRichText";
import { PanelChart } from "@/components/CapChartPanel";
import { PANELS, toFracYear } from "@/lib/capitalism-config";
import type { FlowDTO, CapInsight, CapInsightChart } from "@/lib/capitalism-types";
import seriesData from "@/data/capitalism-series.json";

const SERIES = seriesData as unknown as Record<string, [string, number][]>;
const panelFor = (key: string) => PANELS.find((p) => p.series === key) ?? PANELS[0];
// 해당 지표 데이터의 마지막(최신) 연도.
function lastYearOf(key: string): number {
  const arr = SERIES[key];
  return arr && arr.length ? Math.ceil(toFracYear(arr[arr.length - 1][0])) : 2026;
}
function firstYearOf(key: string): number {
  const arr = SERIES[key];
  return arr && arr.length ? Math.floor(toFracYear(arr[0][0])) : 1940;
}

export function InsightPanel({
  flow, onCommit, onClose,
}: {
  flow: FlowDTO;
  onCommit: (slug: string, insight: CapInsight) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(flow.insight?.text ?? "");
  const [charts, setCharts] = useState<CapInsightChart[]>(flow.insight?.charts ?? []);
  const textRef = useRef(text);
  textRef.current = text;
  const chartsRef = useRef(charts);
  chartsRef.current = charts;

  // 다른 카드의 별을 누르면 그 사건 인사이트로 재시드.
  useEffect(() => {
    setText(flow.insight?.text ?? "");
    setCharts(flow.insight?.charts ?? []);
    textRef.current = flow.insight?.text ?? "";
  }, [flow.slug]);

  // 사건 시점(소수 연도) — 참고 그래프에 점선 마커로 표시.
  const eventFrac = toFracYear(flow.date);

  // 저장(본문/그래프 합쳐). 변경 없으면 스킵.
  const commit = (nextText: string, nextCharts: CapInsightChart[]) => {
    const cur = flow.insight ?? { text: "", charts: [] };
    if ((cur.text ?? "") === nextText && JSON.stringify(cur.charts ?? []) === JSON.stringify(nextCharts)) return;
    onCommit(flow.slug, { text: nextText, charts: nextCharts });
  };

  // doCommit=false 면 로컬만 갱신(입력 중), blur/구조변경 때만 저장(POST 폭주 방지).
  const applyCharts = (next: CapInsightChart[], doCommit: boolean) => {
    setCharts(next);
    if (doCommit) commit(textRef.current, next);
  };
  const addChart = () => {
    // 기본: 달러지수, 사건 시점 → 최신. '범위 자유' — 이후 자유 조절.
    const key = "dollar";
    applyCharts([...charts, { series: key, from: Math.floor(eventFrac), to: lastYearOf(key) }], true);
  };
  const patchChart = (i: number, patch: Partial<CapInsightChart>, doCommit: boolean) =>
    applyCharts(charts.map((c, j) => (j === i ? { ...c, ...patch } : c)), doCommit);
  const removeChart = (i: number) => applyCharts(charts.filter((_, j) => j !== i), true);
  const commitCharts = () => commit(textRef.current, chartsRef.current);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card/40 p-3">
      <div className="flex items-start justify-between gap-2 border-b border-border/50 pb-2">
        <div className="min-w-0">
          <div className="text-[11px] tabular-nums text-muted-foreground">
            {flow.endDate ? `${flow.date} ~ ${flow.endDate}` : flow.date}
          </div>
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <Star className="h-3.5 w-3.5 shrink-0 text-red-500" fill="currentColor" />
            <span className="truncate">{flow.title}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex shrink-0 items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          title="그래프로 돌아가기"
          data-testid="insight-close"
        >
          <X className="h-3.5 w-3.5" /> 그래프
        </button>
      </div>

      <div className="text-[11px] text-muted-foreground/70">
        이 사건과 <b className="text-foreground/80">지금</b>을 어떻게 연결할 수 있을까? — 과거↔현재 인사이트
      </div>

      <CapRichEditor
        value={text}
        onChange={setText}
        onBlur={() => commit(textRef.current, charts)}
        rows={12}
        placeholder="인사이트를 적어보세요. (드래그로 색·하이라이트 · '- '로 불릿)"
      />

      {/* ── 참고 그래프 블록 ── */}
      <div className="flex flex-col gap-2">
        {charts.map((c, i) => {
          const panel = panelFor(c.series);
          const lo = firstYearOf(c.series);
          const hi = lastYearOf(c.series);
          return (
            <div key={i} className="rounded-md border border-border/60 bg-background/40 p-2">
              <div className="mb-1 flex items-center gap-1.5">
                <select
                  value={c.series}
                  onChange={(e) => patchChart(i, { series: e.target.value }, true)}
                  className="min-w-0 flex-1 rounded border border-border bg-background px-1 py-0.5 text-[11px] text-foreground"
                  data-testid={`insight-chart-series-${i}`}
                >
                  {PANELS.map((p) => <option key={p.id} value={p.series}>{p.label}</option>)}
                </select>
                <input
                  type="number" value={c.from} min={lo} max={hi}
                  onChange={(e) => patchChart(i, { from: Number(e.target.value) }, false)}
                  onBlur={commitCharts}
                  className="w-14 rounded border border-border bg-background px-1 py-0.5 text-[11px] tabular-nums text-foreground"
                  title="시작 연도" data-testid={`insight-chart-from-${i}`}
                />
                <span className="text-[11px] text-muted-foreground">~</span>
                <input
                  type="number" value={c.to} min={lo} max={hi}
                  onChange={(e) => patchChart(i, { to: Number(e.target.value) }, false)}
                  onBlur={commitCharts}
                  className="w-14 rounded border border-border bg-background px-1 py-0.5 text-[11px] tabular-nums text-foreground"
                  title="끝 연도" data-testid={`insight-chart-to-${i}`}
                />
                <button
                  type="button" onClick={() => removeChart(i)}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
                  title="그래프 제거" data-testid={`insight-chart-remove-${i}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mb-0.5 flex items-center gap-1.5 px-0.5">
                <span className="h-2 w-2 rounded-sm" style={{ background: panel.color }} />
                <span className="text-[11px] font-medium">{panel.label}</span>
                <span className="text-[10px] text-muted-foreground tabular-nums">{panel.unit}</span>
              </div>
              {/* 사건 시점(eventFrac)을 점선 마커로 표시 → '이 사건이 여기' 시각 앵커 */}
              <PanelChart
                panel={panel} series={SERIES[c.series]}
                fromYear={Math.min(c.from, c.to)} toYear={Math.max(c.from, c.to)}
                playYear={eventFrac} yMode="window" height={130} unit={panel.unit}
              />
            </div>
          );
        })}
        <button
          type="button" onClick={addChart}
          className="flex items-center justify-center gap-1 rounded-md border border-dashed border-border/70 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary"
          data-testid="insight-add-chart"
        >
          <Plus className="h-3.5 w-3.5" /> 참고 그래프 추가
        </button>
      </div>
    </div>
  );
}

// 읽기 전용 참고 그래프(모아보기용). 컨트롤 없이 차트 + 라벨만.
function InsightChartView({ chart }: { chart: CapInsightChart }) {
  const panel = panelFor(chart.series);
  const from = Math.min(chart.from, chart.to);
  const to = Math.max(chart.from, chart.to);
  return (
    <div className="rounded-md border border-border/60 bg-background/40 p-2">
      <div className="mb-0.5 flex items-center gap-1.5 px-0.5">
        <span className="h-2 w-2 rounded-sm" style={{ background: panel.color }} />
        <span className="text-[11px] font-medium">{panel.label}</span>
        <span className="text-[10px] text-muted-foreground tabular-nums">{panel.unit} · {from}~{to}</span>
      </div>
      <PanelChart
        panel={panel} series={SERIES[chart.series]}
        fromYear={from} toYear={to}
        playYear={0} yMode="window" height={150} unit={panel.unit}
      />
    </div>
  );
}

// 인사이트 모아보기 — 인사이트가 있는 사건을 시간순으로 한 편의 글처럼 읽는 뷰.
// (메타 테제 공간은 Phase D2 예정)
export function InsightsCollection({
  flows, onOpenInsight, onJump,
}: {
  flows: FlowDTO[];
  onOpenInsight: (slug: string) => void;
  onJump?: (slug: string) => void;
}) {
  const items = flows
    .filter((f) => f.insight && (f.insight.text.trim() || f.insight.charts.length))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-3xl py-16 text-center text-sm text-muted-foreground">
        아직 인사이트가 없습니다. 타임라인에서 사건 카드의 <Star className="inline h-3.5 w-3.5 text-red-500" fill="currentColor" /> 별을 눌러 인사이트를 적어보세요.
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 py-2">
      {items.map((f) => {
        const eventFrac = toFracYear(f.date);
        return (
          <article key={f.slug} className="border-b border-border/40 pb-6 last:border-0">
            <header className="mb-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] tabular-nums text-muted-foreground">
                  {f.endDate ? `${f.date} ~ ${f.endDate}` : f.date}
                </div>
                <h3 className="flex items-center gap-1.5 text-base font-bold">
                  <Star className="h-4 w-4 shrink-0 text-red-500" fill="currentColor" />
                  {f.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => onOpenInsight(f.slug)}
                className="flex shrink-0 items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                title="타임라인에서 편집"
                data-testid={`insight-edit-${f.slug}`}
              >
                <Pencil className="h-3 w-3" /> 편집
              </button>
            </header>
            {f.insight!.text.trim() ? (
              <CapRichText text={f.insight!.text} className="block text-[13.5px] leading-relaxed text-foreground" onJump={onJump} />
            ) : null}
            {f.insight!.charts.length ? (
              <div className="mt-3 flex flex-col gap-2">
                {f.insight!.charts.map((c, i) => <InsightChartView key={i} chart={c} />)}
              </div>
            ) : null}
            <div className="sr-only">{eventFrac}</div>
          </article>
        );
      })}
    </div>
  );
}
