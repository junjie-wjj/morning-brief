// 从加密备份恢复数据。
//
// 运行（在 web 目录）：
//   BACKUP_PASSPHRASE=你的口令 npm run restore -- --file data/backup-2026-10-23.enc --dry-run
//   BACKUP_PASSPHRASE=你的口令 npm run restore -- --file data/backup-2026-10-23.enc --yes
//   npm run restore -- --file ... --local --yes   # 恢复到本地库
//
// 行为：
//   items     按 link upsert（包含已读/稍后读状态）
//   settings  清空后按备份覆盖
//   feedback  清空后按备份覆盖
import { createDecipheriv, scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(here, "..");
const args = process.argv.slice(2);
const local = args.includes("--local");
const yes = args.includes("--yes");
const dryRun = args.includes("--dry-run");
const fileArg = args.indexOf("--file");
const file = fileArg >= 0 ? args[fileArg + 1] : null;

if (!file) {
  console.error("用法：node scripts/restore.mjs --file data/backup-YYYY-MM-DD.enc [--local] [--dry-run] [--yes]");
  process.exit(1);
}

const passphrase = process.env.BACKUP_PASSPHRASE;
if (!passphrase) {
  console.error("✗ 缺少 BACKUP_PASSPHRASE（必须和备份时一致）");
  process.exit(1);
}

let data;
try {
  const box = JSON.parse(readFileSync(path.resolve(webRoot, file), "utf8"));
  const salt = Buffer.from(box.salt, "base64");
  const iv = Buffer.from(box.iv, "base64");
  const tag = Buffer.from(box.tag, "base64");
  const key = scryptSync(passphrase, salt, 32);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const json = Buffer.concat([decipher.update(Buffer.from(box.data, "base64")), decipher.final()]).toString("utf8");
  data = JSON.parse(json);
} catch (err) {
  console.error(`✗ 解密失败：${err.message}（口令错误或文件损坏）`);
  process.exit(1);
}

console.log(`备份时间：${data.exportedAt}（${data.source ?? "unknown"}）`);
console.log(`条目 ${data.items?.length ?? 0} / 设置 ${data.settings?.length ?? 0} / 反馈 ${data.feedback?.length ?? 0}`);

if (dryRun) {
  console.log("--dry-run：只解密校验，不写入数据库。");
  process.exit(0);
}
if (!yes) {
  console.error("确认恢复请加 --yes（会覆盖 settings/feedback，并按 link 更新 items）。");
  process.exit(1);
}

const envFile = path.join(webRoot, local ? ".env.local" : ".env.cloud");
try {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* 没有该文件就只用系统环境变量 */ }

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
  points TEXT,
  points_reason TEXT,
  body_chars INTEGER,
  body_via TEXT,
  product TEXT,
  issue TEXT,
  dup_of TEXT,
  related TEXT
)`);
await db.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
await db.execute("CREATE TABLE IF NOT EXISTS feedback (link TEXT PRIMARY KEY, verdict TEXT NOT NULL, updated_at TEXT NOT NULL)");

const ITEM_COLS = [
  "link", "date", "source", "title", "zh_title", "summary", "tag", "score", "status",
  "points", "points_reason", "body_chars", "body_via", "product", "issue", "dup_of", "related",
];
const itemSql = `INSERT INTO items (${ITEM_COLS.join(",")}) VALUES (${ITEM_COLS.map(() => "?").join(",")})
  ON CONFLICT(link) DO UPDATE SET ${ITEM_COLS.filter((c) => c !== "link").map((c) => `${c}=excluded.${c}`).join(", ")}`;

const itemStmts = (data.items ?? []).map((it) => ({
  sql: itemSql,
  args: ITEM_COLS.map((c) => (c === "status" ? (it[c] ?? "unread") : (it[c] ?? null))),
}));
if (itemStmts.length) await db.batch(itemStmts, "write");

const settingStmts = [
  { sql: "DELETE FROM settings", args: [] },
  ...(data.settings ?? []).map((s) => ({
    sql: "INSERT INTO settings (key, value) VALUES (?, ?)",
    args: [s.key, s.value],
  })),
];
await db.batch(settingStmts, "write");

const feedbackStmts = [
  { sql: "DELETE FROM feedback", args: [] },
  ...(data.feedback ?? []).map((f) => ({
    sql: "INSERT INTO feedback (link, verdict, updated_at) VALUES (?, ?, ?)",
    args: [f.link, f.verdict, f.updated_at ?? new Date().toISOString()],
  })),
];
await db.batch(feedbackStmts, "write");

console.log(`✓ 恢复完成：items ${itemStmts.length} / settings ${data.settings?.length ?? 0} / feedback ${data.feedback?.length ?? 0}`);
