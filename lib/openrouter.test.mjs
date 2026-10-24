import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFreeModels, diffFreeModels } from './openrouter.mjs';

const api = (id, prompt, completion, name = id) => ({
  id, name, pricing: { prompt: String(prompt), completion: String(completion) },
});

test('parseFreeModels：prompt 与 completion 都为 0 才算免费', () => {
  const json = { data: [
    api('a/free-model', 0, 0, 'Free Model A'),
    api('b/half-free', 0, 0.000001),   // 免费输入陷阱：输出收费
    api('c/paid', 0.001, 0.002),
    { id: null, pricing: { prompt: '0', completion: '0' } }, // 非法条目
  ] };
  const free = parseFreeModels(json);
  assert.deepEqual(free, [{ id: 'a/free-model', name: 'Free Model A' }]);
});

test('parseFreeModels：空/畸形输入返回空数组', () => {
  assert.deepEqual(parseFreeModels(null), []);
  assert.deepEqual(parseFreeModels({}), []);
  assert.deepEqual(parseFreeModels({ data: 'bad' }), []);
});

test('diffFreeModels：报出新增与下架，统计未变', () => {
  const prev = ['keep/1', 'gone/old'];
  const current = [
    { id: 'keep/1', name: 'Keep' },
    { id: 'new/model:free', name: 'New Model' },
  ];
  const d = diffFreeModels(prev, current);
  assert.deepEqual(d.added, [{ id: 'new/model:free', name: 'New Model' }]);
  assert.deepEqual(d.removed, [{ id: 'gone/old', name: 'gone/old' }]);
  assert.equal(d.unchanged, 1);
});

test('diffFreeModels：首次运行（prev 为空）全部算新增，由调用方决定不播报', () => {
  const d = diffFreeModels([], [{ id: 'x', name: 'X' }]);
  assert.equal(d.added.length, 1);
  assert.equal(d.removed.length, 0);
});

test('diffFreeModels：无变化时空集', () => {
  const d = diffFreeModels(['x'], [{ id: 'x', name: 'X' }]);
  assert.equal(d.added.length, 0);
  assert.equal(d.removed.length, 0);
  assert.equal(d.unchanged, 1);
});
