import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "信息早餐",
  description: "每天自动生成的 AI 领域中文简报",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-zinc-50">
        <header className="border-b border-zinc-200 bg-white">
          <nav className="mx-auto flex max-w-2xl items-center gap-6 px-4 py-3">
            <Link href="/" className="font-semibold text-zinc-900">信息早餐</Link>
            <Link href="/later" className="text-sm text-zinc-500 hover:text-zinc-900">稍后读</Link>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">{children}</main>
        <footer className="mx-auto w-full max-w-2xl px-4 pb-8 text-xs text-zinc-400">
          摘要由 LLM 生成仅供导读，以原文为准 · 阶段 1 本地版
        </footer>
      </body>
    </html>
  );
}
