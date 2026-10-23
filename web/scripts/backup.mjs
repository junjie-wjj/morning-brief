// 把云端/本地数据库导出并加密成一个文件，用于每周备份。
//
// 运行（在 web 目录）：
//   BACKUP_PASSPHRASE=你的口令 npm run backup             # 云端 Turso
//   BACKUP_PASSPHRASE=你的口令 npm run backup -- --local  # 本地文件库
//
// 输出：web/data/backup-YYYY-MM-DD.enc（AES-256-GCM + scrypt，口令不写进文件）
// 备份内容：items（含已读/稍后读）、settings、feedback
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(here, "..");
const local = process.argv.includes("--local");

const envFile = path.join(webRoot, local ? ".env.local" : ".env.cloud");
try {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* 没有该文件就只用系统环境变量 */ }

const passphrase = process.env.BACKUP_PASSPHRASE;
if (!passphrase) {
  console.error("✗ 缺少 BACKUP_PASSPHRASE。请在环境变量里设置一个备份口令（不要用登录密码）。");
  process.exit(1);
}

const url = process.env.LIBSQL_URL ?? "file:./data/brief.db";
const db = createClient({ url, authToken: process.env.LIBSQL_AUTH_TOKEN });

const [items, settings, feedback] = await Promise.all([
  db.execute("SELECT * FROM items"),
  db.execute("SELECT * FROM settings"),
  db.execute("SELECT * FROM feedback"),
]);

const payload = {
  version: 1,
  exportedAt: new Date().toISOString(),
  source: local ? "local" : "cloud",
  counts: {
    items: items.rows.length,
    settings: settings.rows.length,
    feedback: feedback.rows.length,
  },
  items: items.rows,
  settings: settings.rows,
  feedback: feedback.rows,
};

// AES-256-GCM：加密 + 完整性校验；scrypt 从口令派生密钥
const salt = randomBytes(16);
const iv = randomBytes(12);
const key = scryptSync(passphrase, salt, 32);
const cipher = createCipheriv("aes-256-gcm", key, iv);
const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);

const box = {
  version: 1,
  alg: "aes-256-gcm",
  kdf: "scrypt",
  salt: salt.toString("base64"),
  iv: iv.toString("base64"),
  tag: cipher.getAuthTag().toString("base64"),
  data: encrypted.toString("base64"),
};

const date = new Date().toISOString().slice(0, 10);
const outFile = process.env.BACKUP_FILE ?? path.join(webRoot, "data", `backup-${date}.enc`);
mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(box));

console.log(`✓ 备份完成：${outFile}`);
console.log(`  条目 ${payload.counts.items} / 设置 ${payload.counts.settings} / 反馈 ${payload.counts.feedback}`);
console.log("  文件已加密；恢复需要同一个 BACKUP_PASSPHRASE。");
