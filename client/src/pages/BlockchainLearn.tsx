// 블록체인 학습 탭(/learn/blockchain) — Phase 1 프레임 + Phase 2 상시 UI.
//   스코프 라이트 테마(.edu-light) + JourneyProvider + 챕터 네비 + ChapterShell +
//   상시 패널(AmountSlider·FeeStackBar·MoneyFlowPanel). 씬 애니메이션은 Phase 3~5.
import { useMemo, useState } from "react";
import { RotateCcw, Save } from "lucide-react";
import { JourneyProvider, useJourney } from "@/lib/blockchain-edu/journeyState";
import { CHAPTER_LIST } from "@/content/blockchain-edu/chapters";
import type { ChapterId } from "@/lib/blockchain-edu/types";
import { actionSplits, ACTION_LABEL, type ActionKind } from "@/lib/blockchain-edu/scenarios";
import ChapterShell from "@/components/blockchain-edu/ChapterShell";
import AmountSlider from "@/components/blockchain-edu/AmountSlider";
import FeeStackBar from "@/components/blockchain-edu/FeeStackBar";
import MoneyFlowPanel from "@/components/blockchain-edu/MoneyFlowPanel";

const ACTIONS: ActionKind[] = ["bridgeDeposit", "l2Swap", "l2Transfer", "withdraw", "hold"];

function EduInner() {
  const { state, setStep, reset, addLedger } = useJourney();
  const [activeId, setActiveId] = useState<ChapterId>("ch1");
  const [action, setAction] = useState<ActionKind>("l2Swap");
  const active = CHAPTER_LIST.find((c) => c.id === activeId) ?? CHAPTER_LIST[0];
  const step = state.chapterProgress[activeId] ?? 0;

  const splits = useMemo(() => actionSplits(action, state.amountUSD), [action, state.amountUSD]);
  const flowKey = `${action}-${state.amountUSD}`;

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

      {/* 상단 고정: 금액 슬라이더 */}
      <AmountSlider />

      {/* 챕터 네비 */}
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
        bottom={<FeeStackBar splits={splits} />}
      />

      {/* 상시: 돈의 행방 */}
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-2 flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h3 className="text-[14px] font-bold">돈의 행방</h3>
            <p className="text-[11px] text-muted-foreground">거래 종류를 고르고 금액을 바꿔 수수료가 누구에게 가는지 보세요.</p>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground tabular-nums">원장 {state.ledger.length}건</span>
            <button onClick={() => addLedger({ chapterId: activeId, action: ACTION_LABEL[action], feeBreakdown: splits })}
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11.5px] font-medium hover:bg-accent transition-colors">
              <Save className="h-3.5 w-3.5" /> 원장에 기록
            </button>
          </div>
        </div>

        {/* 거래 종류 선택 */}
        <div className="mb-2 flex flex-wrap gap-1.5">
          {ACTIONS.map((a) => (
            <button key={a} onClick={() => setAction(a)}
              className={`rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                a === action ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-accent"}`}>
              {ACTION_LABEL[a]}
            </button>
          ))}
        </div>

        <MoneyFlowPanel splits={splits} flowKey={flowKey} />
      </section>
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
