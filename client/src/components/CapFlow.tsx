// 인과 플로우 렌더러 + 인라인 편집. 팝업/라벨 없음.
//  - 박스는 투명/무색, 텍스트만 표시.
//  - 칸 클릭 → 그 자리에서 리치텍스트 편집(드래그 색상 툴바). 포커스 해제 시 저장.
//  - 칸 호버: 하단 +버튼 = 아래 스택 추가, 우측 +버튼 = 가로 분기 추가 (즉시 생성/저장).
//  - 칸 우측 상단 X = 그 칸 삭제(내용 비워도 자동 삭제). 마지막 칸이면 플로우 삭제.
import { useState } from "react";
import { X } from "lucide-react";
import { CapRichText } from "@/components/CapRichText";
import { CapRichEditor } from "@/components/CapRichEditor";
import { newNodeKey } from "@/lib/capitalism-flowops";
import type { FlowDTO, FlowNodeDTO } from "@/lib/capitalism-types";

// 노드 배열을 통째로 바꿔 저장하는 콜백(페이지가 서버 반영 담당).
export type MutateNodes = (flow: FlowDTO, nextNodes: FlowNodeDTO[]) => void;
// 카드 메타(날짜/제목/레이아웃) 변경 저장 콜백.
export type MutateMeta = (flow: FlowDTO, patch: { date?: string; title?: string; layout?: string }) => void;
// 드래그앤드롭 화살표 연결 콜백 — from 노드 → to 노드(카드 내/간 모두).
export type LinkNodes = (from: { slug: string; key: string }, to: { slug: string; key: string }) => void;

// 드래그 중인 소스 노드(전역) — dataTransfer 가 제한적인 환경 대비해 모듈 변수로도 보관.
let DRAG_SRC: { slug: string; key: string } | null = null;

function blankNode(col = "center"): FlowNodeDTO {
  return { id: newNodeKey(), kind: "effect", inLabel: null, text: "", ref: null, col };
}

function Node({
  flow, node, editable, editing, onStartEdit, onCommit, onDelete, onAdd, onLink,
}: {
  flow: FlowDTO;
  node: FlowNodeDTO;
  editable: boolean;
  editing: boolean;
  onStartEdit: (id: string) => void;
  onCommit: (id: string, text: string) => void;
  onDelete: (id: string) => void;
  onAdd: (afterId: string, dir: "down" | "branch-left" | "branch-right") => void;
  onLink?: LinkNodes;
}) {
  const [hover, setHover] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [draft, setDraft] = useState(node.text);
  // 드래그는 편집 모드(editable)이고 텍스트 편집 중이 아닐 때만 허용.
  const canDrag = editable && !editing && !!onLink;

  return (
    <div
      className={`group relative px-2 py-1.5 transition-shadow ${
        dragOver ? "rounded ring-2 ring-rose-400 ring-offset-1" : ""
      }`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-testid={`fnode-${node.id}`}
      // 보드 오버레이가 좌표를 측정할 수 있도록 전역 식별자 부여(slug::nodeKey).
      data-node-id={`${flow.slug}::${node.id}`}
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
    >
      {editing ? (
        <CapRichEditor
          value={draft}
          onChange={setDraft}
          autoFocus
          placeholder="내용 입력 (드래그하여 강조 · 비우면 삭제)"
          rows={2}
          onBlur={() => onCommit(node.id, draft)}
        />
      ) : (
        <div
          className={editable ? "cursor-text rounded hover:bg-muted/40" : ""}
          onClick={(e) => { if (editable) { e.stopPropagation(); setDraft(node.text); onStartEdit(node.id); } }}
          data-testid={`fnode-text-${node.id}`}
        >
          {node.text.trim() ? (
            <CapRichText text={node.text} className="block text-center text-[12.5px] leading-snug text-foreground" />
          ) : (
            <span className="block text-center text-[12.5px] italic leading-snug text-muted-foreground/50">
              (빈 칸 — 클릭해 입력)
            </span>
          )}
        </div>
      )}

      {/* 편집 모드일 때만 노출되는 컨트롤들 */}
      {editable && !editing ? (
        <>
          {/* 좌측 상단 드래그 그립 — 이 점을 잡아 다른 칸으로 끌면 화살표가 연결됨 */}
          {hover && onLink ? (
            <span
              title="끌어서 다른 칸과 화살표 연결"
              className="absolute -left-1.5 -top-1.5 z-10 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-rose-500/90 text-white shadow cursor-grab active:cursor-grabbing"
              data-testid={`drag-grip-${node.id}`}
            >
              <svg width="7" height="7" viewBox="0 0 6 6"><circle cx="1.5" cy="1.5" r="0.9" fill="currentColor"/><circle cx="4.5" cy="1.5" r="0.9" fill="currentColor"/><circle cx="1.5" cy="4.5" r="0.9" fill="currentColor"/><circle cx="4.5" cy="4.5" r="0.9" fill="currentColor"/></svg>
            </span>
          ) : null}

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

          {/* 좌측 +버튼 = 왼쪽 방향 분기 */}
          {hover ? (
            <button
              type="button"
              title="왼쪽으로 분기 추가"
              className="absolute -left-2 top-1/2 z-20 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full bg-foreground/70 text-background text-[11px] leading-none shadow hover:scale-110 transition-transform"
              onClick={(e) => { e.stopPropagation(); onAdd(node.id, "branch-left"); }}
              data-testid={`add-branch-left-${node.id}`}
            >
              +
            </button>
          ) : null}

          {/* 우측 +버튼 = 오른쪽 방향 분기 */}
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

export function FlowColumn({
  flow, active, onSelect, onMutateNodes, onAddLocal, onMutateMeta, onLink, editingId, setEditingId, editable = false,
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
}) {
  // 카드 헤더 인라인 편집 상태: "date" | "title" | null
  const [metaEdit, setMetaEdit] = useState<"date" | "title" | null>(null);
  const [dateDraft, setDateDraft] = useState(flow.date);
  const [titleDraft, setTitleDraft] = useState(flow.title);
  // 노드 텍스트 커밋: 빈 칸이면 제거, 아니면 갱신. 그리고 서버 반영.
  function commit(id: string, text: string) {
    setEditingId(null);
    if (!onMutateNodes) return;
    const trimmed = text.trim();
    // 내용이 실제로 바뀌지 않았으면(=기존 텍스트 그대로 빠져나감) 서버 저장·Undo 푸시 없이 종료.
    const cur = flow.nodes.find((n) => n.id === id);
    if (cur && cur.text === text) return;
    let next: FlowNodeDTO[];
    if (!trimmed) {
      next = flow.nodes.filter((n) => n.id !== id); // 내용 미입력 → 삭제
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
      const nn = blankNode(base?.col || "center");
      nodes.splice(idx >= 0 ? idx + 1 : nodes.length, 0, nn);
      add(flow, nodes);
      setEditingId(nn.id);
      return;
    }

    // ── 좌/우 분기 추가: 선택한 방향 컬럼에 새 칸 ──
    const targetCol = dir === "branch-left" ? "left" : "right";
    const nn = blankNode(targetCol);

    if (flow.layout === "branch") {
      // 이미 branch 레이아웃: 해당 방향 컬럼 끝에 추가.
      nodes.push(nn);
      add(flow, nodes);
      setEditingId(nn.id);
      return;
    }

    // ── stack → branch 자동 전환 ──
    // 기존 stack 노드들은 center(출발 줄기)로 두고, 새 칸을 선택 방향에 추가.
    // layout 전환과 노드 추가를 한 번에 처리(이중 POST 레이스 방지). 서버 저장은 새 칸의 텍스트를
    // 입력해 commit할 때 이뤄지며, 그때 캐시의 branch 레이아웃으로 저장된다.
    const converted: FlowNodeDTO[] = nodes.map((n) => ({ ...n, col: "center" }));
    converted.push(nn);
    add({ ...flow, layout: "branch" }, converted);
    setEditingId(nn.id);
  }

  // 메타(날짜/제목) 커밋.
  function commitDate() {
    setMetaEdit(null);
    const v = dateDraft.trim();
    if (!onMutateMeta || !v || v === flow.date) return;
    onMutateMeta(flow, { date: v });
  }
  function commitTitle() {
    setMetaEdit(null);
    const v = titleDraft.trim();
    if (!onMutateMeta || !v || v === flow.title) return;
    onMutateMeta(flow, { title: v });
  }

  const nodeProps = {
    flow, editable,
    onStartEdit: setEditingId,
    onCommit: commit,
    onDelete: deleteNode,
    onAdd: addNode,
    onLink,
  };

  function renderStack(list: FlowNodeDTO[]) {
    return list.map((n, i) => (
      <div key={n.id}>
        {i > 0 ? <VArrow /> : null}
        <Node {...nodeProps} node={n} editing={editingId === n.id} />
      </div>
    ));
  }

  let body: JSX.Element;
  if (flow.layout === "branch") {
    // 분기 곡선·합류 박스 없이, 좌/중앙/우 칼럼을 그냥 나란히 배치한다.
    // 각 칼럼은 독립적인 세로 스택(위→아래 화살표만). 곡선/merge 화살표 없음.
    const byCol: Record<string, FlowNodeDTO[]> = { center: [], left: [], right: [] };
    flow.nodes.forEach((n) => byCol[n.col || "center"].push(n));
    const cols = [byCol.left, byCol.center, byCol.right].filter((c) => c.length > 0);
    body = (
      <div className="flex items-start justify-center gap-3">
        {cols.map((col, ci) => (
          <div key={ci} className="flex min-w-0 flex-1 flex-col">
            {renderStack(col)}
          </div>
        ))}
      </div>
    );
  } else {
    body = <div className="flex flex-col">{renderStack(flow.nodes)}</div>;
  }

  return (
    <div
      className={`h-full w-[280px] shrink-0 rounded-lg border bg-transparent p-3 transition-colors ${
        active ? "border-primary/70 ring-1 ring-primary/30" : "border-border/60 hover:border-primary/40"
      }`}
      onClick={() => onSelect(flow)}
      data-testid={`flow-${flow.slug}`}
    >
      <div className="mb-2.5 border-b border-border/50 pb-2">
        {/* 날짜 — 클릭 시 date 입력으로 전환(날짜 변경 시 다른 연도 그룹으로 자동 이동) */}
        {editable && metaEdit === "date" ? (
          <input
            type="date"
            autoFocus
            value={dateDraft}
            onChange={(e) => setDateDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={commitDate}
            onKeyDown={(e) => { if (e.key === "Enter") commitDate(); if (e.key === "Escape") { setDateDraft(flow.date); setMetaEdit(null); } }}
            className="w-full rounded border border-border bg-background px-1 py-0.5 text-[10.5px] tabular-nums text-foreground"
            data-testid={`edit-date-${flow.slug}`}
          />
        ) : (
          <div
            className={`text-[10.5px] tabular-nums text-muted-foreground ${editable ? "cursor-text rounded hover:bg-muted/40" : ""}`}
            onClick={(e) => { if (editable) { e.stopPropagation(); setDateDraft(flow.date); setMetaEdit("date"); } }}
            title={editable ? "클릭해 날짜 수정" : undefined}
            data-testid={`text-date-${flow.slug}`}
          >
            {flow.date}
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
      {body}
    </div>
  );
}
