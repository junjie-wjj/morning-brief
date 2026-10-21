// 把 ../docs/data.json 导入数据库（本地文件库或 Turso 云库，由环境变量决定）。
// 运行：cd web && npm run seed
import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 简易 .env 读取（零依赖）：默认读 .env.local（本地文件库）；
// 加 --cloud 参数读 .env.cloud（Turso 云库）
const envName = process.argv.includes("--cloud") ? ".env.cloud" : ".env.local";
const envFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", envName);
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
  status TEXT NOT NULL DEFAULT 'unread',
  product TEXT,
  issue TEXT
)`);

// 迁移：给已存在的表补上「原文精简版」相关列。
// SQLite 的 ALTER TABLE ADD COLUMN 对已存在的列会报错，所以先查 PRAGMA 再补，
// 这样脚本对新库和旧库都能反复安全运行。
const NEW_COLUMNS = [
  ['points', 'TEXT'],            // 精简版要点（多行文本）
  ['points_reason', 'TEXT'],     // 没生成时的原因，或分段覆盖情况
  ['body_chars', 'INTEGER'],     // 抓到的正文字数（0 表示没抓到）
  ['body_via', 'TEXT'],          // 正文来源：direct / reddit-rss / jina
  ['product', 'TEXT'],           // 产品追踪：非空表示该产品的第一手更新
  ['issue', 'TEXT'],             // 期号（北京时间日期）：首页只展示最新一期
];
const existing = new Set(
  (await db.execute('PRAGMA table_info(items)')).rows.map((r) => r.name),
);
for (const [name, type] of NEW_COLUMNS) {
  if (existing.has(name)) continue;
  await db.execute(`ALTER TABLE items ADD COLUMN ${name} ${type}`);
  console.log(`迁移：新增列 ${name}`);
}

// 内容更新就覆盖，但有两类列必须保护：
//   1. status —— 用户在应用里的已读/稍后读，导入永远不碰；
//   2. AI 加工列（zh_title/summary/tag/score/points）—— LLM 加工失败时 brief.mjs 会降级
//      输出原始抓取，这几个字段全是 null。若照写就会把库里已有的中文摘要覆盖成空，
//      即"一次限流抹掉全部历史摘要"。用 COALESCE 逐列保留：新值非 null 才覆盖。
const upsert = `INSERT INTO items (link, date, source, title, zh_title, summary, tag, score,
    points, points_reason, body_chars, body_via, product, issue)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(link) DO UPDATE SET
    date = excluded.date, source = excluded.source, title = excluded.title,
    zh_title = COALESCE(excluded.zh_title, items.zh_title),
    summary  = COALESCE(excluded.summary,  items.summary),
    tag      = COALESCE(excluded.tag,      items.tag),
    score    = COALESCE(excluded.score,    items.score),
    points   = COALESCE(excluded.points,   items.points),
    points_reason = COALESCE(excluded.points_reason, items.points_reason),
    body_chars = COALESCE(excluded.body_chars, items.body_chars),
    body_via   = COALESCE(excluded.body_via,   items.body_via),
    product    = COALESCE(excluded.product,    items.product),
    issue      = COALESCE(excluded.issue,      items.issue)`;

let n = 0;
let withPoints = 0;
for (const it of data.items) {
  if (it.points) withPoints++;
  await db.execute({
    sql: upsert,
    args: [it.link, it.date ?? data.generatedAt, it.source, it.title,
      it.zh, it.summary, it.tag, it.score,
      it.points ?? null, it.pointsReason ?? null,
      it.bodyChars ?? null, it.bodyVia ?? null,
      it.product ?? null, it.issue ?? data.issue ?? null],
  });
  n++;
}
console.log(`导入完成：${n} 条（其中 ${withPoints} 条含原文精简版）→ ${url}`);
