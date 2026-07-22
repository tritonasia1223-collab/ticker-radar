// 블록체인 학습 탭(/learn/blockchain) — Phase 1 프레임.
//   스코프 라이트 테마(.edu-light) + JourneyProvider + 챕터 네비 + ChapterShell.
//   상시 UI(MoneyFlowPanel·AmountSlider)와 씬 애니메이션은 Phase 2~5.
import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { JourneyProvider, useJourney } from "@/lib/blockchain-edu/journeyState";
import { CHAPTER_LIST } from "@/content/blockchain-edu/chapters";
import type { ChapterId } from "@/lib/blockchain-edu/types";
import ChapterShell from "@/components/blockchain-edu/ChapterShell";

function EduInner() {
  const { state, setStep, reset } = useJourney();
  const [activeId, setActiveId] = useState<ChapterId>("ch1");
  const active = CHAPTER_LIST.find((c) => c.id === activeId) ?? CHAPTER_LIST[0];
  const step = state.chapterProgress[activeId] ?? 0;

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6 space-y-4">
      {/* 헤더 */}
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">블록체인 구조 <span className="text-sm font-normal text-muted-foreground">L1/L2 인터랙티브 학습</span></h1>
          <p className="text-[12px] text-muted-foreground">돈이 층을 오가며 수수료가 어떻게 쪼개지는지 8챕터로 따라갑니다.</p>
        </div>
        <button onClick={() => { if (confirm("학습 진행과 원장을 초기화할까요?")) reset(); }}
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[12px] font-medium hover:bg-accent transition-colors">
          <RotateCcw className="h-3.5 w-3.5" /> 처음부터 다시
        </button>
      </header>

      {/* 챕터 네비 (가로 스크롤) */}
      <nav className="flex gap-2 overflow-x-auto pb-1">
        {CHAPTER_LIST.map((c) => {
          const on = c.id === activeId;
          return (
            <button key={c.id} onClick={() => setActiveId(c.id)}
              className={`flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                on ? "border-primary bg-primary/10" : "border-border hover:bg-accent"}`}>
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
                on ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}>{c.num}</span>
              <span className="text-[12px] font-medium whitespace-nowrap">{c.title.split(" — ")[0]}</span>
            </button>
          );
        })}
      </nav>

      <ChapterShell
        chapter={active}
        step={step}
        onPrev={() => setStep(activeId, Math.max(0, step - 1))}
        onNext={() => setStep(activeId, Math.min(active.steps.length - 1, step + 1))}
      />
    </div>
  );
}

export default function BlockchainLearn() {
  // .edu-light: 전역 다크 여부와 무관하게 이 서브트리만 밝은 교육 톤(스코프 CSS 변수).
  return (
    <div className="edu-light min-h-full bg-background text-foreground">
      <JourneyProvider>
        <EduInner />
      </JourneyProvider>
    </div>
  );
}
