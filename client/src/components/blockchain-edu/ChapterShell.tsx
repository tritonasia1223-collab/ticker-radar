// 블록체인 학습 탭 — 챕터 셸(§5). 좌: 설명 패널(스텝 텍스트) / 우: 애니메이션 스테이지 /
//   하단: 상시 패널(돈의 행방·슬라이더는 Phase 2). 모바일은 상하 스택. 진행은 "다음" 버튼(스크롤 하이재킹 금지).
import type { ChapterMeta } from "@/content/blockchain-edu/chapters";

export default function ChapterShell({ chapter, step, onPrev, onNext, stage, bottom }: {
  chapter: ChapterMeta;
  step: number;
  onPrev: () => void;
  onNext: () => void;
  stage?: React.ReactNode;
  bottom?: React.ReactNode;
}) {
  const steps = chapter.steps;
  const cur = Math.min(step, steps.length - 1);
  const atFirst = cur <= 0, atLast = cur >= steps.length - 1;

  return (
    <section className="rounded-xl border border-border bg-card overflow-hidden">
      {/* 헤더 */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-[12px] font-bold">{chapter.num}</span>
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-bold leading-tight">{chapter.title}</h2>
          <p className="truncate text-[11.5px] text-muted-foreground">{chapter.blurb}</p>
        </div>
      </div>

      {/* 본문: 좌 설명 / 우 스테이지 */}
      <div className="grid gap-0 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="flex flex-col gap-4 p-4 md:border-r border-border">
          <p className="text-[13.5px] leading-relaxed text-foreground/90">{steps[cur]?.text}</p>
          <div className="mt-auto flex items-center gap-2">
            <button onClick={onPrev} disabled={atFirst}
              className="rounded-md border border-border px-3 py-1.5 text-[12px] font-medium disabled:opacity-40 hover:bg-accent transition-colors">이전</button>
            <button onClick={onNext} disabled={atLast}
              className="rounded-md bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-foreground disabled:opacity-40 hover:opacity-90 transition-opacity">다음</button>
            <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{cur + 1} / {steps.length}</span>
          </div>
        </div>

        {/* 우측 스테이지 */}
        <div className="min-h-[220px] bg-secondary/40 p-4 flex items-center justify-center">
          {stage ?? (
            <div className="text-center text-[12px] text-muted-foreground">
              <div className="mb-1 text-2xl opacity-40" aria-hidden>◐</div>
              애니메이션 씬 <span className="font-mono">{steps[cur]?.sceneId ?? "—"}</span>
              <div className="text-[10.5px]">Phase 3~5에서 구현</div>
            </div>
          )}
        </div>
      </div>

      {/* 하단 상시 패널 */}
      <div className="border-t border-border bg-background/60 px-4 py-3">
        {bottom ?? <div className="text-[11px] text-muted-foreground">돈의 행방 패널 · 금액 슬라이더 — Phase 2에서 이 자리에 상시 표시됩니다.</div>}
      </div>
    </section>
  );
}
