// 二次压缩（reduce）的测试。
//
// 背景：分段抽取是「不漏」的保证，但各段要点直接堆起来会变成流水账
// —— 实测一篇 4453 字的文章产出 1676 字 / 34 行，跟原文差不多长，失去精简的意义。
// 所以需要一个 reduce 环节：把多段要点压成一份可读的精简版。
//
// 关键约束：压缩的是「表述」，不是「信息」。数字与风险必须原样保留 ——
// 那是最容易在压缩中丢失、又最要紧的内容。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildReducePrompt, applyReduced, REDUCE_TARGET_FACTS } from './extract.mjs';

const sample = {
  facts: ['事实A', '事实B', '事实C', '事实D', '事实E', '事实F', '事实G'],
  numbers: ['96%', '38 分钟'],
  risks: ['隐私问题'],
  conclusion: '原始结论',
};

test('buildReducePrompt 把全部待压缩要点都放进提示词', () => {
  const p = buildReducePrompt(sample, { title: '某文章' });
  for (const f of sample.facts) assert.ok(p.includes(f), `要点 ${f} 必须出现，否则会被无声丢掉`);
  assert.ok(p.includes('96%'), '数字必须进提示词');
  assert.ok(p.includes('隐私问题'), '风险必须进提示词');
  assert.ok(p.includes('某文章'), '标题应带上，帮助判断哪些信息重要');
});

test('buildReducePrompt 明确要求保留全部数字与风险', () => {
  const p = buildReducePrompt(sample, { title: 'T' });
  assert.ok(/数字.*(全部|完整|原样)|(全部|完整|原样).*数字/.test(p), '应要求数字全部保留');
  assert.ok(/风险.*(全部|完整|原样)|(全部|完整|原样).*风险/.test(p), '应要求风险全部保留');
});

test('buildReducePrompt 给出目标条数上限', () => {
  const p = buildReducePrompt(sample, { title: 'T' });
  assert.ok(new RegExp(`最多\\s*${REDUCE_TARGET_FACTS}\\s*条`).test(p), `应写明最多 ${REDUCE_TARGET_FACTS} 条`);
});

test('applyReduced 用压缩结果替换 facts 与 conclusion', () => {
  const out = applyReduced(sample, { facts: ['精简A', '精简B'], conclusion: '新结论' });
  assert.deepEqual(out.facts, ['精简A', '精简B']);
  assert.equal(out.conclusion, '新结论');
});

test('applyReduced 保住数字与风险：模型漏给时回退到原值', () => {
  const out = applyReduced(sample, { facts: ['精简A'], conclusion: '新结论' });
  assert.deepEqual(out.numbers, sample.numbers, '数字必须原样保留');
  assert.deepEqual(out.risks, sample.risks, '风险必须原样保留');
});

test('applyReduced 允许模型补充它认为更完整的数字与风险', () => {
  const out = applyReduced(sample, { facts: ['A'], numbers: ['96%', '38 分钟', '52%'], risks: ['隐私问题', '人工监督'] });
  assert.ok(out.numbers.includes('52%'), '模型补的数字应保留');
  assert.ok(out.risks.includes('人工监督'), '模型补的风险应保留');
});

test('applyReduced 对空/非法压缩结果回退到原要点，绝不返回空', () => {
  for (const bad of [null, {}, { facts: [] }, { facts: 'not-array' }]) {
    const out = applyReduced(sample, bad);
    assert.deepEqual(out.facts, sample.facts, `压缩结果 ${JSON.stringify(bad)} 时应回退`);
  }
});

test('applyReduced 模型没给结论时保留原结论', () => {
  const out = applyReduced(sample, { facts: ['精简A'] });
  assert.equal(out.conclusion, '原始结论');
});
