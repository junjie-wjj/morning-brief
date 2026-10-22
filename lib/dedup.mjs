// 多源去重的纯逻辑：让 LLM 找出「报道同一事件」的条目，合并成一条主条目。
// 只做数据变换，模型调用留在 brief.mjs，这样这里的规则可以直接被 node --test 覆盖。

const MAX_RELATED = 5;

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
    idx.forEach((n) => used.add(n));
    groups.push(idx);
  }

  const out = items.map((it) => ({ ...it }));
  let merged = 0;

  for (const idx of groups) {
    const candidates = idx.map((n) => out[n]);
    const primary = candidates.reduce((best, cur) => {
      const bs = best.en?.score ?? 0;
      const cs = cur.en?.score ?? 0;
      if (cs !== bs) return cs > bs ? cur : best;
      const bd = best.date?.getTime?.() ?? Number.MAX_SAFE_INTEGER;
      const cd = cur.date?.getTime?.() ?? Number.MAX_SAFE_INTEGER;
      return cd < bd ? cur : best; // 同分取更早报道
    });

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
