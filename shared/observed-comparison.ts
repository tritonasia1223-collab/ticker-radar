import type { Obs } from "./liquidity-beta.js";

const DAY = 86400000;
export function observedComparison(points: Obs[], asOf: string, weeks: 4 | 13, toleranceDays: number, maxAgeDays: number) {
  const valid = points.filter(p => p.date <= asOf && Number.isFinite(p.value)).sort((a,b) => a.date.localeCompare(b.date));
  const latest = valid.at(-1) ?? null;
  const current = latest && Date.parse(asOf)-Date.parse(latest.date) <= maxAgeDays*DAY ? latest : null;
  const target = Date.parse(asOf)-weeks*7*DAY;
  const before = valid.findLast(p => Date.parse(p.date) <= target);
  const previous = current && before && before.date < current.date && target-Date.parse(before.date) <= toleranceDays*DAY ? before : null;
  const sample = current ? valid.filter(p => Date.parse(p.date) >= Date.parse(asOf)-3*365.25*DAY) : [];
  const values = sample.map(p => p.value).sort((a,b) => a-b), n = values.length, mid = Math.floor(n/2);
  return { current, previous, change: current && previous ? current.value-previous.value : null,
    history: n >= 12 ? { min: values[0], max: values[n-1], median: n%2 ? values[mid] : (values[mid-1]+values[mid])/2,
      percentile: values.filter(v => v <= current!.value).length/n*100, from: sample[0].date, to: sample[n-1].date, count: n } : null };
}
export type ObservedComparison = ReturnType<typeof observedComparison>;
export function observedNumber(value: number, unit: string, signed = false) {
  const prefix = signed && value > 0 ? "+" : "";
  if (unit === "musd") return `${prefix}${(value/100).toLocaleString("ko-KR",{maximumFractionDigits:0})}억 달러`;
  if (unit === "billions") return `${prefix}${(value*10).toLocaleString("ko-KR",{maximumFractionDigits:1})}억 달러`;
  return `${prefix}${value.toLocaleString("ko-KR",{maximumFractionDigits:2})}${({bp:"bp",pctp:"%p",pp:"%p",percent:"%",ratio:"배",usd:"달러"} as Record<string,string>)[unit] ?? ""}`;
}
export function observedHistoryText(stats: ObservedComparison, unit: string) {
  const h = stats.history;
  if (!stats.current || !h) return "과거 관측 범위를 비교할 자료가 부족합니다.";
  return `${h.from}~${h.to} 관측 중앙값은 ${observedNumber(h.median,unit)}, 범위는 ${observedNumber(h.min,unit)}~${observedNumber(h.max,unit)}입니다. 현재 값 이하의 관측이 ${h.percentile.toFixed(0)}%입니다 (${h.count}개 관측).`;
}
