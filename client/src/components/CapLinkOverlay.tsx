import { useCallback, useLayoutEffect, useState, type RefObject } from "react";
import type { LinkDTO, FlowDTO } from "@/lib/capitalism-types";

interface Props {
  boardRef: RefObject<HTMLDivElement | null>;
  links: LinkDTO[];
  flows: FlowDTO[];
  onDeleteLink: (id: number) => void;
}

interface Segment {
  id: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const ROSE = "#f43f5e";

/** 보드 전역 화살표 오버레이.
 * 각 노드의 위치를 boardRef 기준 좌표로 측정해 링크별로 곡선 화살표를 그린다.
 * SVG 는 보드 전체 스크롤 영역(scrollWidth × scrollHeight)을 덮고,
 * 화살표 path 만 클릭 가능(삭제)하게 한다.
 */
export function CapLinkOverlay({ boardRef, links, flows, onDeleteLink }: Props) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const measure = useCallback(() => {
    const board = boardRef.current;
    if (!board) return;
    const boardRect = board.getBoundingClientRect();
    const scrollLeft = board.scrollLeft;
    const scrollTop = board.scrollTop;

    const centerOf = (slug: string, key: string): { x: number; y: number } | null => {
      const el = board.querySelector<HTMLElement>(
        `[data-node-id="${CSS.escape(`${slug}::${key}`)}"]`,
      );
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: r.left - boardRect.left + scrollLeft + r.width / 2,
        y: r.top - boardRect.top + scrollTop + r.height / 2,
      };
    };

    const next: Segment[] = [];
    for (const link of links) {
      const a = centerOf(link.fromSlug, link.fromKey);
      const b = centerOf(link.toSlug, link.toKey);
      if (!a || !b) continue; // DOM 에 없는 엔드포인트는 건너뜀
      next.push({ id: link.id, x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
    // 동일한 결과면 setState 생략 → 프레임 재측정 루프에서 불필요한 리렌더 방지.
    setSegments((prev) => {
      if (prev.length === next.length && prev.every((p, i) =>
        p.id === next[i].id && p.x1 === next[i].x1 && p.y1 === next[i].y1 &&
        p.x2 === next[i].x2 && p.y2 === next[i].y2)) return prev;
      return next;
    });
    const w = board.scrollWidth;
    const h = board.scrollHeight;
    setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
  }, [boardRef, links]);

  // boardRef 는 부모 소유 ref 이며, 자식 effect 시점에 아직 null 일 수 있다(React 는 ref 를 자식→부모 순으로 부착).
  // 그래서 board 를 잡을 때까지 rAF 로 폴링해 리렌더를 유도한다.
  const [boardReady, setBoardReady] = useState(false);
  useLayoutEffect(() => {
    if (boardReady) return;
    let id = 0;
    const poll = () => {
      if (boardRef.current) {
        setBoardReady(true);
      } else {
        id = requestAnimationFrame(poll);
      }
    };
    poll();
    return () => cancelAnimationFrame(id);
  }, [boardReady, boardRef]);

  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) return;

    measure();

    const ro = new ResizeObserver(() => measure());
    ro.observe(board);
    // 보드 내부 카드들도 관찰 (노드 추가/편집으로 높이 변화)
    board.querySelectorAll('[data-testid^="flow-"]').forEach((el) => ro.observe(el));

    const onScroll = () => measure();
    board.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    // 레이아웃이 안정화될 때까지 여러 프레임에 걸쳐 재측정(초기 로드 시 scrollWidth=0 방지).
    const rafs: number[] = [];
    let tries = 0;
    const tick = () => {
      measure();
      tries += 1;
      if (tries < 8) rafs.push(requestAnimationFrame(tick));
    };
    rafs.push(requestAnimationFrame(tick));

    return () => {
      ro.disconnect();
      board.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      rafs.forEach((id) => cancelAnimationFrame(id));
    };
    // flows/links/boardReady 변경 시 재바인딩 (노드 DOM 변화 반영)
  }, [measure, boardRef, links, flows, boardReady]);

  if (size.w === 0 || size.h === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute left-0 top-0 z-20"
      width={size.w}
      height={size.h}
      style={{ overflow: "visible" }}
      data-testid="cap-link-overlay"
    >
      <defs>
        <marker
          id="cap-arrowhead"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={ROSE} />
        </marker>
      </defs>
      {segments.map((s) => {
        // 부드러운 곡선: 두 점의 중간을 제어점 기준으로 살짝 휘게
        const dx = s.x2 - s.x1;
        const dy = s.y2 - s.y1;
        const dist = Math.hypot(dx, dy) || 1;
        // 진행 방향에 수직으로 휘는 정도 (거리에 비례, 최대 60px)
        const bend = Math.min(60, dist * 0.25);
        const mx = (s.x1 + s.x2) / 2;
        const my = (s.y1 + s.y2) / 2;
        const nx = -dy / dist;
        const ny = dx / dist;
        const cx = mx + nx * bend;
        const cy = my + ny * bend;
        const d = `M ${s.x1} ${s.y1} Q ${cx} ${cy} ${s.x2} ${s.y2}`;
        return (
          <g key={s.id}>
            {/* 보이는 곡선 */}
            <path
              d={d}
              fill="none"
              stroke={ROSE}
              strokeWidth={2.5}
              markerEnd="url(#cap-arrowhead)"
              className="pointer-events-none"
            />
            {/* 클릭 히트영역(투명, 두꺼움) → 삭제 */}
            <path
              d={d}
              fill="none"
              stroke="transparent"
              strokeWidth={14}
              className="pointer-events-auto cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteLink(s.id);
              }}
              data-testid={`link-path-${s.id}`}
            >
              <title>클릭하면 화살표 삭제</title>
            </path>
          </g>
        );
      })}
    </svg>
  );
}
