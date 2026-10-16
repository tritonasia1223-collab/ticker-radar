import { useLayoutEffect, useRef } from 'react';

/** 주차별 문단 길이와 비동기 차트 높이가 달라도 읽던 행의 화면 위치를 유지한다. */
export function useReadingPosition(revision: number, ready: boolean) {
  const pageRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const pending = useRef<{ element: HTMLElement; top: number } | null>(null);

  const preservePosition = () => {
    const page = pageRef.current;
    const scroller = page?.closest('main');
    if (!page || !scroller) return;
    const ceiling = headerRef.current?.getBoundingClientRect().bottom ?? scroller.getBoundingClientRect().top;
    const rows = [...page.querySelectorAll<HTMLElement>('[data-scroll-anchor], [data-credit-reading-row]')];
    const floor = scroller.getBoundingClientRect().bottom;
    // 화면에서 가장 많이 보고 있는 행을 잡는다. 이전 행의 끝자락을 잡으면 차트가 밀린다.
    const anchor = rows.map(element => {
      const rect = element.getBoundingClientRect();
      return { element, visible: Math.max(0, Math.min(rect.bottom, floor) - Math.max(rect.top, ceiling)) };
    }).sort((a, b) => b.visible - a.visible)[0]?.element;
    pending.current = anchor ? { element: anchor, top: anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top } : null;
  };

  useLayoutEffect(() => {
    const page = pageRef.current, header = headerRef.current;
    if (!page || !header) return;
    const measure = () => page.style.setProperty('--liquidity-sticky-top', `${header.offsetHeight + 16}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, [ready]);

  useLayoutEffect(() => {
    const page = pageRef.current, scroller = page?.closest('main');
    const anchor = pending.current;
    if (!page || !scroller || !anchor) return;
    let frame = 0, stopped = false;
    const oldOverflowAnchor = scroller.style.overflowAnchor;
    scroller.style.overflowAnchor = 'none';
    const restore = () => {
      if (stopped || !anchor.element.isConnected) return;
      const scale = scroller.getBoundingClientRect().height / scroller.offsetHeight || 1;
      const delta = anchor.element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - anchor.top;
      if (Math.abs(delta) > 0.5) scroller.scrollTop += delta / scale;
    };
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(restore);
    });
    const stop = () => {
      stopped = true;
      pending.current = null;
      cancelAnimationFrame(frame);
      observer.disconnect();
      scroller.style.overflowAnchor = oldOverflowAnchor;
    };
    const pointer = (event: Event) => {
      if (!(event.target instanceof Node) || !headerRef.current?.contains(event.target)) stop();
    };
    const key = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) stop();
    };
    restore();
    observer.observe(page);
    // 전체 높이가 같아도 위쪽 행들의 높이가 서로 바뀔 수 있다.
    page.querySelectorAll('[data-scroll-anchor], [data-credit-reading-row]').forEach(row => observer.observe(row));
    scroller.addEventListener('wheel', stop, { passive: true });
    scroller.addEventListener('touchstart', stop, { passive: true });
    scroller.addEventListener('pointerdown', pointer);
    scroller.addEventListener('keydown', key);
    return () => {
      // 새 주차 클릭에서 저장한 다음 앵커는 유지한다.
      stopped = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      scroller.style.overflowAnchor = oldOverflowAnchor;
      scroller.removeEventListener('wheel', stop);
      scroller.removeEventListener('touchstart', stop);
      scroller.removeEventListener('pointerdown', pointer);
      scroller.removeEventListener('keydown', key);
    };
  }, [revision, ready]);

  return { pageRef, headerRef, preservePosition };
}
