// 偏好搜索的测试：阈值、排序、分类映射、去重与上限。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { selectSearchTerms, TAG_SEARCH_QUERIES } from './preferences.mjs';

test('净赞达到阈值的产物名会变成搜索词', () => {
  const terms = selectSearchTerms({
    products: [
      { name: 'DeepSeek', up: 4, down: 1 },
      { name: 'Qwen', up: 2, down: 0 },
      { name: 'Kimi', up: 1, down: 0 },
    ],
  });
  assert.deepEqual(terms.map((t) => t.term), ['DeepSeek', 'Qwen']);
  assert.equal(terms[0].kind, 'product');
  assert.equal(terms[0].net, 3);
});

test('分类按映射表转成有意义的搜索词', () => {
  const terms = selectSearchTerms({
    tags: [
      { tag: '福利资源', up: 3, down: 0 },
      { tag: '模型发布', up: 3, down: 1 },
      { tag: '行业动态', up: 9, down: 0 }, // 没有映射，忽略
    ],
  });
  assert.deepEqual(terms.map((t) => t.term).sort(), [
    TAG_SEARCH_QUERIES['福利资源'].query,
    TAG_SEARCH_QUERIES['模型发布'].query,
  ].sort());
  assert.ok(terms.every((t) => t.kind === 'tag'));
  assert.ok(terms.every((t) => t.match), '分类词应带标题匹配规则');
});

test('模型发布的匹配规则排除泛化的 model 用法', () => {
  const re = new RegExp(TAG_SEARCH_QUERIES['模型发布'].match, 'i');
  assert.ok(re.test('Mistral releases a new AI model'));
  assert.ok(re.test('DeepSeek 开源新模型'));
  assert.ok(!re.test('An interactive model of expectations and recessions'));
});

test('产品词带转义后的标题匹配规则', () => {
  const terms = selectSearchTerms({ products: [{ name: 'OpenAI / Codex', up: 2, down: 0 }] });
  assert.equal(terms[0].match, 'OpenAI / Codex');
  assert.ok(new RegExp(terms[0].match, 'i').test('OpenAI / Codex 新版本'));
  assert.ok(!new RegExp(terms[0].match, 'i').test('OpenAI Codex'), '斜杠必须按字面匹配');
});

test('净赞不够或踩多于赞时不启用', () => {
  const terms = selectSearchTerms({
    products: [
      { name: 'A', up: 1, down: 0 },  // 净赞 1
      { name: 'B', up: 3, down: 2 },  // 净赞 1
      { name: 'C', up: 2, down: 3 },  // 净赞 -1
    ],
  });
  assert.deepEqual(terms, []);
});

test('同一个词只保留一条（忽略大小写）', () => {
  const terms = selectSearchTerms({
    products: [
      { name: 'DeepSeek', up: 3, down: 0 },
      { name: 'deepseek', up: 2, down: 0 },
    ],
  });
  assert.equal(terms.length, 1);
  assert.equal(terms[0].up, 3);
});

test('按净赞、赞数排序，并受 maxTerms 限制', () => {
  const terms = selectSearchTerms({
    products: [
      { name: 'A', up: 2, down: 0 },
      { name: 'B', up: 5, down: 0 },
      { name: 'C', up: 3, down: 0 },
      { name: 'D', up: 4, down: 0 },
    ],
  }, { maxTerms: 3 });
  assert.deepEqual(terms.map((t) => t.term), ['B', 'D', 'C']);
});

test('空输入和脏数据不会抛错', () => {
  assert.deepEqual(selectSearchTerms(undefined), []);
  assert.deepEqual(selectSearchTerms({ products: [null, {}, { name: '  ' }] }), []);
});
