import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

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

let db: DatabaseSync | null = null;

// 单例：整个应用共用一个数据库连接（Node 24 内置 SQLite，无需安装任何依赖）
export function getDb(): DatabaseSync {
  if (!db) {
    const dir = path.join(process.cwd(), "data");
    fs.mkdirSync(dir, { recursive: true });
    db = new DatabaseSync(path.join(dir, "brief.db"));
    db.exec(`
      CREATE TABLE IF NOT EXISTS items (
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
      )
    `);
  }
  return db;
}

// 查询条目并把每一行转成纯对象——
// 跨过「服务端组件 → 客户端组件」边界传递的数据必须是 plain object
export function queryItems(sql: string, ...params: (string | number)[]): ItemRow[] {
  return (getDb().prepare(sql).all(...params) as unknown as ItemRow[]).map((r) => ({ ...r }));
}
