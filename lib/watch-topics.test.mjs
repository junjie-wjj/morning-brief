import test from 'node:test';
import assert from 'node:assert/strict';
import { WATCH_TOPICS, filterFixedTerms, watchOpenRouter } from './watch-topics.mjs';

const terms = [
  { term: 'a', label: '免费额度', match: 'x' },
  { term: 'b', label: '榜单动态', match: 'x' },
  { term: 'c', label: 'MCP/插件/技能', match: 'x' },
  { term: 'd', label: '价格变动', match: 'x' },
];

test('watchTopics 为 null / 空数组 = 全部启用', () => {
  assert.equal(filterFixedTerms(terms, null).length, 4);
  assert.equal(filterFixedTerms(terms, []).length, 4);
});

test('只保留勾选的方向', () => {
  const out = filterFixedTerms(terms, ['榜单动态', '价格变动']);
  assert.deepEqual(out.map((t) => t.label), ['榜单动态', '价格变动']);
});

test('未知标签被忽略（容错手改数据）', () => {
  const out = filterFixedTerms(terms, ['榜单动态', '不存在的方向']);
  assert.deepEqual(out.map((t) => t.label), ['榜单动态']);
});

test('OpenRouter 开关：默认开，勾选列表里有才开', () => {
  assert.equal(watchOpenRouter(null), true);
  assert.equal(watchOpenRouter([]), true);
  assert.equal(watchOpenRouter(['免费额度', 'OpenRouter 免费模型']), true);
  assert.equal(watchOpenRouter(['免费额度']), false);
});

test('标签名单完整', () => {
  assert.equal(WATCH_TOPICS.length, 5);
});
