"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ItemRow } from "@/lib/db";

// 客户端组件：按钮点击后发请求改数据库，然后让服务端重新渲染页面
export default function ItemCard({ item }: { item: ItemRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

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
  const hasPoints = Boolean(item.points);

  // 点开标题（跳转原文）时自动标记已读，不必再单独点一次「已读」按钮。
  // 两条边界：
  //   · 已是「稍后读」的不动 —— 那是用户明确收藏的条目，不该被一次点击改掉；
  //   · 用 keepalive 发请求 —— 新标签页打开后本页可能转入后台，普通请求会被中断。
  function markReadOnOpen() {
    if (isRead || item.status === "later") return;
    void fetch(`/api/items/${item.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "read" }),
      keepalive: true,
    }).then(() => startTransition(() => router.refresh()));
  }

  // 卡片空白处：就地展开「原文精简版」，不跳转、不新开标签。
  // 这也是「打开这条消息」，所以同样标记已读（规则与点标题一致）。
  function togglePoints() {
    if (!hasPoints) return;
    setOpen((v) => !v);
    if (!open) markReadOnOpen();
  }

  return (
    // 整张卡片的空白处都可点：点开就地读精简版，不用打开原网页。
    // 标题（跳原文）与按钮区各自阻止冒泡，行为互不干扰。
    <article
      onClick={togglePoints}
      className={`border-b border-zinc-100 py-3 ${pending ? "opacity-60" : ""} ${
        hasPoints ? "cursor-pointer hover:bg-zinc-50/60" : ""
      }`}
      title={hasPoints ? (open ? "点空白处收起精简版" : "点空白处读精简版，不用打开原网页") : undefined}
    >
      {/* 标题是独立跳转区；点它开原文，不触发展开 */}
      <a
        href={item.link}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => { e.stopPropagation(); markReadOnOpen(); }}
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

      {hasPoints && (
        <p className="mt-1 text-xs text-indigo-500">
          {open ? "▾ 收起精简版" : "▸ 原文精简版（不打开网页也能读）"}
        </p>
      )}

      {open && item.points && (
        <div className="mt-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
          {item.points.split("\n").filter(Boolean).map((line, i) => (
            <p key={i} className="mt-1 text-[13px] leading-6 text-zinc-700 first:mt-0">
              {line}
            </p>
          ))}
          <p className="mt-2 text-[11px] text-zinc-400">
            {item.body_chars ? `已处理全文 ${item.body_chars} 字` : ""}
            {item.body_via ? ` · 来源 ${item.body_via}` : ""}
            {item.points_reason ? ` · ${item.points_reason}` : ""}
          </p>
        </div>
      )}

      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="truncate text-xs text-zinc-400">
          {item.source}
          {item.date ? ` · ${item.date.slice(5, 10)}` : ""}
          {item.zh_title && item.zh_title !== item.title ? ` · 原标题：${item.title}` : ""}
        </span>
        {/* 按钮区阻止冒泡，避免点「已读/稍后读」时顺带展开 */}
        <span className="flex shrink-0 gap-3 text-xs" onClick={(e) => e.stopPropagation()}>
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
