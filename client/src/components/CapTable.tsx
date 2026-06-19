// 노드별 표(메모와 같은 열에 함께 표시). 일반 텍스트 셀.
//  - 열 너비 = flex 비율(weight). 표 전체 너비는 컨테이너에 고정 → 열을 추가해도 총 너비는
//    그대로이고 각 열이 1/N 로 균등 분할된다. 드래그(열 경계)는 이웃 두 열끼리 너비를 주고받는다.
//  - 행 높이는 내용에 따라 자동.
import { useState, useRef, useEffect } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import type { CapTableData, FlowNodeDTO } from "@/lib/capitalism-types";

const MIN_COL_W = 32;      // 열 최소 픽셀 너비(드래그 클램프 기준)
const ROW_DELETE_W = 14;   // 좌측 행삭제 거터 폭

// 빈 기본 표(2열 × 2행). widths 는 flex 비율(상대값) — 균등.
export function makeDefaultTable(): CapTableData {
  return { widths: [1, 1], cells: [["", ""], ["", ""]] };
}

function cloneTable(t: CapTableData): CapTableData {
  return { widths: [...t.widths], cells: t.cells.map((r) => [...r]) };
}

// textarea 내용에 맞춰 높이 자동 조절(열 너비만 사용자 조절, 행 높이는 자동).
function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
}

export function TableCard({
  node, editable, autoEdit, onCommit, onEditDone, onFocusNode, focusedId,
}: {
  node: FlowNodeDTO;
  editable: boolean;
  autoEdit?: boolean;
  onCommit: (id: string, table: CapTableData | null) => void;
  onEditDone?: (id: string) => void;
  onFocusNode?: (id: string | null) => void;
  focusedId?: string | null;
}) {
  const focused = focusedId === node.id;
  const [t, setT] = useState<CapTableData>(() => node.table ?? makeDefaultTable());
  const hostRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const editingRef = useRef(false);
  const firstCellRef = useRef<HTMLTextAreaElement | null>(null);

  // 외부(서버) 변경 동기화 — 드래그/입력 포커스 중이 아닐 때만(클로버 방지).
  useEffect(() => {
    if (draggingRef.current || editingRef.current) return;
    const host = hostRef.current;
    if (host && host.contains(document.activeElement)) return;
    setT(node.table ?? makeDefaultTable());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.table]);

  // 생성 직후 첫 셀 포커스.
  useEffect(() => {
    if (autoEdit) firstCellRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cols = t.widths.length;
  const rows = t.cells.length;
  const commit = (next: CapTableData) => { setT(next); onCommit(node.id, next); };

  const setCell = (r: number, c: number, v: string) => {
    setT((prev) => {
      const next = cloneTable(prev);
      if (!next.cells[r]) next.cells[r] = [];
      next.cells[r][c] = v;
      return next;
    });
  };

  // 열 추가 — 총 너비 고정, 모든 열을 균등(1/N)으로. 각 행에 빈 셀 추가.
  const addCol = () => {
    const next = cloneTable(t);
    next.cells.forEach((row) => row.push(""));
    next.widths = Array.from({ length: cols + 1 }, () => 1); // 균등 분할
    commit(next);
  };
  const addRow = () => {
    const next = cloneTable(t);
    next.cells.push(Array.from({ length: cols }, () => ""));
    commit(next);
  };
  const delCol = (c: number) => {
    if (cols <= 1) { onCommit(node.id, null); onEditDone?.(node.id); return; } // 마지막 열 삭제 = 표 삭제
    const next = cloneTable(t);
    next.widths.splice(c, 1);
    next.cells.forEach((row) => row.splice(c, 1));
    commit(next); // 남은 열의 비율은 유지(컨테이너를 다시 가득 채움)
  };
  const delRow = (r: number) => {
    if (rows <= 1) { onCommit(node.id, null); onEditDone?.(node.id); return; }
    const next = cloneTable(t);
    next.cells.splice(r, 1);
    commit(next);
  };
  const deleteTable = () => { onCommit(node.id, null); onEditDone?.(node.id); };

  // 열 경계 드래그 — 이웃 두 열(c, c+1)끼리 너비(weight)를 주고받는다. 총합 불변 → 표 너비 고정.
  const startResize = (c: number, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = true;
    const cellsEl = (e.currentTarget as HTMLElement).closest("[data-cap-cells]") as HTMLElement | null;
    const totalPx = cellsEl ? cellsEl.clientWidth : 200;
    const startX = e.clientX;
    const w = [...t.widths];
    const total = w.reduce((a, b) => a + b, 0) || 1;
    const pair = w[c] + w[c + 1];
    const minW = Math.min(pair / 2, total * (MIN_COL_W / Math.max(1, totalPx)));
    const onMove = (ev: PointerEvent) => {
      const dW = ((ev.clientX - startX) / Math.max(1, totalPx)) * total;
      const nc = Math.max(minW, Math.min(pair - minW, w[c] + dW));
      setT((prev) => {
        const nx = cloneTable(prev);
        nx.widths[c] = nc;
        nx.widths[c + 1] = pair - nc;
        return nx;
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
      {t.cells.map((row, r) => (
        <div key={r} className="group/row flex items-stretch">
          {/* 좌측 행 삭제 거터 */}
          {editable ? (
            <button
              type="button"
              title="행 삭제"
              onClick={() => delRow(r)}
              className="flex shrink-0 items-center justify-center text-muted-foreground/30 opacity-0 transition-opacity hover:text-destructive group-hover/row:opacity-100"
              style={{ width: ROW_DELETE_W }}
              data-testid={`del-row-${node.id}-${r}`}
              tabIndex={-1}
            >
              <X className="h-2.5 w-2.5" strokeWidth={3} />
            </button>
          ) : <div style={{ width: ROW_DELETE_W }} className="shrink-0" aria-hidden />}

          {/* 셀 영역 — flex 비율로 분할(총 너비 = 이 컨테이너에 고정) */}
          <div className="flex min-w-0 flex-1" data-cap-cells>
            {row.map((cell, c) => (
              <div
                key={c}
                className="group/col relative border border-border/60"
                style={{ flexGrow: t.widths[c] || 1, flexBasis: 0, minWidth: 0 }}
              >
                {/* 첫 행: 열 삭제 버튼 */}
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
                    ref={(el) => { if (el) autoGrow(el); if (r === 0 && c === 0) firstCellRef.current = el; }}
                    value={cell}
                    rows={1}
                    onFocus={() => { editingRef.current = true; }}
                    onChange={(e) => { setCell(r, c, e.target.value); autoGrow(e.target); }}
                    onBlur={() => { editingRef.current = false; onCommit(node.id, t); }}
                    className="block w-full resize-none overflow-hidden bg-transparent px-1 py-0.5 text-[11.5px] leading-snug text-foreground outline-none focus:bg-background/60"
                    data-testid={`cell-${node.id}-${r}-${c}`}
                  />
                ) : (
                  <div className="whitespace-pre-wrap px-1 py-0.5 text-[11.5px] leading-snug text-foreground">{cell || "​"}</div>
                )}

                {/* 열 경계 드래그 핸들 — 마지막 열 제외(이웃과 너비 교환), 첫 행에만 표시(열 전체 작용) */}
                {editable && r === 0 && c < cols - 1 ? (
                  <span
                    onPointerDown={(e) => startResize(c, e)}
                    title="드래그하여 이웃 열과 너비 조절"
                    className="absolute -right-[3px] top-0 z-10 h-full w-[6px] cursor-col-resize touch-none hover:bg-sky-400/40"
                    data-testid={`col-resize-${node.id}-${c}`}
                  />
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* 편집 컨트롤 — +열 / +행 / 표 삭제 */}
      {editable ? (
        <div className="mt-1 flex items-center gap-1">
          <button type="button" onClick={addCol} title="열 추가(총 너비 고정·균등 분할)"
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
