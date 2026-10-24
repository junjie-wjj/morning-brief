import Link from "next/link";
import { getFeedback, getPreferenceStats, getSettings, queryItems, type ItemRow } from "@/lib/db";
import { groupOrderFor } from "@/lib/grouping";
import { passesFilters, isBelowMinScore, rankScore, sortByRank, type FilterContext } from "@/lib/filters";
import { parseRelated } from "@/lib/related";
import ItemCard from "./components/ItemCard";
import {
  IconArrowRight,
  IconCalendar,
  IconChevronDown,
  IconCpu,
  IconNewspaper,
  IconSliders,
  IconSparkles,
  IconSun,
} from "./components/Icons";

// 每次请求实时读数据库再渲染（经典 SSR 模式）
export const dynamic = "force-dynamic";

// 服务器（Netlify）跑在 UTC，问候语必须显式按北京时间取小时，
// 否则北京时间早上 9 点会显示成"夜深了"。
const BEIJING_HOUR = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Shanghai",
  hour: "numeric",
  hourCycle: "h23",
});

function greeting() {
  const h = Number(BEIJING_HOUR.format(new Date()));
  if (h < 5) return "夜深了";
  if (h < 11) return "早上好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}

export default async function Home() {
  // 「收件箱」模式：最新一期的全部条目 + 往期中还没读完的条目。
  // 期号是首发定档的（见 seed.mjs）：旧闻不会每天重播；没看完的留在首页
  // 等你，读完（或标记）即退场。没有期号的老数据退回展示全部，避免页面空白。
  // 期号、筛选、反馈、偏好统计互不依赖，一次并行查完，少一个数据库往返。
  const [issueRows, settings, feedback, stats] = await Promise.all([
    queryItems("SELECT MAX(issue) AS issue FROM items"),
    getSettings(), getFeedback(), getPreferenceStats(),
  ]);
  const latestIssue = issueRows[0]?.issue ?? null;
  const rawItems = latestIssue
    ? await queryItems(
        "SELECT * FROM items WHERE issue = ? OR status != 'read' ORDER BY score DESC, date DESC, id DESC",
        latestIssue,
      )
    : await queryItems("SELECT * FROM items ORDER BY score DESC, date DESC, id DESC");
  // 被多源去重合并的报道不再单独展示（主条目下方有「相关报道」链接）
  const items = rawItems.filter((it) => !it.dup_of);

  // 筛选偏好 + 用户反馈（👍/👎 会影响排序与显示）
  const ctx: FilterContext = { settings, feedback, stats };

  // 产品追踪与资讯分开：产品条目只看「关注清单」，资讯走完整筛选
  const productItems = items.filter((it) => it.product).filter((it) => passesFilters(it, ctx));
  const newsItems = items.filter((it) => !it.product).filter((it) => passesFilters(it, ctx));

  // 低于兴趣分下限的资讯不丢弃，收进底部折叠区
  const newsVisible = sortByRank(newsItems.filter((it) => !isBelowMinScore(it, settings)), ctx);
  const lowScore = sortByRank(newsItems.filter((it) => isBelowMinScore(it, settings)), ctx);

  // 今日必读：按个性化排序分取前 3（反馈与偏好会微调排序）
  const must = newsVisible.filter((it) => rankScore(it, ctx) >= 4).slice(0, 3);
  const mustIds = new Set(must.map((it) => it.id));
  const groups = groupOrderFor(newsVisible)
    .map((tag) => ({ tag, list: newsVisible.filter((it) => !mustIds.has(it.id) && (it.tag ?? "其他") === tag) }))
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

  const card = (it: ItemRow) => (
    <ItemCard
      key={it.id}
      item={it}
      verdict={feedback.get(it.link) ?? null}
      related={parseRelated(it.related)}
    />
  );
  // 统计口径与页面一致：可见条目 + 折叠区低分条目 + 产品条目。
  // 之前的 bug：未读数把被筛选隐藏的条目也数进去，出现「共 63 条但未读 68 条」
  const displayed = [...newsVisible, ...lowScore, ...productItems];
  const unreadCount = displayed.filter((it) => it.status === "unread").length;
  // 收件箱模式下会混入往期未读，用徽标注明数量，避免「怎么还有旧新闻」的困惑
  const olderCount = displayed.filter((it) => it.issue && it.issue !== latestIssue).length;
  const isFiltered = settings.minScore !== 3 || settings.unreadOnly || settings.hideDownvoted
    || settings.blockedKeywords.length > 0 || settings.tags || settings.sources || settings.products;

  return (
    <div className="min-w-0">
      {/* 晨报 Hero：刊号 + 统计 + 入口 */}
      <section className="animate-rise overflow-hidden rounded-3xl border border-amber-200/60 bg-gradient-to-b from-white via-white to-amber-50/50 shadow-soft">
        <div className="flex flex-col gap-5 p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-700">
              <IconSun className="h-4 w-4" />
              {latestIssue ? `${latestIssue.replace(/-/g, " · ")} 刊` : "全部条目"}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <span className="rounded-full border border-line bg-white px-2.5 py-1">
                共 {displayed.length} 条
              </span>
              {olderCount > 0 ? (
                <span className="rounded-full border border-line bg-white px-2.5 py-1">
                  含往期未读 {olderCount} 条
                </span>
              ) : null}
              {unreadCount > 0 ? (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-800">
                  {unreadCount} 条未读
                </span>
              ) : null}
              {isFiltered ? (
                <Link
                  href="/settings"
                  className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-2.5 py-1 hover:border-amber-300 hover:text-amber-800"
                >
                  <IconSliders className="h-3.5 w-3.5" />
                  筛选中
                </Link>
              ) : null}
            </div>
          </div>

          <h1 className="font-serif text-3xl font-semibold tracking-tight text-ink sm:text-[2.6rem] sm:leading-[1.15]">
            {greeting()}，
            <br className="sm:hidden" />
            这是今天的 AI 早餐。
          </h1>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted">
            <Link href="/archive" className="group inline-flex items-center gap-1 font-medium text-ink hover:text-amber-800">
              <IconCalendar className="h-4 w-4 text-amber-600" />
              查看历史
              <IconArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link href="/settings" className="group inline-flex items-center gap-1 font-medium text-ink hover:text-amber-800">
              <IconSliders className="h-4 w-4 text-amber-600" />
              筛选设置
            </Link>
            <span className="hidden items-center gap-1 sm:inline-flex">
              <IconNewspaper className="h-4 w-4 text-amber-600" />
              摘要由 AI 生成，以原文为准
            </span>
          </div>
        </div>
      </section>

      {items.length === 0 && (
        <p className="mt-6 text-sm text-muted">
          数据库还是空的。先在 web 目录运行 <code className="rounded bg-paper-deep px-1.5 py-0.5">npm run seed</code> 导入数据。
        </p>
      )}

      {must.length > 0 && (
        <section className="mt-10">
          <header className="flex items-end justify-between">
            <div className="flex items-center gap-2">
              <IconSparkles className="h-4 w-4 text-amber-600" />
              <h2 className="font-serif text-xl font-semibold tracking-tight text-ink">今日必读</h2>
            </div>
            <span className="text-[11px] text-muted">按兴趣分与你的反馈排序</span>
          </header>
          <div className="mt-4 grid auto-rows-min grid-cols-1 gap-4 md:grid-cols-3">
            {must.map((it, i) => (
              <ItemCard
                key={it.id}
                item={it}
                rank={i + 1}
                variant="featured"
                verdict={feedback.get(it.link) ?? null}
                related={parseRelated(it.related)}
              />
            ))}
          </div>
        </section>
      )}

      {productGroups.length > 0 && (
        <section className="mt-12">
          <header className="flex items-end justify-between">
            <div className="flex items-center gap-2">
              <IconCpu className="h-4 w-4 text-indigo-600" />
              <h2 className="font-serif text-xl font-semibold tracking-tight text-ink">产品追踪</h2>
            </div>
            <span className="text-[11px] text-muted">{productGroups.length} 个产品 · 第一手发布</span>
          </header>
          <div className="mt-4 grid auto-rows-min grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {productGroups.map((g) => (
              <div key={g.name} className="min-w-0 rounded-2xl border border-line bg-white p-4 shadow-soft">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold tracking-tight text-ink">{g.name}</h3>
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
                    {g.list.length} 更新
                  </span>
                </div>
                <div className="mt-1 divide-y divide-line/60">
                  {g.list.slice(0, 3).map((it) => (
                    <ItemCard
                      key={it.id}
                      item={it}
                      variant="compact"
                      verdict={feedback.get(it.link) ?? null}
                      related={parseRelated(it.related)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {groups.map((g) => (
        <section key={g.tag} className="mt-12">
          <header className="flex items-end justify-between border-b border-line pb-3">
            <h2 className="font-serif text-xl font-semibold tracking-tight text-ink">{g.tag}</h2>
            <span className="text-[11px] text-muted">{g.list.length} 条</span>
          </header>
          <div className="mt-4 flex min-w-0 flex-col gap-4">
            {g.list.map(card)}
          </div>
        </section>
      ))}

      {lowScore.length > 0 && (
        <details className="group mt-12 rounded-2xl border border-line bg-white/60">
          <summary className="flex cursor-pointer select-none items-center justify-between px-5 py-4 text-sm text-muted hover:text-ink">
            <span>
              已按兴趣分过滤 <span className="font-semibold text-ink">{lowScore.length}</span> 条低分条目
            </span>
            <IconChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="flex min-w-0 flex-col gap-4 px-5 pb-5">
            {lowScore.map(card)}
          </div>
        </details>
      )}

      <nav className="mt-12 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted">
        <Link href="/later" className="inline-flex items-center gap-1 hover:text-ink">
          <IconCalendar className="h-3.5 w-3.5" />
          攒下来的都在「稍后读」
        </Link>
        <Link href="/archive" className="inline-flex items-center gap-1 hover:text-ink">
          <IconNewspaper className="h-3.5 w-3.5" />
          更早的简报在「历史」
        </Link>
      </nav>
    </div>
  );
}
