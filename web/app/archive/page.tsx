import Link from "next/link";
import { execute, getFeedback, queryItems, type ItemRow } from "@/lib/db";
import { parseRelated } from "@/lib/related";
import ItemCard from "../components/ItemCard";
import { IconCalendar, IconChevronDown, IconSearch } from "../components/Icons";

// 历史页：按期号（北京时间日期）分组，分页展示；支持关键词搜索（中文/英文标题与摘要）。
export const dynamic = "force-dynamic";

const PAGE_SIZE = 40;

// 用户输入只做 LIKE 匹配：%/_/\ 是通配符或转义符，先转义避免「输入 % 匹配全部」
function likePattern(q: string) {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export default async function Archive({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; issue?: string }>;
}) {
  const { page: pageParam, q: qParam, issue: issueParam } = await searchParams;
  const q = (qParam ?? "").trim().slice(0, 80);
  // 期号筛选：只接受 YYYY-MM-DD 形态，防手改 URL 塞进奇怪的东西
  const issueSel = /^\d{4}-\d{2}-\d{2}$/.test(issueParam ?? "") ? issueParam! : "";
  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const conditions = ["dup_of IS NULL"];
  const args: (string | number)[] = [];
  if (q) {
    conditions.push("(zh_title LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\')");
    const p = likePattern(q);
    args.push(p, p, p);
  }
  if (issueSel) {
    conditions.push("issue = ?");
    args.push(issueSel);
  }
  const where = conditions.join(" AND ");

  const [items, countResult, feedback, issueRows] = await Promise.all([
    queryItems(
      `SELECT * FROM items WHERE ${where} ORDER BY date DESC, id DESC LIMIT ? OFFSET ?`,
      ...args,
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
  ]);
  const total = Number(countResult.rows[0]?.n ?? 0);
  const hasOlder = page * PAGE_SIZE < total;
  const pageHref = (n: number) => {
    const params = new URLSearchParams();
    params.set("page", String(n));
    if (q) params.set("q", q);
    if (issueSel) params.set("issue", issueSel);
    return `/archive?${params.toString()}`;
  };
  const chipHref = (d: string) => `/archive?issue=${d}`;

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
              href="/archive"
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
                href={chipHref(issue!)}
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
              placeholder="搜索标题或摘要，如 Kimi、免费额度、Claude"
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

        <p className="mt-2 text-xs text-muted">
          {q ? (
            <>
              搜索结果按时间倒序，每页 {PAGE_SIZE} 条。
              <Link href="/archive" className="ml-1 text-amber-800 underline underline-offset-2 hover:text-amber-900">
                清除搜索
              </Link>
            </>
          ) : issueSel ? (
            <>
              只看 {issueSel} 这一期，按时间倒序。
              <Link href="/archive" className="ml-1 text-amber-800 underline underline-offset-2 hover:text-amber-900">
                查看全部
              </Link>
            </>
          ) : (
            <>每页 {PAGE_SIZE} 条，按时间倒序；也可以直接点上面的日期。</>
          )}
        </p>
      </header>

      {items.length === 0 && (
        <p className="mt-6 text-sm text-muted">
          {q ? <>没有找到与「{q}」相关的条目，换个词试试？</> : <>还没有历史数据。</>}
        </p>
      )}

      {entries.map(([issue, list]) => (
        <section key={issue} className="mt-8">
          <div className="sticky top-[61px] z-30 -mx-1 flex items-baseline gap-3 border-b border-line bg-paper/90 px-1 py-2.5 backdrop-blur">
            <h2 className="font-serif text-lg font-semibold tracking-tight text-ink">
              {issue === "更早" ? "更早（未分期）" : issue}
            </h2>
            <span className="text-[11px] text-muted">{list.length} 条</span>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {list.map((it) => (
              <ItemCard
                key={it.id}
                item={it}
                verdict={feedback.get(it.link) ?? null}
                related={parseRelated(it.related)}
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
