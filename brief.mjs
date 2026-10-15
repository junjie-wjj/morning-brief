// morning-brief V0：抓取固定的 AI 信息源，生成当天的静态简报页 docs/index.html
// 零依赖（Node 18+，内置 fetch）。运行：node brief.mjs
// 加/删信息源：编辑下面的 SOURCES 数组即可。

const SOURCES = [
  { name: 'OpenAI · 官方新闻',            type: 'rss',       url: 'https://openai.com/news/rss.xml',            max: 5, days: 7 },
  { name: 'Google DeepMind · 官方博客',   type: 'rss',       url: 'https://deepmind.google/blog/rss.xml',       max: 5, days: 7 },
  { name: 'Anthropic · 官方新闻',         type: 'anthropic', url: 'https://www.anthropic.com/news',             max: 5, days: 7 },
  { name: 'DeepSeek · GitHub 发布',       type: 'gh',        org: 'deepseek-ai',                                max: 4 },
  { name: '智谱 GLM · GitHub 发布',       type: 'gh',        org: 'zai-org',                                    max: 4 },
  { name: '免费 LLM API 动态',            type: 'gh-commits', repo: 'mnfst/awesome-free-llm-apis',              max: 4 },
  { name: 'Hacker News · AI 热帖',        type: 'hn-ai',                                                        max: 10, days: 2 },
  { name: 'Hugging Face · 官方博客',      type: 'rss',       url: 'https://huggingface.co/blog/feed.xml',       max: 5, days: 7 },
  { name: 'r/LocalLLaMA · 社区热帖',      type: 'rss',       url: 'https://www.reddit.com/r/LocalLLaMA/.rss',   max: 5, days: 3 },
  { name: 'Simon Willison · LLM 实践博客', type: 'rss',      url: 'https://simonwillison.net/atom/everything/', max: 5, days: 7 },
  { name: 'TechCrunch · AI 新闻',         type: 'rss',       url: 'https://techcrunch.com/category/artificial-intelligence/feed/', max: 5, days: 3 },
  { name: '量子位 · AI 资讯',             type: 'rss',       url: 'https://www.qbitai.com/feed',                max: 5, days: 2 },
];

const WINDOW_DAYS = 7;          // 常规源只保留最近 N 天的条目
const FETCH_TIMEOUT = 15_000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) morning-brief-v0';

// ---------- AI 加工层（可选）：配置 LLM_API_KEY 才启用 ----------
// key 放在项目根目录的 .env 文件里（LLM_API_KEY=xxx），已加入 .gitignore 不会被提交；
// 也可用系统环境变量。默认走智谱开放平台（https://bigmodel.cn）的免费 Flash 模型，
// 换 DeepSeek 等其他 OpenAI 兼容接口：设 LLM_BASE_URL 与 LLM_MODEL 即可。
try {
  const { readFileSync } = await import('node:fs');
  for (const line of readFileSync(new URL('./.env', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* 没有 .env 文件就只用系统环境变量 */ }

const LLM_API_KEY = process.env.LLM_API_KEY ?? '';
const LLM_BASE_URL = process.env.LLM_BASE_URL ?? 'https://open.bigmodel.cn/api/paas/v4';
const LLM_MODEL = process.env.LLM_MODEL ?? 'glm-4.7-flash';
// 备用模型：免费档主模型经常整体限流（HTTP 429 / 错误码 1302「账户速率限制」、
// 1305「模型访问量过大」），此时自动改用备用模型，避免当天完全没有 AI 加工。
// 逗号分隔，按顺序降级；设 LLM_MODEL_FALLBACKS='' 可关闭。
const LLM_FALLBACKS = (process.env.LLM_MODEL_FALLBACKS ?? 'glm-4-flash')
  .split(',').map((s) => s.trim()).filter(Boolean);
const LLM_MODELS = [...new Set([LLM_MODEL, ...LLM_FALLBACKS])];
// 记录本次实际可用的模型（主模型被限流时会降级），用于日志与页面署名
let activeModel = LLM_MODEL;

// ---------- 原文精简版（「不打开网页也能看」） ----------
// 抓正文 → 分段 → 逐段抽取 → 合并成要点。分段是「关键信息不漏」的结构性保证：
// 一次性把 8000 字塞给模型，中段信息最容易丢。
import { fetchArticleBody, trimBoilerplate } from './lib/article.mjs';
import {
  splitIntoChunks, buildExtractPrompt, mergeExtracts, formatPoints,
  buildReducePrompt, applyReduced,
} from './lib/extract.mjs';

// 成本控制：只对高分条目做（正文比标题长几十倍，全量会让调用量涨十倍以上）。
// 想全量就把 POINTS_MIN_SCORE 设为 1；完全关掉用 --skip-points 或 POINTS_ENABLED=0。
const POINTS_ENABLED = process.env.POINTS_ENABLED !== '0' && !process.argv.includes('--skip-points');
const POINTS_MIN_SCORE = Number(process.env.POINTS_MIN_SCORE ?? 4);
const POINTS_MAX_ITEMS = Number(process.env.POINTS_MAX_ITEMS ?? 15);
const POINTS_CONCURRENCY = Number(process.env.POINTS_CONCURRENCY ?? 3);
const POINTS_CHUNK_CHARS = Number(process.env.POINTS_CHUNK_CHARS ?? 2000);

// ---------- 小工具 ----------

const decodeEntities = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&');

const stripTags = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]*>/g, '')
  .trim();

const text = (s) => (s ? decodeEntities(stripTags(s)) : '');

const escapeHtml = (s) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function fetchText(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, ...headers },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const withinDays = (date, days) => !date || (Date.now() - date.getTime()) <= days * 86_400_000;

// 相对日期（按北京时间自然日）：今天 / 昨天 / N 天前
const DAY_KEY = new Intl.DateTimeFormat('sv', { timeZone: 'Asia/Shanghai' });
const dayKey = (d) => Number(DAY_KEY.format(d).replaceAll('-', ''));
const isToday = (date) => date && dayKey(new Date()) === dayKey(date);
const relDate = (date) => {
  if (!date) return '';
  const diff = dayKey(new Date()) - dayKey(date);
  if (diff <= 0) return '今天';
  if (diff === 1) return '昨天';
  return `${diff} 天前`;
};

// ---------- 各类型源的抓取 ----------

// RSS 2.0 与 Atom 通用提取（V0 用容错的正则，够用即可）
function parseFeed(xml) {
  const items = [];
  const seen = new Set();
  const push = (title, link, dateStr) => {
    title = text(title);
    link = link ? text(link) : '';
    if (!title || !link || seen.has(link)) return;
    seen.add(link);
    const date = dateStr ? new Date(dateStr) : null;
    items.push({ title, link, date: Number.isNaN(date?.getTime()) ? null : date });
  };

  for (const raw of xml.match(/<item[\s\S]*?<\/item>/g) ?? []) {
    const link = raw.match(/<link[^>]*>([\s\S]*?)<\/link>/)?.[1]
      ?? raw.match(/<link[^>]*href="([^"]+)"/)?.[1]
      ?? raw.match(/<guid[^>]*>([\s\S]*?)<\/guid>/)?.[1];
    push(
      raw.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1],
      link,
      raw.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/)?.[1]
        ?? raw.match(/<dc:date[^>]*>([\s\S]*?)<\/dc:date>/)?.[1],
    );
  }
  if (items.length) return items;

  for (const raw of xml.match(/<entry[\s\S]*?<\/entry>/g) ?? []) {
    push(
      raw.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1],
      raw.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? raw.match(/<link[^>]*>([\s\S]*?)<\/link>/)?.[1],
      raw.match(/<updated[^>]*>([\s\S]*?)<\/updated>/)?.[1]
        ?? raw.match(/<published[^>]*>([\s\S]*?)<\/published>/)?.[1],
    );
  }
  return items;
}

async function fetchRss(source) {
  const items = parseFeed(await fetchText(source.url));
  return items.filter((it) => withinDays(it.date, source.days ?? WINDOW_DAYS)).slice(0, source.max);
}

// Anthropic 官网没有 RSS，新闻页是服务端渲染的，直接解析链接/日期/标题
async function fetchAnthropic(source) {
  const html = await fetchText(source.url);
  const items = [];
  const seen = new Set();
  // 先取每个 <a href="/news/..."> 的内部 HTML（(?!</a>) 保证不跨锚点配对），
  // Featured 卡片没有 __title 结构，会被 includes 检查自然跳过（列表区有同条目）。
  const anchorPattern = /<a [^>]*href="(\/news\/[a-z0-9-]+)"[^>]*>((?:(?!<\/a>)[\s\S])*)<\/a>/g;
  for (const [, slug, inner] of html.matchAll(anchorPattern)) {
    if (!inner.includes('__title')) continue;
    const link = `https://www.anthropic.com${slug}`;
    if (seen.has(link)) continue;
    seen.add(link);
    const dateStr = inner.match(/<time[^>]*>([\s\S]*?)<\/time>/)?.[1];
    const title = inner.match(/<span[^>]*__title[^>]*>([\s\S]*?)<\/span>/)?.[1];
    if (!title) continue;
    const date = dateStr ? new Date(text(dateStr)) : null;
    items.push({ title: text(title), link, date: Number.isNaN(date?.getTime()) ? null : date });
  }
  return items.filter((it) => withinDays(it.date, source.days ?? WINDOW_DAYS)).slice(0, source.max);
}

// HN 全站热帖大半不是 AI，改用 Algolia 官方搜索接口，按关键词拉最近 N 天的帖子再按热度排序
const HN_KEYWORDS = ['OpenAI', 'Anthropic', 'Claude', 'DeepSeek', 'Gemini', 'Qwen', 'Kimi', 'LLM'];

async function fetchHnAi(source) {
  const since = Math.floor(Date.now() / 1000) - (source.days ?? 2) * 86_400;
  const results = await Promise.allSettled(HN_KEYWORDS.map((kw) =>
    fetchText(
      `https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=20` +
      `&numericFilters=created_at_i%3E${since}&query=${encodeURIComponent(kw)}`,
    ).then(JSON.parse),
  ));
  const byId = new Map();
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const hit of r.value.hits ?? []) {
      if (!hit.title || (hit.points ?? 0) < 5) continue;
      const prev = byId.get(hit.objectID);
      if (!prev || hit.points > prev.points) byId.set(hit.objectID, hit);
    }
  }
  return [...byId.values()]
    .sort((a, b) => (b.points - a.points) || (b.created_at_i - a.created_at_i))
    .slice(0, source.max)
    .map((hit) => ({
      title: hit.title,
      link: hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`,
      date: new Date(hit.created_at_i * 1000),
      meta: `${hit.points} 分 · ${hit.num_comments ?? 0} 评论`,
    }));
}

// 监控"免费 LLM API 汇总"类仓库的提交（这类福利信息的更新都以 commit 形式出现）
async function fetchGhCommits(source) {
  const commits = JSON.parse(await fetchText(
    `https://api.github.com/repos/${source.repo}/commits?per_page=${source.max}`,
    { Accept: 'application/vnd.github+json' },
  ));
  return commits.map((c) => ({
    title: (c.commit?.message ?? '').split('\n')[0].slice(0, 100) || '(无信息)',
    link: c.html_url,
    date: new Date(c.commit?.committer?.date),
  }));
}

// ---------- AI 加工：中文标题 + 摘要 + 分类 + 兴趣打分（OpenAI 兼容接口） ----------

async function chat(messages, model) {
  let lastErr;
  // 429/5xx/网络错误自动重试 4 次（免费模型对数据中心 IP 限流严格，重试间隔递增）
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LLM_API_KEY}` },
        body: JSON.stringify({ model, temperature: 0.3, messages }),
        signal: AbortSignal.timeout(120_000),
      });
      if (res.ok) return (await res.json()).choices?.[0]?.message?.content ?? '';
      lastErr = new Error(`LLM HTTP ${res.status}`);
      if (res.status !== 429 && res.status < 500) throw lastErr; // 401/403 等重试无意义
    } catch (err) {
      lastErr = err;
    }
    if (attempt < 4) await new Promise((r) => setTimeout(r, 15_000 * attempt));
  }
  throw lastErr;
}

// 按 LLM_MODELS 顺序逐个尝试：某个模型整体限流时自动降级到下一个。
// 每个模型内部仍有 chat() 的 4 次重试；全部模型都失败才抛出。
async function chatWithFallback(messages) {
  let lastErr;
  for (const model of LLM_MODELS) {
    try {
      const content = await chat(messages, model);
      if (model !== activeModel) {
        console.log(`ℹ 主模型 ${activeModel} 限流，已降级到 ${model}`);
        activeModel = model;
      }
      return content;
    } catch (err) {
      lastErr = err;
      if (LLM_MODELS.length > 1) console.warn(`⚠ 模型 ${model} 不可用（${err.message}），尝试下一个`);
    }
  }
  throw lastErr;
}

async function enrichBatch(chunk) {
  const listing = JSON.stringify(chunk.map((it, idx) => ({ i: idx, src: it.source, title: it.title })));
  const content = await chatWithFallback([
    { role: 'system', content: '你是严谨的科技简报编辑，输出永远是纯 JSON。' },
    { role: 'user', content: `下面是今日 AI 资讯条目。请为每一条输出：
- zh：中文标题（15 字左右；原文已是中文则沿用；专有名词保留英文，如 GPT、Claude、DeepSeek）
- s：一两句中文摘要，讲清"发生了什么 + 为什么值得注意"，不写套话
- tag：从这些里选一个：模型发布 / 产品动态 / 研究进展 / 福利资源 / 行业动态 / 其他
- score：1-5 兴趣分，读者画像是"追踪大模型动态、喜欢收集免费额度的个人开发者"。营销软文给 1-2；重要模型发布、免费额度、开源项目给 4-5。

条目：${listing}

只输出 JSON，格式：{"items":[{"i":0,"zh":"...","s":"...","tag":"...","score":3},...]}，不要输出任何其他文字。` },
  ]);
  const cleaned = content.replace(/```(?:json)?/g, '').trim();
  const parsed = JSON.parse(cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1));
  const out = new Map();
  for (const e of parsed.items ?? []) {
    if (!Number.isInteger(e.i) || !chunk[e.i]) continue;
    if (typeof e.zh !== 'string' || !e.zh.trim()) continue;
    out.set(chunk[e.i].link, {
      zh: e.zh.trim(),
      summary: typeof e.s === 'string' ? e.s.trim() : '',
      tag: typeof e.tag === 'string' && e.tag.trim() ? e.tag.trim() : '其他',
      score: Math.max(1, Math.min(5, Math.round(Number(e.score)) || 1)),
    });
  }
  return out;
}

async function enrichWithLLM(items) {
  const merged = new Map();
  const failed = [];
  // 分批加工；单批失败不再拖垮全局——已加工成功的批次照常保留，
  // 只有全部批次都失败才降级为原始抓取（否则一次限流就丢掉当天全部摘要）。
  for (let i = 0; i < items.length; i += 40) {
    const chunk = items.slice(i, i + 40);
    try {
      const part = await enrichBatch(chunk);
      for (const [k, v] of part) merged.set(k, v);
    } catch (err) {
      failed.push(err);
    }
  }
  if (!merged.size) throw (failed[0] ?? new Error('模型未返回有效条目'));
  if (failed.length) {
    console.warn(`⚠ AI 加工部分失败：${failed.length} 批未成功（${failed[0].message}），其余照常输出`);
  }
  return merged;
}

// ---------- 原文精简版：抓正文 → 分段 → 逐段抽取 → 合并 ----------

/** 抽取一段正文的要点；失败返回 null（由调用方决定降级） */
async function extractChunk(chunk, meta) {
  const content = await chatWithFallback([
    { role: 'system', content: '你是严谨的科技简报编辑，输出永远是纯 JSON。' },
    { role: 'user', content: buildExtractPrompt(chunk, meta) },
  ]);
  const cleaned = content.replace(/```(?:json)?/g, '').trim();
  return JSON.parse(cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1));
}

/**
 * 为一条资讯生成「原文精简版」。
 * 返回 { points, bodyChars, bodyVia, bodyReason }；抓不到正文时 points 为空串，
 * 并带上原因 —— 页面要如实标注，而不是假装成功。
 */
async function buildPoints(item) {
  const art = await fetchArticleBody(item.link);
  if (!art.body) return { points: '', bodyChars: 0, bodyVia: null, bodyReason: art.reason };

  const body = trimBoilerplate(art.body);
  const chunks = splitIntoChunks(body, POINTS_CHUNK_CHARS);
  const parts = [];
  for (let i = 0; i < chunks.length; i++) {
    try {
      parts.push(await extractChunk(chunks[i], {
        index: i + 1, total: chunks.length, title: item.title,
      }));
    } catch { /* 单段失败不拖垮整条：其余段落照常合并 */ }
  }

  let merged = mergeExtracts(parts);

  // 二次压缩：分段抽取保证「不漏」，但直接堆起来会变成流水账
  //（实测 4453 字的文章产出 1676 字 / 34 行，几乎等于原文）。
  // 只在多段时才压：单段本来就短，再压一次纯属浪费调用。
  let reduced = false;
  if (chunks.length > 1 && merged.facts.length > 0) {
    try {
      const content = await chatWithFallback([
        { role: 'system', content: '你是严谨的科技简报编辑，输出永远是纯 JSON。' },
        { role: 'user', content: buildReducePrompt(merged, { title: item.title }) },
      ]);
      const cleaned = content.replace(/```(?:json)?/g, '').trim();
      const parsed = JSON.parse(cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1));
      merged = applyReduced(merged, parsed);
      reduced = true;
    } catch { /* 压缩失败就用未压缩的合并结果，不影响可用性 */ }
  }

  return {
    points: formatPoints(merged),
    bodyChars: body.length,
    bodyVia: art.via,
    // 段落覆盖情况如实记录：漏了哪段要能看出来，这是「不漏」的可核对凭据
    bodyReason: [
      parts.length < chunks.length ? `${parts.length}/${chunks.length} 段抽取成功` : '',
      reduced ? '' : (chunks.length > 1 ? '未压缩（二次压缩失败，保留完整要点）' : ''),
    ].filter(Boolean).join('；') || null,
  };
}

/**
 * 为高分条目批量生成精简版。
 * 返回 Map<link, points 信息>；整体失败不影响主流程（摘要与静态页照常输出）。
 */
async function buildAllPoints(items) {
  const targets = items
    .filter((it) => (it.en?.score ?? 0) >= POINTS_MIN_SCORE)
    .slice(0, POINTS_MAX_ITEMS);
  if (!targets.length) return new Map();

  console.log(`\n原文精简版：对 ${targets.length} 条高分条目（score ≥ ${POINTS_MIN_SCORE}）抓正文并分段抽取…`);
  const out = new Map();
  let done = 0;
  let failed = 0;

  // 限并发：既压住限流，也不至于串行跑太久
  for (let i = 0; i < targets.length; i += POINTS_CONCURRENCY) {
    const batch = targets.slice(i, i + POINTS_CONCURRENCY);
    const results = await Promise.allSettled(batch.map(buildPoints));
    results.forEach((r, k) => {
      const it = batch[k];
      if (r.status === 'fulfilled') {
        out.set(it.link, r.value);
        if (r.value.points) done++; else failed++;
      } else {
        failed++;
        out.set(it.link, { points: '', bodyChars: 0, bodyVia: null, bodyReason: r.reason?.message ?? '未知错误' });
      }
    });
    console.log(`  进度 ${Math.min(i + POINTS_CONCURRENCY, targets.length)}/${targets.length}（成功 ${done}，失败 ${failed}）`);
  }

  console.log(`✓ 原文精简版：${done}/${targets.length} 条生成成功${failed ? `，${failed} 条失败（页面会如实标注原因）` : ''}`);
  return out;
}

// GitHub 组织的 Release 动态：先列最近活跃的仓库，再逐个查 Release。
// 官方公开 API，无鉴权限流 60 次/小时；每天每组织 1 + 6 次调用，手动重跑也不会触发限流。
async function fetchGitHubReleases(source) {
  const headers = { Accept: 'application/vnd.github+json' };
  const repos = JSON.parse(await fetchText(
    `https://api.github.com/orgs/${source.org}/repos?sort=pushed&per_page=6`, headers,
  )).map((r) => r.full_name);

  const releases = (await Promise.allSettled(
    repos.map((full) =>
      fetchText(`https://api.github.com/repos/${full}/releases?per_page=2`, headers).then(JSON.parse)),
  )).flatMap((r) => (r.status === 'fulfilled' ? r.value : []));

  return releases
    .filter((rel) => rel.published_at && withinDays(new Date(rel.published_at), WINDOW_DAYS))
    .sort((a, b) => new Date(b.published_at) - new Date(a.published_at))
    .slice(0, source.max)
    .map((rel) => {
      const repo = rel.html_url.split('/releases/')[0].split('/').pop();
      return {
        title: `${repo} ${rel.name || rel.tag_name}`,
        link: rel.html_url,
        date: new Date(rel.published_at),
        meta: rel.prerelease ? '预发布' : '',
      };
    });
}

// ---------- 生成页面 ----------

function renderSection({ name, status, items }) {
  if (status !== 'ok') {
    return `<section class="source failed">
      <h2>${escapeHtml(name)}</h2>
      <p class="health">⚠ 本次抓取失败：${escapeHtml(String(status))}。部署到 GitHub Actions 后部分国内无法直连的源会恢复。</p>
    </section>`;
  }
  if (!items.length) {
    return `<section class="source">
      <h2>${escapeHtml(name)} <span class="count">近 ${WINDOW_DAYS} 天无更新</span></h2>
    </section>`;
  }
  const list = items.map((it) => {
    const rest = [it.meta].filter(Boolean).map(escapeHtml).join(' · ');
    const when = isToday(it.date)
      ? '<span class="new">今天</span>'
      : escapeHtml(relDate(it.date));
    return `<li>
      <a href="${escapeHtml(it.link)}" target="_blank" rel="noopener">${escapeHtml(it.title)}</a>
      <span class="meta">${[when, rest].filter(Boolean).join(' · ')}</span>
    </li>`;
  }).join('\n');
  return `<section class="source">
    <h2>${escapeHtml(name)} <span class="count">${items.length} 条</span></h2>
    <ul>${list}</ul>
  </section>`;
}

async function fetchSource(source) {
  try {
    const fetchers = {
      rss: fetchRss, anthropic: fetchAnthropic,
      'hn-ai': fetchHnAi, gh: fetchGitHubReleases, 'gh-commits': fetchGhCommits,
    };
    const fetcher = fetchers[source.type];
    if (!fetcher) throw new Error(`未知源类型 ${source.type}`);
    return { ...source, status: 'ok', items: await fetcher(source) };
  } catch (err) {
    let status = err?.cause?.code ?? err.message ?? '未知错误';
    if (status === 'HTTP 403') status = 'GitHub API 限流（60 次/小时），1 小时后再试';
    else if (status.startsWith('UND_ERR')) status = '网络连不上（国内直连受限，部署到 GitHub Actions 后恢复）';
    return { ...source, status };
  }
}

const TAG_ORDER = ['模型发布', '福利资源', '产品动态', '研究进展', '行业动态', '其他'];

function renderAiItem(it) {
  const when = isToday(it.date) ? '<span class="new">今天</span>' : escapeHtml(relDate(it.date));
  const meta = [escapeHtml(it.source), when].filter(Boolean).join(' · ');
  // 原文精简版：默认折叠，点开就地读，不必跳转到原站
  const pts = renderPoints(it);
  if (!it.en) {
    return `<li>
      <a href="${escapeHtml(it.link)}" target="_blank" rel="noopener">${escapeHtml(it.title)}</a>
      <span class="meta">${meta} · 未经 AI 加工</span>
      ${pts}
    </li>`;
  }
  const orig = it.en.zh !== it.title ? ` · 原标题：${escapeHtml(it.title)}` : '';
  return `<li>
    <a href="${escapeHtml(it.link)}" target="_blank" rel="noopener">${escapeHtml(it.en.zh)}</a>
    <span class="tag">${escapeHtml(it.en.tag)}</span>
    ${it.en.summary ? `<p class="summary">${escapeHtml(it.en.summary)}</p>` : ''}
    <span class="meta">${meta}${orig}</span>
    ${pts}
  </li>`;
}

/** 渲染「原文精简版」折叠块；没有精简版就不渲染 */
function renderPoints(it) {
  if (!it.points) return '';
  const why = it.pointsReason ? `<p class="ppts-note">${escapeHtml(it.pointsReason)}</p>` : '';
  const via = it.bodyVia ? `正文 ${it.bodyChars} 字 · 来源 ${it.bodyVia}` : '';
  const lines = it.points.split('\n').filter(Boolean)
    .map((l) => `<p class="ppts-line">${escapeHtml(l)}</p>`).join('\n');
  return `<details class="ppts">
    <summary>📖 原文精简版（不跳转也能读）</summary>
    ${lines}
    ${why}
    <p class="ppts-meta">${escapeHtml(via)}</p>
  </details>`;
}

function renderAiPage(flat, enriched, { failedNote, pointsMap = new Map() }) {
  const items = flat.map((it) => {
    const p = pointsMap.get(it.link);
    return {
      ...it,
      en: enriched.get(it.link),
      points: p?.points || null,
      pointsReason: p?.points ? p.bodyReason : (p?.bodyReason ?? null),
      bodyChars: p?.bodyChars ?? 0,
      bodyVia: p?.bodyVia ?? null,
    };
  });
  const kept = items.filter((it) => !it.en || it.en.score >= 3);
  const filtered = items.filter((it) => it.en && it.en.score <= 2);

  const must = kept.filter((it) => it.en)
    .sort((a, b) => (b.en.score - a.en.score)
      || ((isToday(b.date) ? 1 : 0) - (isToday(a.date) ? 1 : 0))
      || ((b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0)))
    .slice(0, 3);
  const mustLinks = new Set(must.map((it) => it.link));

  const card = (it) => `<div class="card">
    <a href="${escapeHtml(it.link)}" target="_blank" rel="noopener">${escapeHtml(it.en.zh)}</a>
    <span class="tag">${escapeHtml(it.en.tag)} · ${it.en.score} 分</span>
    <p class="summary">${escapeHtml(it.en.summary)}</p>
    <span class="meta">${[escapeHtml(it.source), isToday(it.date) ? '<span class="new">今天</span>' : escapeHtml(relDate(it.date))].filter(Boolean).join(' · ')}</span>
    ${renderPoints(it)}
  </div>`;

  const mustHtml = must.length
    ? `<section class="source"><h2>今日必读 <span class="count">按兴趣分排序</span></h2>${must.map(card).join('\n')}</section>`
    : '';

  const groups = TAG_ORDER
    .map((tag) => ({ tag, list: kept.filter((it) => !mustLinks.has(it.link) && (it.en?.tag ?? '其他') === tag) }))
    .filter((g) => g.list.length)
    .map((g) => `<section class="source"><h2>${escapeHtml(g.tag)} <span class="count">${g.list.length} 条</span></h2>
      <ul>${g.list.map(renderAiItem).join('\n')}</ul></section>`)
    .join('\n');

  const filteredHtml = filtered.length
    ? `<details class="filtered"><summary>已按兴趣分过滤 ${filtered.length} 条低分条目（点击展开）</summary>
      <ul>${filtered.map(renderAiItem).join('\n')}</ul></details>`
    : '';

  return `${failedNote}
${mustHtml}
${groups}
${filteredHtml}`;
}

async function main() {
  const results = await Promise.all(SOURCES.map(fetchSource));
  const okResults = results.filter((r) => r.status === 'ok');
  const total = okResults.reduce((n, r) => n + r.items.length, 0);
  const failedCount = results.length - okResults.length;
  const failedNote = failedCount
    ? `<p class="banner">⚠ ${failedCount} 个源本次抓取失败（见各栏目提示），其余内容正常。</p>`
    : '';

  const generatedAt = new Date().toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hour12: false,
  });

  const flat = okResults.flatMap((r) => r.items.map((it) => ({ ...it, source: r.name })));
  let enriched = null;
  let aiNote = '';
  if (!LLM_API_KEY) aiNote = '未配置 LLM_API_KEY，本次展示原始抓取（配置方法见 README）';
  else if (flat.length) {
    try {
      enriched = await enrichWithLLM(flat);
    } catch (err) {
      aiNote = `AI 加工失败（${err.message}），本次展示原始抓取`;
    }
  }

  // 原文精简版：只对已加工的高分条目做；失败不影响摘要与静态页
  let pointsMap = new Map();
  if (enriched && POINTS_ENABLED) {
    try {
      const withScore = flat.map((it) => ({ ...it, en: enriched.get(it.link) }));
      pointsMap = await buildAllPoints(withScore);
    } catch (err) {
      console.warn(`⚠ 原文精简版整体失败（${err.message}），本次不输出要点`);
    }
  }

  const aiBanner = aiNote ? `<p class="banner">ℹ ${aiNote}</p>` : '';
  const body = enriched
    ? renderAiPage(flat, enriched, { failedNote, pointsMap })
    : `${aiBanner}${results.map(renderSection).join('\n')}`;
  const sub = enriched
    ? `生成于 ${escapeHtml(generatedAt)}（北京时间） · 共 ${flat.length} 条 · 摘要与打分由 ${escapeHtml(activeModel)} 生成，仅供导读，以原文为准`
    : `生成于 ${escapeHtml(generatedAt)}（北京时间） · 共 ${total} 条 · 原始抓取（无 AI 加工）`;

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>信息早餐 · ${escapeHtml(generatedAt)}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: system-ui, "Microsoft YaHei", "PingFang SC", sans-serif;
         max-width: 720px; margin: 0 auto; padding: 24px 16px 48px; color: #1f2328; line-height: 1.6; }
  h1 { font-size: 1.5rem; margin: 0 0 4px; }
  .sub { color: #6b7280; font-size: .9rem; margin: 0 0 16px; }
  .banner { background: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px;
            padding: 8px 12px; font-size: .85rem; }
  section.source { margin: 24px 0; }
  h2 { font-size: 1.05rem; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; margin: 0 0 8px; }
  .count { color: #6b7280; font-weight: normal; font-size: .85rem; margin-left: 6px; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { margin: 10px 0; }
  a { color: #1f2328; text-decoration: none; }
  a:hover { color: #2563eb; text-decoration: underline; }
  .meta { display: block; color: #9ca3af; font-size: .8rem; }
  .new { color: #d97706; font-weight: 600; }
  .health { color: #b45309; font-size: .85rem; }
  .card { border: 1px solid #e5e7eb; border-left: 3px solid #d97706; border-radius: 10px;
          padding: 10px 14px; margin: 12px 0; }
  .card a { font-weight: 600; font-size: 1.02rem; }
  .tag { display: inline-block; background: #eef2ff; color: #4338ca; font-size: .75rem;
         padding: 1px 8px; border-radius: 99px; margin-left: 6px; vertical-align: middle; }
  .summary { margin: 6px 0 4px; font-size: .92rem; color: #374151; }
  details.filtered { margin: 24px 0; color: #6b7280; font-size: .88rem; }
  details.filtered summary { cursor: pointer; }
  details.ppts { margin: 8px 0 2px; border: 1px solid #e5e7eb; border-radius: 8px;
                 padding: 6px 10px; background: #fafafa; }
  details.ppts summary { cursor: pointer; font-size: .85rem; color: #4338ca; }
  .ppts-line { margin: 6px 0 0; font-size: .9rem; color: #374151; line-height: 1.65; }
  .ppts-note { margin: 6px 0 0; font-size: .78rem; color: #b45309; }
  .ppts-meta { margin: 6px 0 0; font-size: .75rem; color: #9ca3af; }
  footer { margin-top: 40px; color: #9ca3af; font-size: .8rem; border-top: 1px solid #e5e7eb; padding-top: 12px; }
</style>
</head>
<body>
<h1>信息早餐</h1>
<p class="sub">${sub}</p>
${body}
<footer>
  morning-brief —— 只抓取官方 API / 开放协议；AI 摘要仅供导读，点击条目可跳转原文。
</footer>
</body>
</html>`;

  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync('docs', { recursive: true });
  writeFileSync('docs/index.html', html);

  // 同步输出结构化数据，供 web 应用导入数据库（阶段 3 会自动化这一步）
  const dataForApp = {
    generatedAt: new Date().toISOString(),
    items: okResults.flatMap((r) => r.items.map((it) => {
      const p = pointsMap.get(it.link);
      return {
        link: it.link,
        date: it.date ? it.date.toISOString() : null,
        source: r.name,
        title: it.title,
        zh: enriched?.get(it.link)?.zh ?? null,
        summary: enriched?.get(it.link)?.summary ?? null,
        tag: enriched?.get(it.link)?.tag ?? null,
        score: enriched?.get(it.link)?.score ?? null,
        // 原文精简版：points 为空串表示没生成（抓不到正文或未达分数门槛），
        // 此时 pointsReason 说明原因，页面如实标注而不是假装成功
        points: p?.points || null,
        pointsReason: p?.points ? p.bodyReason : (p?.bodyReason ?? null),
        bodyChars: p?.bodyChars ?? null,
        bodyVia: p?.bodyVia ?? null,
      };
    })),
  };
  writeFileSync('docs/data.json', JSON.stringify(dataForApp, null, 2));

  for (const r of results) {
    console.log(r.status === 'ok' ? `✓ ${r.name}: ${r.items.length} 条` : `✗ ${r.name}: ${r.status}`);
  }
  if (enriched) {
    console.log(`✓ AI 加工（${activeModel}）：${enriched.size}/${flat.length} 条获得中文摘要与打分`);
  } else if (aiNote) {
    console.log(`✗ ${aiNote}`);
  }
  console.log(`\n已生成 docs/index.html（共 ${total} 条）。用浏览器打开即可阅读。`);
}

// 只在「直接运行本文件」时执行主流程；被 import 时（例如测试）不自动跑。
// 这样渲染函数可以被单独测试，而不是只能靠跑一遍完整管线来验证。
import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

export { renderPoints, renderAiItem, renderAiPage };
