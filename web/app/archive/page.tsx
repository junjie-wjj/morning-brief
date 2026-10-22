import { queryItems, type ItemRow } from "@/lib/db";
import { parseRelated } from "@/lib/related";
import ItemCard from "../components/ItemCard";
import { IconCalendar } from "../components/Icons";

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
      <header className="border-b border-line pb-4">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-700">
          <IconCalendar className="h-4 w-4" />
          Archive
        </p>
        <h1 className="mt-1 font-serif text-2xl font-semibold tracking-tight text-ink">
          历史
          <span className="ml-2 align-middle font-sans text-xs font-normal text-muted">
            {items.length} 条 · {entries.length} 期
          </span>
        </h1>
      </header>

      {items.length === 0 && <p className="mt-6 text-sm text-muted">还没有历史数据。</p>}

      {entries.map(([issue, list]) => (
        <section key={issue} className="mt-8">
          <div className="sticky top-[3.25rem] z-30 -mx-1 flex items-baseline gap-3 border-b border-line bg-paper/90 px-1 py-2.5 backdrop-blur">
            <h2 className="font-serif text-lg font-semibold tracking-tight text-ink">
              {issue === "更早" ? "更早（未分期）" : issue}
            </h2>
            <span className="text-[11px] text-muted">{list.length} 条</span>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {list.map((it) => (
              <ItemCard key={it.id} item={it} related={parseRelated(it.related)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
