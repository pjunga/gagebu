import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "가계부 · 금융 워크스페이스",
  description: "수입·지출, 자산, 작업을 한곳에서 관리하는 가계부",
};

// Runs before paint so a stored light theme never flashes the dark palette.
const themeScript = `(function(){try{var t=localStorage.getItem("gagebu:theme");if(t!=="dark"&&t!=="light"){t=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";}document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme="dark";}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
