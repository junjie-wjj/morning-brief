import { queryItems, type ItemRow } from "@/lib/db";
import { parseRelated } from "@/lib/related";
import ItemCard from "../components/ItemCard";

// 历史页：按期号（北京时间日期）分组，展示全部条目
export const dynamic = "force-dynamic";

export default async function Archive() {
  // 被多源去重合并的报道不重复展示；主条目带有「相关报道」链接
  const items = (await queryItems("SELECT * FROM items ORDER BY date DESC, id DESC"))
    .filter((it) => !it.dup_of);

  const groups = new Map<string, ItemRow[]>();
  for (const it of items) {
    const key = it.issue ?? "更早";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(it);
  }
  const entries = [...groups.entries()].sort((a, b) => (a[0] > b[0] ? -1 : 1));

  return (
    <div>
      <h1 className="border-b border-zinc-200 pb-2 text-base font-semibold">
        历史{" "}
        <span className="text-xs font-normal text-zinc-400">
          {items.length} 条 · {entries.length} 期
        </span>
      </h1>

      {items.length === 0 && <p className="mt-6 text-sm text-zinc-500">还没有历史数据。</p>}

      {entries.map(([issue, list]) => (
        <section key={issue} className="mt-6">
          <h2 className="border-b border-zinc-200 pb-2 text-sm font-semibold text-zinc-700">
            {issue === "更早" ? "更早（未分期）" : issue}{" "}
            <span className="text-xs font-normal text-zinc-400">{list.length} 条</span>
          </h2>
          {list.map((it) => (
            <ItemCard key={it.id} item={it} related={parseRelated(it.related)} />
          ))}
        </section>
      ))}
    </div>
  );
}
