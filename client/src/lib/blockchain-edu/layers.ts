// 블록체인 학습 탭 — 레이어 색상 규칙(§2). "색만 봐도 어느 레이어인지" 아는 게 학습 장치.
//   8챕터 전체에서 이 팔레트만 사용(컴포넌트가 강제). 라이트 교육 톤에 맞춘 파스텔+딥 조합.
import type { Layer, Recipient } from "./feeEngine.js";

export const LAYER = {
  L1:       { label: "L1 · 이더리움", solid: "var(--tone-blue-500)", soft: "var(--tone-blue-50)", ink: "var(--tone-blue-600)" }, // 딥블루
  L2:       { label: "L2 · 롤업",     solid: "var(--tone-teal-600)", soft: "var(--tone-teal-100)", ink: "var(--tone-teal-700)" }, // 민트/틸
  offchain: { label: "현실세계",       solid: "var(--ink-soft)", soft: "var(--line-soft)", ink: "var(--ink-soft)" }, // 웜그레이(은행·커스터디)
  burn:     { label: "소각",          solid: "var(--tone-orange-500)", soft: "var(--tone-orange-100)", ink: "var(--tone-orange-600)" }, // 오렌지→재
} as const;

export type LayerKey = keyof typeof LAYER;

// 수취인 8종 → 표시명 + 소속 레이어 + '고유 색'. 레이어별로만 칠하면 L2(시퀀서·LP·프로토콜)가
//   전부 같은 틸이라 구분이 안 됨 → 수취인마다 다른 색상(레이어는 노드의 레이어 배지/그룹으로 표현).
export const RECIPIENT_META: Record<Recipient, { label: string; layer: Layer; solid: string; soft: string; ink: string }> = {
  burn:         { label: "소각(EIP-1559)",  layer: "L1",       solid: "var(--tone-orange-500)", soft: "var(--tone-orange-100)", ink: "var(--tone-orange-600)" }, // 오렌지
  validator:    { label: "검증자(팁)",       layer: "L1",       solid: "var(--tone-blue-500)", soft: "var(--tone-blue-50)", ink: "var(--tone-blue-500)" }, // 블루
  sequencer:    { label: "시퀀서(운영사)",    layer: "L2",       solid: "var(--tone-teal-600)", soft: "var(--tone-teal-100)", ink: "var(--tone-teal-700)" }, // 틸
  lp:           { label: "유동성공급자(LP)",  layer: "L2",       solid: "var(--tone-indigo-400)", soft: "var(--surface-soft)", ink: "var(--tone-indigo-500)" }, // 바이올렛
  protocol:     { label: "프로토콜·프론트",   layer: "L2",       solid: "var(--tone-rose-500)", soft: "var(--surface-soft)", ink: "var(--tone-rose-500)" }, // 핑크
  issuer:       { label: "발행사",           layer: "offchain", solid: "var(--tone-blue-500)", soft: "var(--bg)", ink: "var(--tone-blue-600)" }, // 슬레이트
  custodian:    { label: "커스터디",         layer: "offchain", solid: "var(--tone-orange-600)", soft: "var(--tone-yellow-100)", ink: "var(--tone-orange-700)" }, // 앰버
  assetManager: { label: "자산운용사",        layer: "offchain", solid: "var(--tone-lime-700)", soft: "var(--tone-lime-100)", ink: "var(--tone-lime-700)" }, // 올리브
};

// 수취인 고유 팔레트({solid,soft,ink,label}) — LAYER 팔레트는 레이어 문맥(토글·락앤민트 등)에서 계속 사용.
export function recipientPalette(recipient: Recipient) {
  const m = RECIPIENT_META[recipient];
  return { solid: m.solid, soft: m.soft, ink: m.ink, label: m.label };
}
