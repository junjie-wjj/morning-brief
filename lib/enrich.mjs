// AI 加工批次的「键绑定」纯逻辑：条目用不透明短键引用，模型必须原样回显才能绑定。
// 背景：编号(i:0,1,2…)在弱模型/长列表上会发生错位漂移，曾把 Kimi 的标题
// 错绑到同批一条音乐视频帖上；换成与顺序无关的链接哈希键后，
// 模型即使漏答/乱序也不会把 A 的标题安到 B 头上。

/** 由链接生成 6 位不透明短键（同一批内稳定，跨批次也无碰撞风险地可用） */
export function itemKey(link) {
  let h = 0;
  for (let i = 0; i < link.length; i++) h = (h * 31 + link.charCodeAt(i)) >>> 0;
  return h.toString(36).padStart(6, '0').slice(-6);
}

/**
 * 把模型回显的 {"items":[{"k":"..","zh":"..","s":"..","tag":"..","score":n}]}
 * 绑定回 chunk 里的条目。规则：
 * - k 必须原样匹配某个条目的键，否则丢弃该条（宁缺勿错）
 * - zh 必须非空字符串；score 夹到 1-5；tag 缺省「其他」
 * @returns {Map<string, {zh:string, summary:string, tag:string, score:number}>} link -> 字段
 */
export function applyEnrichResponse(parsed, chunk) {
  const byKey = new Map(chunk.map((it) => [itemKey(it.link), it]));
  const out = new Map();
  for (const e of parsed?.items ?? []) {
    const it = typeof e?.k === 'string' ? byKey.get(e.k) : undefined;
    if (!it) continue;
    if (typeof e.zh !== 'string' || !e.zh.trim()) continue;
    out.set(it.link, {
      zh: e.zh.trim(),
      summary: typeof e.s === 'string' ? e.s.trim() : '',
      tag: typeof e.tag === 'string' && e.tag.trim() ? e.tag.trim() : '其他',
      score: Math.max(1, Math.min(5, Math.round(Number(e.score)) || 1)),
    });
  }
  return out;
}
