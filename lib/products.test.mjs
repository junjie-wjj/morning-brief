// 产品追踪纯逻辑的测试：来源数据 → 统一条目的映射、噪音过滤、去重优先级。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractOriginalUrl,
  mapHfModels,
  mapReleaseItems,
  mapNewsItems,
  mapHnHits,
  dedupeByLink,
} from './products.mjs';

const NOW = new Date('2026-10-21T12:00:00Z').getTime();
const daysAgo = (n) => new Date(NOW - n * 86_400_000).toISOString();

test('extractOriginalUrl 从 Bing 跳转链接里取出原始地址', () => {
  const link = 'http://www.bing.com/news/apiclick.aspx?ref=FexRss&aid=&url=https%3a%2f%2fexample.com%2fa%3fb%3d1&c=1';
  assert.equal(extractOriginalUrl(link), 'https://example.com/a?b=1');
});

test('extractOriginalUrl 对普通链接原样返回', () => {
  assert.equal(extractOriginalUrl('https://example.com/x'), 'https://example.com/x');
});

test('mapHfModels 过滤量化副本、旧模型，并生成统一条目', () => {
  const models = [
    { id: 'deepseek-ai/DeepSeek-V4.1', lastModified: daysAgo(1) },
    { id: 'deepseek-ai/DeepSeek-V4.1-BF16', lastModified: daysAgo(1) }, // 量化副本，应被过滤
    { id: 'deepseek-ai/DeepSeek-V3', lastModified: daysAgo(30) },       // 窗口外
  ];
  const out = mapHfModels(models, { product: 'DeepSeek', days: 14, max: 2, now: NOW });
  assert.equal(out.length, 1);
  assert.equal(out[0].title, '新模型 deepseek-ai/DeepSeek-V4.1');
  assert.equal(out[0].link, 'https://huggingface.co/deepseek-ai/DeepSeek-V4.1');
  assert.equal(out[0].product, 'DeepSeek');
  assert.ok(out[0].date instanceof Date);
});

test('mapHfModels 按时间倒序取前 N 条', () => {
  const models = [
    { id: 'org/A', lastModified: daysAgo(3) },
    { id: 'org/B', lastModified: daysAgo(1) },
    { id: 'org/C', lastModified: daysAgo(2) },
  ];
  const out = mapHfModels(models, { product: 'P', days: 14, max: 2, now: NOW });
  assert.deepEqual(out.map((x) => x.title), ['新模型 org/B', '新模型 org/C']);
});

test('mapReleaseItems 跳过预发布版本并带上产品名前缀', () => {
  const items = [
    { title: 'v2.1.306', link: 'https://github.com/a/b/releases/tag/v2.1.306', date: new Date(daysAgo(1)) },
    { title: 'v2.2.0-beta.1', link: 'https://github.com/a/b/releases/tag/v2.2.0-beta.1', date: new Date(daysAgo(1)) },
    { title: 'v2.0.0', link: 'https://github.com/a/b/releases/tag/v2.0.0', date: new Date(daysAgo(40)) },
  ];
  const out = mapReleaseItems(items, { product: 'Claude', label: 'claude-code', days: 14, max: 2, now: NOW });
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'claude-code v2.1.306');
  assert.equal(out[0].product, 'Claude');
});

test('mapNewsItems 还原原文链接、限定时间窗口', () => {
  const items = [
    { title: 'Qoder 上线新功能', link: 'http://www.bing.com/news/apiclick.aspx?url=https%3a%2f%2fnews.example.com%2fqoder', date: new Date(daysAgo(2)) },
    { title: '旧新闻', link: 'https://news.example.com/old', date: new Date(daysAgo(20)) },
  ];
  const out = mapNewsItems(items, { product: 'Qoder', days: 7, max: 3, now: NOW });
  assert.equal(out.length, 1);
  assert.equal(out[0].link, 'https://news.example.com/qoder');
  assert.equal(out[0].source, '新闻搜索 · Qoder');
});

test('mapNewsItems 按关键词过滤标题，丢弃搜索结果里的无关新闻', () => {
  const items = [
    { title: 'Cursor 发布新版本', link: 'https://a', date: new Date(daysAgo(1)) },
    { title: '马斯克谈 AI 编程', link: 'https://b', date: new Date(daysAgo(1)) }, // 不含关键词
  ];
  const out = mapNewsItems(items, { product: 'Cursor', keyword: 'Cursor', days: 14, max: 3, now: NOW });
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'Cursor 发布新版本');
});

test('dedupeByLink 保留先出现的条目（产品追踪优先）', () => {
  const items = [
    { link: 'https://a', product: 'P' },
    { link: 'https://b' },
    { link: 'https://a', product: null },
    { link: null },
  ];
  const out = dedupeByLink(items);
  assert.equal(out.length, 2);
  assert.equal(out[0].product, 'P', '同链接应保留产品追踪那条');
});

test('mapHnHits 只保留标题含关键词的近期条目', () => {
  const hits = [
    { title: 'Cursor 2.0 released', url: 'https://a', created_at_i: NOW / 1000 - 3600, object_id: '1' },
    { title: 'Unrelated database post', url: 'https://b', created_at_i: NOW / 1000 - 3600, object_id: '2' },
    { title: 'Old Cursor post', url: 'https://c', created_at_i: NOW / 1000 - 40 * 86400, object_id: '3' },
    { title: 'Cursor without url', url: null, created_at_i: NOW / 1000 - 7200, objectID: '4' },
  ];
  const out = mapHnHits(hits, { product: 'Cursor', keyword: 'cursor', days: 14, max: 2, now: NOW });
  assert.equal(out.length, 2);
  assert.ok(out.every((x) => /cursor/i.test(x.title)));
  assert.ok(out.some((x) => x.link === 'https://news.ycombinator.com/item?id=4'), '无原文链接时回退到 HN 讨论页');
});

test('mapHnHits 对关键词做正则转义（如 C++ 不会当正则）', () => {
  const hits = [{ title: 'C++ tooling update', url: 'https://a', created_at_i: NOW / 1000 - 60, object_id: '1' }];
  const out = mapHnHits(hits, { product: 'C++', keyword: 'C++', days: 14, max: 2, now: NOW });
  assert.equal(out.length, 1);
});
