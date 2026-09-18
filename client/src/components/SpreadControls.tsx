import { useEffect, useState } from "react";
import { RATE_SPREAD_IDS, spreadSchema, type SpreadSpec } from "../../../shared/cap-comparison";
import { COMPARE_SERIES } from "@/lib/comparison-series";

export function SpreadControls({ value, onChange, onClose }: { value: SpreadSpec | null; onChange: (value: SpreadSpec | null) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<SpreadSpec>(value ?? { a: "gs10", b: "tb3ms" });
  useEffect(() => { if (value) setDraft(value); }, [value]);
  const valid = spreadSchema.safeParse(draft).success;
  return <section className="space-y-2 border-b bg-violet-500/5 p-3 text-xs" aria-label="스프레드 설정">
    <div className="flex items-center justify-between"><b>스프레드 · A − B</b><button aria-label="스프레드 설정 닫기" onClick={onClose}>✕</button></div>
    <div className="flex flex-wrap items-center gap-2">{(["a", "b"] as const).map((side, i) => <label key={side} className="flex items-center gap-2">{i ? "− B" : "A"}<select aria-label={"스프레드 " + side.toUpperCase()} className="max-w-[200px] rounded border bg-background p-1.5" value={draft[side]} onChange={e => setDraft(p => ({ ...p, [side]: e.target.value }))}>{RATE_SPREAD_IDS.map(id => <option key={id} value={id}>{COMPARE_SERIES.find(s => s.id === id)?.label ?? id}</option>)}</select></label>)}
      <button className="rounded border px-2 py-1.5" onClick={() => setDraft(p => ({ a: p.b, b: p.a }))}>A ↔ B</button>
      <button className="rounded bg-violet-600 px-3 py-1.5 text-white disabled:opacity-40" disabled={!valid} onClick={() => { onChange(draft); onClose(); }}>스프레드 적용</button>
      {value && <button className="rounded border px-2 py-1.5" onClick={() => onChange(null)}>제거</button>}
    </div>
    <p className="text-[11px] text-muted-foreground">{valid ? "금리의 원래 값으로 계산 · %p / bp · 두 금리의 관측값이 있는 월만 표시합니다. 위 그래프의 지표를 바꿔도 이 계산은 유지됩니다." : "A와 B에 서로 다른 금리를 선택하세요."}</p>
  </section>;
}
