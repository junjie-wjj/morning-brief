"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ItemRow } from "@/lib/db";

// 客户端组件：按钮点击后发请求改数据库，然后让服务端重新渲染页面
export default function ItemCard({ item }: { item: ItemRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  async function setStatus(status: "unread" | "read" | "later") {
    await fetch(`/api/items/${item.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    startTransition(() => router.refresh());
  }

  const isRead = item.status === "read";
  const title = item.zh_title ?? item.title;

  return (
    <article className={`border-b border-zinc-100 py-3 ${pending ? "opacity-60" : ""}`}>
      <a
        href={item.link}
        target="_blank"
        rel="noopener noreferrer"
        className={`text-[15px] font-medium hover:text-blue-600 ${isRead ? "text-zinc-400" : "text-zinc-900"}`}
      >
        {title}
      </a>
      {item.tag && (
        <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 align-middle text-xs text-indigo-600">
          {item.tag}
        </span>
      )}
      {item.summary && <p className="mt-1 text-sm leading-6 text-zinc-600">{item.summary}</p>}
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="truncate text-xs text-zinc-400">
          {item.source}
          {item.date ? ` · ${item.date.slice(5, 10)}` : ""}
          {item.zh_title && item.zh_title !== item.title ? ` · 原标题：${item.title}` : ""}
        </span>
        <span className="flex shrink-0 gap-3 text-xs">
          {isRead ? (
            <button onClick={() => setStatus("unread")} className="text-zinc-400 hover:text-zinc-700">撤销已读</button>
          ) : (
            <button onClick={() => setStatus("read")} className="text-zinc-400 hover:text-zinc-700">已读</button>
          )}
          {item.status === "later" ? (
            <button onClick={() => setStatus("unread")} className="text-amber-500 hover:text-amber-700">取消稍后</button>
          ) : (
            <button onClick={() => setStatus("later")} className="text-amber-500 hover:text-amber-700">稍后读</button>
          )}
        </span>
      </div>
    </article>
  );
}
