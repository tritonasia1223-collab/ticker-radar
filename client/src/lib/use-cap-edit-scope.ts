import { useLayoutEffect, useRef, type FocusEvent } from "react";
import { collaboration, focusResource } from "./cap-collab-client";

// No cache writes or network saves on keystrokes. A field's own blur handler
// commits first; release its comparison base after the whole event has run.
export function useCapEditScope(key: string) {
  const ref = useRef<HTMLDivElement>(null);
  const releases = useRef(new Set<() => void>());
  const active = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    if (active.current && !ref.current?.contains(document.activeElement)) {
      const release = active.current; active.current = null;
      queueMicrotask(() => { releases.current.delete(release); release(); });
    }
  });
  useLayoutEffect(() => () => {
    // Child layout cleanups can commit editors removed without a browser blur.
    const pending = [...releases.current];
    queueMicrotask(() => pending.forEach(release => release()));
    releases.current.clear(); active.current = null;
  }, [key]);
  return {
    ref,
    onFocusCapture: (event: FocusEvent<HTMLElement>) => {
      if (!(event.target instanceof HTMLElement) || !event.target.matches("input, textarea, [contenteditable=true]")) return;
      focusResource(key);
      const release = collaboration.beginLocalEdit(key);
      releases.current.add(release); active.current = release;
    },
    onBlurCapture: () => {
      const release = active.current; active.current = null;
      if (release) queueMicrotask(() => { releases.current.delete(release); release(); });
    },
  };
}
