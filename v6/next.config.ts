import type { NextConfig } from "next";

// compass/next.config.ts를 참고했다. 파일 변환 패키지(OCR·HEIC·PDF) 설정은 그 기능을 만드는 라운드에서 넣는다.
const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
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
