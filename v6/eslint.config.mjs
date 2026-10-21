import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 빌드 전에 node_modules에서 복사하는 pdf.js 작업 파일(scripts/copy-pdf-worker.mjs)
    "public/pdfjs/**",
    // 확인용 임시 폴더(배포용 복사본의 빌드 결과 등)
    ".tmp/**",
    "tmp-test/**",
  ]),
]);

export default eslintConfig;
