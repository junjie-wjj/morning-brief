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
  issue TEXT,
  dup_of TEXT,
  related TEXT
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
  ['dup_of', 'TEXT'],            // 多源去重：被合并进的主条目链接
  ['related', 'TEXT'],           // 多源去重：主条目挂的其他报道（JSON）
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
// 去重列（dup_of/related）：本次运行有算过去重就原样覆盖，否则保留旧值。
// 降级日（LLM 失败）data.json 里 dupOf 全为 null，若照写就会把昨天正确合并的条目
// 全部"复活"成独立条目；brief.mjs 用 deduped 字段标记本次是否算过去重。
const dedupRan = Boolean(data.deduped);
const upsert = `INSERT INTO items (link, date, source, title, zh_title, summary, tag, score,
    points, points_reason, body_chars, body_via, product, issue, dup_of, related)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(link) DO UPDATE SET
    date = excluded.date, source = excluded.source, title = excluded.title,
    zh_title = COALESCE(excluded.zh_title, items.zh_title),
    summary  = COALESCE(excluded.summary,  items.summary),
    tag      = COALESCE(excluded.tag,      items.tag),
    score    = COALESCE(excluded.score,    items.score),
    points   = COALESCE(excluded.points,   items.points),
    -- 精简版的元数据（失败原因/正文字数/来源）必须和 points 同生共死：
    -- 旧条目已有 points 时，本次抓正文失败不能把它的元数据覆盖成失败原因，
    -- 否则页面会出现"有精简版内容 + 付费墙失败原因"的矛盾组合。
    points_reason = CASE
      WHEN excluded.points IS NOT NULL THEN excluded.points_reason
      WHEN items.points IS NULL THEN excluded.points_reason
      ELSE items.points_reason END,
    body_chars = CASE
      WHEN excluded.points IS NOT NULL THEN excluded.body_chars
      WHEN items.points IS NULL THEN excluded.body_chars
      ELSE items.body_chars END,
    body_via = CASE
      WHEN excluded.points IS NOT NULL THEN excluded.body_via
      WHEN items.points IS NULL THEN excluded.body_via
      ELSE items.body_via END,
    product    = COALESCE(excluded.product,    items.product),
    -- 期号「首发定档」：只在首次插入时写入，冲突更新时保留旧值。
    -- 一条新闻属于它第一次被抓到的那一期；后续几天它还留在抓取窗口里
    -- 会被重复抓到，但不再挪进新期——否则同一新闻会在首页连播好几天
    -- （实测 10-24 期中约 1/3 是 10-22 及更早的旧闻重播）。
    -- 同一天重跑不受影响：期号本来就是同一天，保留旧值等于没变。
    issue      = items.issue,
    dup_of     = ${dedupRan ? "excluded.dup_of" : "items.dup_of"},
    related    = ${dedupRan ? "excluded.related" : "items.related"}`;

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
      it.product ?? null, it.issue ?? data.issue ?? null,
      it.dupOf ?? null, it.related ? JSON.stringify(it.related) : null],
  });
  n++;
}
console.log(`导入完成：${n} 条（其中 ${withPoints} 条含原文精简版）→ ${url}`);

// 屏蔽词「彻底不抓」的存量清理：已入库的同类条目也从档案里删掉，
// 否则历史页还会留着用户明确说「不想看」的内容。
// 只在导出的偏好文件里 blockMode=drop 时执行；删除不可恢复，日志必须报数。
try {
  const prefPath = path.join(root, "web", "data", "preferences.json");
  const userSet = JSON.parse(readFileSync(prefPath, "utf8")).userSettings ?? {};
  if (userSet.blockMode === "drop" && Array.isArray(userSet.blockedKeywords) && userSet.blockedKeywords.length) {
    let deleted = 0;
    for (const kw of userSet.blockedKeywords) {
      const like = `%${kw.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
      // 先查出命中的链接再连 dup_of 一起删：被删条目如果是主条目，
      // 它合并的重复报道必须跟着走，否则会留下永远不可见的僵尸行
      const matches = await db.execute({
        sql: "SELECT link FROM items WHERE LOWER(title) LIKE ? ESCAPE '\\' OR LOWER(zh_title) LIKE ? ESCAPE '\\'",
        args: [like.toLowerCase(), like.toLowerCase()],
      });
      const links = matches.rows.map((r) => String(r.link));
      if (!links.length) continue;
      const ph = links.map(() => "?").join(",");
      const r = await db.execute({
        sql: `DELETE FROM items WHERE link IN (${ph}) OR dup_of IN (${ph})`,
        args: [...links, ...links],
      });
      deleted += r.rowsAffected;
    }
    console.log(`屏蔽词存量清理：删除 ${deleted} 条已入库的命中条目（含合并的重复报道）`);
  }
} catch {
  /* 偏好文件不存在（本地 seed / 导出步骤失败）时跳过，不影响导入 */
}

// OpenRouter 免费模型快照回写：明天 brief.mjs 靠它 diff 出新增/下架。
// 只有 data.json 带快照（今天抓取成功）才覆盖，失败日保留昨天的旧快照。
if (Array.isArray(data.openrouterFree)) {
  await db.execute({
    sql: "INSERT INTO settings (key, value) VALUES ('openrouter_free', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    args: [JSON.stringify(data.openrouterFree)],
  });
  console.log(`OpenRouter 快照已保存：${data.openrouterFree.length} 个免费模型`);
}
