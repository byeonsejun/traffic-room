import type { Viewport } from "next";
import { IBM_Plex_Sans_KR } from "next/font/google";
import { readTiming } from "@traffic-room/shared";
import { buildRootMetadata, isPreviewDeployment } from "@/lib/seo";
import "./globals.css";

const plex = IBM_Plex_Sans_KR({
  weight: ["300", "400", "500", "600"],
  display: "swap",
  variable: "--font-plex",
});

export const metadata = buildRootMetadata({
  preview: isPreviewDeployment(process.env.VERCEL_ENV),
  delayMinutes: readTiming(process.env).delayMinutes,
});

export const viewport: Viewport = { themeColor: "#0C131D", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={plex.variable}>
      <body>{children}</body>
    </html>
  );
}
