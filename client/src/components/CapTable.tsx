// 노드별 표(메모와 같은 층위). 일반 텍스트 셀 + 열 너비 드래그 조절.
//  - TableCard: 한 노드의 표를 편집(셀 입력/행·열 추가·삭제/열 너비 드래그/표 삭제).
//  - AnchoredColumn: 본문 노드의 세로 위치에 카드를 절대배치로 앵커링(메모열과 동일 방식, 독립 구현).
//  - TableColumn: AnchoredColumn 에 TableCard 를 끼운 표열.
import { useState, useRef, useLayoutEffect, useEffect } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import type { CapTableData, FlowNodeDTO } from "@/lib/capitalism-types";

export const MIN_COL_W = 48;   // 열 최소 너비(px)
const DEFAULT_COL_W = 110;     // 새 열 기본 너비
const ROW_DELETE_W = 14;       // 좌측 행삭제 거터 폭

// 빈 기본 표(2열 × 2행).
export function makeDefaultTable(): CapTableData {
  return { widths: [DEFAULT_COL_W, DEFAULT_COL_W], cells: [["", ""], ["", ""]] };
}

// 표 1개의 콘텐츠 자연 너비(px) — 표열 폭 산정용(거터 + 열 합 + 테두리).
export function tableContentWidth(t: CapTableData): number {
  const cols = t.widths.reduce((a, b) => a + Math.max(MIN_COL_W, b || DEFAULT_COL_W), 0);
  return ROW_DELETE_W + cols + (t.widths.length + 1); // +테두리 여유
}

// 깊은 복제(구조 변경 시 불변성 유지).
function cloneTable(t: CapTableData): CapTableData {
  return { widths: [...t.widths], cells: t.cells.map((r) => [...r]) };
}

function TableCard({
  node, editable, autoEdit, onCommit, onEditDone, onFocusNode, focusedId,
}: {
  node: FlowNodeDTO;
  editable: boolean;
  // 표 버튼으로 막 생성됐으면 첫 셀에 자동 포커스.
  autoEdit?: boolean;
  // 표 전체 저장(빈 표/삭제는 null).
  onCommit: (id: string, table: CapTableData | null) => void;
  onEditDone?: (id: string) => void;
  onFocusNode?: (id: string | null) => void;
  focusedId?: string | null;
}) {
  const focused = focusedId === node.id;
  // 로컬 편집 상태(props.table 시드). 외부(서버) 변경은 포커스 아닐 때만 재시드.
  const [t, setT] = useState<CapTableData>(() => node.table ?? makeDefaultTable());
  const hostRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const editingRef = useRef(false);

  // 외부 table 변경 동기화(드래그/포커스 중이 아닐 때만 — 입력 중 클로버 방지).
  useEffect(() => {
    if (draggingRef.current || editingRef.current) return;
    const host = hostRef.current;
    if (host && host.contains(document.activeElement)) return;
    setT(node.table ?? makeDefaultTable());
    // node.table 참조가 바뀔 때만.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.table]);

  // 첫 생성 시 첫 셀 포커스.
  const firstCellRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (autoEdit) firstCellRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cols = t.widths.length;
  const rows = t.cells.length;

  const commit = (next: CapTableData) => { setT(next); onCommit(node.id, next); };

  // 셀 텍스트 변경(로컬만) → blur 에서 commit.
  const setCell = (r: number, c: number, v: string) => {
    setT((prev) => {
      const next = cloneTable(prev);
      if (!next.cells[r]) next.cells[r] = [];
      next.cells[r][c] = v;
      return next;
    });
  };

  const addCol = () => {
    const next = cloneTable(t);
    next.widths.push(DEFAULT_COL_W);
    next.cells.forEach((row) => row.push(""));
    commit(next);
  };
  const addRow = () => {
    const next = cloneTable(t);
    next.cells.push(Array.from({ length: cols }, () => ""));
    commit(next);
  };
  const delCol = (c: number) => {
    if (cols <= 1) { onCommit(node.id, null); onEditDone?.(node.id); return; } // 마지막 열 삭제 = 표 삭제
    commit(removeCol(t, c));
  };
  const delRow = (r: number) => {
    if (rows <= 1) { onCommit(node.id, null); onEditDone?.(node.id); return; }
    const next = cloneTable(t);
    next.cells.splice(r, 1);
    commit(next);
  };
  const deleteTable = () => { onCommit(node.id, null); onEditDone?.(node.id); };

  // 열 너비 드래그 — 진행 중엔 로컬, pointerup 에 commit.
  const startResize = (c: number, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = true;
    const startX = e.clientX;
    const startW = Math.max(MIN_COL_W, t.widths[c] || DEFAULT_COL_W);
    const onMove = (ev: PointerEvent) => {
      const w = Math.max(MIN_COL_W, Math.round(startW + (ev.clientX - startX)));
      setT((prev) => {
        const next = cloneTable(prev);
        next.widths[c] = w;
        return next;
      });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      draggingRef.current = false;
      setT((cur) => { onCommit(node.id, cur); return cur; });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      ref={hostRef}
      className={`rounded-md border p-1.5 shadow-sm transition-all ${
        focused
          ? "border-sky-400/80 bg-sky-100/70 ring-2 ring-sky-400/60 dark:border-sky-400/60 dark:bg-sky-400/15 dark:ring-sky-400/50"
          : "border-sky-300/50 bg-sky-50/60 dark:border-sky-400/25 dark:bg-sky-400/10"
      }`}
      onClick={(e) => e.stopPropagation()}
      onMouseEnter={() => onFocusNode?.(node.id)}
      onMouseLeave={() => onFocusNode?.(null)}
      data-testid={`table-card-${node.id}`}
    >
      {/* 표 본체 — 가로 넘침 시 스크롤(열 너비를 크게 키워도 카드 폭 보존) */}
      <div className="cap-noscrollbar overflow-x-auto">
        <div className="inline-block">
          {t.cells.map((row, r) => (
            <div key={r} className="group/row flex items-stretch">
              {/* 좌측 행 삭제 거터 */}
              {editable ? (
                <button
                  type="button"
                  title="행 삭제"
                  onClick={() => delRow(r)}
                  className="flex w-[14px] shrink-0 items-center justify-center text-muted-foreground/30 opacity-0 transition-opacity hover:text-destructive group-hover/row:opacity-100"
                  data-testid={`del-row-${node.id}-${r}`}
                  tabIndex={-1}
                >
                  <X className="h-2.5 w-2.5" strokeWidth={3} />
                </button>
              ) : <div className="w-[14px] shrink-0" aria-hidden />}

              {row.map((cell, c) => (
                <div
                  key={c}
                  className="group/col relative border border-border/60"
                  style={{ width: Math.max(MIN_COL_W, t.widths[c] || DEFAULT_COL_W) }}
                >
                  {/* 첫 행: 열 삭제 버튼(상단) */}
                  {editable && r === 0 ? (
                    <button
                      type="button"
                      title="열 삭제"
                      onClick={() => delCol(c)}
                      className="absolute -top-2 left-1/2 z-10 flex h-3.5 w-3.5 -translate-x-1/2 items-center justify-center rounded-full bg-muted text-muted-foreground/60 opacity-0 shadow-sm transition-opacity hover:text-destructive group-hover/col:opacity-100"
                      data-testid={`del-col-${node.id}-${c}`}
                      tabIndex={-1}
                    >
                      <X className="h-2 w-2" strokeWidth={3} />
                    </button>
                  ) : null}

                  {editable ? (
                    <textarea
                      ref={r === 0 && c === 0 ? firstCellRef : undefined}
                      value={cell}
                      rows={1}
                      onFocus={() => { editingRef.current = true; }}
                      onChange={(e) => { setCell(r, c, e.target.value); autoGrow(e.target); }}
                      onBlur={() => { editingRef.current = false; onCommit(node.id, t); }}
                      onInput={(e) => autoGrow(e.currentTarget)}
                      className="block w-full resize-none overflow-hidden bg-transparent px-1 py-0.5 text-[11.5px] leading-snug text-foreground outline-none focus:bg-background/60"
                      data-testid={`cell-${node.id}-${r}-${c}`}
                    />
                  ) : (
                    <div className="whitespace-pre-wrap px-1 py-0.5 text-[11.5px] leading-snug text-foreground">{cell || "​"}</div>
                  )}

                  {/* 열 너비 드래그 핸들(우측 경계) — 첫 행에만(열 전체에 작용) */}
                  {editable && r === 0 ? (
                    <span
                      onPointerDown={(e) => startResize(c, e)}
                      title="드래그하여 열 너비 조절"
                      className="absolute -right-[3px] top-0 z-10 h-full w-[6px] cursor-col-resize touch-none hover:bg-sky-400/40"
                      data-testid={`col-resize-${node.id}-${c}`}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* 편집 컨트롤 — +열 / +행 / 표 삭제 */}
      {editable ? (
        <div className="mt-1 flex items-center gap-1">
          <button type="button" onClick={addCol} title="열 추가"
            className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:bg-sky-100/60 hover:text-sky-600 dark:hover:bg-sky-400/15"
            data-testid={`add-col-${node.id}`}>
            <Plus className="h-2.5 w-2.5" /> 열
          </button>
          <button type="button" onClick={addRow} title="행 추가"
            className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:bg-sky-100/60 hover:text-sky-600 dark:hover:bg-sky-400/15"
            data-testid={`add-row-${node.id}`}>
            <Plus className="h-2.5 w-2.5" /> 행
          </button>
          <span className="flex-1" />
          <button type="button" onClick={deleteTable} title="표 삭제"
            className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-muted-foreground/70 hover:bg-destructive/10 hover:text-destructive"
            data-testid={`del-table-${node.id}`}>
            <Trash2 className="h-2.5 w-2.5" /> 표 삭제
          </button>
        </div>
      ) : null}
    </div>
  );
}

// 열 c 제거(셀 + 너비).
function removeCol(t: CapTableData, c: number): CapTableData {
  const next = cloneTable(t);
  next.widths.splice(c, 1);
  next.cells.forEach((row) => row.splice(c, 1));
  return next;
}

// textarea 내용에 맞춰 높이 자동 조절(행 높이는 내용따라 자동 — '열 너비만' 조절 정책).
function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
}

// ─────────────────────────────────────────────────────────────
// 노드 세로 위치에 카드를 앵커링하는 절대배치 컬럼(메모열과 동일 방식, 독립 구현).
// bodyEl 안에서 data-node-id 가 일치하는 노드의 상대 top 을 읽어 카드 top 으로 쓰고,
// 카드끼리 겹치면 아래로 밀어 내린다.
// ─────────────────────────────────────────────────────────────
export function TableColumn({
  tableNodes, slug, bodyEl, width, editable, autoEditId, onCommit, onEditDone, onFocusNode, focusedId, onHeight,
}: {
  tableNodes: FlowNodeDTO[];
  slug: string;
  bodyEl: HTMLElement | null;
  width: number;
  editable: boolean;
  autoEditId: string | null;
  onCommit: (id: string, table: CapTableData | null) => void;
  onEditDone?: (id: string) => void;
  onFocusNode?: (id: string | null) => void;
  focusedId?: string | null;
  onHeight?: (h: number) => void;
}) {
  const colRef = useRef<HTMLDivElement | null>(null);
  const [tops, setTops] = useState<Record<string, number>>({});
  const [stackH, setStackH] = useState(0);
  const nodesRef = useRef(tableNodes);
  nodesRef.current = tableNodes;

  const measure = useRef<() => void>(() => {});
  measure.current = () => {
    const col = colRef.current;
    if (!col || !bodyEl) return;
    const bodyRect = bodyEl.getBoundingClientRect();
    const GAP = 8;
    const next: Record<string, number> = {};
    let cursor = 0;
    let maxBottom = 0;
    for (const n of nodesRef.current) {
      const cardEl = col.querySelector<HTMLElement>(`[data-table-anchor="${n.id}"]`);
      if (!cardEl) continue;
      const nodeEl = bodyEl.querySelector<HTMLElement>(`[data-node-id="${slug}::${n.id}"]`);
      const nodeTop = nodeEl ? nodeEl.getBoundingClientRect().top - bodyRect.top : cursor;
      const top = Math.max(nodeTop, cursor);
      next[n.id] = top;
      const h = cardEl.offsetHeight;
      cursor = top + h + GAP;
      maxBottom = Math.max(maxBottom, top + h);
    }
    setTops((prev) => {
      const keys = Object.keys(next);
      if (keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === next[k])) return prev;
      return next;
    });
    setStackH((prev) => (prev === maxBottom ? prev : maxBottom));
    onHeight?.(maxBottom);
  };

  useLayoutEffect(() => { measure.current(); });
  useLayoutEffect(() => {
    const col = colRef.current;
    if (!col || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure.current());
    ro.observe(col);
    col.querySelectorAll("[data-table-anchor]").forEach((el) => ro.observe(el));
    if (bodyEl) ro.observe(bodyEl);
    return () => ro.disconnect();
  }, [bodyEl, tableNodes.length]);

  return (
    <div ref={colRef} style={{ width, height: stackH || undefined }} className="relative shrink-0">
      {tableNodes.map((n) => (
        <div key={n.id} data-table-anchor={n.id} className="absolute left-0 right-0" style={{ top: tops[n.id] ?? 0 }}>
          <TableCard
            node={n}
            editable={editable}
            autoEdit={n.id === autoEditId}
            onCommit={onCommit}
            onEditDone={onEditDone}
            onFocusNode={onFocusNode}
            focusedId={focusedId}
          />
        </div>
      ))}
    </div>
  );
}
