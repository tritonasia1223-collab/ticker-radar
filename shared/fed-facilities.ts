import type { ReadWeek } from "./liquidity-read.js";
import { observedComparison } from "./observed-comparison.js";

export const FED_FACILITIES = [
  {key:"discount", label:"할인창구 · Primary Credit", series:"WLCFLPCL", description:"건전한 예금취급기관이 담보를 제공하고 연준에서 빌린 자금입니다. 할인창구의 2차·계절성 대출은 이 계열에 포함되지 않습니다.", color:"#3E5C76"},
  {key:"repo", label:"연준 레포", series:"WORAL", description:"연준이 증권을 매입하고 나중에 되파는 조건으로 공급한 자금입니다. 전체 레포 잔액으로, 상설레포(SRF)만의 이용액은 아닙니다.", color:"#578980"},
  {key:"swap", label:"해외 중앙은행 달러스왑", series:"SWPT", description:"연준이 해외 중앙은행에 외화를 받고 공급한 달러입니다. 미국 은행의 직접 차입과는 구분합니다.", color:"#AB9061"},
  {key:"btfp", label:"BTFP", series:"H41RESPPALDKNWW", description:"국채·기관채·기관 MBS 등을 담보로 예금취급기관에 자금을 빌려준 한시 프로그램입니다. 과거 관측이 있는 주차에만 합계에 포함합니다.", color:"#8A7F99"},
] as const;

const DAY = 86400000;
const valid = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const facilityAmount = (value: number, signed = false) => `${signed && value > 0 ? "+" : ""}${(value/100).toLocaleString("ko-KR", {maximumFractionDigits:2})}억 달러`;

export function fedFacilities(history: ReadWeek[], asOf: string, weeks: 4 | 13) {
  const observed = history.filter(w => w.date <= asOf).sort((a,b) => a.date.localeCompare(b.date));
  const last = observed.at(-1);
  const current = last && Date.parse(asOf)-Date.parse(last.date) <= 14*DAY ? last : null;
  const target = Date.parse(asOf)-weeks*7*DAY;
  const old = observed.findLast(w => Date.parse(w.date) <= target);
  const previous = current && old && old.date < current.date && target-Date.parse(old.date) <= 7*DAY ? old : null;
  const includesBtfp = !!current && valid(current.btfp);
  const specs = FED_FACILITIES.filter(s => s.key !== "btfp" || includesBtfp);
  const total = (w: ReadWeek) => specs.every(s => valid(w[s.key])) ? specs.reduce((sum,s) => sum+w[s.key],0) : NaN;
  const now = current ? total(current) : NaN, before = previous ? total(previous) : NaN;
  const stats = observedComparison(observed.map(w => ({date:w.date,value:total(w)})),asOf,weeks,7,14);
  // 합계가 누락된 주에는 앞선 주의 합계를 현재 합계로 대체하지 않는다.
  if (!valid(now)) { stats.current = null; stats.change = null; stats.history = null; }
  if (!valid(before)) { stats.previous = null; stats.change = null; }
  const rows = specs.map(s => {
    const value = current && valid(current[s.key]) ? current[s.key] : null;
    const prior = previous && valid(previous[s.key]) ? previous[s.key] : null;
    return {...s, value, previous:prior, change:value != null && prior != null ? value-prior : null};
  });
  return {rows, includesBtfp, currentDate:current?.date ?? null, previousDate:previous?.date ?? null,
    value:valid(now)?now:null, previous:valid(before)?before:null, change:valid(now)&&valid(before)?now-before:null, stats};
}
export type FedFacilities = ReturnType<typeof fedFacilities>;

// 선택 시점과 같은 구성으로 과거 잔액을 비교한다. 일부 계열이 없으면 그 주 막대 전체를 비운다.
export function facilityHistory(history: ReadWeek[], asOf: string, data: FedFacilities) {
  const start = Date.parse(asOf) - 365.25 * DAY;
  return history.filter(w => w.date <= asOf && Date.parse(w.date) >= start).sort((a,b) => a.date.localeCompare(b.date)).map(w => {
    const complete = data.rows.every(r => valid(w[r.key]));
    const values = Object.fromEntries(data.rows.map(r => [r.key, complete ? w[r.key] / 100 : null])) as Partial<Record<(typeof FED_FACILITIES)[number]['key'], number | null>>;
    return { date: w.date, time: Date.parse(w.date), ...values };
  });
}

export function facilityReading(data: FedFacilities, weeks: 4 | 13) {
  if (data.value == null || data.change == null) return "연준 대출·레포·스왑의 같은 기간 증감을 모두 비교할 자료가 부족합니다. 확인된 항목은 도표에 따로 표시합니다.";
  const movements = data.rows.filter(r => r.change !== 0 && r.change != null).sort((a,b) => Math.abs(b.change!)-Math.abs(a.change!));
  const total = data.change === 0 ? `연준 대출·레포·스왑 합계는 ${weeks}주 전과 같은 ${facilityAmount(data.value)}입니다.`
    : `연준 대출·레포·스왑 합계는 ${weeks}주간 ${facilityAmount(Math.abs(data.change))} ${data.change>0?'늘어':'줄어'} ${facilityAmount(data.value)}입니다.`;
  const detail = movements.length ? movements.map(r => `${r.label} ${facilityAmount(Math.abs(r.change!))} ${r.change!>0?'증가':'감소'}`).join(', ')+"가 반영됐습니다." : "각 항목의 잔액도 비교한 두 시점에서 같습니다.";
  return `${total} ${detail}`;
}
