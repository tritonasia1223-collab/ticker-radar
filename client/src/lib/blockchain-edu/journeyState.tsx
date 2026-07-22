// 블록체인 학습 탭 — 여정 상태(§3). React Context + useReducer(외부 상태 라이브러리 불필요).
//   localStorage 로 재방문 시 이어서 학습. "처음부터 다시"(reset) 제공.
import { createContext, useContext, useEffect, useReducer } from "react";
import type { ChapterId, JourneyState, LedgerEntry, StepIndex } from "./types.js";
import { CHAPTER_IDS } from "./types.js";

export const AMOUNT_MIN = 10, AMOUNT_MAX = 1_000_000, AMOUNT_DEFAULT = 1_000;
const STORAGE_KEY = "bc-edu-journey-v1";

type Action =
  | { type: "setAmount"; amountUSD: number }
  | { type: "setStep"; chapterId: ChapterId; step: StepIndex }
  | { type: "addLedger"; entry: LedgerEntry }
  | { type: "reset" };

const clampAmount = (v: number) => Math.min(AMOUNT_MAX, Math.max(AMOUNT_MIN, v));

function initialState(): JourneyState {
  const chapterProgress = Object.fromEntries(CHAPTER_IDS.map((c) => [c, 0])) as Record<ChapterId, StepIndex>;
  return { amountUSD: AMOUNT_DEFAULT, chapterProgress, ledger: [] };
}

function reducer(state: JourneyState, action: Action): JourneyState {
  switch (action.type) {
    case "setAmount": return { ...state, amountUSD: clampAmount(action.amountUSD) };
    case "setStep": return { ...state, chapterProgress: { ...state.chapterProgress, [action.chapterId]: Math.max(0, action.step) } };
    case "addLedger": return { ...state, ledger: [...state.ledger, action.entry] };
    case "reset": return initialState();
  }
}

// 저장본 로드(형태가 어긋나면 초기값으로 안전 복구).
function load(): JourneyState {
  const base = initialState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const p = JSON.parse(raw) as Partial<JourneyState>;
    return {
      amountUSD: clampAmount(Number(p.amountUSD) || base.amountUSD),
      chapterProgress: { ...base.chapterProgress, ...(p.chapterProgress ?? {}) },
      ledger: Array.isArray(p.ledger) ? (p.ledger as LedgerEntry[]) : [],
    };
  } catch { return base; }
}

interface JourneyCtxValue {
  state: JourneyState;
  setAmount: (v: number) => void;
  setStep: (chapterId: ChapterId, step: StepIndex) => void;
  addLedger: (entry: LedgerEntry) => void;
  reset: () => void;
}
const JourneyCtx = createContext<JourneyCtxValue | null>(null);

export function JourneyProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, load);
  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* 저장 실패 무시 */ } }, [state]);
  const value: JourneyCtxValue = {
    state,
    setAmount: (v) => dispatch({ type: "setAmount", amountUSD: v }),
    setStep: (chapterId, step) => dispatch({ type: "setStep", chapterId, step }),
    addLedger: (entry) => dispatch({ type: "addLedger", entry }),
    reset: () => dispatch({ type: "reset" }),
  };
  return <JourneyCtx.Provider value={value}>{children}</JourneyCtx.Provider>;
}

export function useJourney(): JourneyCtxValue {
  const c = useContext(JourneyCtx);
  if (!c) throw new Error("useJourney must be used within JourneyProvider");
  return c;
}
