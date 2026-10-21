import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Pretendard(SIL OFL)를 이 서버에서 직접 내려보낸다(compass/app/layout.tsx와 같은 방식).
const pretendard = localFont({
  src: [
    { path: "../node_modules/pretendard/dist/web/static/woff2-subset/Pretendard-SemiBold.subset.woff2", weight: "600", style: "normal" },
    { path: "../node_modules/pretendard/dist/web/static/woff2-subset/Pretendard-Bold.subset.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-pretendard",
  display: "swap",
  fallback: ["Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", "system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  title: "키칸 자동차보험 보상 나침반",
  description: "사고 낸 운전자가 누가, 어느 보험에서, 어떤 담보로, 대략 얼마를 받는지 사람·물건별로 추정합니다. 사고 정보는 서버에 저장하지 않습니다.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f5f6f8" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={`h-full antialiased ${pretendard.variable}`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
