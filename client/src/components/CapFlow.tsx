// 인과 플로우 렌더러 — 박스 투명/무색, 텍스트는 리치텍스트(하이라이트) 표시.
// 박스 호버 시: 하단 +버튼 = 스택(아래로) 추가, 우측 +버튼 = 분기(가로) 추가.
import { useState } from "react";
import { CapRichText } from "@/components/CapRichText";
import type { FlowDTO, FlowNodeDTO } from "@/lib/capitalism-types";

export interface NodeAddReq {
  flow: FlowDTO;
  afterKey: string;          // 기준 노드 key
  dir: "down" | "branch";    // 아래 스택 / 가로 분기
}

function Node({
  node, onAdd, showHandles,
}: {
  node: FlowNodeDTO;
  onAdd?: (afterKey: string, dir: "down" | "branch") => void;
  showHandles: boolean;
}) {
  const [hover, setHover] = useState(false);
  const label =
    node.inLabel !== undefined && node.inLabel !== null && node.inLabel !== "" ? node.inLabel : null;
  return (
    <div
      className="group relative px-2 py-1.5"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-testid={`fnode-${node.id}`}
    >
      {label ? (
        <span className="block text-[10px] font-medium tracking-wide text-muted-foreground/70 mb-0.5">
          {label}
        </span>
      ) : null}
      <CapRichText text={node.text} className="block text-[12.5px] leading-snug text-foreground" />

      {/* 호버 핸들: 하단(+스택), 우측(+분기) */}
      {showHandles && hover && onAdd ? (
        <>
          <button
            type="button"
            title="아래로 블록 추가"
            className="absolute left-1/2 -bottom-2 -translate-x-1/2 z-20 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground text-[11px] leading-none shadow hover:scale-110 transition-transform"
            onClick={(e) => { e.stopPropagation(); onAdd(node.id, "down"); }}
            data-testid={`add-down-${node.id}`}
          >
            +
          </button>
          <button
            type="button"
            title="옆으로 분기 추가"
            className="absolute -right-2 top-1/2 -translate-y-1/2 z-20 flex h-4 w-4 items-center justify-center rounded-full bg-accent-foreground/80 text-background text-[11px] leading-none shadow hover:scale-110 transition-transform"
            onClick={(e) => { e.stopPropagation(); onAdd(node.id, "branch"); }}
            data-testid={`add-branch-${node.id}`}
          >
            +
          </button>
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

function StackFlow({ flow, onAdd, editable }: { flow: FlowDTO; onAdd?: (k: string, d: "down" | "branch") => void; editable: boolean }) {
  return (
    <div className="flex flex-col">
      {flow.nodes.map((n, i) => (
        <div key={n.id}>
          {i > 0 ? <VArrow /> : null}
          <Node node={n} onAdd={onAdd} showHandles={editable} />
        </div>
      ))}
    </div>
  );
}

function BranchFlow({ flow, onAdd, editable }: { flow: FlowDTO; onAdd?: (k: string, d: "down" | "branch") => void; editable: boolean }) {
  const byCol: Record<string, FlowNodeDTO[]> = { center: [], left: [], right: [] };
  flow.nodes.forEach((n) => byCol[n.col || "center"].push(n));
  const source = byCol.center[0];
  const merge = byCol.center[byCol.center.length - 1];

  const stroke = "rgba(140,140,160,0.4)";
  const head = "rgba(160,160,180,0.55)";

  return (
    <div className="flex flex-col">
      {source ? <Node node={source} onAdd={onAdd} showHandles={editable} /> : null}
      <div className="flex justify-center">
        <svg width="220" height="22" viewBox="0 0 220 22" preserveAspectRatio="none">
          <path d="M110 0 C110 11, 56 5, 56 20" fill="none" stroke={stroke} strokeWidth="1.4" />
          <path d="M52 14 L56 21 L60 14" fill="none" stroke={head} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M110 0 C110 11, 164 5, 164 20" fill="none" stroke={stroke} strokeWidth="1.4" />
          <path d="M160 14 L164 21 L168 14" fill="none" stroke={head} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col">
          {byCol.left.map((n, i) => (
            <div key={n.id}>{i > 0 ? <VArrow /> : null}<Node node={n} onAdd={onAdd} showHandles={editable} /></div>
          ))}
        </div>
        <div className="flex flex-col">
          {byCol.right.map((n, i) => (
            <div key={n.id}>{i > 0 ? <VArrow /> : null}<Node node={n} onAdd={onAdd} showHandles={editable} /></div>
          ))}
        </div>
      </div>
      <div className="flex justify-center">
        <svg width="220" height="22" viewBox="0 0 220 22" preserveAspectRatio="none">
          <path d="M56 0 C56 13, 110 7, 110 21" fill="none" stroke={stroke} strokeWidth="1.4" />
          <path d="M164 0 C164 13, 110 7, 110 21" fill="none" stroke={stroke} strokeWidth="1.4" />
          <path d="M106 15 L110 22 L114 15" fill="none" stroke={head} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      {merge && merge !== source ? <Node node={merge} onAdd={onAdd} showHandles={editable} /> : null}
    </div>
  );
}

export function FlowColumn({
  flow, active, onSelect, onEdit, onAddNode, editable = false,
}: {
  flow: FlowDTO;
  active: boolean;
  onSelect: (f: FlowDTO) => void;
  onEdit?: (f: FlowDTO) => void;
  onAddNode?: (req: NodeAddReq) => void;
  editable?: boolean;
}) {
  const handleAdd = onAddNode
    ? (afterKey: string, dir: "down" | "branch") => onAddNode({ flow, afterKey, dir })
    : undefined;

  return (
    <div
      className={`w-[280px] shrink-0 rounded-lg border bg-transparent p-3 cursor-pointer transition-colors ${
        active ? "border-primary/70 ring-1 ring-primary/30" : "border-border/60 hover:border-primary/40"
      }`}
      onClick={() => onSelect(flow)}
      data-testid={`flow-${flow.slug}`}
    >
      <div className="flex items-start gap-2 mb-2.5 pb-2 border-b border-border/50">
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] text-muted-foreground tabular-nums">{flow.date}</div>
          <div className="text-sm font-semibold leading-tight">{flow.title}</div>
        </div>
        {onEdit ? (
          <button
            className="text-[11px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-muted"
            onClick={(e) => { e.stopPropagation(); onEdit(flow); }}
            data-testid={`edit-${flow.slug}`}
          >
            편집
          </button>
        ) : null}
      </div>
      {flow.layout === "branch"
        ? <BranchFlow flow={flow} onAdd={handleAdd} editable={editable} />
        : <StackFlow flow={flow} onAdd={handleAdd} editable={editable} />}
    </div>
  );
}
