import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // 파일 변환에 쓰는 패키지(네이티브·WASM)는 묶지 않고 node_modules에서 그대로 불러온다.
  serverExternalPackages: ["@napi-rs/canvas", "sharp", "heic-convert", "unpdf", "pdfjs-dist"],
  // PDF의 한글 문자표와 기본 글꼴 파일은 코드가 경로로 읽으므로 배포 묶음에 따로 넣어 준다.
  outputFileTracingIncludes: {
    "/api/policies/read": ["./node_modules/pdfjs-dist/cmaps/**", "./node_modules/pdfjs-dist/standard_fonts/**"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
