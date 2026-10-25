import Link from "next/link";
import { execute, getFeedback, getSettings, queryItems, type ItemRow } from "@/lib/db";
import { parseRelated } from "@/lib/related";
import ItemCard from "../components/ItemCard";
import MarkAllReadButton from "../components/MarkAllReadButton";
import DeleteDownvotedButton from "../components/DeleteDownvotedButton";
import { IconCalendar, IconChevronDown, IconSearch } from "../components/Icons";

// 历史页：按期号（北京时间日期）分组、分页；关键词搜索（标题/摘要/原文精简版，
// 支持高亮与按时间/相关度排序）；日期胶囊直达某一期；可隐藏点踩过的条目。
export const dynamic = "force-dynamic";

const PAGE_SIZE = 40;

// 用户输入只做 LIKE 匹配：%/_/\ 是通配符或转义符，先转义避免「输入 % 匹配全部」
function likePattern(q: string) {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export default async function Archive({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; issue?: string; sort?: string; nodown?: string; noblock?: string }>;
}) {
  const { page: pageParam, q: qParam, issue: issueParam, sort: sortParam, nodown: nodownParam, noblock: noblockParam } =
    await searchParams;
  const q = (qParam ?? "").trim().slice(0, 80);
  const sort = sortParam === "relevance" ? "relevance" : "time";
  const hideDown = nodownParam === "1";
  const hideBlock = noblockParam === "1";
  // 期号筛选：只接受 YYYY-MM-DD 形态，防手改 URL 塞进奇怪的东西
  const issueSel = /^\d{4}-\d{2}-\d{2}$/.test(issueParam ?? "") ? issueParam! : "";
  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const conditions = ["dup_of IS NULL"];
  const args: (string | number)[] = [];
  if (q) {
    conditions.push(
      "(zh_title LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR points LIKE ? ESCAPE '\\')",
    );
    const p = likePattern(q);
    args.push(p, p, p, p);
  }
  if (issueSel) {
    conditions.push("issue = ?");
    args.push(issueSel);
  }
  if (hideDown) {
    conditions.push("link NOT IN (SELECT link FROM feedback WHERE verdict = 'down')");
  }
  // 屏蔽词同步隐藏（可选）：历史页默认是完整合订本，这个开关让屏蔽词
  // 在历史页同样生效——和首页同一口径（大小写不敏感，匹配标题）
  if (hideBlock) {
    const settings = await getSettings();
    for (const k of settings.blockedKeywords) {
      const p = likePattern(k.toLowerCase());
      conditions.push(
        "(LOWER(COALESCE(zh_title, '')) NOT LIKE ? ESCAPE '\\' AND LOWER(title) NOT LIKE ? ESCAPE '\\')",
      );
      args.push(p, p);
    }
  }
  const where = conditions.join(" AND ");

  // 相关度排序：标题命中的排在仅摘要/正文命中的前面，组内按兴趣分、时间递减
  const orderSql =
    sort === "relevance"
      ? "(CASE WHEN zh_title LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END), score DESC, date DESC, id DESC"
      : "date DESC, id DESC";
  const orderArgs = sort === "relevance" ? [likePattern(q), likePattern(q)] : [];

  const [items, countResult, feedback, issueRows, unreadRows] = await Promise.all([
    queryItems(
      `SELECT * FROM items WHERE ${where} ORDER BY ${orderSql} LIMIT ? OFFSET ?`,
      ...args,
      ...orderArgs,
      PAGE_SIZE,
      offset,
    ),
    execute(`SELECT COUNT(*) AS n FROM items WHERE ${where}`, args),
    getFeedback(),
    // 日期导航条：每期一行（期号 + 条数），搜索时不展示，避免与搜索结果混淆
    q
      ? Promise.resolve([] as { issue: string | null; n: number }[])
      : execute(
          "SELECT issue, COUNT(*) AS n FROM items WHERE dup_of IS NULL AND issue IS NOT NULL GROUP BY issue ORDER BY issue DESC",
          [],
        ).then((r) => r.rows as unknown as { issue: string | null; n: number }[]),
    // 一键已读 / 删除全部点踩 的确认数：当前浏览范围（不跟随搜索词）内统计
    q
      ? Promise.resolve([{ unread: 0, downed: 0 }])
      : execute(
          `SELECT
             (SELECT COUNT(*) FROM items WHERE dup_of IS NULL AND status = 'unread' ${
               issueSel ? "AND issue = ?" : ""
             } ${hideDown ? "AND link NOT IN (SELECT link FROM feedback WHERE verdict = 'down')" : ""}) AS unread,
             (SELECT COUNT(*) FROM items WHERE dup_of IS NULL AND link IN (SELECT link FROM feedback WHERE verdict = 'down')) AS downed`,
          issueSel ? [issueSel] : [],
        ).then((r) => r.rows as unknown as { unread: number; downed: number }[]),
  ]);
  const total = Number(countResult.rows[0]?.n ?? 0);
  const unreadTotal = Number(unreadRows[0]?.unread ?? 0);
  const downedTotal = Number(unreadRows[0]?.downed ?? 0);
  const hasOlder = page * PAGE_SIZE < total;

  // 链接构造统一走这里，保证翻页/切换时携带全部当前状态
  const pageHref = (n: number) => {
    const params = new URLSearchParams();
    params.set("page", String(n));
    if (q) params.set("q", q);
    if (sort === "relevance") params.set("sort", "relevance");
    if (issueSel) params.set("issue", issueSel);
    if (hideDown) params.set("nodown", "1");
    if (hideBlock) params.set("noblock", "1");
    return `/archive?${params.toString()}`;
  };
  const withParams = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (sort === "relevance") params.set("sort", "relevance");
    if (issueSel) params.set("issue", issueSel);
    if (hideDown) params.set("nodown", "1");
    if (hideBlock) params.set("noblock", "1");
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) params.delete(k);
      else params.set(k, v);
    }
    const s = params.toString();
    return s ? `/archive?${s}` : "/archive";
  };

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
            {q ? (
              <>与「{q}」相关 · {total} 条{total > PAGE_SIZE ? ` · 第 ${page} 页` : ""}</>
            ) : issueSel ? (
              <>{issueSel} 期 · {total} 条{total > PAGE_SIZE ? ` · 第 ${page} 页` : ""}</>
            ) : (
              <>第 {page} 页 · 共 {total} 条</>
            )}
          </span>
        </h1>

        {/* 日期导航：横向滚动的期号胶囊，点哪天看哪天 */}
        {!q && issueRows.length > 0 && (
          <nav aria-label="按期号浏览" className="mt-3 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            <Link
              href={withParams({ issue: null })}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs transition-colors ${
                issueSel
                  ? "border border-line bg-white text-ink-soft hover:border-amber-300"
                  : "bg-ink text-paper"
              }`}
            >
              全部
            </Link>
            {issueRows.map(({ issue, n }) => (
              <Link
                key={issue}
                href={withParams({ issue: issue! })}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs transition-colors ${
                  issueSel === issue
                    ? "bg-ink text-paper"
                    : "border border-line bg-white text-ink-soft hover:border-amber-300 hover:text-amber-800"
                }`}
              >
                {issue!.slice(5).replace("-", "/")}
                <span className="ml-1 opacity-60">{n}</span>
              </Link>
            ))}
          </nav>
        )}

        <form action="/archive" method="get" className="mt-3 flex gap-2">
          <div className="relative flex-1">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="搜索标题、摘要或原文精简版，如 Kimi、免费额度、Claude"
              aria-label="搜索历史条目"
              className="w-full rounded-full border border-line bg-white py-2 pl-9 pr-3 text-sm text-ink outline-none placeholder:text-muted/70 focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
            />
          </div>
          <button
            type="submit"
            className="shrink-0 rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper transition-colors hover:bg-ink-soft"
          >
            搜索
          </button>
        </form>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
          {q ? (
            <>
              <span className="inline-flex overflow-hidden rounded-full border border-line">
                <Link
                  href={withParams({ sort: null, page: null })}
                  className={`px-2.5 py-1 ${sort === "time" ? "bg-ink text-paper" : "bg-white text-ink-soft hover:text-amber-800"}`}
                >
                  按时间
                </Link>
                <Link
                  href={withParams({ sort: "relevance", page: null })}
                  className={`px-2.5 py-1 ${sort === "relevance" ? "bg-ink text-paper" : "bg-white text-ink-soft hover:text-amber-800"}`}
                >
                  按相关度
                </Link>
              </span>
              <span>每页 {PAGE_SIZE} 条。</span>
              <Link href="/archive" className="text-amber-800 underline underline-offset-2 hover:text-amber-900">
                清除搜索
              </Link>
            </>
          ) : (
            <>
              {unreadTotal > 0 ? (
                <MarkAllReadButton
                  scope={issueSel ? { issue: issueSel } : { all: true }}
                  count={unreadTotal}
                />
              ) : null}
              <Link
                href={withParams({ nodown: hideDown ? null : "1", page: null })}
                className={`rounded-full border px-2.5 py-1 transition-colors ${
                  hideDown
                    ? "border-rose-200 bg-rose-50 text-rose-700"
                    : "border-line bg-white text-ink-soft hover:border-amber-300 hover:text-amber-800"
                }`}
                title="隐藏点过「踩」的条目（数据仍保留，随时可关掉开关找回）"
              >
                {hideDown ? "已隐藏点踩条目 ✓" : "隐藏点踩条目"}
              </Link>
              <Link
                href={withParams({ noblock: hideBlock ? null : "1", page: null })}
                className={`rounded-full border px-2.5 py-1 transition-colors ${
                  hideBlock
                    ? "border-rose-200 bg-rose-50 text-rose-700"
                    : "border-line bg-white text-ink-soft hover:border-amber-300 hover:text-amber-800"
                }`}
                title="屏蔽词在历史页同样隐藏（默认历史页显示全部；需要先在设置里添加屏蔽词）"
              >
                {hideBlock ? "已隐藏屏蔽词条目 ✓" : "屏蔽词也隐藏"}
              </Link>
              <DeleteDownvotedButton count={downedTotal} />
              {issueSel ? (
                <Link href="/archive" className="text-amber-800 underline underline-offset-2 hover:text-amber-900">
                  查看全部
                </Link>
              ) : (
                <span>每页 {PAGE_SIZE} 条，按时间倒序；也可以直接点上面的日期。</span>
              )}
            </>
          )}
        </div>
      </header>

      {items.length === 0 && (
        <p className="mt-6 text-sm text-muted">
          {q ? <>没有找到与「{q}」相关的条目，换个词试试？</> : <>还没有历史数据。</>}
        </p>
      )}

      {entries.map(([issue, list]) => (
        <section key={issue} className="mt-8">
          {/* 已选某一期时页面标题就是期号，组内再挂标题属于重复信息 */}
          {!issueSel && (
            <div className="sticky top-[61px] z-30 -mx-1 flex items-baseline gap-3 border-b border-line bg-paper/90 px-1 py-2.5 backdrop-blur">
              <h2 className="font-serif text-lg font-semibold tracking-tight text-ink">
                {issue === "更早" ? "更早（未分期）" : issue}
              </h2>
              <span className="text-[11px] text-muted">本页 {list.length} 条</span>
            </div>
          )}
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {list.map((it) => (
              <ItemCard
                key={it.id}
                item={it}
                verdict={feedback.get(it.link) ?? null}
                related={parseRelated(it.related)}
                highlight={q || undefined}
              />
            ))}
          </div>
        </section>
      ))}

      <nav className="mt-10 flex items-center justify-between gap-3 border-t border-line pt-4 text-sm">
        {page > 1 ? (
          <Link
            href={pageHref(page - 1)}
            className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-4 py-2 text-ink-soft hover:border-amber-300 hover:text-amber-800"
          >
            <IconChevronDown className="h-4 w-4 rotate-90" />
            较新的一页
          </Link>
        ) : <span />}
        {hasOlder ? (
          <Link
            href={pageHref(page + 1)}
            className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-4 py-2 text-ink-soft hover:border-amber-300 hover:text-amber-800"
          >
            更早的一页
            <IconChevronDown className="h-4 w-4 -rotate-90" />
          </Link>
        ) : (
          <span className="text-xs text-muted">已经是最后一页</span>
        )}
      </nav>
    </div>
  );
}
