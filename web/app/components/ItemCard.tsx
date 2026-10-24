"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ItemRow } from "@/lib/db";
import {
  IconBookmark,
  IconCheck,
  IconChevronDown,
  IconExternal,
  IconSparkles,
  IconThumbsDown,
  IconThumbsUp,
  IconTrash,
} from "./Icons";

type Variant = "default" | "featured" | "compact";

const TAG_TONES: Record<string, string> = {
  模型发布: "border-sky-100 bg-sky-50 text-sky-700",
  福利资源: "border-emerald-100 bg-emerald-50 text-emerald-700",
  产品动态: "border-violet-100 bg-violet-50 text-violet-700",
  研究进展: "border-cyan-100 bg-cyan-50 text-cyan-700",
  行业动态: "border-amber-100 bg-amber-50 text-amber-800",
  其他: "border-stone-200 bg-stone-100 text-stone-600",
};

function tagTone(tag: string) {
  return TAG_TONES[tag] ?? "border-stone-200 bg-stone-100 text-stone-600";
}

const BEIJING_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Shanghai",
  month: "2-digit",
  day: "2-digit",
});

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = BEIJING_DATE.formatToParts(d);
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return month && day ? `${month}.${day}` : "";
}

function ScoreBadge({ score }: { score: number }) {
  const tone = score >= 5
    ? "border-amber-300 bg-amber-50 text-amber-800"
    : score >= 4
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : score >= 3
        ? "border-line bg-paper text-stone-600"
        : "border-line bg-white text-muted";
  return (
    <span
      title={`兴趣分 ${score}/5`}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${tone}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {score} 分
    </span>
  );
}

function ActionIcon({
  label,
  active,
  activeClass,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  activeClass: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`grid h-10 w-10 place-items-center rounded-full border transition-colors sm:h-8 sm:w-8 ${
        active
          ? activeClass
          : "border-transparent text-stone-400 hover:bg-paper-deep hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

// 搜索关键词高亮：把命中片段用黄底标出，让「这条为什么算结果」一眼可见。
// q 为空时原样渲染；大小写不敏感；正则元字符已转义，纯字面匹配。
function Highlighted({ text, q }: { text: string; q?: string }) {
  if (!q || !q.trim()) return <>{text}</>;
  const needle = q.trim();
  const parts = text.split(new RegExp(`(${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return (
    <>
      {parts.map((p, i) =>
        p.toLowerCase() === needle.toLowerCase() ? (
          <mark key={i} className="rounded-sm bg-amber-200/80 px-0.5 text-inherit">
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

// 客户端组件：按钮点击后发请求改数据库，然后让服务端重新渲染页面
export default function ItemCard({
  item,
  verdict = null,
  related = [],
  variant = "default",
  rank,
  highlight,
}: {
  item: ItemRow;
  verdict?: "up" | "down" | null;
  related?: { title: string; link: string; source: string }[];
  variant?: Variant;
  rank?: number;
  highlight?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  // 乐观状态：点击后立即变色，不等服务器往返；失败再回滚并提示。
  // 这里刻意不做 props→state 的同步：成功时本地状态与服务器结果一致，
  // 失败时回滚；跨设备的外部变更会在下一次整页加载时体现。
  const [localVerdict, setLocalVerdict] = useState(verdict);
  const [localStatus, setLocalStatus] = useState(item.status);
  const [error, setError] = useState("");
  // 删除是乐观的整卡消失：确认后立即不渲染，失败再恢复
  const [deleted, setDeleted] = useState(false);

  async function setStatus(status: "unread" | "read" | "later") {
    const prev = localStatus;
    setLocalStatus(status);
    setError("");
    try {
      const res = await fetch(`/api/items/${item.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      startTransition(() => router.refresh());
    } catch {
      setLocalStatus(prev);
      setError("操作失败，请重试");
    }
  }

  // 👍/👎：再点一次同一按钮表示撤销；点👎后条目会从首页隐藏（可在设置里关闭）
  async function sendFeedback(next: "up" | "down") {
    const prev = localVerdict;
    const nextVerdict = localVerdict === next ? null : next;
    setLocalVerdict(nextVerdict);
    setError("");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ link: item.link, verdict: nextVerdict }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      startTransition(() => router.refresh());
    } catch {
      setLocalVerdict(prev);
      setError("操作失败，请重试");
    }
  }

  // 删除这条：不可恢复（连同合并进来的重复报道一起删），所以必须确认。
  // 反馈记录保留——那是偏好学习的原料，不随条目消失。
  async function deleteItem() {
    if (!window.confirm(`删除「${title.slice(0, 30)}」？不可恢复，合并的重复报道会一起删。`)) return;
    setDeleted(true);
    setError("");
    try {
      const res = await fetch(`/api/items/${item.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      startTransition(() => router.refresh());
    } catch {
      setDeleted(false);
      setError("删除失败，请重试");
    }
  }

  if (deleted) return null;

  const isRead = localStatus === "read";
  const isLater = localStatus === "later";
  const title = item.zh_title ?? item.title;
  const hasPoints = Boolean(item.points);
  const isFeatured = variant === "featured";
  const isCompact = variant === "compact";

  // 点开标题（跳转原文）时自动标记已读，不必再单独点一次「已读」按钮。
  // 两条边界：
  //   · 已是「稍后读」的不动 —— 那是用户明确收藏的条目，不该被一次点击改掉；
  //   · 用 keepalive 发请求 —— 新标签页打开后本页可能转入后台，普通请求会被中断。
  function markReadOnOpen() {
    if (isRead || isLater) return;
    const prev = localStatus;
    setLocalStatus("read");
    void fetch(`/api/items/${item.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "read" }),
      keepalive: true,
    }).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      startTransition(() => router.refresh());
    }).catch(() => {
      setLocalStatus(prev);
      setError("标记已读失败");
    });
  }

  // 卡片空白处：就地展开「原文精简版」，不跳转、不新开标签。
  // 这也是「打开这条消息」，所以同样标记已读（规则与点标题一致）。
  function togglePoints() {
    if (!hasPoints) return;
    setOpen((v) => !v);
    if (!open) markReadOnOpen();
  }

  const articleClass = isFeatured
    ? "group flex h-full min-w-0 flex-col rounded-2xl border border-amber-200/70 bg-gradient-to-b from-amber-50/70 via-white to-white shadow-soft transition-shadow duration-200 hover:shadow-lift"
    : isCompact
      ? "group min-w-0 py-3.5 transition-colors"
      : "group min-w-0 rounded-2xl border border-line bg-white shadow-soft transition-shadow duration-200 hover:shadow-lift";

  return (
    <article
      onClick={togglePoints}
      className={`${articleClass} ${pending ? "opacity-60" : ""} ${
        hasPoints ? "cursor-pointer" : ""
      }`}
      title={hasPoints ? (open ? "点空白处收起精简版" : "点空白处读精简版，不用打开原网页") : undefined}
    >
      <div className={isCompact ? "min-w-0" : isFeatured ? "flex min-w-0 flex-1 flex-col p-5" : "min-w-0 p-4 sm:p-5"}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {isFeatured && rank ? (
                <span className="font-serif text-2xl font-semibold leading-none text-amber-600">
                  {String(rank).padStart(2, "0")}
                </span>
              ) : null}
              {item.tag ? (
                <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${tagTone(item.tag)}`}>
                  {item.tag}
                </span>
              ) : null}
              {isRead ? (
                <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10.5px] text-stone-500">已读</span>
              ) : null}
              {isLater ? (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] text-amber-700">稍后读</span>
              ) : null}
            </div>

            {/* 标题是独立跳转区；点它开原文，不触发展开 */}
            <a
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => { e.stopPropagation(); markReadOnOpen(); }}
              className={`block font-semibold tracking-tight transition-colors ${
                isFeatured
                  ? "mt-2 text-[17px] leading-snug hover:text-amber-800 sm:text-lg"
                  : isCompact
                    ? "mt-1.5 text-[14.5px] leading-6 hover:text-amber-800"
                    : "mt-2 text-[15.5px] leading-6 hover:text-amber-800"
              } ${isRead ? "text-stone-400 hover:text-stone-600" : "text-ink"}`}
            >
              {highlight ? <Highlighted text={title} q={highlight} /> : title}
            </a>

            {item.summary ? (
              <p
                className={
                  isCompact
                    ? "mt-1 line-clamp-2 text-[12.5px] leading-5 text-muted"
                    : `mt-1.5 text-[13.5px] leading-6 text-ink-soft ${isFeatured ? "sm:text-sm" : ""}`
                }
              >
                {highlight ? <Highlighted text={item.summary} q={highlight} /> : item.summary}
              </p>
            ) : null}

            {related.length > 0 ? (
              <div
                className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted"
                onClick={(e) => e.stopPropagation()}
              >
                <span className="font-medium text-stone-500">相关报道</span>
                {related.map((r, i) => (
                  <span key={r.link} className="inline-flex items-center gap-1.5">
                    {i > 0 ? <span className="text-line">·</span> : null}
                    <a
                      href={r.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 text-amber-700 underline decoration-amber-200 underline-offset-2 hover:decoration-amber-500"
                    >
                      {r.source}
                      <IconExternal className="h-3 w-3" />
                    </a>
                  </span>
                ))}
              </div>
            ) : null}

            {hasPoints ? (
              <button
                type="button"
                aria-expanded={open}
                onClick={(e) => { e.stopPropagation(); togglePoints(); }}
                className="mt-2 inline-flex items-center gap-1.5 rounded-full py-1 text-[11px] font-medium text-amber-700 transition-colors hover:text-amber-900"
              >
                <IconSparkles className="h-3.5 w-3.5" />
                {open ? "收起精简版" : "原文精简版 · 不打开网页也能读"}
                <IconChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
              </button>
            ) : null}

            {open && item.points ? (
              <div className="mt-2 rounded-xl border border-amber-200/70 bg-amber-50/60 px-3.5 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-700">
                  原文精简
                </p>
                {item.points.split("\n").filter(Boolean).map((line, i) => (
                  <p key={i} className="mt-2 text-[13px] leading-6 text-ink-soft first:mt-1.5">
                    {highlight ? <Highlighted text={line} q={highlight} /> : line}
                  </p>
                ))}
                <p className="mt-2.5 text-[10.5px] text-muted">
                  {item.body_chars ? `已处理全文 ${item.body_chars} 字` : ""}
                  {item.body_via ? ` · 来源 ${item.body_via}` : ""}
                  {item.points_reason ? ` · ${item.points_reason}` : ""}
                </p>
              </div>
            ) : null}
          </div>

          {item.score !== null && item.score !== undefined ? <ScoreBadge score={item.score} /> : null}
        </div>
      </div>

      <div
        className={
          isCompact
            ? "mt-2 flex flex-wrap items-center justify-between gap-2"
            : "flex flex-wrap items-center justify-between gap-2 border-t border-line/70 px-4 py-2.5 sm:px-5"
        }
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[10.5px] text-muted">
          <span className="truncate">{item.source}</span>
          {item.date ? (
            <>
              <span className="text-line">·</span>
              <span className="shrink-0">{formatDate(item.date)}</span>
            </>
          ) : null}
          {!isCompact && item.zh_title && item.zh_title !== item.title ? (
            <span className="hidden truncate text-stone-400 md:inline">
              · 原标题：{highlight ? <Highlighted text={item.title} q={highlight} /> : item.title}
            </span>
          ) : null}
          {error ? (
            <span className="shrink-0 text-rose-600" role="status" aria-live="polite">· {error}</span>
          ) : null}
        </span>

        {/* 按钮区阻止冒泡，避免点「已读/稍后读」时顺带展开 */}
        <div
          className="flex shrink-0 items-center gap-0.5"
          onClick={(e) => e.stopPropagation()}
        >
          <ActionIcon
            label="有用，多推这类"
            active={localVerdict === "up"}
            activeClass="border-emerald-200 bg-emerald-50 text-emerald-700"
            onClick={() => sendFeedback("up")}
          >
            <IconThumbsUp className="h-4 w-4" />
          </ActionIcon>
          <ActionIcon
            label="不感兴趣，少推这类"
            active={localVerdict === "down"}
            activeClass="border-rose-200 bg-rose-50 text-rose-700"
            onClick={() => sendFeedback("down")}
          >
            <IconThumbsDown className="h-4 w-4" />
          </ActionIcon>

          <span className="mx-0.5 h-4 w-px bg-line" />

          <button
            type="button"
            onClick={() => setStatus(isRead ? "unread" : "read")}
            title={isRead ? "撤销已读" : "标为已读"}
            aria-label={isRead ? "撤销已读" : "标为已读"}
            className={`grid h-10 w-10 place-items-center rounded-full transition-colors sm:h-8 sm:w-8 ${
              isRead ? "text-emerald-700 hover:bg-emerald-50" : "text-stone-400 hover:bg-paper-deep hover:text-ink"
            }`}
          >
            <IconCheck className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setStatus(isLater ? "unread" : "later")}
            title={isLater ? "取消稍后读" : "稍后读"}
            aria-label={isLater ? "取消稍后读" : "稍后读"}
            className={`grid h-10 w-10 place-items-center rounded-full transition-colors sm:h-8 sm:w-8 ${
              isLater ? "text-amber-700 hover:bg-amber-50" : "text-stone-400 hover:bg-paper-deep hover:text-ink"
            }`}
          >
            <IconBookmark className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={deleteItem}
            title="删除这条（不可恢复）"
            aria-label="删除这条"
            className="grid h-10 w-10 place-items-center rounded-full text-stone-400 transition-colors hover:bg-rose-50 hover:text-rose-600 sm:h-8 sm:w-8"
          >
            <IconTrash className="h-4 w-4" />
          </button>
        </div>
      </div>
    </article>
  );
}
