import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { springHeight } from "@/lib/glass-spring/spring.js";

/** React adapter only; the portable motion module has no React dependency. */
export function TimelineDisclosure({ open, id, children }: { open: boolean; id: string; children: ReactNode }) {
  const element = useRef<HTMLDivElement | null>(null);
  const motion = useRef<ReturnType<typeof springHeight> | null>(null);
  const [mounted, setMounted] = useState(open);
  const initialOpen = useRef(open);
  const attach = useCallback((node: HTMLDivElement | null) => { if (node) node.hidden = !initialOpen.current; element.current = node; }, []);
  useLayoutEffect(() => {
    if (!element.current) return;
    if (open) setMounted(true);
    // Disable editing immediately on close while keeping the body for its exit.
    element.current.inert = !open;
    const next = springHeight(element.current, open);
    motion.current = next;
    void next.finished.then(status => {
      if (status === "finished" && !open && motion.current === next) setMounted(false);
    });
  }, [open]);
  useEffect(() => () => { motion.current?.cancel(); }, []);
  return <div ref={attach} className="it-disclosure" id={id} aria-hidden={!open}>
    {(open || mounted) && <div className="it-band-detail">{children}</div>}
  </div>;
}
