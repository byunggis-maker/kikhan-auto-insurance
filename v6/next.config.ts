import type { NextConfig } from "next";

// compass/next.config.ts를 참고했다.
const nextConfig: NextConfig = {
  cacheComponents: true,
  // 아이폰 사진(HEIC) 변환기는 번들에 넣지 않고 서버에서 node_modules 그대로 불러온다(라운드 7 서류 인식)
  serverExternalPackages: ["heic-convert"],
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
