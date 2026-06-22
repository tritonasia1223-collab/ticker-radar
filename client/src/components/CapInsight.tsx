// 사건 인사이트 패널 — 오른쪽(그래프 자리)에 떠서 과거↔현재 연결 인사이트를 편집/표시.
// Phase B: 리치텍스트 본문 + 헤더(사건 제목/날짜) + 닫기. (참고 그래프 블록은 Phase C)
import { useState, useRef, useEffect } from "react";
import { X, Star } from "lucide-react";
import { CapRichEditor } from "@/components/CapRichEditor";
import type { FlowDTO, CapInsight } from "@/lib/capitalism-types";

export function InsightPanel({
  flow, onCommit, onClose,
}: {
  flow: FlowDTO;
  onCommit: (slug: string, insight: CapInsight) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(flow.insight?.text ?? "");
  const textRef = useRef(text);
  textRef.current = text;

  // 다른 카드의 별을 누르면(같은 패널 재사용) 그 사건의 인사이트로 재시드.
  useEffect(() => {
    setText(flow.insight?.text ?? "");
    textRef.current = flow.insight?.text ?? "";
  }, [flow.slug]);

  const commit = () => {
    const next = textRef.current;
    const cur = flow.insight ?? { text: "", charts: [] };
    if ((cur.text ?? "") === next) return; // 변경 없음
    onCommit(flow.slug, { text: next, charts: cur.charts ?? [] });
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card/40 p-3">
      <div className="flex items-start justify-between gap-2 border-b border-border/50 pb-2">
        <div className="min-w-0">
          <div className="text-[11px] tabular-nums text-muted-foreground">
            {flow.endDate ? `${flow.date} ~ ${flow.endDate}` : flow.date}
          </div>
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <Star className="h-3.5 w-3.5 shrink-0 text-red-500" fill="currentColor" />
            <span className="truncate">{flow.title}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex shrink-0 items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          title="그래프로 돌아가기"
          data-testid="insight-close"
        >
          <X className="h-3.5 w-3.5" /> 그래프
        </button>
      </div>

      <div className="text-[11px] text-muted-foreground/70">
        이 사건과 <b className="text-foreground/80">지금</b>을 어떻게 연결할 수 있을까? — 과거↔현재 인사이트
      </div>

      <CapRichEditor
        value={text}
        onChange={setText}
        onBlur={commit}
        rows={14}
        placeholder="인사이트를 적어보세요. (드래그로 색·하이라이트 · '- '로 불릿)"
      />

      {/* Phase C: 참고 그래프 블록(지표 선택 + 범위)이 여기에 들어옵니다. */}
    </div>
  );
}
