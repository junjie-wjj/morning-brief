// 多源去重的测试：分组校验、主条目选择、相关报道挂载与上限。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildDedupePrompt, applyDedupe, normalizeTitle, exactTitleGroups } from './dedup.mjs';

const item = (link, score, date, source = '某来源', zh = `标题 ${link}`) => ({
  link,
  title: `原标题 ${link}`,
  source,
  date: new Date(date),
  en: { zh, summary: '摘要', tag: '模型发布', score },
});

test('buildDedupePrompt 包含条目信息与 JSON 输出要求', () => {
  const prompt = buildDedupePrompt([
    item('a', 5, '2026-10-21T01:00:00Z', 'OpenAI · 官方新闻', 'OpenAI 发布新模型'),
    item('b', 4, '2026-10-21T02:00:00Z', '量子位', 'OpenAI 新模型发布'),
  ]);
  assert.ok(prompt.includes('OpenAI 发布新模型'));
  assert.ok(prompt.includes('量子位'));
  assert.ok(prompt.includes('"groups"'));
  assert.ok(prompt.includes('同一事件'));
  assert.ok(prompt.includes('同一来源'), '提示词应禁止合并同源条目');
});

test('applyDedupe 合并组并保留评分最高者为主条目', () => {
  const items = [
    item('a', 3, '2026-10-21T03:00:00Z', '量子位'),
    item('b', 5, '2026-10-21T01:00:00Z', 'OpenAI · 官方新闻'),
    item('c', 4, '2026-10-21T02:00:00Z', 'Hacker News · AI 热帖'),
  ];
  const { items: out, merged } = applyDedupe(items, [[0, 1, 2]]);
  assert.equal(merged, 1);
  assert.equal(out[1].related.length, 2);
  assert.deepEqual(out[1].related.map((r) => r.link).sort(), ['a', 'c']);
  assert.equal(out[0].dupOf, 'b');
  assert.equal(out[2].dupOf, 'b');
  assert.equal(out[1].dupOf, undefined, '主条目不应被标记为重复');
});

test('applyDedupe 同分时保留更早报道', () => {
  const items = [
    item('later', 4, '2026-10-21T05:00:00Z', '量子位'),
    item('earlier', 4, '2026-10-21T01:00:00Z', 'TechCrunch · AI 新闻'),
  ];
  const { items: out } = applyDedupe(items, [[0, 1]]);
  assert.equal(out[0].dupOf, 'earlier');
  assert.equal(out[1].related.length, 1);
});

test('applyDedupe 拒绝同源分组（同一仓库的多个 commit 不是重复报道）', () => {
  const items = [
    item('c1', 3, '2026-10-21T01:00:00Z', '免费 LLM API 动态'),
    item('c2', 4, '2026-10-21T02:00:00Z', '免费 LLM API 动态'),
    item('c3', 5, '2026-10-21T03:00:00Z', '免费 LLM API 动态'),
  ];
  const { items: out, merged } = applyDedupe(items, [[0, 1, 2]]);
  assert.equal(merged, 0);
  assert.ok(out.every((it) => !it.dupOf));
});

test('applyDedupe 组内同源出现两次即整组作废（即使混有其他来源）', () => {
  const items = [
    item('c1', 3, '2026-10-21T01:00:00Z', '免费 LLM API 动态'),
    item('c2', 4, '2026-10-21T02:00:00Z', '免费 LLM API 动态'),
    item('hn', 5, '2026-10-21T03:00:00Z', 'Hacker News · AI 热帖'),
  ];
  const { items: out, merged } = applyDedupe(items, [[0, 1, 2]]);
  assert.equal(merged, 0);
  assert.ok(out.every((it) => !it.dupOf));
});

test('applyDedupe 忽略非法序号、重复序号与单条组', () => {
  const items = [item('a', 3, '2026-10-21T01:00:00Z'), item('b', 4, '2026-10-21T02:00:00Z')];
  const { merged } = applyDedupe(items, [[0], [0, 99], [1, 1], 'bad', null]);
  assert.equal(merged, 0);
});

test('applyDedupe 重叠分组只保留第一组', () => {
  const items = ['a', 'b', 'c'].map((l, i) => item(l, 3 + i, `2026-10-21T0${i + 1}:00:00Z`, `来源${i}`));
  const { items: out, merged } = applyDedupe(items, [[0, 1], [1, 2]]);
  assert.equal(merged, 1);
  assert.equal(out[0].dupOf, 'b');
  assert.equal(out[2].dupOf, undefined, '第二组因重叠被跳过');
});

test('applyDedupe 相关报道最多 5 条', () => {
  const items = Array.from({ length: 8 }, (_, i) => item(`l${i}`, i === 7 ? 5 : 3, `2026-10-21T0${i}:00:00Z`, `来源${i}`));
  const { items: out } = applyDedupe(items, [[0, 1, 2, 3, 4, 5, 6, 7]]);
  assert.equal(out[7].related.length, 5);
});

// ---------- 同标题预合并（exactTitleGroups） ----------

test('normalizeTitle 去空格标点并小写', () => {
  assert.equal(normalizeTitle('Kimi K3.1 Pro 模型发布'), 'kimik31pro模型发布');
  assert.equal(normalizeTitle('kimi k3.1 pro模型发布!!'), 'kimik31pro模型发布');
  assert.equal(normalizeTitle(null), '');
});

test('exactTitleGroups 跨来源同英文标题直接分组', () => {
  const items = [
    item('a', 3, '2026-10-21T01:00:00Z', 'OpenAI · 官方新闻'),
    item('b', 4, '2026-10-21T02:00:00Z', 'TechCrunch · AI 新闻'),
    item('c', 5, '2026-10-21T03:00:00Z', 'Hacker News · AI 热帖'),
  ];
  // 让 a、b 原始标题相同，c 不同
  items[0].title = items[1].title = 'Securing our frontier model training environment';
  items[2].title = 'Other story';
  const groups = exactTitleGroups(items);
  assert.equal(groups.length, 1);
  assert.deepEqual([...groups[0]].sort(), [0, 1]);
});

test('exactTitleGroups 中文标题重合也分组（标点/空格差异不影响）', () => {
  const items = [
    { ...item('a', 3, '2026-10-21T01:00:00Z', '量子位 · AI 资讯'), zh: 'Kimi K3.1 Pro 模型发布' },
    { ...item('b', 4, '2026-10-21T02:00:00Z', 'Simon Willison · LLM 实践博客'), zh: 'Kimi K3.1 Pro模型发布！' },
  ];
  items[0].en.zh = 'Kimi K3.1 Pro 模型发布';
  items[1].en.zh = 'Kimi K3.1 Pro模型发布！';
  const groups = exactTitleGroups(items);
  assert.equal(groups.length, 1);
  assert.deepEqual([...groups[0]].sort(), [0, 1]);
});

test('exactTitleGroups 同源相同标题不合并（独立更新）', () => {
  const items = [
    item('c1', 3, '2026-10-21T01:00:00Z', '免费 LLM API 动态'),
    item('c2', 4, '2026-10-21T02:00:00Z', '免费 LLM API 动态'),
  ];
  items[0].title = items[1].title = 'docs: regenerate README';
  assert.deepEqual(exactTitleGroups(items), []);
});

test('exactTitleGroups 分组喂给 applyDedupe 可正常合并', () => {
  const items = [
    item('a', 3, '2026-10-21T01:00:00Z', 'OpenAI · 官方新闻'),
    item('b', 4, '2026-10-21T02:00:00Z', 'Hacker News · AI 热帖'),
    item('c', 5, '2026-10-21T03:00:00Z', '量子位 · AI 资讯'),
  ];
  items[0].title = items[1].title = 'Same headline';
  const { items: out, merged } = applyDedupe(items, exactTitleGroups(items));
  assert.equal(merged, 1);
  assert.equal(out[0].dupOf, 'b');
  assert.equal(out[2].dupOf, undefined, '标题不同的第三条不受影响');
});
