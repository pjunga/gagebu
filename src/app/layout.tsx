import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "가계부 · 금융 워크스페이스",
  description: "수입·지출, 자산, 작업을 한곳에서 관리하는 가계부",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
