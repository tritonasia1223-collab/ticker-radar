// 블록체인 학습 탭 — 엔진 → '돈의 행방' 시나리오 브리지. 액션 종류 + 금액 → FeeSplit[].
//   FeeStackBar·MoneyFlowPanel·원장이 전부 이 일관된 형태를 소비한다. 엔진(순수함수)만 사용.
import { l1TxFee, l2TxFee, swapFee, stablecoinYieldFlow, type FeeSplit, type StablecoinModel } from "./feeEngine.js";
import { CALIBRATION as C } from "./calibration.js";

export type ActionKind = "bridgeDeposit" | "l2Swap" | "l2Transfer" | "withdraw" | "hold";

export const ACTION_LABEL: Record<ActionKind, string> = {
  bridgeDeposit: "입금(브릿지)",
  l2Swap: "DEX 스왑",
  l2Transfer: "L2 송금",
  withdraw: "출금",
  hold: "스테이블코인 보유",
};

// 액션 → 수수료 분해. 슬리피지는 풀(LP)에 귀속되는 것으로 단순화(교육 모델).
export function actionSplits(
  kind: ActionKind,
  amountUSD: number,
  opts?: { days?: number; model?: StablecoinModel },
): FeeSplit[] {
  switch (kind) {
    case "bridgeDeposit": {
      const f = l1TxFee(C.l1.gasUsage.bridgeDeposit);
      return [
        { recipient: "burn", amountUSD: f.burn, layer: "L1" },
        { recipient: "validator", amountUSD: f.validator, layer: "L1" },
      ];
    }
    case "withdraw": {
      const f = l1TxFee(C.l1.gasUsage.transfer);
      return [
        { recipient: "burn", amountUSD: f.burn, layer: "L1" },
        { recipient: "validator", amountUSD: f.validator, layer: "L1" },
      ];
    }
    case "l2Transfer": {
      const f = l2TxFee(amountUSD);
      return [
        { recipient: "sequencer", amountUSD: f.sequencer, layer: "L2" },
        { recipient: "burn", amountUSD: f.l1DataCostShare, layer: "L1" }, // 블롭 정산분(사실상 L1)
      ];
    }
    case "l2Swap": {
      const tx = l2TxFee(amountUSD);
      const s = swapFee(amountUSD);
      return [
        { recipient: "sequencer", amountUSD: tx.sequencer, layer: "L2" },
        { recipient: "burn", amountUSD: tx.l1DataCostShare, layer: "L1" },
        { recipient: "lp", amountUSD: s.lp + s.slippage, layer: "L2" }, // LP 수수료 + 슬리피지(풀 귀속)
        { recipient: "protocol", amountUSD: s.protocol, layer: "L2" },
      ];
    }
    case "hold":
      return stablecoinYieldFlow(amountUSD, opts?.days ?? 365, opts?.model ?? "usdc");
  }
}

export const totalUSD = (splits: FeeSplit[]) => splits.reduce((s, x) => s + x.amountUSD, 0);
