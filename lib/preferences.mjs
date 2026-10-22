// 偏好搜索的纯逻辑：把反馈统计变成「值得加进搜索的词」。
// 只做数据变换，不读数据库、不发请求，方便直接用 node --test 覆盖。

// 分类 → 搜索词 + 标题匹配规则。只映射那些「当成关键词搜」真的有用的分类；
// 产品动态/行业动态/其他太宽泛，搜出来全是噪音，不映射。
// match 是标题必须命中的正则：搜索引擎会做模糊匹配，不加这层会混进完全无关的帖子。
export const TAG_SEARCH_QUERIES = {
  福利资源: { query: 'free LLM API', match: 'free|免费|api|token|额度' },
  模型发布: { query: 'new AI model', match: 'ai model|模型|release|发布|开源|llm' },
  研究进展: { query: 'AI research paper', match: 'paper|论文|research|研究|benchmark' },
};

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 从反馈统计里挑出搜索词。
 * - 净赞（赞 - 踩）达到 minNet 才启用，避免一两次点击就改变搜索
 * - 产品名优先，其次是有映射的分类
 * - 同一个词只保留一条；按净赞、赞数排序，最多 maxTerms 条
 *
 * @param {{products?: {name: string, up?: number, down?: number}[],
 *          tags?: {tag: string, up?: number, down?: number}[]}} stats
 * @returns {{term: string, kind: 'product'|'tag', label: string, match: string,
 *            net: number, up: number, down: number}[]}
 */
export function selectSearchTerms(stats, { maxTerms = 5, minNet = 2 } = {}) {
  const candidates = [];

  for (const p of stats?.products ?? []) {
    const name = typeof p?.name === 'string' ? p.name.trim() : '';
    if (!name) continue;
    const up = Number(p.up) || 0;
    const down = Number(p.down) || 0;
    const net = up - down;
    if (net < minNet) continue;
    candidates.push({
      term: name, kind: 'product', label: name, match: escapeRegExp(name), net, up, down,
    });
  }

  for (const t of stats?.tags ?? []) {
    const tag = typeof t?.tag === 'string' ? t.tag.trim() : '';
    const mapping = TAG_SEARCH_QUERIES[tag];
    if (!mapping) continue;
    const up = Number(t.up) || 0;
    const down = Number(t.down) || 0;
    const net = up - down;
    if (net < minNet) continue;
    candidates.push({
      term: mapping.query, kind: 'tag', label: tag, match: mapping.match, net, up, down,
    });
  }

  const byTerm = new Map();
  for (const c of candidates) {
    const key = c.term.toLowerCase();
    const prev = byTerm.get(key);
    if (!prev || c.net > prev.net || (c.net === prev.net && c.up > prev.up)) {
      byTerm.set(key, c);
    }
  }

  return [...byTerm.values()]
    .sort((a, b) => b.net - a.net || b.up - a.up || a.term.localeCompare(b.term))
    .slice(0, Math.max(0, maxTerms));
}
