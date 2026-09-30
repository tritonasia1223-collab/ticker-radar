import type { LiquidityContext, Obs } from "./liquidity-beta.js";

export interface M2Part { key: string; label: string; value: number; share: number }
export interface M2Composition { date: string; total: number; parts: M2Part[] }

// 같은 관측월끼리만 합산. 최신 M2에 이전 달의 구성 항목을 끼워 맞추지 않는다.
// H.6: https://www.federalreserve.gov/releases/h6/Current/ (표 2·3)
// 정기예금과 개인 MMF에서 해당 은퇴계좌를 제외해 M2에 포함되는 잔액으로 표시한다.
export function m2Composition(series: LiquidityContext["series"], total: Obs | null): M2Composition | null {
  if (!total || !Number.isFinite(total.value) || total.value <= 0) return null;
  const keys = ["m2Currency", "m2Demand", "m2Liquid", "m2Time", "m2Retail", "m2Retirement", "m2RetirementDeposits"] as const;
  const values = keys.map(key => series[key]?.find(o => o.date === total.date)?.value);
  if (values.some(value => value == null || !Number.isFinite(value) || value < 0)) return null;
  const [currency, demand, liquid, time, retail, retirement, retirementDeposits] = values as number[];
  if (retirementDeposits > retirement) return null;
  const parts = [
    { key: "currency", label: "현금", value: currency },
    { key: "demand", label: "요구불예금", value: demand },
    { key: "liquid", label: "저축·기타 유동성예금", value: liquid },
    { key: "time", label: "소액 정기예금", value: time - retirementDeposits },
    { key: "retail", label: "개인 MMF", value: retail - (retirement - retirementDeposits) },
  ];
  const sum = parts.reduce((acc, part) => acc + part.value, 0);
  // 단위 백만 달러. H.6의 0.1 billion 반올림 오차만 허용한다.
  // 정의가 다르거나 자료가 누락된 시점에는 임의의 잔차를 구성 항목으로 만들지 않는다.
  if (parts.some(part => part.value < 0) || Math.abs(sum - total.value) > 500) return null;
  return { date: total.date, total: total.value, parts: parts.map(part => ({ ...part, share: part.value / sum * 100 })) };
}
