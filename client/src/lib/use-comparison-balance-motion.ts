import { useLayoutEffect, useRef } from "react";
import { animate, useMotionValue, useReducedMotion } from "framer-motion";
import type { InsightBalance } from "../../../shared/comparison-balance";

// Owned by the sidebar: changing the keyed prose editor must not reset the bars.
export function useComparisonBalanceMotion(value: InsightBalance | null | undefined, initialFrom?: InsightBalance | null) {
  const money = useMotionValue<number>(value?.money ?? initialFrom?.money ?? 0), goods = useMotionValue<number>(value?.goods ?? initialFrom?.goods ?? 0);
  const labelOpacity = useMotionValue(1);
  const comparisonOpacity = useMotionValue(1), resultOpacity = useMotionValue(1);
  const previousVisible = useRef(false);
  const reduced = useReducedMotion();
  const visible = !!value;
  useLayoutEffect(() => {
    const connect = visible && (previousVisible.current || !!initialFrom) && !reduced;
    const entering = visible && !previousVisible.current;
    previousVisible.current = visible;
    money.stop(); goods.stop(); labelOpacity.stop(); comparisonOpacity.stop(); resultOpacity.stop();
    if (entering && initialFrom && !reduced) { money.set(initialFrom.money); goods.set(initialFrom.goods); }
    const moving = visible && (Math.abs(money.get() - value!.money) > .0001 || Math.abs(goods.get() - value!.goods) > .0001);
    const showResult = () => { labelOpacity.set(1); comparisonOpacity.set(1); resultOpacity.set(1); };
    if (!visible) {
      if (initialFrom) { money.set(initialFrom.money); goods.set(initialFrom.goods); }
      labelOpacity.set(0); comparisonOpacity.set(0); resultOpacity.set(0); return;
    }
    if (!connect || !moving) { money.set(value!.money); goods.set(value!.goods); showResult(); return; }
    // Animate from current rendered values, in either direction, including interruptions.
    // Give the reader time to follow the zero crossing, rather than settling immediately.
    const transition = { type: "tween" as const, duration: 1.1, ease: [0.45, 0, 0.55, 1] as const };
    labelOpacity.set(0);
    comparisonOpacity.set(0); resultOpacity.set(0);
    let active = true;
    const a = animate(money, value!.money, transition), b = animate(goods, value!.goods, transition);
    // Interrupted transitions must not reveal the new labels before their own motion ends.
    Promise.all([a, b]).then(async () => {
      if (!active) return;
      // One fade rhythm, staggered slightly so the explanation follows the settled bars.
      const reveal = { duration: .18, ease: "easeOut" as const };
      animate(labelOpacity, 1, reveal);
      await animate(comparisonOpacity, 1, { ...reveal, delay: .08 });
      if (active) animate(resultOpacity, 1, reveal);
    });
    return () => { active = false; a.stop(); b.stop(); labelOpacity.stop(); comparisonOpacity.stop(); resultOpacity.stop(); };
  }, [visible, value?.money, value?.goods, reduced, money, goods, labelOpacity, comparisonOpacity, resultOpacity, initialFrom?.money, initialFrom?.goods]);
  return { money, goods, labelOpacity, comparisonOpacity, resultOpacity };
}
export type BalanceMotion = ReturnType<typeof useComparisonBalanceMotion>;

