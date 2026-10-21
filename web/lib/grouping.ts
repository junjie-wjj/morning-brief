import type { ItemRow } from "./db";

// 与 brief.mjs 的 groupOrderFor 保持同一逻辑：已知分类按固定顺序在前，
// 未知分类（模型偶尔自创标签）按条目数排在后面。
// 绝不能因为标签不在白名单就丢掉条目——宁可多一个小组，也不能静默消失。
const TAG_ORDER = ["模型发布", "福利资源", "产品动态", "研究进展", "行业动态", "其他"];

export function groupOrderFor(items: ItemRow[]): string[] {
  const counts = new Map<string, number>();
  for (const it of items) {
    const tag = it.tag ?? "其他";
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const unknown = [...counts.keys()]
    .filter((t) => !TAG_ORDER.includes(t))
    .sort((a, b) => (counts.get(b)! - counts.get(a)!) || a.localeCompare(b, "zh"));
  return [...TAG_ORDER, ...unknown];
}
