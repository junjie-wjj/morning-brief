// 「关注方向」开关的纯逻辑：设置页勾选 → 每晚导出 → 流水线按勾选过滤固定搜索。
// 标签与 brief.mjs 的 FIXED_SEARCH_TERMS / OpenRouter 源保持一致
// （web/lib/db.ts 的 WATCH_TOPICS 是同一份名单的 TS 侧镜像）。

/** 全部可选的关注方向（label 与固定搜索/OpenRouter 源一一对应） */
export const WATCH_TOPICS = ['免费额度', '榜单动态', 'MCP/插件/技能', '价格变动', 'OpenRouter 免费模型'];

/**
 * 按用户勾选过滤固定搜索词。
 * @param {Array<{term:string,label:string,match:string}>} terms 固定搜索词表
 * @param {string[] | null} watchTopics null = 全部启用；数组 = 只保留勾选的
 * @returns 过滤后的词表（未知标签忽略，容错手改数据）
 */
export function filterFixedTerms(terms, watchTopics) {
  if (!Array.isArray(watchTopics) || watchTopics.length === 0) return terms;
  const on = new Set(watchTopics);
  return terms.filter((t) => on.has(t.label));
}

/** OpenRouter 免费模型监控是否启用 */
export function watchOpenRouter(watchTopics) {
  if (!Array.isArray(watchTopics) || watchTopics.length === 0) return true;
  return watchTopics.includes('OpenRouter 免费模型');
}
