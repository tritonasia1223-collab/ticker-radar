// 재사용 가능한 framer-motion 스프링 프리셋 모음.
// iOS UIKit/SwiftUI 느낌의 물리 기반 스프링을 한 곳에서 관리한다.
// 사용처: 그래프 1↔2열 전환(layout), 체크박스 토글 등장/퇴장, 패널 hover 등.
//
// 사용 예시:
//   import { motion } from "framer-motion";
//   import { spring } from "@/lib/motion-presets";
//   <motion.div layout transition={spring.ios}> ... </motion.div>

import type { Transition } from "framer-motion";

// 스프링 프리셋. damping/stiffness 조합으로 "탄성감"을 조절한다.
export const spring = {
  // iOS 기본 — 그래프 레이아웃 재배치(1↔2열)에 쓰는 메인 프리셋.
  // 살짝 탄력 있으면서도 과하지 않게 정착. (애플 기본 UISpring 느낌)
  ios: { type: "spring", stiffness: 200, damping: 25, mass: 0.9 } as Transition,
  // 부드럽게 — 모달/오버레이/카드 등 큰 표면.
  smooth: { type: "spring", stiffness: 200, damping: 30 } as Transition,
  // 가볍고 천천히 — 큰 요소가 여유롭게 움직일 때.
  gentle: { type: "spring", stiffness: 120, damping: 20 } as Transition,
  // 빠릿 — 버튼/토글/작은 마이크로 인터랙션.
  snappy: { type: "spring", stiffness: 300, damping: 25 } as Transition,
  // 통통 튀게 — 등장/축하 등 즐거운 순간.
  bouncy: { type: "spring", stiffness: 220, damping: 14, mass: 0.8 } as Transition,
} as const;

// 등장/퇴장 공통 variants — 페이드 + 살짝 솟아오름. AnimatePresence 와 함께 사용.
// 리스트 항목이 추가/제거될 때 자연스럽게 끼어들거나 빠지게 한다.
export const fadeRise = {
  initial: { opacity: 0, y: 8, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -8, scale: 0.98 },
};

// 동작 최소화 선호 사용자(prefers-reduced-motion)는 모션을 거의 제거.
// 컴포넌트에서 useReducedMotion() 결과에 따라 이 트랜지션으로 대체한다.
export const reducedTransition: Transition = { duration: 0 };
