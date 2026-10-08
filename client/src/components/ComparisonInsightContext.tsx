import { useMemo, useState } from "react";
import { COMPARE_SERIES, seriesLabel, activeSeriesIds, makeSpread } from "@/lib/comparison-series";
import { periodChange, changePresentation, periodChangeQuote } from "@/lib/comparison-period-change";
import { collaboration } from "@/lib/cap-collab-client";
import { comparisonInsightSchema, monthlyPoints, type SavedInsight, type InsightContext, type Observation } from "../../../shared/cap-comparison";

export function ComparisonInsightContext({ note, currentContext, seriesData, canEdit, onRestore, summary = false }: {
  note: SavedInsight; currentContext: InsightContext; seriesData: Record<string, Observation[]> | undefined;
  canEdit: boolean; onRestore: (context: InsightContext, note: SavedInsight) => void;
  summary?: boolean;
}) {
  const [error, setError] = useState("");
  const context = note.context, ids = context?.ids ?? currentContext.ids;
  const savedSpread = context ? context.spread : currentContext.spread;
  const spread = useMemo(() => makeSpread(savedSpread, seriesData), [savedSpread, seriesData]);
  const summaries = useMemo(() => {
    if (!note.endDate) return [];
    const rows = ids.map(id => {
      const def = COMPARE_SERIES.find(s => s.id === id);
      return { id, label: seriesLabel(id), unit: def?.unit ?? "", color: def?.color,
        ...periodChange(id, def ? monthlyPoints(seriesData?.[id] ?? []) : [], note.date, note.endDate!) };
    });
    if (spread) rows.push({ id: "spread", label: spread.label, unit: "%p", color: "#8b5cf6", ...periodChange("spread", spread.points, note.date, note.endDate) });
    return rows;
  }, [ids, note.date, note.endDate, seriesData, spread]);
  const save = (patch: object) => {
    const key = "note:" + note.id, current = collaboration.get(key);
    if (!current) return;
    const parsed = comparisonInsightSchema.safeParse({ ...current, ...patch });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    collaboration.edit(key, { ...parsed.data }); setError("");
  };
  const quote = () => {
    const quoteText = periodChangeQuote(summaries, note.date, note.endDate!);
    const current = collaboration.get("note:" + note.id);
    if (!current || !quoteText) return;
    save({ text: [current.text, quoteText].filter(Boolean).join("\n\n") });
  };
  return <div className="space-y-4">
    {!summary && <section className="rounded-lg border bg-muted/10 p-3" aria-label="인사이트 관련 그래프">
      <div className="mb-2 flex items-center justify-between gap-2"><h3 className="text-xs font-semibold">관련 그래프</h3>{context && (!!activeSeriesIds(context.ids).length || !!context.spread) && <button className="rounded border px-2 py-1 text-[11px] hover:bg-muted" onClick={() => onRestore(context, note)}>관련 그래프 보기</button>}</div>
      {context ? <><div className="flex flex-wrap gap-1.5">{context.ids.map(id => { const def = COMPARE_SERIES.find(s => s.id === id); return <span key={id} className="rounded border bg-background px-2 py-1 text-[10px]" style={{ borderColor: def ? def.color + "60" : undefined }}>{seriesLabel(id)}{def ? currentContext.ids.includes(id) ? " · 표시 중" : " · 숨김" : ""}</span>; })}{spread && <span className="rounded border border-violet-500/30 px-2 py-1 text-[10px] text-violet-500">{spread.label}{JSON.stringify(currentContext.spread) === JSON.stringify(context.spread) ? " · 표시 중" : " · 숨김"}</span>}</div>{!context.ids.length && !context.spread && <p className="text-[11px] text-muted-foreground">연결된 그래프가 없습니다.</p>}</> : <p className="text-[11px] leading-5 text-muted-foreground">이전에 작성한 글에는 관련 그래프가 저장되어 있지 않습니다. 지금 보고 있는 지표를 연결할 수 있습니다.</p>}
      {context?.alignment && <p className="mt-2 text-[11px] text-muted-foreground">작성 당시 실험 설정 · 중앙 기준선 정렬 · {context.alignment.from || context.alignment.to ? <>참고 기간 {context.alignment.from ?? "자료 시작"} ~ {context.alignment.to ?? "자료 끝"}</> : "전체 자료 기준"}</p>}
      {context?.ids.includes("dollar") && <p className="mt-2 text-[11px] text-muted-foreground">기존 접합 달러지수는 삭제됐습니다. 관련 지표를 새로 선택해 주세요.</p>}
      {context?.ids.includes("inflation") && <p className="mt-2 text-[11px] text-muted-foreground">이 기록의 CPI YoY는 비교 목록에서 제외됐습니다. 물가 수준(CPI)은 별도 지표입니다.</p>}
      {context && canEdit && <p className="mt-2 text-[10px] leading-4 text-muted-foreground">작성 시 표시된 지표·스프레드·축 설정이 자동 입력됩니다. 필요할 때만 아래에서 수정하세요.</p>}
      {canEdit && <details className="mt-3 text-[11px]"><summary className="cursor-pointer text-muted-foreground">관련 그래프 수정</summary><button className="my-2 rounded border px-2 py-1" onClick={() => save({ context: { view: currentContext.view, alignment: currentContext.alignment, ids: [...currentContext.ids], spread: currentContext.spread ? { ...currentContext.spread } : null } })}>{context ? "현재 표시 그래프로 바꾸기" : "현재 그래프 연결"}</button><div className="grid grid-cols-1 gap-1.5">{COMPARE_SERIES.map(s => {
        const chosen = context?.ids.includes(s.id) ?? false;
        return <label key={s.id} className="flex items-center gap-2"><input type="checkbox" aria-label={"관련 지표 " + s.label} checked={chosen} onChange={e => save({ context: { view: context?.view, alignment: context?.alignment, ids: e.target.checked ? [...(context?.ids ?? []), s.id] : (context?.ids ?? []).filter(id => id !== s.id), spread: context?.spread ?? null } })} />{s.label}</label>;
      })}</div><p className="mt-2 text-muted-foreground">위 버튼으로 현재 켜 둔 지표와 스프레드를 함께 반영할 수 있습니다. 화면의 그래프를 켜고 꺼도 이 글에 저장된 목록은 유지됩니다.</p>{context?.spread && <button className="mt-2 underline" onClick={() => save({ context: { ...context, spread: null } })}>스프레드 연결 해제</button>}</details>}
    </section>}
    {summary && note.endDate && <section className="border-t bg-muted/10 px-4 py-3" aria-label="구간 변화 요약" data-testid="period-summary">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2"><h3 className="text-xs font-semibold">이 구간의 변화</h3><span className="mr-auto text-[10px] text-muted-foreground">{note.date} ~ {note.endDate}</span>{canEdit && <button className="rounded border px-2 py-1 text-[11px] disabled:opacity-40" disabled={!summaries.some(r => r.result)} onClick={quote}>본문에 인용</button>}</div>
      {!summaries.length && <p className="mt-3 text-sm text-muted-foreground">관련 지표를 연결하면 구간 변화를 볼 수 있습니다.</p>}
      <div className="mt-3 grid gap-x-6 gap-y-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))" }}>{summaries.map(row => {
        const change = row.result ? changePresentation(row.result, row.unit) : null;
        return <div key={row.id} className="min-w-0 border-t pt-3" data-testid={"summary-" + row.id}>
          <div className="flex items-start gap-2">
            <span className="mt-2 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: row.color ?? "currentColor" }} aria-hidden="true" />
            <h4 className="text-base font-semibold leading-6 text-foreground">{row.label}</h4>
            {change && <span className={"shrink-0 text-lg font-semibold leading-6 " + (change.direction === "up" ? "text-red-600 dark:text-red-400" : change.direction === "down" ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground")} aria-label={change.label} title={change.label}>{change.symbol}</span>}
          </div>
          <p className="mt-1.5 pl-4 text-sm tabular-nums leading-6 text-foreground">{change ? change.line : seriesData ? "비교 자료 부족" : "불러오는 중…"}</p>
          {row.annual && <p className="mt-1 pl-4 text-[11px] text-muted-foreground" title="점선은 연간 관측값을 연결한 참고선입니다. 구간 안 실제 관측값만 비교하며 중간 값을 추정하지 않습니다.">연간 자료 · 참고</p>}
        </div>;
      })}</div>
      <p className="mt-3 text-[11px] text-muted-foreground">구간 내 첫 값 → 마지막 값 (증감)</p>
    </section>}
    {error && <p role="alert" className="text-xs text-amber-600">{error}</p>}
  </div>;
}
