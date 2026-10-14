import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Pretendard(SIL OFL)를 이 서버에서 직접 내려보낸다. 다른 사이트로 글꼴 요청을 보내지 않는다.
// 자주 쓰는 한글 2,780자만 담은 판(KS X 1001)을 굵기 셋으로 쓴다. 없는 글자는 기기 글꼴로 보인다.
const pretendard = localFont({
  src: [
    { path: "../node_modules/pretendard/dist/web/static/woff2-subset/Pretendard-Regular.subset.woff2", weight: "400", style: "normal" },
    { path: "../node_modules/pretendard/dist/web/static/woff2-subset/Pretendard-SemiBold.subset.woff2", weight: "600", style: "normal" },
    { path: "../node_modules/pretendard/dist/web/static/woff2-subset/Pretendard-Bold.subset.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-pretendard",
  display: "swap",
  fallback: ["Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", "system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  title: "키칸 자동차보험 보상 나침반",
  description: "내가 아는 정보만으로 자동차보험 담보별 예상 보험금을 사람별로 추정해 봅니다. 개인정보를 저장하지 않습니다.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f5f6f8" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={`h-full antialiased ${pretendard.variable}`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
