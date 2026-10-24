// OpenRouter 免费模型监控的纯逻辑：解析模型列表 + 与昨日快照对比。
// 只做数据变换，不发请求，node --test 直接覆盖。

/**
 * 从 OpenRouter /api/v1/models 的返回里筛出真·免费模型。
 * 免费的定义：prompt 与 completion 单价都为 "0"（字符串）。
 * 只 prompt 免费但 completion 收费的（免费输入陷阱）不算。
 * @returns {{id: string, name: string}[]}
 */
export function parseFreeModels(apiJson) {
  const list = Array.isArray(apiJson?.data) ? apiJson.data : [];
  return list
    .filter((m) => m?.id && String(m.pricing?.prompt) === '0' && String(m.pricing?.completion) === '0')
    .map((m) => ({ id: m.id, name: m.name ?? m.id }));
}

/**
 * 今日列表与昨日快照对比，得到变化集。
 * @param {string[]} prevIds 昨日免费模型 id（首次运行为空数组）
 * @param {{id: string, name: string}[]} current 今日免费模型
 * @returns {{added: {id:string,name:string}[], removed: {id:string,name:string}[], unchanged: number}}
 */
export function diffFreeModels(prevIds, current) {
  const prev = new Set(Array.isArray(prevIds) ? prevIds : []);
  const prevNames = new Map(); // 供 removed 出名字：prev 只有 id 时回退用 id 当名字
  for (const id of prev) prevNames.set(id, id);
  const added = current.filter((m) => !prev.has(m.id));
  const curIds = new Set(current.map((m) => m.id));
  const removed = [...prev].filter((id) => !curIds.has(id)).map((id) => ({ id, name: prevNames.get(id) }));
  return { added, removed, unchanged: current.length - added.length };
}
