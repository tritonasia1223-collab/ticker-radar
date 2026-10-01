import { sourcePeriods, sourcePeriodLabel } from "@/lib/capitalism-history";

export function SeriesSourceHistory({ seriesKey }: { seriesKey: string }) {
  const periods = sourcePeriods(seriesKey);
  if (!periods.length) return null;
  return <div className="mt-2 space-y-2 text-[11px] leading-5 text-muted-foreground" data-testid={`series-sources-${seriesKey}`}>
    {periods.map(s => <div key={s.from}>
      <span className="mr-2 font-medium tabular-nums text-foreground">{sourcePeriodLabel(s)}</span>
      <a href={s.url} target="_blank" rel="noreferrer" title={s.id} className="underline underline-offset-2">{s.source.replace(`(${s.id})`, "").replace(`(NBER ${s.id})`, "").replace(`(${s.id}, 단종)`, "")}</a>
      <p>{s.note}</p>
    </div>)}
  </div>;
}
