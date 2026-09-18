import { useEffect, useState } from "react";
import { centerRange, presetRange, validDate } from "../../../shared/cap-comparison";
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
type Range = [number, number];

export function ComparisonTimeNavigation({ range, extent, onRange, onJump }: { range: Range; extent: Range; onRange: (range: Range) => void; onJump: (time: number) => void }) {
  const [preset, setPreset] = useState<{ mode: string; span: number } | null>(null), [date, setDate] = useState(""), [error, setError] = useState("");
  useEffect(() => { if (preset && Math.abs(range[1] - range[0] - preset.span) > 1) setPreset(null); }, [range[0], range[1], preset]);
  const choose = (mode: "month" | "year" | "all") => {
    const next = mode === "all" ? extent : presetRange(range, mode, extent);
    setPreset({ mode, span: next[1] - next[0] }); onRange(next); setError("");
  };
  const jump = () => {
    if (!validDate(date)) { setError("이동할 날짜를 입력하세요."); return; }
    const time = Date.parse(date);
    if (time < extent[0] || time > extent[1]) { setError(iso(extent[0]) + " ~ " + iso(extent[1]) + " 안의 날짜를 입력하세요."); return; }
    onRange(centerRange(time, range[1] - range[0], extent)); onJump(time); setError("");
  };
  return <div className="space-y-2 border-t px-4 py-2" data-testid="comparison-time-navigation">
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <div className="flex gap-1" role="group" aria-label="시간 축척">{([{ id: "month", label: "월", hint: "현재 시점 중심 24개월" }, { id: "year", label: "연", hint: "현재 시점 중심 20년" }, { id: "all", label: "전체", hint: "전체 수록 기간" }] as const).map(p => <button key={p.id} title={p.hint} aria-pressed={preset?.mode === p.id} className={"rounded px-3 py-1.5 " + (preset?.mode === p.id ? "bg-sky-500/15 font-semibold text-sky-600" : "hover:bg-muted")} onClick={() => choose(p.id)}>{p.label}</button>)}</div>
      <form className="flex items-center gap-2" onSubmit={e => { e.preventDefault(); jump(); }}><label className="flex items-center gap-2"><span className="text-muted-foreground">날짜 이동</span><input type="date" aria-label="이동할 날짜" min={iso(extent[0])} max={iso(extent[1])} className="min-w-0 rounded border bg-background px-2 py-1" value={date} onChange={e => setDate(e.target.value)} /></label><button className="rounded border px-2.5 py-1" type="submit">이동</button></form>
      <span className="ml-auto text-[10px] tabular-nums text-muted-foreground" data-testid="visible-date-range">{iso(range[0])} ~ {iso(range[1])}</span>
    </div>
    {error ? <p role="alert" className="text-xs text-amber-600">{error}</p> : <p className="text-[10px] text-muted-foreground">{preset?.mode === "month" ? "월 보기 · 24개월" : preset?.mode === "year" ? "연 보기 · 20년" : preset?.mode === "all" ? "전체 기간" : "자유 축척"} · 월별 관측값 유지 · 날짜 이동은 현재 축척을 유지합니다. 자료 양 끝에서는 표시 범위가 경계에 맞춰집니다.</p>}
  </div>;
}
