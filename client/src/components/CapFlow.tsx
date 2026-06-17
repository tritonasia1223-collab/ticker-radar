// 인과 플로우(마인드맵형) 렌더러 — 세로 스택 / 분기·합류.
import { KIND_STYLE, CAT_COLORS } from "@/lib/capitalism-config";
import type { FlowDTO, FlowNodeDTO } from "@/lib/capitalism-types";

function Node({ node }: { node: FlowNodeDTO }) {
  const ks = KIND_STYLE[node.kind] ?? KIND_STYLE.effect;
  const label = node.inLabel !== undefined && node.inLabel !== null && node.inLabel !== "" ? node.inLabel : ks.tag;
  return (
    <div
      className="rounded-md border border-border bg-card/60 px-3 py-2 text-left"
      style={{ borderLeft: `3px solid ${ks.c}` }}
      data-testid={`fnode-${node.id}`}
    >
      {label ? (
        <span className="block text-[10px] font-semibold tracking-wide mb-1" style={{ color: ks.c }}>
          {label}
        </span>
      ) : null}
      <div className="text-[12.5px] leading-snug text-foreground">{node.text}</div>
      {node.ref ? (
        <div className="mt-1 text-[10.5px] text-muted-foreground italic" title={node.ref}>
          참고: {node.ref}
        </div>
      ) : null}
    </div>
  );
}

function VArrow() {
  return (
    <div className="flex justify-center py-1">
      <svg width="16" height="20" viewBox="0 0 16 20">
        <line x1="8" y1="0" x2="8" y2="13" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground/50" />
        <path d="M4 12 L8 18 L12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/60" />
      </svg>
    </div>
  );
}

function StackFlow({ flow }: { flow: FlowDTO }) {
  return (
    <div className="flex flex-col">
      {flow.nodes.map((n, i) => (
        <div key={n.id}>
          {i > 0 ? <VArrow /> : null}
          <Node node={n} />
        </div>
      ))}
    </div>
  );
}

function BranchFlow({ flow }: { flow: FlowDTO }) {
  const byCol: Record<string, FlowNodeDTO[]> = { center: [], left: [], right: [] };
  flow.nodes.forEach((n) => byCol[n.col || "center"].push(n));
  const source = byCol.center[0];
  const merge = byCol.center[byCol.center.length - 1];

  const stroke = "rgba(140,140,160,0.45)";
  const head = "rgba(160,160,180,0.6)";

  return (
    <div className="flex flex-col">
      {source ? <Node node={source} /> : null}
      {/* split arrows */}
      <div className="flex justify-center">
        <svg width="220" height="24" viewBox="0 0 220 24" preserveAspectRatio="none">
          <path d="M110 0 C110 12, 56 6, 56 22" fill="none" stroke={stroke} strokeWidth="1.5" />
          <path d="M52 16 L56 23 L60 16" fill="none" stroke={head} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M110 0 C110 12, 164 6, 164 22" fill="none" stroke={stroke} strokeWidth="1.5" />
          <path d="M160 16 L164 23 L168 16" fill="none" stroke={head} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      {/* two columns */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col">
          {byCol.left.map((n, i) => (
            <div key={n.id}>
              {i > 0 ? <VArrow /> : null}
              <Node node={n} />
            </div>
          ))}
        </div>
        <div className="flex flex-col">
          {byCol.right.map((n, i) => (
            <div key={n.id}>
              {i > 0 ? <VArrow /> : null}
              <Node node={n} />
            </div>
          ))}
        </div>
      </div>
      {/* merge arrows */}
      <div className="flex justify-center">
        <svg width="220" height="24" viewBox="0 0 220 24" preserveAspectRatio="none">
          <path d="M56 0 C56 14, 110 8, 110 23" fill="none" stroke={stroke} strokeWidth="1.5" />
          <path d="M164 0 C164 14, 110 8, 110 23" fill="none" stroke={stroke} strokeWidth="1.5" />
          <path d="M106 17 L110 24 L114 17" fill="none" stroke={head} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      {merge && merge !== source ? <Node node={merge} /> : null}
    </div>
  );
}

export function FlowColumn({
  flow, active, onSelect, onEdit,
}: {
  flow: FlowDTO;
  active: boolean;
  onSelect: (f: FlowDTO) => void;
  onEdit?: (f: FlowDTO) => void;
}) {
  return (
    <div
      className={`w-[300px] shrink-0 rounded-lg border bg-card/40 p-3 cursor-pointer transition-colors ${
        active ? "border-primary ring-1 ring-primary/40" : "border-border hover:border-primary/40"
      }`}
      onClick={() => onSelect(flow)}
      data-testid={`flow-${flow.slug}`}
    >
      <div className="flex items-start gap-2 mb-3 pb-2 border-b border-border">
        <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CAT_COLORS[flow.category] || "#888" }} />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-muted-foreground tabular-nums">{flow.date}</div>
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
      {flow.layout === "branch" ? <BranchFlow flow={flow} /> : <StackFlow flow={flow} />}
    </div>
  );
}
