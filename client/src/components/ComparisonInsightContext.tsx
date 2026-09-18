import { useMemo, useState, type ReactNode } from "react";
import { COMPARE_SERIES, makeSpread, numberLabel, signedLabel, deltaUnit } from "@/lib/comparison-series";
import { collaboration } from "@/lib/cap-collab-client";
import { comparisonInsightSchema, monthlyPoints, periodSummary, type SavedInsight, type InsightContext, type Observation } from "../../../shared/cap-comparison";

export function ComparisonInsightContext({ note, currentContext, seriesData, canEdit, onRestore, children }: {
  note: SavedInsight; currentContext: InsightContext; seriesData: Record<string, Observation[]> | undefined;
  canEdit: boolean; onRestore: (context: InsightContext, note: SavedInsight) => void;
  children: ReactNode;
}) {
  const [error, setError] = useState("");
  const context = note.context, ids = context?.ids ?? currentContext.ids;
  const savedSpread = context ? context.spread : currentContext.spread;
  const spread = useMemo(() => makeSpread(savedSpread, seriesData), [savedSpread, seriesData]);
  const summaries = useMemo(() => {
    if (!note.endDate) return [];
    const rows = ids.map(id => {
      const def = COMPARE_SERIES.find(s => s.id === id);
      return { id, label: def?.label ?? id, unit: def?.unit ?? "", delta: deltaUnit(def?.unit ?? ""), color: def?.color,
        result: periodSummary(monthlyPoints(seriesData?.[id] ?? []), note.date, note.endDate!) };
    });
    if (spread) rows.push({ id: "spread", label: spread.label, unit: "%p", delta: "%p", color: "#8b5cf6", result: periodSummary(spread.points, note.date, note.endDate) });
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
    const lines = summaries.flatMap(row => {
      const r = row.result; if (!r) return [];
      return [row.label + ": " + numberLabel(r.first.raw) + " → " + numberLabel(r.last.raw) + " " + row.unit + " (" + signedLabel(r.change) + row.delta + (r.percent !== null && !["%", "%p"].includes(row.unit) ? ", " + signedLabel(r.percent) + "%" : "") + ") · 관측일 " + r.first.date + " → " + r.last.date];
    });
    const current = collaboration.get("note:" + note.id);
    if (!current || !lines.length) return;
    save({ text: [current.text, "[구간 요약 " + note.date + " ~ " + note.endDate + " · " + new Date().toISOString().slice(0, 10) + " 인용]", ...lines].filter(Boolean).join("\n") });
  };
  return <div className="space-y-4">
    <section className="rounded-lg border bg-muted/10 p-3" aria-label="인사이트 관련 그래프">
      <div className="mb-2 flex items-center justify-between gap-2"><h3 className="text-xs font-semibold">관련 그래프</h3>{context && (!!context.ids.length || !!context.spread) && <button className="rounded border px-2 py-1 text-[11px] hover:bg-muted" onClick={() => onRestore(context, note)}>관련 그래프 보기</button>}</div>
      {context ? <><div className="flex flex-wrap gap-1.5">{context.ids.map(id => { const def = COMPARE_SERIES.find(s => s.id === id); return <span key={id} className="rounded border bg-background px-2 py-1 text-[10px]" style={{ borderColor: def?.color + "60" }}>{def?.label ?? id}{currentContext.ids.includes(id) ? " · 표시 중" : " · 숨김"}</span>; })}{spread && <span className="rounded border border-violet-500/30 px-2 py-1 text-[10px] text-violet-500">{spread.label}{JSON.stringify(currentContext.spread) === JSON.stringify(context.spread) ? " · 표시 중" : " · 숨김"}</span>}</div>{!context.ids.length && !context.spread && <p className="text-[11px] text-muted-foreground">연결된 그래프가 없습니다.</p>}</> : <p className="text-[11px] leading-5 text-muted-foreground">이전에 작성한 글에는 관련 그래프가 저장되어 있지 않습니다. 지금 보고 있는 지표를 연결할 수 있습니다.</p>}
      {canEdit && <details className="mt-3 text-[11px]"><summary className="cursor-pointer text-muted-foreground">관련 그래프 설정</summary><button className="my-2 rounded border px-2 py-1" onClick={() => save({ context: { ids: [...currentContext.ids], spread: currentContext.spread } })}>현재 그래프 연결</button><div className="grid grid-cols-1 gap-1.5">{COMPARE_SERIES.map(s => {
        const chosen = context?.ids.includes(s.id) ?? false;
        return <label key={s.id} className="flex items-center gap-2"><input type="checkbox" aria-label={"관련 지표 " + s.label} checked={chosen} disabled={!chosen && (context?.ids.length ?? 0) >= 4} onChange={e => save({ context: { ids: e.target.checked ? [...(context?.ids ?? []), s.id] : (context?.ids ?? []).filter(id => id !== s.id), spread: context?.spread ?? null } })} />{s.label}</label>;
      })}</div><p className="mt-2 text-muted-foreground">최대 4개 · 스프레드는 왼쪽 도구에서 설정한 뒤 ‘현재 그래프 연결’로 함께 저장합니다.</p>{context?.spread && <button className="mt-2 underline" onClick={() => save({ context: { ...context, spread: null } })}>스프레드 연결 해제</button>}</details>}
    </section>
    {children}
    {note.endDate && <section className="rounded-lg border border-sky-500/20 p-3" aria-label="구간 변화 요약" data-testid="period-summary">
      <div className="mb-1 flex items-center justify-between gap-2"><h3 className="text-xs font-semibold">구간 변화</h3>{canEdit && <button className="rounded border px-2 py-1 text-[11px] disabled:opacity-40" disabled={!summaries.some(r => r.result)} onClick={quote}>본문에 인용</button>}</div>
      <p className="mb-3 text-[10px] leading-4 text-muted-foreground">{context ? "저장된 관련 지표" : "현재 표시 지표 · 아직 연결 안 됨"}의 원래 값 · 기간 안의 첫/마지막 관측값</p>
      {!summaries.length && <p className="text-xs text-muted-foreground">관련 지표를 연결하면 구간 변화를 볼 수 있습니다.</p>}
      {summaries.map(row => <div key={row.id} className="border-t py-2 text-xs" data-testid={"summary-" + row.id}><b style={{ color: row.color }}>{row.label}</b>{row.result ? <><div className="mt-1 tabular-nums">{numberLabel(row.result.first.raw)} → {numberLabel(row.result.last.raw)} <span className="text-muted-foreground">{row.unit}</span></div><p className="mt-1 font-medium tabular-nums">{signedLabel(row.result.change)}{row.delta}{row.unit === "%p" && " · " + signedLabel(row.result.change * 100) + "bp"}{!["%", "%p"].includes(row.unit) && (row.result.percent === null ? " · 변화율 계산 불가" : " · " + signedLabel(row.result.percent) + "%")}</p><p className="mt-1 text-[10px] text-muted-foreground">관측일 {row.result.first.date} → {row.result.last.date}</p></> : <p className="mt-1 text-[11px] text-muted-foreground">{seriesData ? "기간 안에 관측값이 2개 이상 필요합니다." : "시계열을 불러오는 중입니다."}</p>}</div>)}
      {!!summaries.some(row => row.result) && <details className="mt-2 text-[11px]"><summary className="cursor-pointer text-muted-foreground">구간 최고·최저</summary>{summaries.map(row => row.result && <p key={row.id} className="mt-2 leading-5">{row.label}<br />최고 {numberLabel(row.result.high.raw)} {row.unit} ({row.result.high.date})<br />최저 {numberLabel(row.result.low.raw)} {row.unit} ({row.result.low.date})</p>)}</details>}
      <p className="mt-2 text-[10px] leading-4 text-muted-foreground">경계에 값이 없으면 실제 사용한 관측일을 표시합니다. 인용한 수치는 본문에 고정되며 자동으로 바뀌지 않습니다.</p>
    </section>}
    {error && <p role="alert" className="text-xs text-amber-600">{error}</p>}
  </div>;
}
