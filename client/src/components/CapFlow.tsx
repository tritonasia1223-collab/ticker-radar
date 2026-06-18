// 인과 플로우 렌더러 + 인라인 편집. 팝업/라벨 없음.
//  - 박스는 투명/무색, 텍스트만 표시.
//  - 칸 클릭 → 그 자리에서 리치텍스트 편집(드래그 색상 툴바). 포커스 해제 시 저장.
//  - 칸 호버: 하단 +버튼 = 아래 스택 추가, 우측 +버튼 = 가로 분기 추가 (즉시 생성/저장).
//  - 칸 우측 상단 X = 그 칸 삭제(내용 비워도 자동 삭제). 마지막 칸이면 플로우 삭제.
import { useState, useRef, useLayoutEffect } from "react";
import { X, MessageSquare } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CapRichText } from "@/components/CapRichText";
import { CapRichEditor } from "@/components/CapRichEditor";
import { newNodeKey } from "@/lib/capitalism-flowops";
import type { FlowDTO, FlowNodeDTO } from "@/lib/capitalism-types";

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
  flow, node, editable, editing, onStartEdit, onCommit, onDelete, onAdd, onMemo, onLink,
}: {
  flow: FlowDTO;
  node: FlowNodeDTO;
  editable: boolean;
  editing: boolean;
  onStartEdit: (id: string) => void;
  onCommit: (id: string, text: string) => void;
  onDelete: (id: string) => void;
  onAdd: (afterId: string, dir: "down" | "branch-left" | "branch-right") => void;
  onMemo?: (id: string, memo: string) => void;
  onLink?: LinkNodes;
}) {
  const [hover, setHover] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [draft, setDraft] = useState(node.text);
  // 메모 팝오버 상태 + 편집 초안
  const [memoOpen, setMemoOpen] = useState(false);
  const [memoDraft, setMemoDraft] = useState(node.ref ?? "");
  const hasMemo = !!(node.ref && node.ref.trim());
  // 메모 textarea 자동 높이 조절 — 내용 분량만큼 늘어나고(최소 4줄), 너무 길면 그때만 스크롤.
  const memoRef = useRef<HTMLTextAreaElement | null>(null);
  const autoGrow = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";              // 먼저 줄여야 줄어드는 경우도 반영됨
    const max = 360;                      // 최대 높이(px) 넘으면 스크롤
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  };
  // 팝오버가 열리거나 초안이 바뀔 때 높이 동기화(렌더 직후 측정).
  useLayoutEffect(() => {
    if (memoOpen) autoGrow(memoRef.current);
  }, [memoOpen, memoDraft]);
  // 드래그앤드롭 화살표 그리기 기능 — 현재 비활성(주석처리). 필요 시 아래 줄 복구.
  // const canDrag = editable && !editing && !!onLink;
  const canDrag = false;

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

      {/* 메모(보충 설명) 버튼 — 상시 표시(편집모드 제외). 메모가 있으면 채운 색, 없으면 흐림.
          구글 시트/슬라이드 코멘트처럼 클릭 시 말풍선(Popover)으로 읽기·편집. */}
      {!editing ? (
        <Popover
          open={memoOpen}
          onOpenChange={(o) => {
            setMemoOpen(o);
            if (o) setMemoDraft(node.ref ?? "");           // 열 때 최신값 동기화
            else if (editable && onMemo) onMemo(node.id, memoDraft); // 닫을 때 저장
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              title={hasMemo ? "메모 보기/편집" : "메모 추가"}
              onClick={(e) => e.stopPropagation()}
              className={`absolute right-0.5 bottom-0.5 z-10 flex h-4 w-4 items-center justify-center rounded-full transition-colors ${
                hasMemo
                  ? "bg-amber-400/90 text-amber-950 shadow-sm hover:bg-amber-400"
                  : "bg-muted/50 text-muted-foreground/50 opacity-50 hover:opacity-100 hover:bg-muted"
              }`}
              data-testid={`memo-btn-${node.id}`}
            >
              <MessageSquare className="h-2.5 w-2.5" strokeWidth={2.5} />
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="right"
            align="start"
            className="w-64 p-3"
            onClick={(e) => e.stopPropagation()}
            data-testid={`memo-pop-${node.id}`}
          >
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <MessageSquare className="h-3 w-3" /> 보충 메모
            </div>
            {editable ? (
              <>
                <textarea
                  ref={memoRef}
                  value={memoDraft}
                  onChange={(e) => { setMemoDraft(e.target.value); autoGrow(e.target); }}
                  placeholder="이 칸에 대한 보충 설명·출처를 적으세요"
                  rows={4}
                  autoFocus
                  className="block max-h-[360px] min-h-[88px] w-full resize-y overflow-hidden rounded border border-border bg-background px-2 py-1.5 text-[12px] leading-snug text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                  data-testid={`memo-input-${node.id}`}
                />
                <div className="mt-2 flex items-center justify-between">
                  <button
                    type="button"
                    className="text-[11px] text-muted-foreground hover:text-destructive disabled:opacity-40"
                    disabled={!hasMemo && !memoDraft.trim()}
                    onClick={() => { setMemoDraft(""); onMemo?.(node.id, ""); setMemoOpen(false); }}
                    data-testid={`memo-clear-${node.id}`}
                  >
                    메모 삭제
                  </button>
                  <button
                    type="button"
                    className="rounded bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90"
                    onClick={() => { onMemo?.(node.id, memoDraft); setMemoOpen(false); }}
                    data-testid={`memo-save-${node.id}`}
                  >
                    저장
                  </button>
                </div>
              </>
            ) : hasMemo ? (
              <p className="max-h-[360px] overflow-y-auto whitespace-pre-wrap text-[12px] leading-relaxed text-foreground" data-testid={`memo-text-${node.id}`}>
                {node.ref}
              </p>
            ) : (
              <p className="text-[12px] text-muted-foreground/60">메모가 없습니다.</p>
            )}
          </PopoverContent>
        </Popover>
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

  const nodeProps = {
    flow, editable,
    onStartEdit: setEditingId,
    onCommit: commit,
    onDelete: deleteNode,
    onAdd: addNode,
    onMemo: commitMemo,
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

  // 어떤 컬럼이 실제로 쓰이는지 판단(빈 컬럼은 렌더하지 않음).
  const usedCols = (() => {
    const set = new Set<string>();
    flow.nodes.forEach((n) => set.add(n.col || "center"));
    return ["left", "center", "right"].filter((c) => set.has(c));
  })();

  let body: JSX.Element;
  if (flow.layout === "branch") {
    // 행(row) 기반 그리드: 배열 순서대로 순회하며 center 노드는 새 행을 시작하고,
    // left/right(분기) 노드는 가장 최근 행의 해당 컬럼 셀에 배치한다.
    // → 분기 칸이 출발(center) 노드와 같은 행에 가로로 정렬된다(버그1).
    type Row = Record<string, FlowNodeDTO | undefined>;
    const rows: Row[] = [];
    let cur: Row | null = null;
    for (const n of flow.nodes) {
      const col = n.col || "center";
      // 새 행을 시작해야 하는 경우:
      //  (1) 아직 행이 없음
      //  (2) center 노드 — center 는 항상 새 줄기 행을 시작
      //  (3) 현재 행의 해당 컬럼 셀이 이미 차 있음 — 덮어쓰기 방지(같은 컬럼 노드가
      //      연속될 때 한 셀에 겹쳐 한 개만 보이던 버그 수정. 예: 모든 노드가 left 인 카드)
      if (cur === null || col === "center" || cur[col] !== undefined) {
        cur = {};
        rows.push(cur);
      }
      cur[col] = n;
    }
    body = (
      <div className="flex flex-col">
        {rows.map((row, ri) => (
          <div key={ri}>
            {ri > 0 ? <VArrow /> : null}
            <div className="flex items-start justify-center gap-3">
              {usedCols.map((col) => (
                <div key={col} className="w-[240px] shrink-0">
                  {row[col] ? (
                    <Node {...nodeProps} node={row[col]!} editing={editingId === row[col]!.id} />
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  } else {
    body = <div className="flex flex-col">{renderStack(flow.nodes)}</div>;
  }

  // 카드 너비: 단일 컬럼(기본/스택)은 280px 고정. 분기로 컬럼이 늘면
  // 컬럼 수 × (240px + gap 12px) + 좌우 패딩(24px) 만큼 카드 자체가 넓어진다(버그3).
  // 컬럼 너비(240px)는 shrink-0 이므로 줄지 않고, 카드가 확장된다.
  const cardWidth =
    flow.layout === "branch" && usedCols.length > 1
      ? usedCols.length * 240 + (usedCols.length - 1) * 12 + 24
      : 280;

  return (
    <div
      style={{ width: cardWidth }}
      className={`h-full shrink-0 rounded-lg border bg-transparent p-3 transition-colors ${
        active ? "border-primary/70 ring-1 ring-primary/30" : "border-border/60 hover:border-primary/40"
      }`}
      onClick={() => onSelect(flow)}
      data-testid={`flow-${flow.slug}`}
    >
      <div className="mb-2.5 border-b border-border/50 pb-2">
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
      {body}
    </div>
  );
}
