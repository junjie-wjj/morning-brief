import Link from "next/link";
import { queryItems } from "@/lib/db";
import { groupOrderFor } from "@/lib/grouping";
import ItemCard from "./components/ItemCard";

// 每次请求实时读数据库再渲染（经典 SSR 模式）
export const dynamic = "force-dynamic";

export default async function Home() {
  // 只展示最新一期：避免首页被上线以来的全部历史条目淹没。
  // 没有期号的老数据（迁移前的库）退回展示全部，避免页面空白。
  const latestIssue = (await queryItems("SELECT MAX(issue) AS issue FROM items"))[0]?.issue ?? null;
  const items = latestIssue
    ? await queryItems("SELECT * FROM items WHERE issue = ? ORDER BY score DESC, date DESC, id DESC", latestIssue)
    : await queryItems("SELECT * FROM items ORDER BY score DESC, date DESC, id DESC");

  // 产品追踪与资讯分开：产品条目按产品分组、始终展示；资讯才按兴趣分过滤
  const productItems = items.filter((it) => it.product);
  const newsItems = items.filter((it) => !it.product);

  // 低分资讯（≤2）折叠到页面底部；未评分的条目不隐藏
  const newsKept = newsItems.filter((it) => it.score === null || it.score >= 3);
  const filtered = newsItems.filter((it) => it.score !== null && it.score <= 2);

  // 今日必读：资讯里兴趣分 4 分以上的前 3 条
  const must = newsKept.filter((it) => (it.score ?? 0) >= 4).slice(0, 3);
  const mustIds = new Set(must.map((it) => it.id));
  const groups = groupOrderFor(newsKept)
    .map((tag) => ({ tag, list: newsKept.filter((it) => !mustIds.has(it.id) && (it.tag ?? "其他") === tag) }))
    .filter((g) => g.list.length > 0);

  // 产品分组：按每个产品最新一条的时间倒序排列
  const productGroups = [...new Set(productItems.map((it) => it.product!))]
    .map((name) => {
      const list = productItems
        .filter((it) => it.product === name)
        .sort((a, b) => ((b.date ?? "") > (a.date ?? "") ? 1 : -1));
      return { name, list };
    })
    .sort((a, b) => ((b.list[0]?.date ?? "") > (a.list[0]?.date ?? "") ? 1 : -1));

  return (
    <div>
      <p className="text-xs text-zinc-400">
        {latestIssue ? `最新一期 · ${latestIssue}` : "全部条目"} · 共 {items.length} 条 ·{" "}
        <Link href="/archive" className="underline hover:text-zinc-600">查看历史</Link>
      </p>

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

      {productGroups.length > 0 && (
        <section className="mt-6">
          <h2 className="border-b border-zinc-200 pb-2 text-base font-semibold">
            产品追踪 <span className="text-xs font-normal text-zinc-400">{productGroups.length} 个产品 · 第一手发布</span>
          </h2>
          {productGroups.map((g) => (
            <div key={g.name} className="mt-4">
              <h3 className="border-l-2 border-indigo-400 pl-2 text-sm font-semibold text-zinc-700">{g.name}</h3>
              {g.list.slice(0, 3).map((it) => <ItemCard key={it.id} item={it} />)}
            </div>
          ))}
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

      {filtered.length > 0 && (
        <details className="mt-6 text-sm text-zinc-500">
          <summary className="cursor-pointer">已按兴趣分过滤 {filtered.length} 条低分条目（点击展开）</summary>
          {filtered.map((it) => <ItemCard key={it.id} item={it} />)}
        </details>
      )}

      <p className="mt-8 text-xs text-zinc-400">
        攒下来的都在 <Link href="/later" className="underline">稍后读</Link>
        {" · "}
        更早的简报在 <Link href="/archive" className="underline">历史</Link>
      </p>
    </div>
  );
}
