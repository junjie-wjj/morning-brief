// 把 ../docs/data.json（数据管线每天生成的 JSON）导入 SQLite。
// 运行：cd web && npm run seed
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const data = JSON.parse(readFileSync(path.join(root, "docs", "data.json"), "utf8"));

const dbDir = path.join(root, "web", "data");
mkdirSync(dbDir, { recursive: true });
const db = new DatabaseSync(path.join(dbDir, "brief.db"));
db.exec(`CREATE TABLE IF NOT EXISTS items (
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

// 内容更新就覆盖，但 status 列不在更新范围——用户在应用里的已读/稍后读操作不会被导入覆盖
const upsert = db.prepare(`
  INSERT INTO items (link, date, source, title, zh_title, summary, tag, score)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(link) DO UPDATE SET
    date = excluded.date, source = excluded.source, title = excluded.title,
    zh_title = excluded.zh_title, summary = excluded.summary,
    tag = excluded.tag, score = excluded.score
`);

let n = 0;
for (const it of data.items) {
  upsert.run(it.link, it.date ?? data.generatedAt, it.source, it.title,
    it.zh, it.summary, it.tag, it.score);
  n++;
}
console.log(`导入完成：${n} 条 → web/data/brief.db`);
