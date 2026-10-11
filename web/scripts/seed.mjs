// 把 ../docs/data.json 导入数据库（本地文件库或 Turso 云库，由环境变量决定）。
// 运行：cd web && npm run seed
import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 简易 .env.local 读取（零依赖）：Next.js 会自动加载它，但本脚本需要手动读
const envFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env.local");
try {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const data = JSON.parse(readFileSync(path.join(root, "docs", "data.json"), "utf8"));

const url = process.env.LIBSQL_URL ?? "file:./data/brief.db";
const db = createClient({ url, authToken: process.env.LIBSQL_AUTH_TOKEN });

await db.execute(`CREATE TABLE IF NOT EXISTS items (
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

// 内容更新就覆盖，但 status 列不在更新范围——用户在应用里的已读/稍后读不会被导入覆盖
const upsert = `INSERT INTO items (link, date, source, title, zh_title, summary, tag, score)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(link) DO UPDATE SET
    date = excluded.date, source = excluded.source, title = excluded.title,
    zh_title = excluded.zh_title, summary = excluded.summary,
    tag = excluded.tag, score = excluded.score`;

let n = 0;
for (const it of data.items) {
  await db.execute({
    sql: upsert,
    args: [it.link, it.date ?? data.generatedAt, it.source, it.title,
      it.zh, it.summary, it.tag, it.score],
  });
  n++;
}
console.log(`导入完成：${n} 条 → ${url}`);
