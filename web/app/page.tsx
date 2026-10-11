import Link from "next/link";
import { queryItems } from "@/lib/db";
import ItemCard from "./components/ItemCard";

// 每次请求实时读数据库再返回页面（阻塞式渲染，阶段 1 采用最直白的写法）
export const instant = false;

const TAG_ORDER = ["模型发布", "福利资源", "产品动态", "研究进展", "行业动态", "其他"];

export default async function Home() {
  const items = await queryItems("SELECT * FROM items ORDER BY score DESC, date DESC, id DESC");

  // 今日必读：兴趣分 4 分以上的前 3 条
  const must = items.filter((it) => (it.score ?? 0) >= 4).slice(0, 3);
  const mustIds = new Set(must.map((it) => it.id));
  const groups = TAG_ORDER
    .map((tag) => ({ tag, list: items.filter((it) => !mustIds.has(it.id) && (it.tag ?? "其他") === tag) }))
    .filter((g) => g.list.length > 0);

  return (
    <div>
      <p className="text-xs text-zinc-400">最新数据 · 共 {items.length} 条</p>

      {items.length === 0 && (
        <p className="mt-6 text-sm text-zinc-500">
          数据库还是空的。先在 web 目录运行 <code className="rounded bg-zinc-200 px-1">npm run seed</code> 导入数据。
        </p>
      )}

      {must.length > 0 && (
        <section className="mt-3">
          <h2 className="border-b border-zinc-200 pb-2 text-base font-semibold">今日必读</h2>
          {must.map((it) => <ItemCard key={it.id} item={it} />)}
        </section>
      )}

      {groups.map((g) => (
        <section key={g.tag} className="mt-6">
          <h2 className="border-b border-zinc-200 pb-2 text-base font-semibold">
            {g.tag} <span className="text-xs font-normal text-zinc-400">{g.list.length} 条</span>
          </h2>
          {g.list.map((it) => <ItemCard key={it.id} item={it} />)}
        </section>
      ))}

      <p className="mt-8 text-xs text-zinc-400">
        攒下来的都在 <Link href="/later" className="underline">稍后读</Link>
      </p>
    </div>
  );
}
