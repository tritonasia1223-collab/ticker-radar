// 블록체인 학습 탭 — 레이어 색상 규칙(§2). "색만 봐도 어느 레이어인지" 아는 게 학습 장치.
//   8챕터 전체에서 이 팔레트만 사용(컴포넌트가 강제). 라이트 교육 톤에 맞춘 파스텔+딥 조합.
import type { Layer, Recipient } from "./feeEngine.js";

export const LAYER = {
  L1:       { label: "L1 · 이더리움", solid: "#1e40af", soft: "#dbeafe", ink: "#1e3a8a" }, // 딥블루
  L2:       { label: "L2 · 롤업",     solid: "#0d9488", soft: "#ccfbf1", ink: "#0f766e" }, // 민트/틸
  offchain: { label: "현실세계",       solid: "#78716c", soft: "#e7e5e4", ink: "#57534e" }, // 웜그레이(은행·커스터디)
  burn:     { label: "소각",          solid: "#ea580c", soft: "#ffedd5", ink: "#9a3412" }, // 오렌지→재
} as const;

export type LayerKey = keyof typeof LAYER;

// 수취인 8종 → 표시명 + 소속 레이어(MoneyFlowPanel 노드 배치·색상용, Phase 2).
export const RECIPIENT_META: Record<Recipient, { label: string; layer: Layer }> = {
  burn:         { label: "소각(EIP-1559)",  layer: "L1" },
  validator:    { label: "검증자(팁)",       layer: "L1" },
  sequencer:    { label: "시퀀서(운영사)",    layer: "L2" },
  lp:           { label: "유동성공급자(LP)",  layer: "L2" },
  protocol:     { label: "프로토콜·프론트",   layer: "L2" },
  issuer:       { label: "발행사",           layer: "offchain" },
  custodian:    { label: "커스터디",         layer: "offchain" },
  assetManager: { label: "자산운용사",        layer: "offchain" },
};

// 레이어 → 팔레트(소각 수취인은 burn 팔레트로 오버라이드).
export function recipientPalette(recipient: Recipient) {
  if (recipient === "burn") return LAYER.burn;
  return LAYER[RECIPIENT_META[recipient].layer];
}
