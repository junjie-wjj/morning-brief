// 静态页渲染的测试。
// 重点：精简版要默认折叠（点开就地读，不跳转），没有精简版时不能渲染空壳，
// 并且所有来自网页的内容都必须转义——正文/要点是外部数据，不能直接塞进 HTML。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderPoints, renderAiPage, groupOrderFor } from '../brief.mjs';

const base = {
  link: 'https://example.com/a',
  points: '结论：某结论\n· 要点一\n数字：96%；8 小时',
  bodyChars: 4210,
  bodyVia: 'jina',
  pointsReason: null,
};

test('renderPoints 渲染成默认折叠的 details', () => {
  const html = renderPoints(base);
  assert.ok(html.includes('<details'), '应是折叠块');
  assert.ok(!html.includes('<details open'), '默认应为折叠，不是展开');
  assert.ok(html.includes('原文精简版'), '摘要文字应可读');
});

test('renderPoints 逐行渲染要点', () => {
  const html = renderPoints(base);
  assert.ok(html.includes('结论：某结论'));
  assert.ok(html.includes('要点一'));
  assert.ok(html.includes('96%'));
});

test('renderPoints 带上正文来源与字数，作为「全读过」的凭据', () => {
  const html = renderPoints(base);
  assert.ok(html.includes('4210'), '应显示正文字数');
  assert.ok(html.includes('jina'), '应显示正文来源');
});

test('renderPoints 没有精简版时返回空串，不渲染空壳', () => {
  assert.equal(renderPoints({ ...base, points: null }), '');
  assert.equal(renderPoints({ ...base, points: '' }), '');
});

test('renderPoints 转义 HTML，防止网页内容注入页面', () => {
  const html = renderPoints({
    ...base,
    points: '<script>alert(1)</script> 与 <img onerror=x>',
  });
  assert.ok(!html.includes('<script>'), '脚本标签必须被转义');
  assert.ok(!html.includes('<img'), 'img 标签必须被转义');
  assert.ok(html.includes('&lt;script&gt;'), '应转义成实体');
});

test('renderPoints 展示覆盖情况备注（哪几段抽取成功）', () => {
  const html = renderPoints({ ...base, pointsReason: '2/3 段抽取成功' });
  assert.ok(html.includes('2/3 段抽取成功'), '覆盖情况应如实显示');
});

test('groupOrderFor 把未知分类排在已知分类之后，按条目数降序', () => {
  const items = [
    { en: { tag: '模型发布' } }, { en: { tag: '模型发布' } },
    { en: { tag: '开源项目' } }, { en: { tag: '开源项目' } }, { en: { tag: '开源项目' } },
    { en: { tag: '工具' } },
    { en: null },
  ];
  const order = groupOrderFor(items);
  assert.deepEqual(order.slice(0, 6), ['模型发布', '福利资源', '产品动态', '研究进展', '行业动态', '其他']);
  assert.deepEqual(order.slice(6), ['开源项目', '工具'], '未知分类应按条目数降序排在其后');
});

// 回归测试：模型偶尔会返回白名单外的分类（如「开源项目」）。
// 旧逻辑只遍历白名单，这类条目会从所有分组里静默消失（除非恰好挤进今日必读）。
test('renderAiPage 不会因为分类不在白名单就丢掉条目', () => {
  const flat = ['a', 'b', 'c', 'x'].map((k) => ({
    link: `https://example.com/${k}`,
    date: new Date(),
    source: '测试源',
    title: `原标题 ${k}`,
  }));
  const enriched = new Map([
    ['https://example.com/a', { zh: 'A 标题', summary: '摘要', tag: '模型发布', score: 5 }],
    ['https://example.com/b', { zh: 'B 标题', summary: '摘要', tag: '模型发布', score: 5 }],
    ['https://example.com/c', { zh: 'C 标题', summary: '摘要', tag: '产品动态', score: 5 }],
    ['https://example.com/x', { zh: 'X 自创分类', summary: '摘要', tag: '开源项目', score: 3 }],
  ]);
  const html = renderAiPage(flat, enriched, { failedNote: '' });
  assert.ok(html.includes('<h2>开源项目'), '未知分类应渲染成独立分组');
  assert.ok(html.includes('X 自创分类'), '条目不能从页面上消失');
});

test('renderAiPage 隐藏重复条目，并在主条目下方挂相关报道', () => {
  const flat = [
    {
      link: 'https://example.com/primary', date: new Date(), source: 'OpenAI · 官方新闻', title: 'Primary',
      related: [{ title: '重复条目', link: 'https://example.com/dup', source: '量子位 · AI 资讯' }],
    },
    { link: 'https://example.com/dup', date: new Date(), source: '量子位 · AI 资讯', title: 'Dup', dupOf: 'https://example.com/primary' },
  ];
  const enriched = new Map([
    ['https://example.com/primary', { zh: '主条目', summary: '摘要', tag: '模型发布', score: 5 }],
    ['https://example.com/dup', { zh: '重复条目', summary: '摘要', tag: '模型发布', score: 4 }],
  ]);
  const html = renderAiPage(flat, enriched, { failedNote: '' });
  assert.ok(html.includes('主条目'));
  assert.ok(!html.includes('重复条目'), '被合并的重复条目不应单独展示');
  assert.ok(html.includes('相关报道'), '主条目应带相关报道');
  assert.ok(html.includes('量子位'), '相关报道应显示来源');
});
