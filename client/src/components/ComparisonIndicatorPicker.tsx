import { X } from "lucide-react";
import { COMPARE_CATEGORIES, COMPARE_SERIES, shortSeriesLabel } from "@/lib/comparison-series";



export function ComparisonIndicatorPicker({ ids, onToggle, onClear, onClose }: {
  ids: string[]; onToggle: (id: string, on: boolean) => void; onClear: () => void; onClose: () => void;
}) {
  return <section id="comparison-indicators" aria-label="표시 지표 선택" className="fixed bottom-3 left-3 right-3 z-30 max-h-[70vh] max-w-[900px] overflow-auto rounded-xl border bg-background shadow-xl sm:absolute sm:bottom-auto sm:top-full sm:mt-1">
    <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background px-3 py-2.5 sm:px-4">
      <span className="text-xs font-semibold">표시할 지표 선택</span>
      <button type="button" disabled={!ids.length} onClick={onClear} className="rounded border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-40">전체 선택 해제</button>
      <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{ids.length}개 선택</span>
      <button type="button" aria-label="지표 선택 닫기" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted"><X size={16} /></button>
    </div>
    <div className="divide-y px-3 sm:px-4">{Object.entries(COMPARE_CATEGORIES).map(([key, group]) => <div key={key} role="group" aria-labelledby={"indicator-group-" + key} className="py-2.5 sm:flex sm:items-start sm:gap-3">
      <div id={"indicator-group-" + key} className="mb-2 flex shrink-0 items-center gap-1.5 text-[11px] font-semibold text-muted-foreground sm:mb-0 sm:w-20 sm:pt-2"><span className="h-1 w-1 rounded-full" style={{ background: group.color }} />{group.label}</div>
      <div className="flex min-w-0 flex-wrap gap-1.5">{COMPARE_SERIES.filter(s => s.category === key).map(s => {
        const checked = ids.includes(s.id);
        return <label key={s.id} title={s.label + " · " + s.note} className={"inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors " + (checked ? "border-sky-500/30 bg-sky-500/[.07] text-foreground" : "border-transparent bg-muted/40 text-muted-foreground hover:border-border hover:text-foreground")}>
          <input type="checkbox" aria-label={s.label} className="h-3.5 w-3.5 shrink-0 accent-sky-500" checked={checked} onChange={e => onToggle(s.id, e.target.checked)} />
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: s.color }} />{shortSeriesLabel(s.id)}
        </label>;
      })}</div>
    </div>)}</div>
  </section>;
}
