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
  ready ??= getDb().execute(`CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    link TEXT NOT NULL UNIQUE,
    date TEXT,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    zh_title TEXT,
    summary TEXT,
    tag TEXT,
    score INTEGER,
    status TEXT NOT NULL DEFAULT 'unread'
  )`);
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
