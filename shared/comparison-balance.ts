import { z } from "zod";

// Ordinal editorial steps, never measured percentages or quantities.
export const balanceLevelSchema = z.union([z.literal(-2), z.literal(-1), z.literal(0), z.literal(1), z.literal(2)]);
export const insightBalanceSchema = z.object({
  money: balanceLevelSchema,
  goods: balanceLevelSchema,
  outcome: z.enum(["inflation", "deflation", "stagflation", "goldilocks", "stable"]).nullable(),
  outcomeLabel: z.string().trim().max(40).optional(),
}).strict();
export type InsightBalance = z.infer<typeof insightBalanceSchema>;
export type BalanceLevel = InsightBalance["money"];
export const BALANCE_LEVELS: { value: BalanceLevel; label: string; symbol: string }[] = [
  { value: -2, label: "크게 감소", symbol: "↓↓" },
  { value: -1, label: "감소", symbol: "↓" },
  { value: 0, label: "변화 없음", symbol: "—" },
  { value: 1, label: "증가", symbol: "↑" },
  { value: 2, label: "크게 증가", symbol: "↑↑" },
];
export const BALANCE_OUTCOMES = {
  inflation: { label: "물가 상승", detail: "인플레이션", color: "text-red-600 dark:text-red-400", background: "bg-red-500/5" },
  deflation: { label: "물가 하락", detail: "디플레이션", color: "text-blue-600 dark:text-blue-400", background: "bg-blue-500/5" },
  stagflation: { label: "스태그플레이션", detail: "물가 상승 · 경기 침체", color: "text-orange-700 dark:text-orange-400", background: "bg-orange-500/5" },
  goldilocks: { label: "골디락스", detail: "물가 안정 · 생산 증가", color: "text-emerald-700 dark:text-emerald-400", background: "bg-emerald-500/5" },
  stable: { label: "물가 안정", detail: "큰 물가 변화 없음", color: "text-slate-600 dark:text-slate-300", background: "bg-muted/40" },
} as const;

export function balanceRelation({ money, goods }: Pick<InsightBalance, "money" | "goods">): string {
  if (money === goods) return money > 0 ? "돈과 물건이 함께 늘어남" : money < 0 ? "돈과 물건이 함께 줄어듦" : "돈과 물건 모두 변화 없음";
  if (money > 0 && goods > 0) return money > goods ? "돈이 물건보다 더 빠르게 늘어남" : "물건이 돈보다 더 빠르게 늘어남";
  if (money < 0 && goods < 0) return money < goods ? "돈이 물건보다 더 크게 줄어듦" : "물건이 돈보다 더 크게 줄어듦";
  if (money > 0 && goods < 0) return "돈은 늘고, 물건은 줄어듦";
  if (money < 0 && goods > 0) return "돈은 줄고, 물건은 늘어남";
  if (money === 0) return goods > 0 ? "돈은 그대로, 물건은 늘어남" : "돈은 그대로, 물건은 줄어듦";
  return money > 0 ? "돈은 늘고, 물건은 그대로" : "돈은 줄고, 물건은 그대로";
}
