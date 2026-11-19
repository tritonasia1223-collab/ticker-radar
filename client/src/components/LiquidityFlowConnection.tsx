import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

// 02·03의 같은 합계 열을 실제 차트 위치에 맞춰 연결한다.
export function LiquidityFlowConnection({ children, revision }: { children: ReactNode; revision: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [bands, setBands] = useState<{ left: number; top: number; width: number; height: number }[]>([]);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      const next = window.innerWidth < 768 ? [] : [4, 13].flatMap(weeks => {
        const from = element.querySelector(`[data-total-band="source-${weeks}"]`)?.getBoundingClientRect();
        const to = element.querySelector(`[data-total-band="destination-${weeks}"]`)?.getBoundingClientRect();
        if (!from || !to || !bounds.width || Math.abs(from.left - to.left) > 2) return [];
        const scaleX = element.offsetWidth / bounds.width, scaleY = element.offsetHeight / bounds.height;
        return [{ left: (from.left - bounds.left) * scaleX, top: (from.top - bounds.top) * scaleY, width: from.width * scaleX, height: (to.bottom - from.top) * scaleY }];
      });
      setBands(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.querySelectorAll('svg').forEach(svg => observer.observe(svg));
    window.addEventListener('resize', measure);
    measure();
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [revision]);
  return <div ref={root} className="relative" data-testid="liquidity-flow-connection">
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {bands.map((band, index) => <div key={index} data-testid="liquidity-total-band" className="absolute rounded-xl" style={{ ...band, background: 'rgba(148, 133, 68, 0.09)', border: '1px solid rgba(148, 133, 68, 0.13)' }} />)}
    </div>
    <div className="relative">{children}</div>
  </div>;
}
