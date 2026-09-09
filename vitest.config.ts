import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// 앱 번들과 분리한 Node 테스트. 경제사 저장·유동성·무결성 및 기존 수수료 엔진을 검사한다.
export default defineConfig({
  resolve: { alias: {
    "@": fileURLToPath(new URL("./client/src", import.meta.url)),
    "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
  } },
  test: {
    environment: "node",
    include: ["client/src/lib/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
