import { useLayoutEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";

type Range = [number, number];
export function useComparisonRangeMotion(target: Range, transition: number): Range {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState<Range>(target);
  const current = useRef(target), previousTransition = useRef(transition);
  useLayoutEffect(() => {
    const animate = previousTransition.current !== transition && !reduced;
    previousTransition.current = transition;
    if (!animate) { current.current = target; setDisplay(target); return; }
    const from = current.current, began = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - began) / 460), eased = 1 - (1 - progress) ** 3;
      const next: Range = progress === 1 ? target : [from[0] + (target[0] - from[0]) * eased, from[1] + (target[1] - from[1]) * eased];
      current.current = next; setDisplay(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target[0], target[1], transition, reduced]);
  return display;
}
