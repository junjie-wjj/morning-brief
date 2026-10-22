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

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-white p-5 shadow-soft">
      <h2 className="text-sm font-semibold tracking-tight text-ink">{title}</h2>
      <p className="mt-1 text-xs leading-5 text-muted">{hint}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Chip({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: () => void;
  children: React.ReactNode;
}) {
  return (
    <label
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
        checked
          ? "border-amber-300 bg-amber-50 text-amber-900"
          : "border-line bg-white text-ink-soft hover:border-amber-200 hover:bg-amber-50/40"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-3.5 w-3.5 rounded border-stone-300 accent-amber-600"
      />
      {children}
    </label>
  );
}

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

  return (
    <div className="mt-6 space-y-4">
      <Section title="兴趣分下限" hint="低于这个分数的资讯会收进首页底部的折叠区；产品追踪不受影响。">
        <div className="flex flex-wrap gap-2">
          {[
            { v: 1, label: "1 · 全部显示" },
            { v: 2, label: "2" },
            { v: 3, label: "3 · 推荐" },
            { v: 4, label: "4 · 只看高分" },
            { v: 5, label: "5 · 最高分" },
          ].map(({ v, label }) => (
            <button
              key={v}
              type="button"
              onClick={() => setS({ ...s, minScore: v })}
              aria-pressed={s.minScore === v}
              className={`rounded-full border px-3.5 py-1.5 text-[13px] transition-colors ${
                s.minScore === v
                  ? "border-amber-400 bg-amber-500 text-white shadow-sm"
                  : "border-line bg-white text-ink-soft hover:border-amber-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="分类" hint="不勾选表示不限；全部勾选也等于不限。">
        <div className="flex flex-wrap gap-2">
          {options.tags.map((tag) => (
            <Chip key={tag} checked={chosen("tags", options.tags).has(tag)} onChange={() => toggle("tags", options.tags, tag)}>
              {tag}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="来源" hint="关掉不想看的来源，例如只想留官方博客和量子位。">
        <div className="flex flex-wrap gap-2">
          {options.sources.map((source) => (
            <Chip key={source} checked={chosen("sources", options.sources).has(source)} onChange={() => toggle("sources", options.sources, source)}>
              {source}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="产品追踪" hint="只关注你需要的产品（不勾选表示全部保留）。">
        <div className="flex flex-wrap gap-2">
          {options.products.map((product) => (
            <Chip key={product} checked={chosen("products", options.products).has(product)} onChange={() => toggle("products", options.products, product)}>
              {product}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="屏蔽关键词" hint="标题包含这些词的条目不显示，一行一个（或逗号分隔）。">
        <textarea
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          rows={3}
          placeholder={"融资\n招聘\n裁员"}
          className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm leading-6 text-ink shadow-inner outline-none transition-colors placeholder:text-stone-300 focus:border-amber-400"
        />
      </Section>

      <Section title="其他" hint="阅读状态与反馈显示控制。">
        <div className="flex flex-col gap-3">
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={s.unreadOnly}
              onChange={(e) => setS({ ...s, unreadOnly: e.target.checked })}
              className="h-4 w-4 rounded border-stone-300 accent-amber-600"
            />
            只显示未读
          </label>
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={s.hideDownvoted}
              onChange={(e) => setS({ ...s, hideDownvoted: e.target.checked })}
              className="h-4 w-4 rounded border-stone-300 accent-amber-600"
            />
            隐藏点过「不感兴趣」的条目
          </label>
        </div>
      </Section>

      <div className="sticky bottom-4 flex items-center gap-3 rounded-2xl border border-line bg-white/90 p-3 shadow-lift backdrop-blur">
        <button
          onClick={() => save(s)}
          disabled={pending}
          className="rounded-xl bg-ink px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-700 disabled:opacity-60"
        >
          保存设置
        </button>
        <button
          onClick={() => { setS(DEFAULTS); setKeywords(""); save(DEFAULTS, ""); }}
          className="rounded-xl border border-line bg-white px-4 py-2.5 text-sm text-ink-soft transition-colors hover:bg-paper-deep"
        >
          恢复默认
        </button>
        <span
          aria-live="polite"
          className={`text-sm font-medium text-emerald-700 transition-opacity ${saved ? "opacity-100" : "opacity-0"}`}
        >
          已保存
        </span>
      </div>
    </div>
  );
}
