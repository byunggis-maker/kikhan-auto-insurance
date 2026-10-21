import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  // 테스트 임시 파일은 v6/tmp-test/에만(tests/setup.ts)
  test: { environment: "node", include: ["tests/**/*.test.ts"], setupFiles: ["tests/setup.ts"] },
});
