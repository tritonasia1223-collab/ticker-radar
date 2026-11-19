import { useLayoutEffect, useRef, useState } from "react";
import { spring, springPresets } from "./warm-prism/spring.js";

type Range = [number, number];
export function useComparisonRangeMotion(target: Range, transition: number): Range {
  const [display, setDisplay] = useState<Range>(target);
  const current = useRef(target), previousTransition = useRef(transition);
  useLayoutEffect(() => {
    const shouldAnimate = previousTransition.current !== transition;
    previousTransition.current = transition;
    if (!shouldAnimate) { current.current = target; setDisplay(target); return; }
    const from = current.current;
    // Near-critical damping settles quickly without overshooting the date range.
    const animation = spring(document.createElement("div"), {
      ...springPresets.smooth, from: 0, to: 1,
      onUpdate: progress => {
        const next: Range = [from[0] + (target[0] - from[0]) * progress, from[1] + (target[1] - from[1]) * progress];
        current.current = next; setDisplay(next);
      },
    });
    return () => animation.cancel();
  }, [target[0], target[1], transition]);
  return display;
}
