import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import Navbar from "@/components/Navbar";
import { LegalFooter } from "@/components/legal/LegalFooter";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "크리에이터X - 크리에이터 성장 예측 게임",
  description:
    "가상 포인트 기반 크리에이터 성장 예측 게임입니다. 포인트는 현금 가치가 없습니다.",
  icons: {
    icon: [
      {
        url: "/brand/creatorx-icon-32.png",
        sizes: "32x32",
        type: "image/png",
      },
      {
        url: "/brand/creatorx-icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: "/brand/creatorx-icon-180.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers>
          <Navbar />
          {children}
          <LegalFooter />
        </Providers>
      </body>
    </html>
  );
}
