import { useLayoutEffect, useRef } from "react";
import { useMotionValue } from "framer-motion";
import { spring, springPresets } from "./warm-prism/spring.js";
import type { InsightBalance } from "../../../shared/comparison-balance";

// MotionValue only binds SVG attributes. All animation runs through warm-prism.
export function useComparisonBalanceMotion(value: InsightBalance | null | undefined, initialFrom?: InsightBalance | null, _entryDelay = 0) {
  const money = useMotionValue<number>(value?.money ?? initialFrom?.money ?? 0);
  const goods = useMotionValue<number>(value?.goods ?? initialFrom?.goods ?? 0);
  const labelOpacity = useMotionValue(1), comparisonOpacity = useMotionValue(1), resultOpacity = useMotionValue(1);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    labelOpacity.set(1); comparisonOpacity.set(1); resultOpacity.set(1);
    if (!value) { mounted.current = false; return; }
    if (!mounted.current) { mounted.current = true; money.set(value.money); goods.set(value.goods); return; }
    const motions = [[money, value.money], [goods, value.goods]].map(([state, target]) => {
      const binding = state as typeof money;
      return spring(document.createElement('div'), { ...springPresets.smooth, from: binding.get(), to: target as number, onUpdate: v => binding.set(v) });
    });
    return () => motions.forEach(m => m.cancel());
  }, [!!value, value?.money, value?.goods, money, goods, labelOpacity, comparisonOpacity, resultOpacity]);
  return { money, goods, labelOpacity, comparisonOpacity, resultOpacity };
}
export type BalanceMotion = ReturnType<typeof useComparisonBalanceMotion>;
