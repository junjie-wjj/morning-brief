import { createClient, type Client } from "@libsql/client";

export type ItemStatus = "unread" | "read" | "later";

// 筛选偏好：单用户应用，存在数据库里以便跨设备一致
// 关注方向名单：与流水线侧 lib/watch-topics.mjs 的 WATCH_TOPICS 保持一致
export const WATCH_TOPICS = ["免费额度", "榜单动态", "MCP/插件/技能", "价格变动", "OpenRouter 免费模型"] as const;

export interface Settings {
  minScore: number;            // 兴趣分下限（产品条目不参与）
  tags: string[] | null;       // null = 全部分类
  sources: string[] | null;    // null = 全部来源
  unreadOnly: boolean;         // 只显示未读
  products: string[] | null;   // null = 全部产品
  blockedKeywords: string[];   // 标题包含这些词就不显示
  hideDownvoted: boolean;      // 隐藏点过「不感兴趣」的条目
  blockMode: "hide" | "drop";  // 屏蔽词作用范围：仅隐藏（默认）/ 彻底不抓（每日更新时从源头丢弃并清理档案）
  dropLowScore: boolean;       // 每日更新时兴趣分 ≤2 的资讯不入库（省 AI 额度）
  watchTopics: string[] | null; // 关注方向（固定搜索+OpenRouter）：null = 全部启用，每晚流水线生效
}

export const DEFAULT_SETTINGS: Settings = {
  minScore: 3,
  tags: null,
  sources: null,
  unreadOnly: false,
  products: null,
  blockedKeywords: [],
  hideDownvoted: true,
  blockMode: "hide",
  dropLowScore: false,
  watchTopics: null,
};

export interface ItemRow {
  id: number;
  link: string;
  date: string | null;
  source: string;
  title: string;
  zh_title: string | null;
  summary: string | null;
  tag: string | null;
  score: number | null;
  status: ItemStatus;
  // 原文精简版（由 brief.mjs 在抓取阶段生成，见 lib/extract.mjs）：
  // points 为空表示没生成，points_reason 说明原因或分段覆盖情况
  points: string | null;
  points_reason: string | null;
  body_chars: number | null;
  body_via: string | null;
  // 产品追踪：非空表示这是某个产品的第一手更新（新模型/新版本/官方公告），
  // 页面上按产品分组展示，不参与资讯的兴趣分过滤
  product: string | null;
  // 期号（北京时间日期，如 2026-10-21）：首页只展示最新一期，历史在 /archive
  issue: string | null;
  // 多源去重：dup_of 非空表示这条被合并进主条目（页面上隐藏）；
  // related 是主条目挂的其他报道（JSON 数组：{title, link, source}）
  dup_of: string | null;
  related: string | null;
}

let client: Client | null = null;

// 数据库连接：默认连本地文件（file:./data/brief.db）；
// 上云后在环境变量里把 LIBSQL_URL 换成 Turso 云库地址（libsql://...），代码一行不用改
export function getDb(): Client {
  if (!client) {
    client = createClient({
      url: process.env.LIBSQL_URL ?? "file:./data/brief.db",
      authToken: process.env.LIBSQL_AUTH_TOKEN,
    });
  }
  return client;
}

// 建表只执行一次（应用首次读库时自动完成，云端库也用这一句初始化）
let ready: Promise<unknown> | null = null;
function initSchema(): Promise<unknown> {
  // 新库直接带上精简版相关列
  ready ??= (async () => {
    await getDb().execute(`CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      link TEXT NOT NULL UNIQUE,
      date TEXT,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      zh_title TEXT,
      summary TEXT,
      tag TEXT,
      score INTEGER,
      status TEXT NOT NULL DEFAULT 'unread',
      points TEXT,
      points_reason TEXT,
      body_chars INTEGER,
      body_via TEXT,
      product TEXT,
      issue TEXT,
      dup_of TEXT,
      related TEXT
    )`);

    // 旧库补列：SQLite 的 ALTER TABLE ADD COLUMN 对已存在的列会报错，
    // 所以先查 PRAGMA 再补，保证应用在任何库上都能安全自迁移。
    const existing = new Set(
      (await getDb().execute("PRAGMA table_info(items)")).rows.map((r) => String(r.name)),
    );
    const cols: [string, string][] = [
      ["points", "TEXT"],
      ["points_reason", "TEXT"],
      ["body_chars", "INTEGER"],
      ["body_via", "TEXT"],
      ["product", "TEXT"],
      ["issue", "TEXT"],
      ["dup_of", "TEXT"],
      ["related", "TEXT"],
    ];
    for (const [name, type] of cols) {
      if (existing.has(name)) continue;
      await getDb().execute(`ALTER TABLE items ADD COLUMN ${name} ${type}`);
    }

    // 筛选偏好（单行 JSON）与用户反馈（每条链接一条）
    await getDb().execute(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`);
    await getDb().execute(`CREATE TABLE IF NOT EXISTS feedback (
      link TEXT PRIMARY KEY,
      verdict TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      tag TEXT,
      product TEXT
    )`);
    // 反馈快照列的自迁移：tag/product 记录点赞那一刻的条目分类，
    // 统计不再依赖 join items——条目删除后偏好画像不失真（"删除失忆"修复）
    const fbCols = new Set(
      (await getDb().execute("PRAGMA table_info(feedback)")).rows.map((r) => String(r.name)),
    );
    if (!fbCols.has("tag")) await getDb().execute("ALTER TABLE feedback ADD COLUMN tag TEXT");
    if (!fbCols.has("product")) await getDb().execute("ALTER TABLE feedback ADD COLUMN product TEXT");

    // 常用查询索引：历史页按期筛选 / 去重过滤 / 时间排序都吃这几个
    for (const idx of [
      "CREATE INDEX IF NOT EXISTS idx_items_issue ON items(issue)",
      "CREATE INDEX IF NOT EXISTS idx_items_dup ON items(dup_of)",
      "CREATE INDEX IF NOT EXISTS idx_items_date ON items(date DESC)",
    ]) {
      await getDb().execute(idx);
    }
  })();
  return ready;
}

// 查询条目并把每行转成纯对象——
// 跨过「服务端组件 → 客户端组件」边界传递的数据必须是 plain object
export async function queryItems(
  sql: string,
  ...params: (string | number | null)[]
): Promise<ItemRow[]> {
  await initSchema();
  const rs = await getDb().execute({ sql, args: params });
  return rs.rows.map((r) => ({ ...r })) as unknown as ItemRow[];
}

// 写操作（UPDATE / INSERT / DELETE），返回 { rowsAffected, ... }
export async function execute(sql: string, args: (string | number | null)[]) {
  await initSchema();
  return getDb().execute({ sql, args });
}

// ---------- 筛选偏好与反馈 ----------

export async function getSettings(): Promise<Settings> {
  await initSchema();
  const rs = await getDb().execute("SELECT value FROM settings WHERE key = 'filters'");
  const raw = rs.rows[0]?.value;
  if (typeof raw !== "string") return DEFAULT_SETTINGS;
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await initSchema();
  await getDb().execute({
    sql: `INSERT INTO settings (key, value) VALUES ('filters', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    args: [JSON.stringify(settings)],
  });
}

export type Verdict = "up" | "down";

export async function getFeedback(): Promise<Map<string, Verdict>> {
  await initSchema();
  const rs = await getDb().execute("SELECT link, verdict FROM feedback");
  return new Map(rs.rows.map((r) => [String(r.link), String(r.verdict) as Verdict]));
}

export async function setFeedback(
  link: string,
  verdict: Verdict | null,
  snapshot?: { tag?: string | null; product?: string | null },
): Promise<void> {
  await initSchema();
  if (verdict === null) {
    await getDb().execute({ sql: "DELETE FROM feedback WHERE link = ?", args: [link] });
    return;
  }
  await getDb().execute({
    // 快照列点赞时写入：以后条目被删，"踩过 WorkBuddy 产品动态"这类事实仍留在统计里
    sql: `INSERT INTO feedback (link, verdict, updated_at, tag, product) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(link) DO UPDATE SET verdict = excluded.verdict, updated_at = excluded.updated_at,
            tag = COALESCE(excluded.tag, feedback.tag), product = COALESCE(excluded.product, feedback.product)`,
    args: [
      link,
      verdict,
      new Date().toISOString(),
      snapshot?.tag ?? null,
      snapshot?.product ?? null,
    ],
  });
}

/** 反馈画像：按分类/来源统计点赞与点踩，用于调整显示排序 */
export interface PreferenceStats {
  tagBias: Map<string, number>;
  sourceBias: Map<string, number>;
}

export async function getPreferenceStats(): Promise<PreferenceStats> {
  await initSchema();
  // 优先读反馈自带的快照列（条目删除后画像不失真），老数据回退到 join 现存条目
  const rs = await getDb().execute(`
    SELECT f.verdict, COALESCE(f.tag, i.tag) AS tag, i.source, COUNT(*) AS c
    FROM feedback f LEFT JOIN items i ON i.link = f.link
    GROUP BY f.verdict, COALESCE(f.tag, i.tag), i.source
  `);
  const tagBias = new Map<string, number>();
  const sourceBias = new Map<string, number>();
  const bump = (map: Map<string, number>, key: unknown, delta: number) => {
    if (typeof key !== "string" || !key) return;
    map.set(key, (map.get(key) ?? 0) + delta);
  };
  for (const r of rs.rows) {
    const delta = r.verdict === "up" ? 0.4 : -0.8;
    bump(tagBias, r.tag, delta);
    bump(sourceBias, r.source, delta);
  }
  const clamp = (m: Map<string, number>) => {
    for (const [k, v] of m) m.set(k, Math.max(-2, Math.min(2, v)));
  };
  clamp(tagBias);
  clamp(sourceBias);
  return { tagBias, sourceBias };
}

/** 设置页需要的可选项（分类、来源、产品） */
export async function getFilterOptions(): Promise<{ tags: string[]; sources: string[]; products: string[] }> {  await initSchema();
  const tags = await getDb().execute("SELECT DISTINCT tag FROM items WHERE tag IS NOT NULL ORDER BY tag");
  const sources = await getDb().execute("SELECT DISTINCT source FROM items WHERE product IS NULL ORDER BY source");
  const products = await getDb().execute("SELECT DISTINCT product FROM items WHERE product IS NOT NULL ORDER BY product");
  const col = (rs: { rows: unknown[] }, key: string) =>
    rs.rows.map((r) => String((r as Record<string, unknown>)[key])).filter(Boolean);
  return { tags: col(tags, "tag"), sources: col(sources, "source"), products: col(products, "product") };
}

// ---------- 系统眼中的你：画像可视化 + 阅读统计 ----------

// 分类 → 偏好搜索词的映射（与流水线 lib/preferences.mjs 的 TAG_SEARCH_QUERIES 同源）
const TAG_SEARCH_QUERIES: Record<string, string> = {
  福利资源: "free LLM API",
  模型发布: "new AI model",
  研究进展: "AI research paper",
};

export interface Insights {
  tags: { tag: string; up: number; down: number }[];
  products: { name: string; up: number; down: number }[];
  reading: { total: number; read: number; later: number; unread: number; ups: number; downs: number };
  /** 当前因净赞 ≥2 而实际启用的偏好搜索词 */
  searchTerms: { term: string; kind: "product" | "tag"; label: string }[];
}

/** 画像与阅读统计：反馈读快照列（删除不失真），阅读数按条目状态汇总 */
export async function getInsights(): Promise<Insights> {
  await initSchema();
  const fb = await getDb().execute(`
    SELECT f.verdict, COALESCE(f.tag, i.tag) AS tag, COALESCE(f.product, i.product) AS product, COUNT(*) AS c
    FROM feedback f LEFT JOIN items i ON i.link = f.link
    GROUP BY f.verdict, COALESCE(f.tag, i.tag), COALESCE(f.product, i.product)
  `);
  const tagMap = new Map<string, { up: number; down: number }>();
  const prodMap = new Map<string, { up: number; down: number }>();
  let ups = 0;
  let downs = 0;
  for (const r of fb.rows) {
    const n = Number(r.c) || 0;
    if (r.verdict === "up") ups += n;
    else downs += n;
    const tag = typeof r.tag === "string" && r.tag ? r.tag : null;
    const prod = typeof r.product === "string" && r.product ? r.product : null;
    if (tag) {
      const cur = tagMap.get(tag) ?? { up: 0, down: 0 };
      if (r.verdict === "up") cur.up += n; else cur.down += n;
      tagMap.set(tag, cur);
    }
    if (prod) {
      const cur = prodMap.get(prod) ?? { up: 0, down: 0 };
      if (r.verdict === "up") cur.up += n; else cur.down += n;
      prodMap.set(prod, cur);
    }
  }
  const st = await getDb().execute(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN status = 'read' THEN 1 ELSE 0 END) AS read,
      SUM(CASE WHEN status = 'later' THEN 1 ELSE 0 END) AS later,
      SUM(CASE WHEN status = 'unread' THEN 1 ELSE 0 END) AS unread
    FROM items WHERE dup_of IS NULL
  `);
  const row = st.rows[0] as Record<string, unknown>;

  const searchTerms: Insights["searchTerms"] = [];
  for (const [name, v] of prodMap) {
    if (v.up - v.down >= 2) searchTerms.push({ term: name, kind: "product", label: name });
  }
  for (const [tag, v] of tagMap) {
    const q = TAG_SEARCH_QUERIES[tag];
    if (q && v.up - v.down >= 2) searchTerms.push({ term: q, kind: "tag", label: tag });
  }

  return {
    tags: [...tagMap.entries()].map(([tag, v]) => ({ tag, ...v })).sort((a, b) => (b.up - b.down) - (a.up - a.down)),
    products: [...prodMap.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => (b.up - b.down) - (a.up - a.down)),
    reading: {
      total: Number(row.total) || 0,
      read: Number(row.read) || 0,
      later: Number(row.later) || 0,
      unread: Number(row.unread) || 0,
      ups,
      downs,
    },
    searchTerms,
  };
}
