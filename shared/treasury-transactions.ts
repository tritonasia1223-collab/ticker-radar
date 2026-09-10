// All amounts are million USD. Transaction observations remain separate from
// the existing H.4.1/MSPD monthly stock approximation.
export interface TreasuryTransactions {
  month: string;
  fetchedAt: string;
  treasury: { asOf: string; issues: number; inflation: number; redemptions: number } | null;
  buybacks: { cashManagement: number; liquiditySupport: number; other: number; total: number; count: number } | null;
  fed: { purchases: number; sales: number; rollovers: number; maturities: number; operations: number } | null;
  errors: { treasury?: string; buybacks?: string; fed?: string };
}

export interface WaterfallItem { label: string; value: number; estimated?: boolean; total?: boolean }
export interface WaterfallBar extends WaterfallItem { start: number; end: number }

export function waterfallBars(items: WaterfallItem[]): WaterfallBar[] {
  let running = 0;
  return items.map(item => {
    if (!Number.isFinite(item.value)) throw new Error("Missing waterfall observation");
    const start = item.total ? 0 : running;
    const end = item.total ? item.value : running + item.value;
    running = end;
    return { ...item, start, end };
  });
}

/** Signed stacking: QT can make non-Fed growth exceed total issuance. */
export function holdingSegments(supply: number, fed: number) {
  if (![supply, fed].every(Number.isFinite)) return null;
  const values = [{ key: "fed" as const, value: fed }, { key: "other" as const, value: supply - fed }];
  let positive = 0, negative = 0;
  const segments = values.map(item => {
    const start = item.value >= 0 ? positive : negative;
    const end = start + item.value;
    if (item.value >= 0) positive = end; else negative = end;
    return { ...item, start, end };
  });
  return { segments, min: negative, max: positive, total: supply };
}

export function treasuryWaterfall(data: TreasuryTransactions, stockChange: number): WaterfallItem[] | null {
  const t = data.treasury, b = data.buybacks;
  if (!t || !b || !Number.isFinite(stockChange)) return null;
  // DTS redemptions already include buybacks. Split once, never subtract twice.
  const remainingRedemptions = t.redemptions - b.total;
  if (remainingRedemptions < -1) return null;
  const items: WaterfallItem[] = [
    { label: "총발행", value: t.issues },
    { label: "만기·기타 상환", value: -remainingRedemptions },
    { label: "바이백 소각", value: -b.total },
    { label: "물가보정", value: t.inflation },
  ];
  const difference = stockChange - (t.issues + t.inflation - t.redemptions);
  if (Math.abs(difference) > 0.000001) items.push({ label: "자료 간 차이", value: difference, estimated: true });
  return [...items, { label: "발행잔액 증감", value: stockChange, total: true }];
}

export function fedWaterfall(data: TreasuryTransactions, stockChange: number): WaterfallItem[] | null {
  const f = data.fed;
  if (!f || !Number.isFinite(stockChange)) return null;
  const items: WaterfallItem[] = [
    { label: "유통시장 매입", value: f.purchases },
    { label: "만기 재투자", value: f.rollovers },
    { label: "만기도래 추정", value: -f.maturities, estimated: true },
  ];
  if (f.sales !== 0) items.push({ label: "유통시장 매도", value: -f.sales });
  // Operations use calendar-month settlement dates; the legacy chart compares
  // last-Wednesday holdings. Do not disguise the reconciliation as redemptions.
  const difference = stockChange - (f.purchases + f.rollovers - f.maturities - f.sales);
  if (Math.abs(difference) > 0.000001) items.push({ label: "관측일·기타 차이", value: difference, estimated: true });
  return [...items, { label: "연준 보유 증감", value: stockChange, total: true }];
}
