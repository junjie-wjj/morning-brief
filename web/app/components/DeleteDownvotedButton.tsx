"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconTrash } from "./Icons";

// 一键删除所有点过「踩」的条目（连带合并进来的重复报道）。
// 不可恢复，必须弹确认并报条数；反馈记录保留（偏好学习的原料）。
export default function DeleteDownvotedButton({ count }: { count: number }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState("");

  if (count <= 0) return null;

  async function purge() {
    if (!window.confirm(`确定永久删除 ${count} 条点过「踩」的条目？\n连带合并进来的重复报道一起删，不可恢复。`)) return;
    setError("");
    try {
      const res = await fetch("/api/delete-downvoted", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      startTransition(() => router.refresh());
    } catch {
      setError("删除失败，请重试");
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={purge}
        className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-2.5 py-1 text-xs text-ink-soft transition-colors hover:border-rose-300 hover:text-rose-700"
      >
        <IconTrash className="h-3.5 w-3.5" />
        删除全部点踩条目（{count}）
      </button>
      {error ? (
        <span role="status" aria-live="polite" className="text-xs text-rose-600">
          {error}
        </span>
      ) : null}
    </span>
  );
}
