import { queryItems } from "@/lib/db";
import ItemCard from "../components/ItemCard";

// 每次请求实时读数据库再返回页面
export const instant = false;

export default async function Later() {
  const items = await queryItems("SELECT * FROM items WHERE status = 'later' ORDER BY id DESC");

  return (
    <div>
      <h1 className="border-b border-zinc-200 pb-2 text-base font-semibold">
        稍后读 <span className="text-xs font-normal text-zinc-400">{items.length} 条</span>
      </h1>
      {items.length === 0 && (
        <p className="mt-6 text-sm text-zinc-500">空空如也。在首页点「稍后读」就会出现在这里。</p>
      )}
      {items.map((it) => <ItemCard key={it.id} item={it} />)}
    </div>
  );
}
