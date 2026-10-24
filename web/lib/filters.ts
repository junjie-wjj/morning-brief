import type { ItemRow, PreferenceStats, Settings, Verdict } from "./db";

export interface FilterContext {
  settings: Settings;
  feedback: Map<string, Verdict>;
  stats: PreferenceStats;
}

// 基础筛选（不含兴趣分阈值）：屏蔽词、已读、点踩、分类、来源、产品关注清单
export function passesFilters(item: ItemRow, ctx: FilterContext): boolean {
  const { settings, feedback } = ctx;

  if (settings.hideDownvoted && feedback.get(item.link) === "down") return false;
  if (settings.unreadOnly && item.status !== "unread") return false;

  if (settings.blockedKeywords.length > 0) {
    // 大小写不敏感：用户习惯填小写（如 kimi），标题里却是 Kimi/KIMI，先统一小写再比
    const text = `${item.zh_title ?? ""} ${item.title}`.toLowerCase();
    if (settings.blockedKeywords.some((k) => k && text.includes(k.toLowerCase()))) return false;
  }

  if (item.product) {
    // 产品条目只受「关注清单」约束，不参与分类/来源/兴趣分过滤
    return !settings.products || settings.products.includes(item.product);
  }

  if (settings.tags && !settings.tags.includes(item.tag ?? "其他")) return false;
  if (settings.sources && !settings.sources.includes(item.source)) return false;
  return true;
}

/** 低于兴趣分下限的资讯：不直接丢弃，收进折叠区 */
export function isBelowMinScore(item: ItemRow, settings: Settings): boolean {
  return !item.product && item.score !== null && item.score < settings.minScore;
}

/** 个性化排序分：原始兴趣分 + 分类/来源偏好 + 单条反馈 */
export function rankScore(item: ItemRow, ctx: FilterContext): number {
  const verdict = ctx.feedback.get(item.link);
  return (item.score ?? 3)
    + (item.tag ? (ctx.stats.tagBias.get(item.tag) ?? 0) : 0)
    + (ctx.stats.sourceBias.get(item.source) ?? 0)
    + (verdict === "up" ? 1.5 : verdict === "down" ? -3 : 0);
}

export function sortByRank(items: ItemRow[], ctx: FilterContext): ItemRow[] {
  return [...items].sort((a, b) =>
    rankScore(b, ctx) - rankScore(a, ctx)
    || (b.date ?? "").localeCompare(a.date ?? "")
    || b.id - a.id,
  );
}
