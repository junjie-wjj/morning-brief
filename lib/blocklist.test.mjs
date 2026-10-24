import test from 'node:test';
import assert from 'node:assert/strict';
import { dropBlockedItems, dropLowScoreItems } from './blocklist.mjs';

test('dropBlockedItems：大小写不敏感地匹配原始标题', () => {
  const items = [
    { link: 'a', title: 'Introducing Kimi K3.1 Pro' },
    { link: 'b', title: 'kimi-code@2.3.0 发布' },
    { link: 'c', title: 'OpenAI 发布新模型' },
  ];
  const { kept, dropped } = dropBlockedItems(items, ['kimi']);
  assert.deepEqual(kept.map((i) => i.link), ['c']);
  assert.deepEqual(dropped.map((i) => i.link), ['a', 'b']);
});

test('dropBlockedItems：空词表/全空白词不丢弃任何条目', () => {
  const items = [{ link: 'a', title: 'Kimi K3.1' }];
  assert.equal(dropBlockedItems(items, []).kept.length, 1);
  assert.equal(dropBlockedItems(items, ['  ', '']).dropped.length, 0);
  assert.equal(dropBlockedItems(items, null).kept.length, 1);
});

test('dropBlockedItems：多词命中任一即丢弃；转义不生效（纯字面 includes）', () => {
  const items = [
    { link: 'a', title: 'Qwen 更新' },
    { link: 'b', title: '无聊营销软文' },
    { link: 'c', title: '别的' },
  ];
  const { dropped } = dropBlockedItems(items, ['qwen', '营销']);
  assert.deepEqual(dropped.map((i) => i.link), ['a', 'b']);
});

test('dropLowScoreItems：≤阈值丢弃，产品条目与未知分豁免', () => {
  const items = [
    { link: 'n1', title: '低分资讯' },
    { link: 'n2', title: '高分资讯' },
    { link: 'n3', title: '没加工出分的资讯' },
    { link: 'p1', title: '低分产品动态', product: 'Kimi' },
  ];
  const enriched = new Map([
    ['n1', { zh: 'x', summary: '', tag: '其他', score: 2 }],
    ['n2', { zh: 'y', summary: '', tag: '其他', score: 3 }],
    ['p1', { zh: 'z', summary: '', tag: '产品', score: 1 }],
  ]);
  const { kept, dropped } = dropLowScoreItems(items, enriched, 2);
  assert.deepEqual(dropped.map((i) => i.link), ['n1']);
  assert.deepEqual(kept.map((i) => i.link).sort(), ['n2', 'n3', 'p1']);
});

test('dropLowScoreItems：enriched 为空（降级日）不丢任何条目', () => {
  const items = [{ link: 'n1', title: 'x' }];
  const { kept, dropped } = dropLowScoreItems(items, null, 2);
  assert.equal(kept.length, 1);
  assert.equal(dropped.length, 0);
});
