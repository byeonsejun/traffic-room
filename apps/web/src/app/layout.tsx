import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "전국 도로 상황실",
  description: "전국 돌발 상황을 약 1시간 지연으로 보여주는 도로 상황실",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
