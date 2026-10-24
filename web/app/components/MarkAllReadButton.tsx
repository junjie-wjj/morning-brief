"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconCheck } from "./Icons";

// 一键全部已读。作用范围由 props 决定（首页=最新一期；历史页=当前筛选范围），
// 批量操作没有撤销，所以点之前弹确认，并把将影响的条数说清楚。
export default function MarkAllReadButton({
  scope,
  count,
  label = "全部已读",
}: {
  scope: { issue: string } | { all: true };
  count: number;
  label?: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState("");

  if (count <= 0) return null;
  const isAll = "all" in scope;
  const scopeLabel = isAll ? "所有期" : `${scope.issue} 期`;

  async function markAll() {
    if (!window.confirm(`确定把${isAll ? "全部" : "这一期"}的 ${count} 条未读标为已读？`)) return;
    setError("");
    try {
      const res = await fetch("/api/read-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isAll ? { all: true } : { issue: scope.issue }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      startTransition(() => router.refresh());
    } catch {
      setError("操作失败，请重试");
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={markAll}
        title={`把${scopeLabel}的未读全部标为已读`}
        className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-2.5 py-1 text-xs text-ink-soft transition-colors hover:border-emerald-300 hover:text-emerald-700"
      >
        <IconCheck className="h-3.5 w-3.5" />
        {label}
      </button>
      {error ? (
        <span role="status" aria-live="polite" className="text-xs text-rose-600">
          {error}
        </span>
      ) : null}
    </span>
  );
}
