// 인과 플로우 렌더러 + 인라인 편집. 팝업/라벨 없음.
//  - 박스는 투명/무색, 텍스트만 표시.
//  - 칸 클릭 → 그 자리에서 리치텍스트 편집(드래그 색상 툴바). 포커스 해제 시 저장.
//  - 칸 호버: 하단 +버튼 = 아래 스택 추가, 우측 +버튼 = 가로 분기 추가 (즉시 생성/저장).
//  - 칸 우측 상단 X = 그 칸 삭제(내용 비워도 자동 삭제). 마지막 칸이면 플로우 삭제.
import { useState, useRef, useLayoutEffect } from "react";
import { X, MessageSquare, Table2, Star } from "lucide-react";
import { CapRichText } from "@/components/CapRichText";
import { CapRichEditor, type LinkTarget } from "@/components/CapRichEditor";
import { TableCard, makeDefaultTable } from "@/components/CapTable";
import { newNodeKey } from "@/lib/capitalism-flowops";
import type { FlowDTO, FlowNodeDTO, CapTableData } from "@/lib/capitalism-types";

// 노드 배열을 통째로 바꿔 저장하는 콜백(페이지가 서버 반영 담당).
export type MutateNodes = (flow: FlowDTO, nextNodes: FlowNodeDTO[]) => void;
// 카드 메타(날짜/제목/레이아웃) 변경 저장 콜백.
export type MutateMeta = (flow: FlowDTO, patch: { date?: string; endDate?: string | null; title?: string; layout?: string }) => void;
// 드래그앤드롭 화살표 연결 콜백 — from 노드 → to 노드(카드 내/간 모두).
export type LinkNodes = (from: { slug: string; key: string }, to: { slug: string; key: string }) => void;

// 드래그 중인 소스 노드(전역) — dataTransfer 가 제한적인 환경 대비해 모듈 변수로도 보관.
let DRAG_SRC: { slug: string; key: string } | null = null;

function blankNode(col = "center"): FlowNodeDTO {
  return { id: newNodeKey(), kind: "effect", inLabel: null, text: "", ref: null, col };
}

function Node({
  flow, node, editable, editing, onStartEdit, onCommit, onDelete, onAdd, onMemoClick, onTableClick, onLink, linkTargets, onJump, onFocusNode, focusedId,
}: {
  flow: FlowDTO;
  node: FlowNodeDTO;
  editable: boolean;
  editing: boolean;
  onStartEdit: (id: string) => void;
  onCommit: (id: string, text: string) => void;
  onDelete: (id: string) => void;
  onAdd: (afterId: string, dir: "down" | "branch-left" | "branch-right") => void;
  // 메모 버튼 클릭 — 우측 메모 컬럼에서 이 노드의 메모를 추가/편집 시작.
  onMemoClick?: (id: string) => void;
  // 표 버튼 클릭 — 우측 표열에서 이 노드의 표를 생성/편집 시작.
  onTableClick?: (id: string) => void;
  onLink?: LinkNodes;
  // 내부 링크용 — 카드 목록(편집) + 점프 콜백(클릭).
  linkTargets?: LinkTarget[];
  onJump?: (slug: string) => void;
  // 노션식 양방향 하이라이트 — 호버 중인 노드 id 공유. focus 대상이면 노드를 강조한다.
  onFocusNode?: (id: string | null) => void;
  focusedId?: string | null;
}) {
  const [hover, setHover] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [draft, setDraft] = useState(node.text);
  const hasMemo = !!(node.ref && node.ref.trim());
  const hasTable = !!node.table;
  // 이 노드(또는 그 메모)에 마우스가 올라가 있어 강조 대상인지.
  const focused = focusedId === node.id;
  // 드래그앤드롭 화살표 그리기 기능 — 현재 비활성(주석처리). 필요 시 아래 줄 복구.
  // const canDrag = editable && !editing && !!onLink;
  const canDrag = false;

  return (
    <div
      className={`group relative rounded px-2 py-1.5 transition-all ${
        dragOver ? "ring-2 ring-rose-400 ring-offset-1" : ""
      } ${
        focused
          ? "bg-amber-100/70 ring-2 ring-amber-400/80 dark:bg-amber-400/15 dark:ring-amber-400/60"
          : ""
      }`}
      onMouseEnter={() => { setHover(true); if (hasMemo) onFocusNode?.(node.id); }}
      onMouseLeave={() => { setHover(false); if (hasMemo) onFocusNode?.(null); }}
      data-testid={`fnode-${node.id}`}
      // 보드 오버레이가 좌표를 측정할 수 있도록 전역 식별자 부여(slug::nodeKey).
      data-node-id={`${flow.slug}::${node.id}`}
      // [비활성] 드래그앤드롭 화살표 그리기 — 당장 필요 없어 주석처리. 복구 시 아래 블록 해제.
      /*
      draggable={canDrag}
      onDragStart={(e) => {
        if (!canDrag) return;
        DRAG_SRC = { slug: flow.slug, key: node.id };
        try {
          e.dataTransfer.setData("text/plain", `${flow.slug}::${node.id}`);
          e.dataTransfer.effectAllowed = "link";
        } catch {}
      }}
      onDragEnd={() => { DRAG_SRC = null; setDragOver(false); }}
      onDragOver={(e) => {
        if (!canDrag || !DRAG_SRC) return;
        // 자기 자신 위로는 드롭 표시 안 함.
        if (DRAG_SRC.slug === flow.slug && DRAG_SRC.key === node.id) return;
        e.preventDefault();
        try { e.dataTransfer.dropEffect = "link"; } catch {}
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (!canDrag) return;
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
        let src = DRAG_SRC;
        if (!src) {
          const raw = e.dataTransfer.getData("text/plain");
          const [s, k] = raw.split("::");
          if (s && k) src = { slug: s, key: k };
        }
        DRAG_SRC = null;
        if (!src) return;
        if (src.slug === flow.slug && src.key === node.id) return; // 자기 연결 금지
        onLink?.(src, { slug: flow.slug, key: node.id });
      }}
      */
    >
      {editing ? (
        <CapRichEditor
          value={draft}
          onChange={setDraft}
          autoFocus
          placeholder="내용 입력 (드래그하여 강조 · 비우면 삭제)"
          rows={2}
          onBlur={() => onCommit(node.id, draft)}
          linkTargets={linkTargets}
        />
      ) : (
        <div
          className={editable ? "cursor-text rounded hover:bg-muted/40" : ""}
          onClick={(e) => { if (editable) { e.stopPropagation(); setDraft(node.text); onStartEdit(node.id); } }}
          data-testid={`fnode-text-${node.id}`}
        >
          {node.text.trim() ? (
            <CapRichText text={node.text} className="block text-center text-[12.5px] leading-snug text-foreground" onJump={onJump} />
          ) : (
            <span className="block text-center text-[12.5px] italic leading-snug text-muted-foreground/50">
              (빈 칸 — 클릭해 입력)
            </span>
          )}
        </div>
      )}

      {/* 우측 하단 버튼 — 표(좌) + 메모(우). 있으면 색상, 없으면 흐린 회색. 클릭 시 우측 해당 열에서 편집. */}
      {!editing ? (
        <>
          <button
            type="button"
            title={hasTable ? "표 편집" : "표 추가"}
            onClick={(e) => { e.stopPropagation(); onTableClick?.(node.id); }}
            className={`absolute right-[18px] bottom-0.5 z-10 flex h-4 w-4 items-center justify-center rounded-full transition-colors ${
              hasTable
                ? "bg-sky-400/90 text-sky-950 shadow-sm hover:bg-sky-400"
                : "bg-muted/50 text-muted-foreground/50 opacity-50 hover:opacity-100 hover:bg-muted"
            }`}
            data-testid={`table-btn-${node.id}`}
          >
            <Table2 className="h-2.5 w-2.5" strokeWidth={2.5} />
          </button>
          <button
            type="button"
            title={hasMemo ? "메모 보기/편집" : "메모 추가"}
            onClick={(e) => { e.stopPropagation(); onMemoClick?.(node.id); }}
            className={`absolute right-0.5 bottom-0.5 z-10 flex h-4 w-4 items-center justify-center rounded-full transition-colors ${
              hasMemo
                ? "bg-amber-400/90 text-amber-950 shadow-sm hover:bg-amber-400"
                : "bg-muted/50 text-muted-foreground/50 opacity-50 hover:opacity-100 hover:bg-muted"
            }`}
            data-testid={`memo-btn-${node.id}`}
          >
            <MessageSquare className="h-2.5 w-2.5" strokeWidth={2.5} />
          </button>
        </>
      ) : null}

      {/* 편집 모드일 때만 노출되는 컨트롤들 */}
      {editable && !editing ? (
        <>
          {/* [비활성] 드래그 그립 — 드래그앤드롭 화살표 기능과 함께 주석처리. 복구 시 해제.
          {hover && onLink ? (
            <span
              title="끌어서 다른 칸과 화살표 연결"
              className="absolute -left-1.5 -top-1.5 z-10 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-rose-500/90 text-white shadow cursor-grab active:cursor-grabbing"
              data-testid={`drag-grip-${node.id}`}
            >
              <svg width="7" height="7" viewBox="0 0 6 6"><circle cx="1.5" cy="1.5" r="0.9" fill="currentColor"/><circle cx="4.5" cy="1.5" r="0.9" fill="currentColor"/><circle cx="1.5" cy="4.5" r="0.9" fill="currentColor"/><circle cx="4.5" cy="4.5" r="0.9" fill="currentColor"/></svg>
            </span>
          ) : null}
          */}

          {/* 우측 상단 X = 이 칸 삭제 */}
          {hover ? (
            <button
              type="button"
              title="이 칸 삭제"
              className="absolute -right-1.5 -top-1.5 z-20 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow hover:scale-110 transition-transform"
              onClick={(e) => { e.stopPropagation(); onDelete(node.id); }}
              data-testid={`del-node-${node.id}`}
            >
              <X className="h-2.5 w-2.5" strokeWidth={3} />
            </button>
          ) : null}

          {/* 하단 +버튼 = 아래 스택 추가 */}
          {hover ? (
            <button
              type="button"
              title="아래로 칸 추가"
              className="absolute left-1/2 -bottom-2 z-20 flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground text-[11px] leading-none shadow hover:scale-110 transition-transform"
              onClick={(e) => { e.stopPropagation(); onAdd(node.id, "down"); }}
              data-testid={`add-down-${node.id}`}
            >
              +
            </button>
          ) : null}

          {/* 우측 +버튼 = 오른쪽 방향 분기 (왼쪽 분기는 사용하지 않아 버튼 제거) */}
          {hover ? (
            <button
              type="button"
              title="오른쪽으로 분기 추가"
              className="absolute -right-2 top-1/2 z-20 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full bg-foreground/70 text-background text-[11px] leading-none shadow hover:scale-110 transition-transform"
              onClick={(e) => { e.stopPropagation(); onAdd(node.id, "branch-right"); }}
              data-testid={`add-branch-right-${node.id}`}
            >
              +
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function VArrow() {
  return (
    <div className="flex justify-center py-0.5">
      <svg width="14" height="16" viewBox="0 0 14 16">
        <line x1="7" y1="0" x2="7" y2="10" stroke="currentColor" strokeWidth="1.3" className="text-muted-foreground/40" />
        <path d="M3.5 9 L7 14 L10.5 9" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/50" />
      </svg>
    </div>
  );
}

// 메모 컬럼 너비(px). 카드 우측 여백을 채워 노션식 코멘트를 상시 표시한다.
const MEMO_COL_W = 240;

// 노션식 메모 카드 1개. 작성된 메모만 표시하며, 노드 버튼으로 추가한 경우(autoEdit) 자동으로 편집 상태.
function MemoCard({
  node, editable, autoEdit, onMemo, onFocusNode, onEditDone, focusedId,
}: {
  node: FlowNodeDTO;
  editable: boolean;
  // 노드 메모 버튼으로 막 추가된 메모 — 자동으로 편집 모드로 시작.
  autoEdit?: boolean;
  onMemo?: (id: string, memo: string) => void;
  onFocusNode?: (id: string | null) => void;
  // 편집 종료 신호(취소 포함) — 부모가 autoEdit 대상을 해제하도록.
  onEditDone?: (id: string) => void;
  // 노션식 양방향 하이라이트 — 대응 노드가 호버 중이면 메모 카드도 강조.
  focusedId?: string | null;
}) {
  const hasMemo = !!(node.ref && node.ref.trim());
  const focused = focusedId === node.id;
  const [editing, setEditing] = useState(!!autoEdit);
  const [draft, setDraft] = useState(node.ref ?? "");
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const grow = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
    el.style.overflowY = el.scrollHeight > 320 ? "auto" : "hidden";
  };
  const startEdit = () => {
    if (!editable) return;
    setDraft(node.ref ?? "");
    setEditing(true);
    onFocusNode?.(node.id);
  };
  const finish = () => {
    setEditing(false);
    onFocusNode?.(null);
    onMemo?.(node.id, draft);
    onEditDone?.(node.id);
  };
  const cancel = () => {
    setDraft(node.ref ?? "");
    setEditing(false);
    onFocusNode?.(null);
    onEditDone?.(node.id);
  };

  return (
    <div
      className={`rounded-md border px-2 py-1.5 shadow-sm transition-all ${
        focused
          ? "border-amber-400/80 bg-amber-100/80 ring-2 ring-amber-400/70 dark:border-amber-400/60 dark:bg-amber-400/20 dark:ring-amber-400/50"
          : "border-amber-300/50 bg-amber-50/70 dark:border-amber-400/25 dark:bg-amber-400/10"
      }`}
      onClick={(e) => e.stopPropagation()}
      onMouseEnter={() => onFocusNode?.(node.id)}
      onMouseLeave={() => { if (!editing) onFocusNode?.(null); }}
      data-testid={`memo-card-${node.id}`}
    >
      {editing ? (
        <textarea
          ref={(el) => { taRef.current = el; if (el) { grow(el); requestAnimationFrame(() => grow(el)); } }}
          value={draft}
          autoFocus
          rows={3}
          onChange={(e) => { setDraft(e.target.value); grow(e.target); }}
          onBlur={finish}
          onKeyDown={(e) => {
            if (e.key === "Escape") { cancel(); }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); finish(); }
          }}
          placeholder="메모 입력 (Esc 취소 · ⌘/Ctrl+Enter 저장 · 비워서 저장하면 삭제)"
          className="block max-h-[320px] min-h-[56px] w-full resize-none overflow-hidden rounded border border-amber-300/60 bg-background px-1.5 py-1 text-[12.5px] leading-snug text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-amber-400"
          data-testid={`memo-input-${node.id}`}
        />
      ) : (
        <p
          className={`whitespace-pre-wrap text-[12.5px] leading-relaxed text-foreground/90 ${editable ? "cursor-text rounded hover:bg-amber-100/50 dark:hover:bg-amber-400/10" : ""}`}
          onClick={startEdit}
          title={editable ? "클릭해 메모 수정" : undefined}
          data-testid={`memo-text-${node.id}`}
        >
          {node.ref}
        </p>
      )}
    </div>
  );
}

// 메모 컬럼(본문과 분리). 각 메모 카드를 "대응 노드의 실제 세로 위치"에 절대배치(absolute)로 앵커링한다.
// 이렇게 하면 메모가 아무리 길어도 본문 노드 간격에는 전혀 영향을 주지 않는다(사용자 요구: 2열/3열 분리).
// 측정: bodyEl 안에서 data-node-id가 일치하는 노드의 offsetTop을 읽어 메모 top으로 사용하고,
// 메모끼리 겹치면 아래로 밀어 내린다(top = max(노드 top, 직전 메모 bottom + gap)).
// 노드별 주석 컬럼 — 메모와 표를 '한 열'에 함께 표시. 각 노드의 (메모 + 표)를 그 노드의
// 세로 위치에 앵커링하고, 블록끼리 겹치면 아래로 밀어 내린다(본문 노드 간격에는 영향 없음).
function SideColumn({
  sideNodes, slug, bodyEl, editable, autoEditMemoId, autoEditTableId,
  onMemo, onMemoEditDone, onCommitTable, onTableEditDone, onFocusNode, focusedId,
}: {
  sideNodes: FlowNodeDTO[];
  slug: string;
  bodyEl: HTMLElement | null;
  editable: boolean;
  autoEditMemoId: string | null;
  autoEditTableId: string | null;
  onMemo?: (id: string, memo: string) => void;
  onMemoEditDone?: (id: string) => void;
  onCommitTable: (id: string, table: CapTableData | null) => void;
  onTableEditDone?: (id: string) => void;
  onFocusNode?: (id: string | null) => void;
  focusedId?: string | null;
}) {
  const colRef = useRef<HTMLDivElement | null>(null);
  const [tops, setTops] = useState<Record<string, number>>({});
  const [stackH, setStackH] = useState(0);
  const nodesRef = useRef(sideNodes);
  nodesRef.current = sideNodes;

  // 레이아웃 측정: 노드 위치 + (메모+표) 블록 높이를 읽어 겹치지 않게 top 계산.
  // textarea 자동 높이/표 편집 등 명령형 변화는 ResizeObserver 로 감지해 재측정.
  const measure = useRef<() => void>(() => {});
  measure.current = () => {
    const col = colRef.current;
    if (!col || !bodyEl) return;
    const bodyRect = bodyEl.getBoundingClientRect();
    const GAP = 6;
    const next: Record<string, number> = {};
    let cursor = 0;
    let maxBottom = 0;
    for (const n of nodesRef.current) {
      const cardEl = col.querySelector<HTMLElement>(`[data-side-anchor="${n.id}"]`);
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
  };

  useLayoutEffect(() => { measure.current(); });
  useLayoutEffect(() => {
    const col = colRef.current;
    if (!col || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure.current());
    ro.observe(col);
    col.querySelectorAll("[data-side-anchor]").forEach((el) => ro.observe(el));
    if (bodyEl) ro.observe(bodyEl);
    return () => ro.disconnect();
  }, [bodyEl, sideNodes.length]);

  return (
    <div ref={colRef} style={{ width: MEMO_COL_W, height: stackH || undefined }} className="relative shrink-0">
      {sideNodes.map((n) => {
        const showMemo = !!(n.ref && n.ref.trim()) || n.id === autoEditMemoId;
        const showTable = !!n.table || n.id === autoEditTableId;
        return (
          <div
            key={n.id}
            data-side-anchor={n.id}
            className="absolute left-0 right-0 flex flex-col gap-1.5"
            style={{ top: tops[n.id] ?? 0 }}
          >
            {showMemo ? (
              <MemoCard
                node={n}
                editable={editable}
                autoEdit={n.id === autoEditMemoId}
                onMemo={onMemo}
                onFocusNode={onFocusNode}
                onEditDone={onMemoEditDone}
                focusedId={focusedId}
              />
            ) : null}
            {showTable ? (
              <TableCard
                node={n}
                editable={editable}
                autoEdit={n.id === autoEditTableId}
                onCommit={onCommitTable}
                onEditDone={onTableEditDone}
                onFocusNode={onFocusNode}
                focusedId={focusedId}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function FlowColumn({
  flow, active, onSelect, onMutateNodes, onAddLocal, onMutateMeta, onLink, editingId, setEditingId, editable = false, linkTargets, onJump, onInsightClick,
}: {
  flow: FlowDTO;
  active: boolean;
  onSelect: (f: FlowDTO) => void;
  onMutateNodes?: MutateNodes;
  onAddLocal?: MutateNodes;
  onMutateMeta?: MutateMeta;
  onLink?: LinkNodes;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  editable?: boolean;
  // 내부 링크 — 편집 시 카드 목록, 클릭 시 점프 콜백.
  linkTargets?: LinkTarget[];
  onJump?: (slug: string) => void;
  // 인사이트 별(★) 클릭 — 오른쪽 패널에 이 사건 인사이트를 연다.
  onInsightClick?: (slug: string) => void;
}) {
  // 카드 헤더 인라인 편집 상태: "date" | "title" | null
  const [metaEdit, setMetaEdit] = useState<"date" | "title" | null>(null);
  // 노드 메모 버튼으로 막 추가/편집을 시작한 노드 id. 해당 메모 카드를 강제 표시 + 자동 편집.
  const [autoEditMemoId, setAutoEditMemoId] = useState<string | null>(null);
  // 노드 표 버튼으로 막 추가/편집을 시작한 노드 id. 첫 셀 자동 포커스용.
  const [autoEditTableId, setAutoEditTableId] = useState<string | null>(null);
  // 노션식 양방향 호버 하이라이트 — 현재 호버 중인 노드 id. 노드↔메모 양쪽을 동시에 강조한다.
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  // 본문 스택 DOM 참조(메모 컬럼이 노드 세로 위치를 측정하는 좌표 기준). callback ref로 세팅해 최초 마운트 시점에도 메모 앵커링이 동작하게 한다.
  const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null);
  const [dateDraft, setDateDraft] = useState(flow.date);
  const [endDateDraft, setEndDateDraft] = useState(flow.endDate ?? "");
  const [titleDraft, setTitleDraft] = useState(flow.title);
  // 노드 텍스트 커밋: 빈 칸이면 제거, 아니면 갱신. 그리고 서버 반영.
  function commit(id: string, text: string) {
    setEditingId(null);
    if (!onMutateNodes) return;
    const trimmed = text.trim();
    // 내용이 실제로 바뀌지 않았으면(=기존 텍스트 그대로 빠져나감) 서버 저장·Undo 푸시 없이 종료.
    const cur = flow.nodes.find((n) => n.id === id);
    if (cur && cur.text === text) return;
    // 텍스트를 비웠어도 표/메모가 달려 있으면 노드를 삭제하지 않고 텍스트만 비운다(표·메모 보존).
    const keepEvenIfEmpty = !!(cur && (cur.table || (cur.ref && cur.ref.trim())));
    let next: FlowNodeDTO[];
    if (!trimmed && !keepEvenIfEmpty) {
      next = flow.nodes.filter((n) => n.id !== id); // 진짜 빈 칸 → 삭제
    } else {
      next = flow.nodes.map((n) => (n.id === id ? { ...n, text } : n));
    }
    onMutateNodes(flow, next);
  }

  function deleteNode(id: string) {
    if (!onMutateNodes) return;
    setEditingId(null);
    onMutateNodes(flow, flow.nodes.filter((n) => n.id !== id));
  }

  function addNode(afterId: string, dir: "down" | "branch-left" | "branch-right") {
    const add = onAddLocal ?? onMutateNodes;
    if (!add) return;
    const idx = flow.nodes.findIndex((n) => n.id === afterId);
    const nodes = [...flow.nodes];

    // ── 아래 스택 추가: 같은 컬럼으로 바로 아래 삽입 ──
    if (dir === "down") {
      const base = idx >= 0 ? nodes[idx] : nodes[nodes.length - 1];
      const col = base?.col || "center";
      const nn = blankNode(col);
      let insertAt = idx >= 0 ? idx + 1 : nodes.length;
      // branch 레이아웃에서 기준열(center) 아래에 칸을 추가할 때는, 같은 행 블록에
      // 딸린 분기(left/right) 노드들을 건너뛴 위치에 삽입한다. 배열 인접성으로 행을
      // 구성하므로, 단순히 center 바로 뒤에 끼우면 기존 분기 노드들이 한 행씩 아래로
      // 밀린다(우측 분기를 먼저 작성한 뒤 기준열 추가 시 발생하던 버그).
      if (flow.layout === "branch" && col === "center" && idx >= 0) {
        let j = idx + 1;
        while (j < nodes.length && (nodes[j].col || "center") !== "center") j++;
        insertAt = j;
      }
      nodes.splice(insertAt, 0, nn);
      add(flow, nodes);
      setEditingId(nn.id);
      return;
    }

    // ── 좌/우 분기 추가: 선택한 방향 컬럼에 새 칸 ──
    // 새 칸은 "출발 노드 바로 뒤" 인덱스에 삽입한다. 배열 순서가 곧 행(row) 순서이므로,
    // 이렇게 하면 렌더 시 새 분기 칸이 출발 노드와 같은 행에 정렬된다(버그1).
    const targetCol = dir === "branch-left" ? "left" : "right";
    const nn = blankNode(targetCol);

    if (flow.layout === "branch") {
      // 이미 branch 레이아웃: 출발 노드 바로 뒤에 삽입.
      nodes.splice(idx >= 0 ? idx + 1 : nodes.length, 0, nn);
      add(flow, nodes);
      setEditingId(nn.id);
      return;
    }

    // ── stack → branch 자동 전환 ──
    // 기존 stack 노드들은 center(출발 줄기)로 두고, 새 칸을 선택 방향에 추가.
    // layout 전환과 노드 추가를 한 번에 처리(이중 POST 레이스 방지). 서버 저장은 새 칸의 텍스트를
    // 입력해 commit할 때 이뤄지며, 그때 캐시의 branch 레이아웃으로 저장된다.
    // 새 분기 칸을 출발 노드 바로 뒤에 삽입해 같은 행에 정렬되도록 한다(버그1).
    const converted: FlowNodeDTO[] = nodes.map((n) => ({ ...n, col: "center" }));
    converted.splice(idx >= 0 ? idx + 1 : converted.length, 0, nn);
    add({ ...flow, layout: "branch" }, converted);
    setEditingId(nn.id);
  }

  // 메타(날짜/제목) 커밋. 시작일 + (선택)종료일을 함께 반영.
  // 종료일이 비었거나 시작일보다 빠르면 null(기간 해제)로 정규화.
  function commitDate() {
    setMetaEdit(null);
    if (!onMutateMeta) return;
    const start = dateDraft.trim();
    if (!start) return;
    let end: string | null = endDateDraft.trim() || null;
    if (end && end < start) end = null; // 잘못된 범위는 무시
    const curEnd = flow.endDate ?? null;
    if (start === flow.date && end === curEnd) return; // 변경 없음
    onMutateMeta(flow, { date: start, endDate: end });
  }
  function commitTitle() {
    setMetaEdit(null);
    const v = titleDraft.trim();
    if (!onMutateMeta || !v || v === flow.title) return;
    onMutateMeta(flow, { title: v });
  }

  // 노드 메모(보충 설명) 커밋. ref 컬럼에 저장. 빈 문자열 → null(메모 삭제).
  function commitMemo(id: string, memo: string) {
    if (!onMutateNodes) return;
    const next: string | null = memo.trim() || null;
    const cur = flow.nodes.find((n) => n.id === id);
    if (!cur || (cur.ref ?? null) === next) return; // 변경 없음
    onMutateNodes(flow, flow.nodes.map((n) => (n.id === id ? { ...n, ref: next } : n)));
  }

  // 노드 메모 버튼 클릭 — 우측 메모 컬럼에 이 노드 메모 카드를 띄우고 바로 편집 상태로 만든다.
  function onMemoClick(id: string) {
    setAutoEditMemoId(id);
  }
  // 메모 편집 종료(저장/취소) — autoEdit 대상 해제. 빈 메모였으면 카드가 자연스레 사라진다.
  function onMemoEditDone(id: string) {
    setAutoEditMemoId((cur) => (cur === id ? null : cur));
  }

  // 노드 표 저장(메모와 같은 층위). table=null 이면 표 삭제. ref 컬럼처럼 node.table 에 보관.
  function commitTable(id: string, table: CapTableData | null) {
    if (!onMutateNodes) return;
    const cur = flow.nodes.find((n) => n.id === id);
    if (!cur) return;
    const prevJson = cur.table ? JSON.stringify(cur.table) : null;
    const nextJson = table ? JSON.stringify(table) : null;
    if (prevJson === nextJson) return; // 변경 없음
    onMutateNodes(flow, flow.nodes.map((n) => (n.id === id ? { ...n, table } : n)));
  }
  // 표 버튼 클릭 — 표 없으면 기본 표(2×2) 생성, 그리고 첫 셀 자동 편집.
  function onTableClick(id: string) {
    const cur = flow.nodes.find((n) => n.id === id);
    if (cur && !cur.table) {
      onMutateNodes?.(flow, flow.nodes.map((n) => (n.id === id ? { ...n, table: makeDefaultTable() } : n)));
    }
    setAutoEditTableId(id);
  }
  function onTableEditDone(id: string) {
    setAutoEditTableId((cur) => (cur === id ? null : cur));
  }

  const nodeProps = {
    flow, editable,
    onStartEdit: setEditingId,
    onCommit: commit,
    onDelete: deleteNode,
    onAdd: addNode,
    onMemoClick,
    onTableClick,
    onLink,
    linkTargets,
    onJump,
    onFocusNode: setFocusedNodeId,
    focusedId: focusedNodeId,
  };

  // 본문을 "행" 배열로 만든다. 각 행은 본문 노드(JSX)와 그 행에 속한 노드 목록(메모 대응용)을 갖는다.
  // 행 단위로 [본문행 | 메모슬롯]을 나란히 두므로, 메모가 자기 노드 행 높이에 대략 정렬되고
  // 위쪽 메모가 사라져도 아래 메모가 위로 끌려올라가지 않는다.
  type BodyRow = { content: JSX.Element; nodes: FlowNodeDTO[] };

  // 어떤 컬럼이 실제로 쓰이는지 판단(빈 컬럼은 렌더하지 않음).
  const usedCols = (() => {
    const set = new Set<string>();
    flow.nodes.forEach((n) => set.add(n.col || "center"));
    return ["left", "center", "right"].filter((c) => set.has(c));
  })();

  // 본문 행 배열 구성(branch=행 그리드, stack=세로 1열).
  const bodyRows: BodyRow[] = [];
  if (flow.layout === "branch") {
    // 행(row) 기반 그리드: 배열 순서대로 순회하며 center 노드는 새 행을 시작하고,
    // left/right(분기) 노드는 가장 최근 행의 해당 컬럼 셀에 배치한다.
    type Row = Record<string, FlowNodeDTO | undefined>;
    const rows: Row[] = [];
    let cur: Row | null = null;
    for (const n of flow.nodes) {
      const col = n.col || "center";
      if (cur === null || col === "center" || cur[col] !== undefined) {
        cur = {};
        rows.push(cur);
      }
      cur[col] = n;
    }
    rows.forEach((row, ri) => {
      const rowNodes = usedCols
        .map((col) => row[col])
        .filter((n): n is FlowNodeDTO => !!n);
      // 화살표는 '기준열(center)'에서만 — 바로 위·아래 행에 center 노드가 연속될 때.
      // 분기열(left/right)에는 노드 간 화살표를 그리지 않는다(기준 흐름만 화살표로 표시).
      const hasArrow = (col: string) =>
        col === "center" && !!row[col] && ri > 0 && !!rows[ri - 1][col];
      const anyArrow = usedCols.some(hasArrow);
      bodyRows.push({
        nodes: rowNodes,
        content: (
          <div>
            {anyArrow ? (
              <div className="flex items-start justify-center gap-3">
                {usedCols.map((col) => (
                  <div key={col} className="w-[240px] shrink-0">
                    {hasArrow(col) ? <VArrow /> : null}
                  </div>
                ))}
              </div>
            ) : null}
            <div className="flex items-start justify-center gap-3">
              {usedCols.map((col) => (
                <div key={col} className="w-[240px] shrink-0">
                  {row[col] ? (
                    // key={node.id}: 노드별 고유 키로 컴포넌트를 식별한다. 없으면 행/컬럼 위치
                    // 기반으로 reconcile되어, 같은 위치에 다른 노드가 들어올 때 이전 노드의
                    // 편집 draft가 그대로 재사용되는 버그가 생긴다(분기 추가 후 새 노드에
                    // 옛 노드 텍스트가 채워지던 문제).
                    <Node key={row[col]!.id} {...nodeProps} node={row[col]!} editing={editingId === row[col]!.id} />
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ),
      });
    });
  } else {
    flow.nodes.forEach((n, i) => {
      bodyRows.push({
        nodes: [n],
        content: (
          <div>
            {i > 0 ? <VArrow /> : null}
            <Node key={n.id} {...nodeProps} node={n} editing={editingId === n.id} />
          </div>
        ),
      });
    });
  }

  // 본문(이벤트 흐름) 너비: 단일 컬럼(기본/스택)은 296px(약간 넓힘). 분기로 컬럼이 늘면
  // 컬럼 수 × (240px + gap 12px) 만큼 본문이 넓어진다.
  const bodyWidth =
    flow.layout === "branch" && usedCols.length > 1
      ? usedCols.length * 240 + (usedCols.length - 1) * 12
      : 296;

  // 메모+표를 한 열(SideColumn)에 함께 표시. 메모/표가 하나라도 있거나 막 추가/편집 중인 노드.
  // (flow.nodes 순서 = 위→아래. 컬럼이 이 순서대로 노드 위치에 앵커링한다.)
  const orderedSideNodes = flow.nodes.filter(
    (n) => (n.ref && n.ref.trim()) || n.table || n.id === autoEditMemoId || n.id === autoEditTableId,
  );
  const showSideCol = orderedSideNodes.length > 0;

  // 카드 전체 너비 = 좌우 패딩(24px) + 본문 + (주석 컬럼: 폭 + 구분선 12px).
  const cardWidth = 24 + bodyWidth + (showSideCol ? MEMO_COL_W + 12 : 0);

  return (
    <div
      style={{ width: cardWidth }}
      className={`relative shrink-0 self-start rounded-lg border bg-transparent p-3 transition-colors ${
        active ? "border-primary/70 ring-1 ring-primary/30" : "border-border/60 hover:border-primary/40"
      }`}
      onClick={() => onSelect(flow)}
      data-testid={`flow-${flow.slug}`}
    >
      {/* 인사이트 별(★) — 우상단. 인사이트 있으면 빨강 채움, 없으면 흐린 외곽선(추가용). 클릭 시 오른쪽 패널에 인사이트. */}
      {editable || flow.insight ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onInsightClick?.(flow.slug); }}
          className={`absolute right-1.5 top-1.5 z-10 transition-transform hover:scale-110 ${
            flow.insight ? "text-red-500" : "text-muted-foreground/30 hover:text-red-400"
          }`}
          title={flow.insight ? "인사이트 보기/편집" : "인사이트 추가 (과거↔현재 연결)"}
          data-testid={`insight-btn-${flow.slug}`}
        >
          <Star className={`h-4 w-4 ${flow.insight ? "cap-star-neon" : ""}`} fill={flow.insight ? "currentColor" : "none"} strokeWidth={2} />
        </button>
      ) : null}

      <div className="mb-2.5 border-b border-border/50 pb-2 pr-6">
        {/* 날짜 — 클릭 시 시작일 + (선택)종료일 입력으로 전환. 종료일을 넣으면 기간 이벤트가 된다. */}
        {editable && metaEdit === "date" ? (
          <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-1">
              <input
                type="date"
                autoFocus
                value={dateDraft}
                onChange={(e) => setDateDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") commitDate(); if (e.key === "Escape") { setDateDraft(flow.date); setEndDateDraft(flow.endDate ?? ""); setMetaEdit(null); } }}
                className="flex-1 rounded border border-border bg-background px-1 py-0.5 text-[10.5px] tabular-nums text-foreground"
                data-testid={`edit-date-${flow.slug}`}
              />
              <span className="text-[10.5px] text-muted-foreground">~</span>
              <input
                type="date"
                value={endDateDraft}
                min={dateDraft || undefined}
                onChange={(e) => setEndDateDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") commitDate(); if (e.key === "Escape") { setDateDraft(flow.date); setEndDateDraft(flow.endDate ?? ""); setMetaEdit(null); } }}
                className="flex-1 rounded border border-border bg-background px-1 py-0.5 text-[10.5px] tabular-nums text-foreground"
                data-testid={`edit-enddate-${flow.slug}`}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-muted-foreground/70">종료일 입력 시 기간으로 표시</span>
              <div className="flex gap-1">
                {endDateDraft ? (
                  <button
                    type="button"
                    className="rounded px-1 py-0.5 text-[9px] text-muted-foreground hover:bg-muted/60"
                    onClick={() => setEndDateDraft("")}
                    data-testid={`clear-enddate-${flow.slug}`}
                  >기간 해제</button>
                ) : null}
                <button
                  type="button"
                  className="rounded px-1 py-0.5 text-[9px] font-medium text-primary hover:bg-muted/60"
                  onClick={commitDate}
                  data-testid={`save-date-${flow.slug}`}
                >저장</button>
              </div>
            </div>
          </div>
        ) : (
          <div
            className={`text-[10.5px] tabular-nums text-muted-foreground ${editable ? "cursor-text rounded hover:bg-muted/40" : ""}`}
            onClick={(e) => { if (editable) { e.stopPropagation(); setDateDraft(flow.date); setEndDateDraft(flow.endDate ?? ""); setMetaEdit("date"); } }}
            title={editable ? "클릭해 날짜/기간 수정" : undefined}
            data-testid={`text-date-${flow.slug}`}
          >
            {flow.endDate ? `${flow.date} ~ ${flow.endDate}` : flow.date}
          </div>
        )}
        {/* 제목 — 클릭 시 입력으로 전환 */}
        {editable && metaEdit === "title" ? (
          <input
            type="text"
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={commitTitle}
            onKeyDown={(e) => { if (e.key === "Enter") commitTitle(); if (e.key === "Escape") { setTitleDraft(flow.title); setMetaEdit(null); } }}
            className="mt-0.5 w-full rounded border border-border bg-background px-1 py-0.5 text-sm font-semibold leading-tight text-foreground"
            data-testid={`edit-title-${flow.slug}`}
          />
        ) : (
          <div
            className={`text-sm font-semibold leading-tight ${editable ? "cursor-text rounded hover:bg-muted/40" : ""}`}
            onClick={(e) => { if (editable) { e.stopPropagation(); setTitleDraft(flow.title); setMetaEdit("title"); } }}
            title={editable ? "클릭해 제목 수정" : undefined}
            data-testid={`text-title-${flow.slug}`}
          >
            {flow.title}
          </div>
        )}
      </div>
      {/* 본문 스택(좌) + 메모 컬럼(우)을 완전히 분리. 메모는 absolute 앵커링이므로 본문 노드 간격에 영향을 주지 않는다. */}
      <div className="flex items-start">
        {/* 본문: 독립적 세로 스택. 노드 간격은 메모 높이와 무관하게 자신의 내용만으로 결정. */}
        <div ref={setBodyEl} style={{ width: bodyWidth }} className="flex shrink-0 flex-col">
          {bodyRows.map((row, ri) => (
            // 행 key는 행에 속한 노드 id 조합으로 안정화(인덱스 key는 행 삽입/제거 시
            // 잘못된 reconcile를 유발한다). 빈 행은 ri로 폴백.
            <div key={row.nodes.map((n) => n.id).join("-") || ri}>{row.content}</div>
          ))}
        </div>
        {showSideCol ? (
          <div className="shrink-0 self-stretch border-l border-border/40 pl-2.5">
            <SideColumn
              sideNodes={orderedSideNodes}
              slug={flow.slug}
              bodyEl={bodyEl}
              editable={editable}
              autoEditMemoId={autoEditMemoId}
              autoEditTableId={autoEditTableId}
              onMemo={commitMemo}
              onMemoEditDone={onMemoEditDone}
              onCommitTable={commitTable}
              onTableEditDone={onTableEditDone}
              onFocusNode={setFocusedNodeId}
              focusedId={focusedNodeId}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
