// 产品追踪的纯逻辑：把各来源的原始数据转成统一条目。
// 只做数据变换，不做网络请求——抓取器留在 brief.mjs，这样这些函数可以直接被 node --test 覆盖。

const DAY_MS = 86_400_000;

/** 从 Bing 新闻的跳转链接里取出原始文章地址（取不到就原样返回） */
export function extractOriginalUrl(link) {
  const m = String(link).match(/[?&]url=([^&]+)/);
  if (!m) return link;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return link;
  }
}

// HF 模型名里带这些词的，多为量化/转换副本（同一模型的不同精度版本），不是新模型发布
const MODEL_NOISE = /(bf16|fp16|fp8|fp4|gguf|awq|gptq|int4|int8|w4a16|w8a8|quant|mlx|onnx)/i;

/** Hugging Face API 返回的模型 → 统一条目；过滤量化副本与窗口外的旧模型 */
export function mapHfModels(models, { product, days = 14, max = 2, now = Date.now() } = {}) {
  return (Array.isArray(models) ? models : [])
    .filter((m) => m && typeof m.id === 'string')
    .filter((m) => !MODEL_NOISE.test(m.id.split('/').pop()))
    .map((m) => ({ m, date: new Date(m.lastModified) }))
    .filter(({ date }) => !Number.isNaN(date.getTime()) && now - date.getTime() <= days * DAY_MS)
    .sort((a, b) => b.date - a.date)
    .slice(0, max)
    .map(({ m, date }) => ({
      title: `新模型 ${m.id}`,
      link: `https://huggingface.co/${m.id}`,
      date,
      product,
      source: `${product} · Hugging Face`,
    }));
}

/** GitHub Releases Atom 的条目 → 统一条目；跳过预发布版本与窗口外的旧版本 */
export function mapReleaseItems(items, { product, label, days = 14, max = 2, now = Date.now() } = {}) {
  return (Array.isArray(items) ? items : [])
    .filter((it) => it && it.title && it.link)
    .filter((it) => !/\b(alpha|beta|rc|preview|canary|nightly)\b/i.test(it.title))
    .map((it) => ({ it, date: it.date ?? null }))
    .filter(({ date }) => date && now - date.getTime() <= days * DAY_MS)
    .sort((a, b) => b.date - a.date)
    .slice(0, max)
    .map(({ it, date }) => ({
      title: `${label ? `${label} ` : ''}${it.title}`,
      link: it.link,
      date,
      product,
      source: `${product} · GitHub 发布`,
    }));
}

/** 关键词新闻搜索结果 → 统一条目（链接还原成原文地址）。
 *  传入 keyword 时只保留标题真的包含它的条目——搜索引擎的模糊匹配经常带回无关新闻。 */
export function mapNewsItems(items, { product, keyword, days = 7, max = 2, now = Date.now() } = {}) {
  const kw = String(keyword ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = kw ? new RegExp(kw, 'i') : null;
  return (Array.isArray(items) ? items : [])
    .filter((it) => it && it.title && it.link)
    .filter((it) => !re || re.test(it.title))
    .map((it) => ({ it, date: it.date ? new Date(it.date) : null }))
    .filter(({ date }) => date && !Number.isNaN(date.getTime()) && now - date.getTime() <= days * DAY_MS)
    .slice(0, max)
    .map(({ it, date }) => ({
      title: it.title,
      link: extractOriginalUrl(it.link),
      date,
      product,
      source: `新闻搜索 · ${product}`,
    }));
}

/**
 * Hacker News 搜索命中 → 统一条目。
 * 用于没有官方渠道的产品（如 Cursor）：社区讨论往往比媒体报道更快。
 * 只保留标题里真的含关键词的条目，避免 Algolia 的模糊匹配噪音。
 */
export function mapHnHits(hits, { product, keyword, days = 14, max = 2, now = Date.now() } = {}) {
  const kw = String(keyword ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = kw ? new RegExp(kw, 'i') : null;
  return (Array.isArray(hits) ? hits : [])
    .filter((h) => h && h.title)
    .filter((h) => !re || re.test(h.title))
    .map((h) => ({ h, date: new Date((h.created_at_i ?? 0) * 1000) }))
    .filter(({ date }) => !Number.isNaN(date.getTime()) && now - date.getTime() <= days * DAY_MS)
    .sort((a, b) => b.date - a.date)
    .slice(0, max)
    .map(({ h, date }) => ({
      title: h.title,
      link: h.url ?? `https://news.ycombinator.com/item?id=${h.object_id}`,
      date,
      product,
      source: `Hacker News · ${product}`,
    }));
}

/** 按链接去重，保留先出现的（调用方先放产品追踪，再放资讯，实现优先级） */
export function dedupeByLink(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (!it?.link || seen.has(it.link)) continue;
    seen.add(it.link);
    out.push(it);
  }
  return out;
}
