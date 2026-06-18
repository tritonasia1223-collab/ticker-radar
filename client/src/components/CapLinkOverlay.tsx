import { useCallback, useLayoutEffect, useState, type RefObject } from "react";
import type { LinkDTO, FlowDTO } from "@/lib/capitalism-types";

interface Props {
  boardRef: RefObject<HTMLDivElement | null>;
  links: LinkDTO[];
  flows: FlowDTO[];
  onDeleteLink: (id: number) => void;
}

interface NodeRect {
  cx: number; // 중심 x
  cy: number; // 중심 y
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface Segment {
  id: number;
  d: string; // 직각선 경로 (둘레고 도달)
}

// 카드 사이의 흰/muted 세로 화살표(VArrow)와 동일한 결을 쓰기 위해 muted-foreground 계열 색을 사용.
// currentColor + text-muted-foreground 클래스로 테마(다크/라이트)에 자동 적응.

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

    // 노드 DOM 의 사각형을 보드 좌표계(스크롤 포함)로 변환.
    const rectOf = (slug: string, key: string): NodeRect | null => {
      const el = board.querySelector<HTMLElement>(
        `[data-node-id="${CSS.escape(`${slug}::${key}`)}"]`,
      );
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const left = r.left - boardRect.left + scrollLeft;
      const top = r.top - boardRect.top + scrollTop;
      return {
        left,
        top,
        right: left + r.width,
        bottom: top + r.height,
        cx: left + r.width / 2,
        cy: top + r.height / 2,
      };
    };

    // 카드(플로)의 좌/우 경계 x — 카드 사이 "안쪽 통로" 계산에 사용.
    const cardEdgesOf = (slug: string): { left: number; right: number } | null => {
      const card = board.querySelector<HTMLElement>(
        `[data-testid="${CSS.escape(`flow-${slug}`)}"]`,
      );
      if (!card) return null;
      const r = card.getBoundingClientRect();
      return {
        left: r.left - boardRect.left + scrollLeft,
        right: r.right - boardRect.left + scrollLeft,
      };
    };

    // 직각선 경로 생성: 출발 노드 → 두 카드 사이 "안쪽 세로 통로" → 도달 노드.
    // 통로 X 는 출발 카드 우측과 도달 카드 좌측 사이 빈 공간 중앙으로 둔다.
    // (바깥 경계로 돌지 않으므로 아래에 노드를 추가해도 걸리지 않음)
    const R = 8; // 모서리 둥근 반경
    // exitSide: 출발 노드가 통로 쪽으로 나가는 변(left=좌측, right=우측)
    // enterSide: 도달 노드가 통로에서 들어오는 변
    const orthPath = (
      a: NodeRect,
      b: NodeRect,
      corridorX: number,
      exitSide: "left" | "right",
      enterSide: "left" | "right",
    ): string => {
      const ax = exitSide === "right" ? a.right : a.left;
      const ay = a.cy;
      const bx = enterSide === "left" ? b.left : b.right;
      const by = b.cy;
      const cx = corridorX;
      const goingDown = by >= ay;
      const r1 = Math.min(R, Math.abs(cx - ax) / 2 || R, Math.abs(by - ay) / 2 || R);
      const r2 = Math.min(R, Math.abs(cx - bx) / 2 || R, Math.abs(by - ay) / 2 || R);
      const dir1 = cx >= ax ? 1 : -1; // 통로가 출발 노드 기준 오른쪽인가
      const dir2 = bx >= cx ? 1 : -1; // 도달 노드가 통로 기준 오른쪽인가
      const sweep1 = goingDown ? (dir1 > 0 ? 0 : 1) : (dir1 > 0 ? 1 : 0);
      const sweep2 = goingDown ? (dir2 > 0 ? 1 : 0) : (dir2 > 0 ? 0 : 1);
      const vy1 = goingDown ? ay + r1 : ay - r1;
      const vy2 = goingDown ? by - r2 : by + r2;
      return [
        `M ${ax} ${ay}`,
        `H ${cx - dir1 * r1}`,
        `A ${r1} ${r1} 0 0 ${sweep1} ${cx} ${vy1}`,
        `V ${vy2}`,
        `A ${r2} ${r2} 0 0 ${sweep2} ${cx + dir2 * r2} ${by}`,
        `H ${bx}`,
      ].join(" ");
    };

    const next: Segment[] = [];
    for (const link of links) {
      const a = rectOf(link.fromSlug, link.fromKey);
      const b = rectOf(link.toSlug, link.toKey);
      if (!a || !b) continue; // DOM 에 없는 엔드포인트는 건너뜀
      const fc = cardEdgesOf(link.fromSlug);
      const tc = cardEdgesOf(link.toSlug);

      let corridorX: number;
      let exitSide: "left" | "right";
      let enterSide: "left" | "right";

      if (fc && tc && link.fromSlug !== link.toSlug && tc.left > fc.right) {
        // 도달 카드가 출발 카드 오른쪽: 두 카드 사이 빈 통로 중앙으로 라우팅.
        corridorX = (fc.right + tc.left) / 2;
        exitSide = "right";   // 출발 노드 우측으로 빠져나와
        enterSide = "left";   // 도달 노드 좌측으로 진입(화살촉 오른쪽 향함)
      } else if (fc && tc && link.fromSlug !== link.toSlug && fc.left > tc.right) {
        // 도달 카드가 출발 카드 왼쪽: 통로를 두 카드 사이에 두고 방향 반전.
        corridorX = (tc.right + fc.left) / 2;
        exitSide = "left";
        enterSide = "right";
      } else {
        // 같은 카드 내부(또는 카드 경계 못 구함): 노드 우측 바로 옆 좁은 안쪽 여백 통로.
        const innerGap = 16;
        corridorX = Math.max(a.right, b.right) + innerGap;
        exitSide = "right";
        enterSide = "right";
      }

      const d = orthPath(a, b, corridorX, exitSide, enterSide);
      if (d.includes("undefined") || d.includes("NaN")) continue; // 좌표 이상 경로는 그리지 않음
      next.push({ id: link.id, d });
    }
    // 동일한 결과면 setState 생략 → 프레임 재측정 루프에서 불필요한 리렌더 방지.
    setSegments((prev) => {
      if (prev.length === next.length && prev.every((p, i) =>
        p.id === next[i].id && p.d === next[i].d)) return prev;
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
          <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" className="text-muted-foreground/60" />
        </marker>
      </defs>
      {segments.map((s) => {
        return (
          <g key={s.id}>
            {/* 보이는 곡선 */}
            <path
              d={s.d}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              markerEnd="url(#cap-arrowhead)"
              className="pointer-events-none text-muted-foreground/55"
            />
            {/* 클릭 히트영역(투명, 두꺼움) → 삭제 */}
            <path
              d={s.d}
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
