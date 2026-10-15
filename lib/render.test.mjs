// 静态页渲染的测试。
// 重点：精简版要默认折叠（点开就地读，不跳转），没有精简版时不能渲染空壳，
// 并且所有来自网页的内容都必须转义——正文/要点是外部数据，不能直接塞进 HTML。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderPoints } from '../brief.mjs';

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
