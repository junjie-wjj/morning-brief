import { getFeedback, queryItems } from "@/lib/db";
import { parseRelated } from "@/lib/related";
import ItemCard from "../components/ItemCard";
import { IconCalendar, IconNewspaper } from "../components/Icons";

// 每次请求实时读数据库再渲染
export const dynamic = "force-dynamic";

export default async function Later() {
  const [items, feedback] = await Promise.all([
    queryItems("SELECT * FROM items WHERE status = 'later' ORDER BY id DESC"),
    getFeedback(),
  ]);

  return (
    <div className="max-w-2xl">
      <header className="border-b border-line pb-4">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-700">
          <IconCalendar className="h-4 w-4" />
          Reading List
        </p>
        <h1 className="mt-1 font-serif text-2xl font-semibold tracking-tight text-ink">
          稍后读
          <span className="ml-2 align-middle font-sans text-xs font-normal text-muted">{items.length} 条</span>
        </h1>
      </header>
      {items.length === 0 && (
        <div className="mt-8 rounded-2xl border border-dashed border-line bg-white/60 px-6 py-12 text-center">
          <IconNewspaper className="mx-auto h-8 w-8 text-stone-300" />
          <p className="mt-3 text-sm text-muted">空空如也。在首页点「稍后读」就会出现在这里。</p>
        </div>
      )}
      <div className="mt-6 grid gap-4">
        {items.map((it) => (
          <ItemCard
            key={it.id}
            item={it}
            verdict={feedback.get(it.link) ?? null}
            related={parseRelated(it.related)}
          />
        ))}
      </div>
    </div>
  );
}
