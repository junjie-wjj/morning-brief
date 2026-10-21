import { createClient, type Client } from "@libsql/client";

export type ItemStatus = "unread" | "read" | "later";

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
      product TEXT
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
    ];
    for (const [name, type] of cols) {
      if (existing.has(name)) continue;
      await getDb().execute(`ALTER TABLE items ADD COLUMN ${name} ${type}`);
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
