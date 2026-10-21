"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Settings } from "@/lib/db";

const DEFAULTS: Settings = {
  minScore: 3,
  tags: null,
  sources: null,
  unreadOnly: false,
  products: null,
  blockedKeywords: [],
  hideDownvoted: true,
};

type MultiField = "tags" | "sources" | "products";

export default function SettingsForm({
  initial,
  options,
}: {
  initial: Settings;
  options: { tags: string[]; sources: string[]; products: string[] };
}) {
  const router = useRouter();
  const [s, setS] = useState<Settings>(initial);
  const [keywords, setKeywords] = useState(initial.blockedKeywords.join("\n"));
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const chosen = (field: MultiField, all: string[]) => {
    const v = s[field];
    return v === null ? new Set(all) : new Set(v);
  };

  function toggle(field: MultiField, all: string[], value: string) {
    const set = chosen(field, all);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    // 全选等价于「不限」，存 null 更省心（以后新增分类/来源也会自动包含）
    setS({ ...s, [field]: set.size === all.length ? null : [...set] });
  }

  async function save(next: Settings, keywordText: string = keywords) {
    const parsed = keywordText.split(/[\n,，]/).map((k) => k.trim()).filter(Boolean);
    const payload = { ...next, blockedKeywords: parsed };
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return;
    setS(payload);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    startTransition(() => router.refresh());
  }

  const box = "h-4 w-4 rounded border-zinc-300 text-indigo-600 accent-indigo-600";
  const label = "flex items-center gap-2 text-sm text-zinc-700";

  return (
    <div className="mt-5 space-y-7">
      <section>
        <h2 className="text-sm font-semibold text-zinc-900">兴趣分下限</h2>
        <p className="mt-1 text-xs text-zinc-500">低于这个分数的资讯会收进首页底部的折叠区；产品追踪不受影响。</p>
        <select
          value={s.minScore}
          onChange={(e) => setS({ ...s, minScore: Number(e.target.value) })}
          className="mt-2 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm"
        >
          <option value={1}>1 分（全部显示）</option>
          <option value={2}>2 分</option>
          <option value={3}>3 分（推荐：隐藏明显低质）</option>
          <option value={4}>4 分（只看高分）</option>
          <option value={5}>5 分（只看最高分）</option>
        </select>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-zinc-900">分类</h2>
        <p className="mt-1 text-xs text-zinc-500">不勾选表示不限；全部勾选也等于不限。</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {options.tags.map((tag) => (
            <label key={tag} className={label}>
              <input
                type="checkbox"
                className={box}
                checked={chosen("tags", options.tags).has(tag)}
                onChange={() => toggle("tags", options.tags, tag)}
              />
              {tag}
            </label>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-zinc-900">来源</h2>
        <p className="mt-1 text-xs text-zinc-500">关掉不想看的来源，例如只想留官方博客和量子位。</p>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {options.sources.map((source) => (
            <label key={source} className={label}>
              <input
                type="checkbox"
                className={box}
                checked={chosen("sources", options.sources).has(source)}
                onChange={() => toggle("sources", options.sources, source)}
              />
              {source}
            </label>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-zinc-900">产品追踪</h2>
        <p className="mt-1 text-xs text-zinc-500">只关注你需要的产品（不勾选表示全部保留）。</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {options.products.map((product) => (
            <label key={product} className={label}>
              <input
                type="checkbox"
                className={box}
                checked={chosen("products", options.products).has(product)}
                onChange={() => toggle("products", options.products, product)}
              />
              {product}
            </label>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-zinc-900">屏蔽关键词</h2>
        <p className="mt-1 text-xs text-zinc-500">标题包含这些词的条目不显示，一行一个（或逗号分隔）。</p>
        <textarea
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          rows={3}
          placeholder={"融资\n招聘\n裁员"}
          className="mt-2 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
      </section>

      <section className="space-y-2">
        <label className={label}>
          <input
            type="checkbox"
            className={box}
            checked={s.unreadOnly}
            onChange={(e) => setS({ ...s, unreadOnly: e.target.checked })}
          />
          只显示未读
        </label>
        <label className={label}>
          <input
            type="checkbox"
            className={box}
            checked={s.hideDownvoted}
            onChange={(e) => setS({ ...s, hideDownvoted: e.target.checked })}
          />
          隐藏点过「👎 不感兴趣」的条目
        </label>
      </section>

      <div className="flex items-center gap-3 border-t border-zinc-200 pt-4">
        <button
          onClick={() => save(s)}
          disabled={pending}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
        >
          保存设置
        </button>
        <button
          onClick={() => { setS(DEFAULTS); setKeywords(""); save(DEFAULTS, ""); }}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50"
        >
          恢复默认
        </button>
        {saved && <span className="text-sm text-emerald-600">已保存</span>}
      </div>
    </div>
  );
}
