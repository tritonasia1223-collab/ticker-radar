import { useLayoutEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "framer-motion";

type Range = [number, number];
export function useComparisonRangeMotion(target: Range, transition: number): Range {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState<Range>(target);
  const current = useRef(target), previousTransition = useRef(transition);
  useLayoutEffect(() => {
    const shouldAnimate = previousTransition.current !== transition && !reduced;
    previousTransition.current = transition;
    if (!shouldAnimate) { current.current = target; setDisplay(target); return; }
    const from = current.current;
    // Near-critical damping settles quickly without overshooting the date range.
    const animation = animate(0, 1, {
      type: "spring", stiffness: 1000, damping: 44, mass: .45,
      restDelta: .002, restSpeed: .05,
      onUpdate: progress => {
        const next: Range = [from[0] + (target[0] - from[0]) * progress, from[1] + (target[1] - from[1]) * progress];
        current.current = next; setDisplay(next);
      },
      onComplete: () => { current.current = target; setDisplay(target); },
    });
    return () => animation.stop();
  }, [target[0], target[1], transition, reduced]);
  return display;
}
