import type { Metadata, Viewport } from "next";
import Link from "next/link";
import NavLinks from "./components/NavLinks";
import SwRegister from "./components/SwRegister";
import { IconSun } from "./components/Icons";
import "./globals.css";

export const metadata: Metadata = {
  title: "信息早餐",
  description: "每天自动生成的 AI 领域中文简报",
  manifest: "/manifest.webmanifest",
  icons: { apple: "/icon-180.png" },
};

export const viewport: Viewport = {
  themeColor: "#F59E0B",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <header className="sticky top-0 z-40 border-b border-line/70 bg-paper/80 backdrop-blur-xl">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
            <Link href="/" className="flex shrink-0 items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 text-white shadow-sm">
                <IconSun className="h-5 w-5" />
              </span>
              <span className="leading-tight">
                <span className="block font-serif text-[17px] font-semibold tracking-tight text-ink">
                  信息早餐
                </span>
                <span className="hidden text-[9px] uppercase tracking-[0.2em] text-muted sm:block">
                  AI Daily Brief
                </span>
              </span>
            </Link>
            <div className="ml-auto min-w-0">
              <NavLinks />
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
          {children}
        </main>

        <footer className="border-t border-line/70">
          <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p>摘要由 LLM 生成，仅供导读，以原文为准。</p>
            <p>morning-brief · 每天自动更新</p>
          </div>
        </footer>
        <SwRegister />
      </body>
    </html>
  );
}
