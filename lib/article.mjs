// 把网页 HTML 变成干净的正文文本，并在直抓失败时按需降级。
//
// 为什么需要它：抓取阶段只能拿到标题；要生成「原文精简版」必须先把正文取回来。
// 实测各源情况差别很大（2026-10-14 实测）：
//   · OpenAI 官方  直抓 403        → 走 Jina Reader 可拿到
//   · 量子位       直抓连接超时     → 走 Jina Reader 可拿到
//   · Reddit       直抓只有 6 个字  → 走单帖 .rss 可拿到 6499 字
//   · Reuters      直抓 401        → 付费墙，拿不到（如实标注）
// 因此顺序是：直抓 → 无效则 Reddit .rss → 无效则 Jina Reader → 放弃并说明原因。

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) morning-brief-v0';
const DIRECT_TIMEOUT = 20_000;
const PROXY_TIMEOUT = 30_000;

// 正文短于这个长度就认为没抓到（Reddit 的 JS 壳只有 6 个字）
const MIN_BODY_CHARS = 200;

// 明显是拦截/拒绝页的特征
const BLOCK_PATTERNS = [
  /^access denied/i, /^forbidden/i, /^just a moment/i, /^attention required/i,
  /^enable javascript/i, /^are you a robot/i, /^请开启\s*javascript/i,
];

/** 把 HTML 转成纯文本：剔除脚本/样式/导航/页脚，解开实体，折叠空白 */
export function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<form[\s\S]*?<\/form>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    // 块级标签结束处保留换行：trimBoilerplate 依赖按行判断，
    // 全部折叠成空格会让它无从下手（实测导航会被当成正文）。
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote|pre)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())  // 行内空白折叠
    .filter(Boolean)
    .join('\n');
}

/** 这段文本像不像一篇真正的文章正文？ */
export function looksLikeArticle(text) {
  const t = (text ?? '').trim();
  if (t.length < MIN_BODY_CHARS) return false;
  return !BLOCK_PATTERNS.some((re) => re.test(t));
}

// 页面里夹带的、与正文无关的整行内容。
// 实测 TechCrunch 的正文里混着侧栏推荐文章标题，会被模型当成正文抽出来——
// 错误内容比缺失内容更糟，所以在送进 LLM 之前就尽量剔掉。
//
// 注意：中英文要分开写。JS 正则里 \b 只认 ASCII 单词字符，中文之间没有 \b，
// 写成 ^(分享|广告)\b 会永远匹配不上。
const BOILERPLATE_LINE = new RegExp(
  [
    // 英文行首关键词（用 \b 收尾是安全的，后面通常接空格或标点）
    '^(share|tweet|advertisement|advert|sponsored|sign up|subscribe|newsletter|read more|related|recommended|more from|trending|follow us|copyright|terms|privacy|all rights reserved)\\b',
    // 中文行首关键词（不加 \b）
    '^(分享|推荐阅读|相关阅读|热门推荐|广告|订阅|关注我们|版权|免责声明|转载请注明|编辑|来源)',
    // "5 min read" / "5 分钟阅读"
    '^\\d+\\s*(min read|分钟阅读)$',
  ].join('|'),
  'i',
);

/**
 * 去掉整行的样板内容（导航、推荐、版权等）。
 * 只在能按行判断时才动；纯单行文本原样返回，避免误删正文。
 */
export function trimBoilerplate(text) {
  const t = (text ?? '').trim();
  if (!t || !t.includes('\n')) return t;
  const kept = t.split('\n').filter((line) => {
    const s = line.trim();
    if (!s) return false;
    return !BOILERPLATE_LINE.test(s);
  });
  return kept.join('\n').trim();
}

/** 从 Reddit 单帖 RSS 里取正文（content 字段，HTML 转义后再清洗） */
export function parseRedditRss(xml) {
  const raw = xml?.match(/<content[^>]*>([\s\S]*?)<\/content>/)?.[1]
    ?? xml?.match(/<description[^>]*>([\s\S]*?)<\/description>/)?.[1];
  if (!raw) return '';
  // RSS 里的正文是「转义后的 HTML」（&lt;div&gt;…）。必须先解开实体再剥标签，
  // 顺序反了就会把 &lt;div&gt; 当成普通文字留在正文里。
  const unescaped = raw
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/gi, '&');
  return stripHtml(unescaped);
}

/**
 * 清理 Markdown 噪音。
 * Jina Reader 返回的是 Markdown，实测导航长这样：
 *   `* [Business](https://openai.com/business/)`
 * 这些纯链接行会被模型当成正文，抽出「OpenAI 提供 API Platform、Docs 等信息」这类废话。
 * 策略：整行都是链接/图片/裸 URL 的丢掉；行内的链接保留文字、去掉 URL。
 */
export function cleanMarkdown(text) {
  const t = (text ?? '').trim();
  if (!t) return '';
  return t
    .split('\n')
    .map((line) => {
      const raw = line.trim();
      if (!raw) return '';

      // 先判断「整行就是一个链接/图片」——必须在解包之前判断，
      // 否则 [Log in](url) 解包成 "Log in" 之后就认不出来了。
      const bare = raw.replace(/^[*+-]\s+/, '').trim();
      if (/^!?\[[^\]]*\]\([^)]*\)$/.test(bare)) return '';
      if (/^https?:\/\/\S+$/i.test(bare)) return '';

      let s = raw;
      s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '');      // 图片整体丢掉
      s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');   // 行内链接保留文字
      s = s.replace(/^#{1,6}\s*/, '').replace(/^>\s*/, '').replace(/^[*+-]\s+/, '');
      s = s.replace(/\*\*|__|`/g, '');                 // 强调符号
      return s.trim();
    })
    .filter((s) => {
      if (!s) return false;
      if (/^https?:\/\/\S+$/i.test(s)) return false;
      if (/^\S+@\S+\.\S+$/.test(s)) return false;
      if (/^[\s\-–—|·•>*#]+$/.test(s)) return false;
      return true;
    })
    .join('\n')
    .trim();
}

/**
 * 去掉 Jina Reader 的包装头。
 * Jina 返回的是 "Title: …\n\nURL Source: …\n\nMarkdown Content:\n…"，
 * 这层包装会被模型当成正文，实测导致抽取出「文章来源为 OpenAI」这类空话。
 */
export function stripJinaWrapper(text) {
  let t = (text ?? '').trim();
  if (!t) return '';
  // 先砍掉 "Markdown Content:" 之前的所有包装行
  const marker = t.indexOf('Markdown Content:');
  if (marker >= 0) t = t.slice(marker + 'Markdown Content:'.length);
  // 再逐行剔除残留的 Title:/URL Source: 行
  return t
    .split('\n')
    .filter((line) => !/^\s*(Title|URL Source|Published Time|Markdown Content)\s*:/i.test(line))
    .join('\n')
    .trim();
}

async function fetchText(url, timeout) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml,*/*' },
    signal: AbortSignal.timeout(timeout),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const isReddit = (url) => /^https?:\/\/(www\.|old\.)?reddit\.com\//i.test(url);

/**
 * 取一篇文章的正文。
 * 返回 { body, chars, via } —— via 说明正文是怎么来的，抓不到时为 null 并带 reason。
 * 永不抛错：抓不到是常态（付费墙/JS 渲染），由调用方决定怎么标注。
 */
export async function fetchArticleBody(url) {
  // ① 直抓
  try {
    const html = await fetchText(url, DIRECT_TIMEOUT);
    const body = stripHtml(html);
    if (looksLikeArticle(body)) return { body, chars: body.length, via: 'direct' };
  } catch { /* 落到下一级 */ }

  // ② Reddit 走单帖 .rss（直抓只有 JS 壳）
  if (isReddit(url)) {
    try {
      const rssUrl = url.replace(/\/+$/, '') + '/.rss';
      const body = parseRedditRss(await fetchText(rssUrl, DIRECT_TIMEOUT));
      if (looksLikeArticle(body)) return { body, chars: body.length, via: 'reddit-rss' };
    } catch { /* 落到下一级 */ }
  }

  // ③ Jina Reader 代理（免费、无需 key），解决 403 与地区性超时。
  //    实测同一 URL 会时好时坏（一次 4732 字、一次直接失败），所以重试一次。
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await fetchText(`https://r.jina.ai/${url}`, PROXY_TIMEOUT);
      const body = cleanMarkdown(stripJinaWrapper(raw));
      if (looksLikeArticle(body)) return { body, chars: body.length, via: 'jina' };
    } catch { /* 再试一次 */ }
    if (attempt === 1) await new Promise((r) => setTimeout(r, 2000));
  }

  return { body: '', chars: 0, via: null, reason: '正文抓取失败（付费墙或反爬）' };
}
