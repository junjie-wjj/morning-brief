// 去重接线的回归测试：dedupeNews 必须把 AI 加工结果挂到条目上。
// 之前这里漏挂，导致提示词只有英文原标题、主条目选择把所有 score 当成 0。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dedupeNews } from '../brief.mjs';

const raw = (link, hour, extra = {}) => ({
  link,
  title: `Raw ${link}`,
  source: `来源${link}`,
  date: new Date(`2026-10-21T0${hour}:00:00Z`),
  ...extra,
});

const enriched = new Map([
  ['a', { zh: '中文标题 A', summary: '摘要 A', tag: '模型发布', score: 3 }],
  ['b', { zh: '中文标题 B', summary: '摘要 B', tag: '模型发布', score: 5 }],
]);

test('dedupeNews 用中文标题/摘要构造提示词，并按兴趣分选主条目', async () => {
  let prompt = '';
  const fakeChat = async (messages) => {
    prompt = messages.at(-1).content;
    return '{"groups":[[0,1]]}';
  };

  const out = await dedupeNews([raw('a', 1), raw('b', 2)], enriched, fakeChat);
  assert.ok(prompt.includes('中文标题 A'), '提示词应包含 AI 中文标题');
  assert.ok(prompt.includes('摘要 B'), '提示词应包含 AI 摘要');

  const a = out.find((it) => it.link === 'a');
  const b = out.find((it) => it.link === 'b');
  assert.equal(a.dupOf, 'b', '应保留 5 分条目为主条目，而不是更早的 3 分条目');
  assert.equal(b.related.length, 1);
  assert.equal(b.related[0].link, 'a');
});

test('dedupeNews 在不足两条资讯时也会挂上 AI 结果（供后续精简版使用）', async () => {
  let called = false;
  const out = await dedupeNews([raw('a', 1)], enriched, async () => {
    called = true;
    return '{"groups":[]}';
  });
  assert.equal(called, false, '不足两条不应调用 LLM');
  assert.equal(out[0].en.score, 3, '早退路径也必须挂上 en');
});

test('dedupeNews 不把产品条目送去事件去重', async () => {
  let prompt = '';
  const product = raw('p', 3, { product: 'DeepSeek' });
  const out = await dedupeNews([raw('a', 1), raw('b', 2), product], enriched, async (messages) => {
    prompt = messages.at(-1).content;
    return '{"groups":[[0,1]]}';
  });
  assert.ok(!prompt.includes('Raw p'), '产品条目不应进入去重提示词');
  assert.equal(out.find((it) => it.link === 'p').dupOf, undefined);
});

test('dedupeNews 只有产品条目时不调用 LLM', async () => {
  let called = false;
  const out = await dedupeNews([raw('p', 1, { product: 'DeepSeek' })], enriched, async () => {
    called = true;
    return '{"groups":[]}';
  });
  assert.equal(called, false);
  assert.equal(out.length, 1);
});
