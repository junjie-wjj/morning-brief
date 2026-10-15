// 分段抽取的「合并」逻辑测试。
// 逐段抽取后要把各段结果合并成一份要点；合并规则决定最终有没有漏。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mergeExtracts, buildExtractPrompt, formatPoints } from './extract.mjs';

// ---------- 合并：不丢字段、不重复 ----------

test('mergeExtracts 合并多段结果，各段要点都保留', () => {
  const merged = mergeExtracts([
    { facts: ['事实A', '事实B'], numbers: ['涨了 30%'], risks: [], conclusion: '结论一' },
    { facts: ['事实C'], numbers: [], risks: ['风险X'], conclusion: '' },
  ]);
  assert.deepEqual(merged.facts, ['事实A', '事实B', '事实C']);
  assert.deepEqual(merged.numbers, ['涨了 30%']);
  assert.deepEqual(merged.risks, ['风险X']);
  assert.equal(merged.conclusion, '结论一', '第一段有结论就用第一段的');
});

test('mergeExtracts 去掉完全重复的条目', () => {
  const merged = mergeExtracts([
    { facts: ['同一个事实'], numbers: [], risks: [], conclusion: '' },
    { facts: ['同一个事实', '另一个事实'], numbers: [], risks: [], conclusion: '' },
  ]);
  assert.deepEqual(merged.facts, ['同一个事实', '另一个事实']);
});

test('mergeExtracts 对空输入返回空结构而不是报错', () => {
  const merged = mergeExtracts([]);
  assert.deepEqual(merged, { facts: [], numbers: [], risks: [], conclusion: '' });
});

test('mergeExtracts 忽略 null/undefined 段与非法字段', () => {
  const merged = mergeExtracts([
    null,
    { facts: '不是数组', numbers: null, risks: undefined, conclusion: 123 },
    { facts: ['有效事实'], numbers: [], risks: [], conclusion: '有效结论' },
  ]);
  assert.deepEqual(merged.facts, ['有效事实']);
  assert.equal(merged.conclusion, '有效结论');
});

// ---------- 提示词：必须要求逐段全覆盖 ----------

test('buildExtractPrompt 把该段原文完整放进提示词', () => {
  const body = '这是需要被抽取的正文内容。';
  const p = buildExtractPrompt(body, { index: 1, total: 3 });
  assert.ok(p.includes(body), '正文必须原样出现，否则模型看不到内容');
});

test('buildExtractPrompt 声明这是第几段，促使模型覆盖全部段落', () => {
  const p = buildExtractPrompt('正文', { index: 2, total: 5 });
  assert.ok(/2/.test(p) && /5/.test(p), '提示词应包含段号与总段数');
});

test('buildExtractPrompt 要求固定字段齐全', () => {
  const p = buildExtractPrompt('正文', { index: 1, total: 1 });
  for (const f of ['facts', 'numbers', 'risks', 'conclusion']) {
    assert.ok(p.includes(f), `提示词应要求字段 ${f}`);
  }
});

test('buildExtractPrompt 要求用中文输出', () => {
  const p = buildExtractPrompt('正文', { index: 1, total: 1 });
  assert.ok(/中文/.test(p), '整站是中文简报，要点必须是中文');
});

test('buildExtractPrompt 要求合并同一主题、限制条数，避免把精简版写成流水账', () => {
  const p = buildExtractPrompt('正文', { index: 1, total: 1 });
  assert.ok(/合并/.test(p), '应要求合并同一主题的要点');
  assert.ok(/最多\s*\d+\s*条/.test(p), '应限制条数，否则不是精简版');
});

test('buildExtractPrompt 带上文章标题，并要求忽略页面里无关内容', () => {
  const p = buildExtractPrompt('正文', { index: 1, total: 1, title: 'Apple 发布 HomeView' });
  assert.ok(p.includes('Apple 发布 HomeView'), '标题必须出现在提示词里');
  assert.ok(/无关|其它文章|其他文章|推荐阅读/.test(p),
    '必须明确要求忽略页面上的其它文章（实测 TechCrunch 会把侧栏推荐文章混进来）');
});

// ---------- 展示格式 ----------

test('formatPoints 把要点渲染成多行文本', () => {
  const out = formatPoints({ facts: ['事实A'], numbers: ['30%'], risks: [], conclusion: '结论' });
  assert.ok(out.includes('事实A'));
  assert.ok(out.includes('30%'));
  assert.ok(out.includes('结论'));
});

test('formatPoints 对空要点返回空串', () => {
  assert.equal(formatPoints({ facts: [], numbers: [], risks: [], conclusion: '' }), '');
  assert.equal(formatPoints(null), '');
});
