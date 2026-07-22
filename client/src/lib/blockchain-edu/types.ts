// 블록체인 학습 탭 — 여정 상태 타입(§3). 전 챕터가 공유하는 단일 상태의 형태.
import type { FeeSplit } from "./feeEngine.js";

export type ChapterId = "ch1" | "ch2" | "ch3" | "ch4" | "ch5" | "ch6" | "ch7" | "ch8";
export const CHAPTER_IDS: ChapterId[] = ["ch1", "ch2", "ch3", "ch4", "ch5", "ch6", "ch7", "ch8"];
export type StepIndex = number;

export interface LedgerEntry {
  chapterId: ChapterId;
  action: string;            // '입금(브릿지)', 'DEX 스왑', 'L2 송금', '출금' ...
  feeBreakdown: FeeSplit[];  // feeEngine 출력
}

export interface JourneyState {
  amountUSD: number;                                // 금액 슬라이더. 기본 $1,000, 범위 $10~$1M(로그).
  chapterProgress: Record<ChapterId, StepIndex>;
  ledger: LedgerEntry[];                            // 누적 원장
}
