// 主条目挂的「相关报道」以 JSON 存在 related 列，读取时统一在这里解析
export type RelatedLink = { title: string; link: string; source: string };

export function parseRelated(raw: string | null): RelatedLink[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
