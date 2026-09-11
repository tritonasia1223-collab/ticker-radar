// Use layout CSS pixels, without viewport transforms or fractional screen coordinates.
export function relativeLayoutTop(element: HTMLElement, reference: HTMLElement): number {
  const top = (start: HTMLElement) => {
    let value = 0;
    for (let el: HTMLElement | null = start; el;) {
      value += el.offsetTop;
      const parent = el.offsetParent as HTMLElement | null;
      if (parent) value += parent.clientTop;
      el = parent;
    }
    return value;
  };
  return top(element) - top(reference);
}

// Coalesce resize bursts and avoid React writes in ResizeObserver's delivery phase.
export function frameMeasurement(measure: () => void) {
  let frame: number | null = null, disposed = false;
  return {
    schedule() {
      if (disposed || frame !== null) return;
      frame = requestAnimationFrame(() => { frame = null; if (!disposed) measure(); });
    },
    dispose() {
      disposed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    },
  };
}
