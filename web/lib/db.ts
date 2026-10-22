import { createClient, type Client } from "@libsql/client";

export type ItemStatus = "unread" | "read" | "later";

// 筛选偏好：单用户应用，存在数据库里以便跨设备一致
export interface Settings {
  minScore: number;            // 兴趣分下限（产品条目不参与）
  tags: string[] | null;       // null = 全部分类
  sources: string[] | null;    // null = 全部来源
  unreadOnly: boolean;         // 只显示未读
  products: string[] | null;   // null = 全部产品
  blockedKeywords: string[];   // 标题包含这些词就不显示
  hideDownvoted: boolean;      // 隐藏点过「不感兴趣」的条目
}

export const DEFAULT_SETTINGS: Settings = {
  minScore: 3,
  tags: null,
  sources: null,
  unreadOnly: false,
  products: null,
  blockedKeywords: [],
  hideDownvoted: true,
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
      updated_at TEXT NOT NULL
    )`);
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

export async function setFeedback(link: string, verdict: Verdict | null): Promise<void> {
  await initSchema();
  if (verdict === null) {
    await getDb().execute({ sql: "DELETE FROM feedback WHERE link = ?", args: [link] });
    return;
  }
  await getDb().execute({
    sql: `INSERT INTO feedback (link, verdict, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(link) DO UPDATE SET verdict = excluded.verdict, updated_at = excluded.updated_at`,
    args: [link, verdict, new Date().toISOString()],
  });
}

/** 反馈画像：按分类/来源统计点赞与点踩，用于调整显示排序 */
export interface PreferenceStats {
  tagBias: Map<string, number>;
  sourceBias: Map<string, number>;
}

export async function getPreferenceStats(): Promise<PreferenceStats> {
  await initSchema();
  const rs = await getDb().execute(`
    SELECT f.verdict, i.tag, i.source, COUNT(*) AS c
    FROM feedback f JOIN items i ON i.link = f.link
    GROUP BY f.verdict, i.tag, i.source
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
export async function getFilterOptions(): Promise<{ tags: string[]; sources: string[]; products: string[] }> {
  await initSchema();
  const tags = await getDb().execute("SELECT DISTINCT tag FROM items WHERE tag IS NOT NULL ORDER BY tag");
  const sources = await getDb().execute("SELECT DISTINCT source FROM items WHERE product IS NULL ORDER BY source");
  const products = await getDb().execute("SELECT DISTINCT product FROM items WHERE product IS NOT NULL ORDER BY product");
  const col = (rs: { rows: unknown[] }, key: string) =>
    rs.rows.map((r) => String((r as Record<string, unknown>)[key])).filter(Boolean);
  return { tags: col(tags, "tag"), sources: col(sources, "source"), products: col(products, "product") };
}
