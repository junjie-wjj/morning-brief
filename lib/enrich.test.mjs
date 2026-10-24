import test from 'node:test';
import assert from 'node:assert/strict';
import { itemKey, applyEnrichResponse } from './enrich.mjs';

const chunk = [
  { link: 'https://a.example/one', title: 'Introducing Kimi K3.1 Pro' },
  { link: 'https://a.example/two', title: 'DE STAAT - FREEDOM' },
  { link: 'https://a.example/three', title: 'New GLM model' },
];

test('itemKey：稳定、区分条目、形如短哈希', () => {
  assert.equal(itemKey(chunk[0].link), itemKey(chunk[0].link));
  assert.notEqual(itemKey(chunk[0].link), itemKey(chunk[1].link));
  assert.match(itemKey(chunk[0].link), /^[0-9a-z]{6}$/);
});

test('正确回显键：逐条绑定', () => {
  const parsed = { items: chunk.map((it) => ({
    k: itemKey(it.link), zh: `标题${itemKey(it.link)}`, s: '摘要', tag: '模型发布', score: 4,
  })) };
  const out = applyEnrichResponse(parsed, chunk);
  assert.equal(out.size, 3);
  assert.equal(out.get(chunk[1].link).zh, `标题${itemKey(chunk[1].link)}`);
});

test('编号错位攻击：回显了不存在的键/旧式序号，全部丢弃，不错绑', () => {
  // 弱模型把 Kimi 的内容安到音乐视频键上，但键不存在 → 丢弃
  const parsed = { items: [
    { k: 'zzzzzz', zh: 'Kimi K3.1 Pro发布' },          // 不存在的键
    { i: 1, zh: '用旧式序号回答' },                     // 旧式序号，没有 k
    { k: itemKey(chunk[2].link), zh: 'GLM 发布' },      // 正确键
  ] };
  const out = applyEnrichResponse(parsed, chunk);
  assert.equal(out.size, 1);
  assert.ok(out.has(chunk[2].link));
  assert.ok(!out.has(chunk[0].link));
});

test('字段兜底：空 zh 丢弃；score 夹紧；tag 缺省其他', () => {
  const parsed = { items: [
    { k: itemKey(chunk[0].link), zh: '  ' },
    { k: itemKey(chunk[1].link), zh: '标题', score: 99 },
    { k: itemKey(chunk[2].link), zh: '标题', score: 'x' },
  ] };
  const out = applyEnrichResponse(parsed, chunk);
  assert.equal(out.size, 2);
  assert.equal(out.get(chunk[1].link).score, 5);
  assert.equal(out.get(chunk[2].link).score, 1);
  assert.equal(out.get(chunk[2].link).tag, '其他');
});
