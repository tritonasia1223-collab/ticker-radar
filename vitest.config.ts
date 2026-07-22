import { defineConfig } from "vitest/config";

// 블록체인 학습 탭의 수수료 엔진(순수함수) 단위테스트 전용 스코프.
//   앱 vite.config(React 플러그인·alias)와 분리 — 엔진은 React import 없는 순수 TS라 node 환경이면 충분.
//   실행: npm test   (feeEngine.test.ts 반증 7종 게이트)
export default defineConfig({
  test: {
    environment: "node",
    include: ["client/src/lib/blockchain-edu/**/*.test.ts"],
  },
});
