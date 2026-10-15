// 正文抓取与分段精简的测试。零依赖，用 Node 内置 test runner：
//   node --test lib/
//
// 重点验证「不能漏掉」这个核心诉求：
// 分段必须无损（拼回来 = 原文），否则文章中段的内容会在送进 LLM 前就丢了。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { splitIntoChunks } from './extract.mjs';
import {
  stripHtml, parseRedditRss, looksLikeArticle, trimBoilerplate, stripJinaWrapper, cleanMarkdown,
} from './article.mjs';

const squash = (s) => s.replace(/\s+/g, '');

// ---------- 分段：无损是「不漏」的结构性保证 ----------

test('splitIntoChunks 不丢字：各段拼回来等于原文', () => {
  const text = 'A'.repeat(1000) + 'B'.repeat(1000) + 'C'.repeat(1000);
  const chunks = splitIntoChunks(text, 800);
  assert.ok(chunks.length > 1, '应该切成多段');
  assert.equal(squash(chunks.join('')), squash(text));
});

test('splitIntoChunks 保留中文与标点，不做字符级截断丢失', () => {
  const text = '第一段内容。'.repeat(200) + '第二段内容！'.repeat(200);
  const chunks = splitIntoChunks(text, 500);
  assert.equal(squash(chunks.join('')), squash(text));
});

test('splitIntoChunks 优先在句末断开，避免把句子劈成两半', () => {
  const sentence = '这是一个完整的句子，用来测试断句行为。';
  const text = sentence.repeat(50);
  const chunks = splitIntoChunks(text, 200);
  // 除最后一段外，每段都应以句末标点收尾
  for (const c of chunks.slice(0, -1)) {
    assert.match(c.trimEnd().slice(-1), /[。！？.!?]/, `段落结尾不该是半句话: ...${c.slice(-20)}`);
  }
});

test('splitIntoChunks 对超长无标点文本仍能切分且不丢字', () => {
  const text = 'x'.repeat(5000); // 没有任何标点可断
  const chunks = splitIntoChunks(text, 600);
  assert.ok(chunks.length >= 8, `应切成足够多段，实际 ${chunks.length}`);
  assert.equal(squash(chunks.join('')), squash(text));
});

test('splitIntoChunks 短文本返回单段', () => {
  const chunks = splitIntoChunks('很短的一段话。', 1000);
  assert.equal(chunks.length, 1);
});

test('splitIntoChunks 空文本返回空数组', () => {
  assert.deepEqual(splitIntoChunks('', 1000), []);
  assert.deepEqual(splitIntoChunks('   ', 1000), []);
});

// ---------- HTML 清洗 ----------

test('stripHtml 去掉脚本、样式与标签，保留正文', () => {
  const html = `<html><head><style>body{color:red}</style></head>
    <body><script>var x=1;</script><nav>导航</nav>
    <p>真正的正文内容。</p><footer>版权</footer></body></html>`;
  const out = stripHtml(html);
  assert.ok(out.includes('真正的正文内容。'), '正文应保留');
  assert.ok(!out.includes('var x=1'), '脚本应剔除');
  assert.ok(!out.includes('color:red'), '样式应剔除');
  assert.ok(!out.includes('导航'), '导航应剔除');
  assert.ok(!out.includes('版权'), '页脚应剔除');
});

test('stripHtml 解开常见 HTML 实体', () => {
  const out = stripHtml('<p>Tom &amp; Jerry &lt;3 &quot;quoted&quot;&#39;s</p>');
  assert.ok(out.includes('Tom & Jerry <3 "quoted"\'s'), `实体未解开: ${out}`);
});

test('stripHtml 折叠行内多余空白', () => {
  // 注意：段落之间保留换行（见下一个测试），这里只断言行内空白被折叠。
  const out = stripHtml('<p>a</p>\n\n\n   <p>b</p>');
  assert.equal(out, 'a\nb');
});

test('stripHtml 保留段落换行，否则按行剔除样板会失效', () => {
  // 实测教训：早期版本把所有空白（含换行）折叠成一个空格，
  // 导致 trimBoilerplate 因为「没有换行」直接跳过，页面导航被当成正文抽进要点。
  const out = stripHtml('<p>第一段</p><p>第二段</p><p>第三段</p>');
  assert.ok(out.includes('\n'), `应保留换行，实际: ${JSON.stringify(out)}`);
  assert.equal(out.split('\n').filter(Boolean).length, 3, '三段应各占一行');
});

// ---------- Reddit 单帖 RSS 解析 ----------

test('parseRedditRss 从单帖 RSS 中取出正文并解开实体', () => {
  const xml = `<feed><entry><title>标题</title>
    <content type="html">&lt;div class="md"&gt;&lt;p&gt;这是帖子正文。&lt;/p&gt;&lt;/div&gt;</content>
    </entry></feed>`;
  const out = parseRedditRss(xml);
  assert.ok(out.includes('这是帖子正文。'), `实际: ${out}`);
  assert.ok(!out.includes('<div'), 'HTML 标签应已解开并剔除');
});

test('parseRedditRss 对无 content 的 feed 返回空串', () => {
  assert.equal(parseRedditRss('<feed><entry><title>无正文</title></entry></feed>'), '');
});

// ---------- 正文有效性判断（防止把「Reddit」6 个字当正文） ----------

test('looksLikeArticle 拒绝明显无效的正文', () => {
  assert.equal(looksLikeArticle('Reddit'), false, '6 个字的 JS 壳不算正文');
  assert.equal(looksLikeArticle(''), false);
  assert.equal(looksLikeArticle('   '), false);
  assert.equal(looksLikeArticle('Access Denied'), false, '拒绝页不算正文');
});

test('looksLikeArticle 接受足够长的真实正文', () => {
  assert.equal(looksLikeArticle('这是一篇正常长度的文章正文。'.repeat(30)), true);
});

// ---------- 样板内容剔除（错误内容比缺失内容更糟） ----------

test('trimBoilerplate 去掉推荐阅读/版权等整行样板', () => {
  const text = [
    '这是正文第一段，讲的是苹果发布新设备。',
    '推荐阅读：某某公司的十个技巧',
    '这是正文第二段，继续讲细节。',
    'Copyright 2026 Example Inc. All rights reserved',
  ].join('\n');
  const out = trimBoilerplate(text);
  assert.ok(out.includes('这是正文第一段'), '正文必须保留');
  assert.ok(out.includes('这是正文第二段'), '正文必须保留');
  assert.ok(!out.includes('推荐阅读'), '推荐阅读应剔除');
  assert.ok(!out.includes('Copyright'), '版权行应剔除');
});

test('trimBoilerplate 对单行文本原样返回，避免误删正文', () => {
  const oneLine = '推荐阅读是这篇正文里讨论的主题，不能因为开头两个字就删掉整篇。';
  assert.equal(trimBoilerplate(oneLine), oneLine);
});

// ---------- Jina Reader 的包装头 ----------
// 实测 Jina 返回的是 "Title: …\n\nURL Source: …\n\nMarkdown Content:\n…"，
// 这层包装会被模型当成正文，导致抽取出「文章来源为 OpenAI」这类空话。

test('stripJinaWrapper 去掉 Title/URL Source/Markdown Content 包装', () => {
  const raw = `Title: SentinelOne cuts malware analysis from weeks to hours

URL Source: https://openai.com/index/sentinelone

Markdown Content:
Reverse engineering malware can take four to six weeks.`;
  const out = stripJinaWrapper(raw);
  assert.ok(out.includes('Reverse engineering malware'), '正文必须保留');
  assert.ok(!out.includes('URL Source'), '包装行应剔除');
  assert.ok(!out.includes('Markdown Content'), '包装行应剔除');
  assert.ok(!/^Title:/.test(out), 'Title 行应剔除');
});

test('stripJinaWrapper 对没有包装的文本原样返回', () => {
  const plain = '这就是普通正文，没有任何包装。';
  assert.equal(stripJinaWrapper(plain), plain);
});

// ---------- Markdown 清理 ----------
// Jina 返回的是 Markdown。实测导航是 `* [Business](https://openai.com/business/)`
// 这种纯链接行，会被模型当成正文，抽出「OpenAI 提供 API Platform、Docs 等信息」。

test('cleanMarkdown 丢掉纯链接的导航行', () => {
  const md = [
    '* [Research](https://openai.com/research/)',
    '* [Business](https://openai.com/business/)',
    '[Log in](https://openai.com/login)',
    '这是真正的正文第一句，讲的是产品发布。',
  ].join('\n');
  const out = cleanMarkdown(md);
  assert.ok(out.includes('这是真正的正文第一句'), '正文必须保留');
  assert.ok(!out.includes('Business'), '纯链接导航行应剔除');
  assert.ok(!out.includes('Research'), '纯链接导航行应剔除');
});

test('cleanMarkdown 保留正文里的行内链接文字', () => {
  const md = 'OpenAI 发布了 [GPT-6](https://openai.com/gpt6)，性能提升明显。';
  const out = cleanMarkdown(md);
  assert.ok(out.includes('GPT-6'), '行内链接的文字要保留');
  assert.ok(!out.includes('https://openai.com/gpt6'), 'URL 应去掉');
  assert.ok(out.includes('性能提升明显'), '句子其余部分保留');
});

test('cleanMarkdown 去掉图片与裸 URL', () => {
  const md = '![图](https://x.com/a.png)\n正文内容。\nhttps://example.com/only-url';
  const out = cleanMarkdown(md);
  assert.ok(out.includes('正文内容。'));
  assert.ok(!out.includes('x.com/a.png'), '图片应剔除');
  assert.ok(!out.includes('example.com/only-url'), '裸 URL 行应剔除');
});

test('cleanMarkdown 去掉 Markdown 标题井号与强调符号', () => {
  const out = cleanMarkdown('## 小标题\n**加粗**与*斜体*');
  assert.ok(out.includes('小标题'));
  assert.ok(!out.includes('#'), '井号应去掉');
  assert.ok(!out.includes('**'), '强调符号应去掉');
});
