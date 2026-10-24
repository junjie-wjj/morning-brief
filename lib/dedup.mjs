// 多源去重的纯逻辑：让 LLM 找出「报道同一事件」的条目，合并成一条主条目。
// 只做数据变换，模型调用留在 brief.mjs，这样这里的规则可以直接被 node --test 覆盖。

const MAX_RELATED = 5;

/** 标题归一化：小写、去空白与标点。中英文标题都适用。 */
export function normalizeTitle(t) {
  return String(t ?? '').toLowerCase().replace(/[\s\p{P}]+/gu, '');
}

/** 标题词元集合：英文/数字词（≥3 字符）+ 中文相邻二字组合 */
function titleTokens(t) {
  const s = String(t ?? '').toLowerCase();
  const latin = s.match(/[a-z0-9][a-z0-9.]{2,}/g) ?? [];
  const cjk = [];
  for (const w of s.match(/[\u4e00-\u9fff]{2,}/g) ?? []) {
    for (let i = 0; i + 1 < w.length; i++) cjk.push(w.slice(i, i + 2));
  }
  return new Set([...latin, ...cjk]);
}

/**
 * 标题亲和度：两个标题至少共享一个词元才算「可能报道同一件事」。
 * 任一侧没有词元（空标题/纯符号）时视为无法判断，返回 true 交由其他规则。
 */
function sharesAffinity(a, b) {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (ta.size === 0 || tb.size === 0) return true;
  for (const x of ta) if (tb.has(x)) return true;
  return false;
}

/** 主条目选择：评分最高；同分取更早报道 */
function pickPrimary(candidates) {
  return candidates.reduce((best, cur) => {
    const bs = best.en?.score ?? 0;
    const cs = cur.en?.score ?? 0;
    if (cs !== bs) return cs > bs ? cur : best;
    const bd = best.date?.getTime?.() ?? Number.MAX_SAFE_INTEGER;
    const cd = cur.date?.getTime?.() ?? Number.MAX_SAFE_INTEGER;
    return cd < bd ? cur : best;
  });
}

/**
 * 纯逻辑预合并：不同来源、归一化标题完全一致的条目直接视为同一报道。
 * 兜住 LLM 限流降级/漏判时的明显重复（如同一篇官方文章被博客与 HN 同时收录）。
 * 原始标题与中文标题各查一遍（有的条目只在其中一个上重合）。
 * 与 LLM 分组同规则：只跨来源合并，同源多条视为独立更新。
 * @param {object[]} items dedupeNews 的 news 数组（含 en）
 * @returns {number[][]} 分组（下标数组），与 LLM 分组拼接后交给 applyDedupe
 */
export function exactTitleGroups(items) {
  const byTitle = new Map();
  for (let i = 0; i < items.length; i++) {
    for (const t of [items[i].title, items[i].en?.zh]) {
      const key = normalizeTitle(t);
      if (!key) continue;
      if (!byTitle.has(key)) byTitle.set(key, []);
      byTitle.get(key).push(i);
    }
  }
  const groups = [];
  const used = new Set();
  for (const idxs of byTitle.values()) {
    const uniq = [...new Set(idxs)];
    if (uniq.length < 2) continue;
    if (new Set(uniq.map((n) => items[n].source)).size < 2) continue;
    if (uniq.some((n) => used.has(n))) continue;
    uniq.forEach((n) => used.add(n));
    groups.push(uniq);
  }
  return groups;
}

/** 生成去重提示词；条目用序号引用，模型只返回分组 */
export function buildDedupePrompt(items) {
  const listing = JSON.stringify(items.map((it, i) => ({
    i,
    src: it.source,
    title: it.en?.zh ?? it.title,
    summary: it.en?.summary ?? '',
  })));
  return `下面是今日 AI 资讯条目。请找出「报道同一事件」的条目并分组。
判定标准：同一产品/公司的同一次发布、同一篇论文、同一起事件；仅仅是同一主题不算。
只合并来自不同来源的条目；同一来源的多条是各自独立的更新（例如同一仓库的多个 commit），禁止分组。
每组中每个来源最多出现一条；一组里只要有两个条目来自同一来源，整组作废。
不要合并不同产品的同类更新，也不要合并观点文章与事实报道。
条目：${listing}
只输出 JSON：{"groups":[[0,3,7],[2,5]]}；没有重复就输出 {"groups":[]}。不要输出其他文字。`;
}

/**
 * 应用 LLM 给出的分组。
 * - 非法序号、重复序号、少于 2 条的组会被忽略
 * - 组内同一来源出现多次时忽略（同源多条是独立更新，不是重复报道）
 * - 组内成员与主条目标题必须共享至少一个词元：弱模型偶尔会把毫不相干的
 *   条目编成一组（如 HN 讨论帖 × 仓库 commit），零词元关联的组直接作废
 * - 同一序号只归入第一个组
 * - 每组保留评分最高者为主条目（同分取更早），其余标记 dupOf 并挂到主条目的 related
 * @returns {{items: object[], merged: number}}
 */
export function applyDedupe(items, rawGroups) {
  const used = new Set();
  const groups = [];

  for (const raw of rawGroups ?? []) {
    if (!Array.isArray(raw)) continue;
    const idx = [...new Set(raw.filter((n) => Number.isInteger(n) && n >= 0 && n < items.length))];
    if (idx.length < 2) continue;
    if (new Set(idx.map((n) => items[n].source)).size !== idx.length) continue; // 同一来源最多一条
    if (idx.some((n) => used.has(n))) continue; // 与前面的组重叠：跳过，避免一条进两组
    const primary = pickPrimary(idx.map((n) => items[n]));
    // 标题亲和度防线：主条目是合并后的门面，所有成员都得和它对得上
    const primaryTitle = primary.en?.zh ?? primary.title;
    if (idx.some((n) => {
      const it = items[n];
      return it.link !== primary.link && !sharesAffinity(primaryTitle, it.en?.zh ?? it.title);
    })) continue;
    idx.forEach((n) => used.add(n));
    groups.push(idx);
  }

  const out = items.map((it) => ({ ...it }));
  let merged = 0;

  for (const idx of groups) {
    const candidates = idx.map((n) => out[n]);
    const primary = pickPrimary(candidates);

    const related = candidates
      .filter((it) => it.link !== primary.link)
      .slice(0, MAX_RELATED)
      .map((it) => ({ title: it.en?.zh ?? it.title, link: it.link, source: it.source }));

    primary.related = related;
    for (const it of candidates) {
      if (it.link !== primary.link) it.dupOf = primary.link;
    }
    merged++;
  }

  return { items: out, merged };
}
