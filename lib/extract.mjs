// 把长正文切段，供「分段抽取再合并」使用。
//
// 为什么必须分段：一次性把 8000 字塞给模型，长文中段的信息最容易丢。
// 分段后逐段抽取、每段都必填固定字段，覆盖才是均匀的——这是「关键信息不漏」
// 的结构性保证，而不是指望模型自觉。
//
// 硬要求：分段必须无损（拼回来 === 原文）。丢字就是丢信息，直接违背诉求。

const MIN_CHUNK = 200;      // 小于这个长度就不必再切
const SENTENCE_END = /[。！？!?；;]/;

/**
 * 把文本切成不超过 maxChars 的若干段。
 * 优先在句末标点处断开；找不到标点时按长度硬切，但仍保证不丢字。
 */
export function splitIntoChunks(text, maxChars = 2000) {
  const src = text ?? '';
  if (!src.trim()) return [];
  if (src.length <= maxChars) return [src];

  const chunks = [];
  let rest = src;

  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    // 在窗口内从后往前找最后一个句末标点，尽量不劈开句子
    let cut = -1;
    for (let i = window.length - 1; i >= Math.floor(maxChars * 0.5); i--) {
      if (SENTENCE_END.test(window[i])) { cut = i + 1; break; }
    }
    if (cut <= 0) cut = maxChars; // 整段没有标点：硬切
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }

  if (rest.length > 0) {
    // 尾段太短就并入上一段，避免产生无意义的碎片
    if (rest.length < MIN_CHUNK && chunks.length > 0) chunks[chunks.length - 1] += rest;
    else chunks.push(rest);
  }

  return chunks;
}

// ---------- 分段抽取：提示词与合并 ----------

/**
 * 构造「抽取这一段」的提示词。
 * 固定字段是关键：自由总结每次覆盖到什么全看运气，固定字段能让每段都被同等对待，
 * 尤其是 numbers —— 数字是摘要里最容易丢、又最要紧的东西。
 */
export function buildExtractPrompt(chunk, { index = 1, total = 1, title = '' } = {}) {
  const titleLine = title ? `\n这篇文章的标题是：《${title}》。只抽取与这篇文章主题相关的内容。\n` : '';
  return `你在为一份中文科技简报做资料抽取。下面是第 ${index} 段（共 ${total} 段）的原文。
${titleLine}
要求：
- **用中文输出**（专有名词、产品名、人名保留英文，如 GPT、Claude、Apple）
- 只依据这段原文，不要补充外部知识，不要推测
- 只抽取与本文主题相关的内容；网页里夹带的**其它文章标题、推荐阅读、侧栏链接、广告、导航菜单一律忽略**
- 这一段里出现的关键信息都要抽出来，不要因为"看起来次要"就省略
- 同一件事拆成好几条时要**合并成一条**，不要写成流水账
- 忽略作者署名、发布日期、"某媒体报道了这条新闻"这类元信息，读者不需要
- 输出纯 JSON，字段齐全：
  - facts：字符串数组，这段里的事实要点，**最多 6 条**，每条一句话、信息密度高
  - numbers：字符串数组，这段里出现的具体数字/版本号/金额/百分比（没有就给空数组）
  - risks：字符串数组，这段提到的限制、风险、争议（没有就给空数组）
  - conclusion：这段的核心结论，一句话（这段没有明确结论就给空串）

原文：
${chunk}

只输出 JSON，格式：{"facts":[],"numbers":[],"risks":[],"conclusion":""}`;
}

const asArray = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : []);

/**
 * 合并各段的抽取结果。
 * 逐段抽取保证「全文都被读过」，合并负责把它们拼成一份不重复的要点。
 */
export function mergeExtracts(parts) {
  const out = { facts: [], numbers: [], risks: [], conclusion: '' };
  const seen = { facts: new Set(), numbers: new Set(), risks: new Set() };

  for (const p of parts ?? []) {
    if (!p || typeof p !== 'object') continue;
    for (const key of ['facts', 'numbers', 'risks']) {
      for (const item of asArray(p[key])) {
        const k = item.trim();
        if (seen[key].has(k)) continue;
        seen[key].add(k);
        out[key].push(k);
      }
    }
    // 结论取第一个非空的：通常是首段的总述，比末段的收尾更有代表性
    if (!out.conclusion && typeof p.conclusion === 'string' && p.conclusion.trim()) {
      out.conclusion = p.conclusion.trim();
    }
  }
  return out;
}

/** 把要点渲染成可读的多行文本（存库与页面展示共用） */
export function formatPoints(points) {
  if (!points) return '';
  const lines = [];
  if (points.conclusion) lines.push(`结论：${points.conclusion}`);
  for (const f of asArray(points.facts)) lines.push(`· ${f}`);
  if (asArray(points.numbers).length) lines.push(`数字：${points.numbers.join('；')}`);
  if (asArray(points.risks).length) lines.push(`风险：${points.risks.join('；')}`);
  return lines.join('\n');
}
