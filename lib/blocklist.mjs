// 抓取侧丢弃的纯逻辑：屏蔽词「彻底不抓」与「低分不入库」。
// 只做数据变换，不发请求，node --test 直接覆盖。
// 注意：这一层的丢弃是不可恢复的（条目不会入库），调用方必须只在用户
// 明确选择的模式下启用，并在日志里如实报数。

/** 大小写不敏感的标题命中（与 web/lib/filters.ts 的展示层屏蔽同一口径） */
function titleHits(item, keywords) {
  const text = `${item.title ?? ''}`.toLowerCase();
  return keywords.some((k) => k && text.includes(k.toLowerCase()));
}

/**
 * 屏蔽词「彻底不抓」：抓取后、AI 加工前直接丢弃标题命中的条目。
 * 只能匹配原始标题（此时还没有中文标题）——这是该模式的技术边界，
 * 设置页的说明文字要如实标注。
 * @returns {{kept: object[], dropped: object[]}}
 */
export function dropBlockedItems(items, keywords) {
  const list = Array.isArray(keywords)
    ? keywords.filter((k) => typeof k === 'string' && k.trim())
    : [];
  if (!list.length) return { kept: items, dropped: [] };
  const kept = [];
  const dropped = [];
  for (const it of items) {
    (titleHits(it, list) ? dropped : kept).push(it);
  }
  return { kept, dropped };
}

/**
 * 「低分不入库」：AI 加工后，兴趣分 ≤ threshold 的资讯直接不入库。
 * - 产品条目豁免：关注清单是用户主动订阅的第一手动态，分数低也保留；
 * - 没加工出分数（null）的条目豁免：未知 ≠ 垃圾，降级日不能误杀。
 * @param {object[]} items
 * @param {Map<string, {score:number}>} enriched link → 加工结果
 * @returns {{kept: object[], dropped: object[]}}
 */
export function dropLowScoreItems(items, enriched, threshold = 2) {
  const kept = [];
  const dropped = [];
  for (const it of items) {
    if (it.product) { kept.push(it); continue; }
    const en = enriched?.get?.(it.link);
    if (en && Number.isFinite(en.score) && en.score <= threshold) dropped.push(it);
    else kept.push(it);
  }
  return { kept, dropped };
}

// 特定分类的入库分数门槛：用户确认「研究进展」类内容只有 AI 打分 ≥4 才入库——
// 低分论文直接丢弃省 token，但 4 分以上的研究类工具情报（如「智谱开源 ZCode」）保留。
const TAG_MIN_SCORE = { 研究进展: 4 };

/**
 * 按分类分数门槛丢弃：tag 命中规则且 score < 门槛的资讯不入库。
 * 产品条目与没加工出分/分类的条目豁免（与 dropLowScoreItems 同口径）。
 * @param {Record<string, number>} rules tag → 最低入库分
 * @returns {{kept: object[], dropped: object[]}}
 */
export function dropByTagScoreRules(items, enriched, rules = TAG_MIN_SCORE) {
  const kept = [];
  const dropped = [];
  for (const it of items) {
    if (it.product) { kept.push(it); continue; }
    const en = enriched?.get?.(it.link);
    const min = en ? rules[en.tag] : undefined;
    if (min !== undefined && Number.isFinite(en.score) && en.score < min) dropped.push(it);
    else kept.push(it);
  }
  return { kept, dropped };
}
