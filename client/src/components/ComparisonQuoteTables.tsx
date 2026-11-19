import { X } from "lucide-react";
import type { ComparisonQuoteTable } from "../../../shared/cap-comparison";
import { changePresentation, directionClass } from "@/lib/comparison-period-change";

export function ComparisonQuoteTables({ tables, onRemove }: { tables: ComparisonQuoteTable[]; onRemove?: (id: string) => void }) {
  return <div className="space-y-5">{tables.map(table => <div key={table.id} className="relative rounded-xl border border-border/70 bg-background" data-testid="insight-quote-table">
    {onRemove && <button aria-label="인용 표 삭제" title="인용 표 삭제" onClick={() => onRemove(table.id)} className="absolute right-2 top-2 rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-foreground"><X size={13} /></button>}
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-[12px] tabular-nums">
        <caption className="px-3 pb-3 pt-4 text-left"><span className="block text-sm font-semibold">이 구간의 변화</span><span className="mt-1 block text-[11px] text-muted-foreground">{table.from} ~ {table.to}</span></caption>
        <colgroup><col style={{ width: "40%" }} /><col style={{ width: "20%" }} /><col style={{ width: "20%" }} /><col style={{ width: "20%" }} /></colgroup>
        <thead className="border-y border-border/50 bg-muted/30 text-[11px] text-muted-foreground"><tr><th className="px-3 py-2 text-left font-medium">지표</th>{["시작", "끝", "증감"].map(label => <th key={label} className="px-2 py-2 text-right font-medium">{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-border/40">{table.rows.map((row, i) => {
          const change = changePresentation({ first: { raw: row.start }, last: { raw: row.end }, change: row.change });
          return <tr key={i}><th scope="row" className="break-words px-3 py-3 text-left font-medium leading-5">{row.label}</th><td className="break-words px-2 py-3 text-right">{change.start}</td><td className="break-words px-2 py-3 text-right">{change.end}</td><td className={"break-words px-2 py-3 text-right font-medium " + directionClass(change.direction)}>{change.difference}</td></tr>;
        })}</tbody>
      </table>
    </div>
  </div>)}</div>;
}
