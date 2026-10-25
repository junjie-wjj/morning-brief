"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { WATCH_TOPICS, type Insights, type Settings } from "@/lib/db";

const DEFAULTS: Settings = {
  minScore: 3,
  tags: null,
  sources: null,
  unreadOnly: false,
  products: null,
  blockedKeywords: [],
  hideDownvoted: true,
  blockMode: "hide",
  dropLowScore: false,
  watchTopics: null,
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
  insights,
  authEnabled = false,
}: {
  initial: Settings;
  options: { tags: string[]; sources: string[]; products: string[] };
  insights?: Insights;
  authEnabled?: boolean;
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

  async function logout() {
    await fetch("/api/auth", { method: "DELETE" });
    router.replace("/login");
  }

  return (
    <div className="mt-6 space-y-4">
      {insights ? (
        <Section
          title="系统眼中的你"
          hint="根据你的 👍/👎 统计出的偏好画像与阅读概况；多点赞踩就会越准，删除条目不影响这里的记忆。"
        >
          <div className="space-y-3">
            {insights.searchTerms.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-muted">每日主动搜索：</span>
                {insights.searchTerms.map((t) => (
                  <span
                    key={t.kind + t.term}
                    className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700"
                    title={t.kind === "tag" ? `分类「${t.label}」净赞 ≥2 触发` : `产品「${t.label}」净赞 ≥2 触发`}
                  >
                    {t.term}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted">还没有触发偏好搜索（同一主题净赞 ≥2 才启用）。</p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-ink-soft">分类偏好（👍/👎）</p>
                <div className="mt-1.5 space-y-1">
                  {insights.tags.slice(0, 6).map((t) => {
                    const net = t.up - t.down;
                    return (
                      <div key={t.tag} className="flex items-center gap-2 text-xs">
                        <span className="w-20 shrink-0 truncate text-ink-soft">{t.tag}</span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-100">
                          <div
                            className={`h-full rounded-full ${net >= 0 ? "bg-emerald-400" : "bg-rose-300"}`}
                            style={{ width: `${Math.min(100, Math.abs(net) * 8 + 8)}%` }}
                          />
                        </div>
                        <span className={`w-8 shrink-0 text-right tabular-nums ${net >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                          {net >= 0 ? "+" : ""}{net}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-ink-soft">产品偏好（👍/👎）</p>
                <div className="mt-1.5 space-y-1">
                  {insights.products.slice(0, 6).map((p) => {
                    const net = p.up - p.down;
                    return (
                      <div key={p.name} className="flex items-center gap-2 text-xs">
                        <span className="w-20 shrink-0 truncate text-ink-soft">{p.name}</span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-100">
                          <div
                            className={`h-full rounded-full ${net >= 0 ? "bg-emerald-400" : "bg-rose-300"}`}
                            style={{ width: `${Math.min(100, Math.abs(net) * 8 + 8)}%` }}
                          />
                        </div>
                        <span className={`w-8 shrink-0 text-right tabular-nums ${net >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                          {net >= 0 ? "+" : ""}{net}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <p className="border-t border-line pt-2 text-xs text-muted">
              阅读概况：库存 {insights.reading.total} 条 · 已读 {insights.reading.read} · 稍后读 {insights.reading.later} · 未读 {insights.reading.unread}
              ｜ 反馈 {insights.reading.ups} 赞 / {insights.reading.downs} 踩
            </p>
          </div>
        </Section>
      ) : null}
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

      <Section title="关注方向" hint="每天固定搜索这些主题并监控 OpenRouter 免费模型上下架。不勾选表示全部启用；修改后明天早上的更新生效。">
        <div className="flex flex-wrap gap-2">
          {WATCH_TOPICS.map((topic) => {
            const on = s.watchTopics === null || s.watchTopics.includes(topic);
            return (
              <Chip key={topic} checked={on} onChange={() => {
                const set = new Set(s.watchTopics ?? WATCH_TOPICS);
                if (set.has(topic)) set.delete(topic);
                else set.add(topic);
                // 全选等价于「不限」，存 null；全不选同样存 null 但语义是"至少保留全部"
                // ——空列表在流水线侧按"全部启用"处理，避免一次误操作把搜索全关掉
                setS({ ...s, watchTopics: set.size === WATCH_TOPICS.length ? null : [...set] });
              }}>
                {topic}
              </Chip>
            );
          })}
        </div>
      </Section>

      <Section title="屏蔽关键词" hint="标题包含这些词（大小写不限）的条目不显示，一行一个（或逗号分隔）。">
        <textarea
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          rows={3}
          placeholder={"融资\n招聘\n裁员"}
          className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm leading-6 text-ink shadow-inner outline-none transition-colors placeholder:text-stone-300 focus:border-amber-400"
        />
        <div className="mt-3">
          <p className="text-xs font-medium text-ink-soft">作用范围</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <button
              type="button"
              aria-pressed={s.blockMode === "hide"}
              onClick={() => setS({ ...s, blockMode: "hide" })}
              className={`rounded-full border px-3.5 py-1.5 text-[13px] transition-colors ${
                s.blockMode === "hide"
                  ? "border-amber-400 bg-amber-500 text-white shadow-sm"
                  : "border-line bg-white text-ink-soft hover:border-amber-300"
              }`}
            >
              仅隐藏（保留存档）
            </button>
            <button
              type="button"
              aria-pressed={s.blockMode === "drop"}
              onClick={() => setS({ ...s, blockMode: "drop" })}
              className={`rounded-full border px-3.5 py-1.5 text-[13px] transition-colors ${
                s.blockMode === "drop"
                  ? "border-rose-400 bg-rose-500 text-white shadow-sm"
                  : "border-line bg-white text-ink-soft hover:border-rose-300"
              }`}
            >
              彻底不抓（不进档案）
            </button>
          </div>
          <p className="mt-1.5 text-xs leading-5 text-muted">
            {s.blockMode === "drop"
              ? "每日更新时命中词的条目在 AI 加工前直接丢弃（省额度），已入库的同类内容也会一并删除，历史页不再可见。删除不可恢复。"
              : "被屏蔽的新闻照常抓取和存档，只是不出现在首页；历史页仍可查看与搜索，删词即恢复显示。"}
          </p>
        </div>
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
          <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={s.dropLowScore}
              onChange={(e) => setS({ ...s, dropLowScore: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-stone-300 accent-amber-600"
            />
            <span>
              低分内容不入库（每日更新时兴趣分 ≤ 2 的资讯直接丢弃）
              <span className="block text-xs text-muted">
                省下 AI 加工额度，垃圾内容不再进入首页折叠区和历史页；产品动态与未打分条目不受影响。开启后明日生效。
              </span>
            </span>
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
        {authEnabled ? (
          <button
            onClick={logout}
            className="ml-auto text-xs text-muted transition-colors hover:text-rose-600"
          >
            退出登录
          </button>
        ) : null}
      </div>
    </div>
  );
}
