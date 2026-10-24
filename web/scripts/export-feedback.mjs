// 把应用里的 👍/👎 反馈聚合成一份偏好统计，供 brief.mjs 的「偏好搜索」使用。
//
// 运行（在 web 目录）：
//   npm run export:preferences             # 云端 Turso（读 .env.cloud）
//   npm run export:preferences -- --local  # 本地文件库（读 .env.local）
//
// 输出：web/data/preferences.json（已 gitignore，不会提交）
// 结构：{ generatedAt, feedbackCount, products: [{name,up,down}], tags: [{tag,up,down}] }
import { createClient } from "@libsql/client";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(here, "..");
const argv = process.argv.slice(2);
const local = argv.includes("--local");
const outArg = argv.indexOf("--out");
const outFile = outArg >= 0
  ? path.resolve(argv[outArg + 1])
  : path.join(webRoot, "data", "preferences.json");

// 简易 .env 读取（零依赖，与 seed.mjs 同风格）
const envFile = path.join(webRoot, local ? ".env.local" : ".env.cloud");
try {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* 没有该文件就只用系统环境变量 */ }

const url = process.env.LIBSQL_URL ?? "file:./data/brief.db";
const db = createClient({ url, authToken: process.env.LIBSQL_AUTH_TOKEN });

const empty = {
  generatedAt: new Date().toISOString(),
  feedbackCount: 0,
  products: [],
  tags: [],
};

let rows = [];
try {
  const rs = await db.execute(`
    SELECT f.verdict, i.product, i.tag, COUNT(*) AS c
    FROM feedback f JOIN items i ON i.link = f.link
    GROUP BY f.verdict, i.product, i.tag
  `);
  rows = rs.rows;
} catch (err) {
  console.warn(`⚠ 读取反馈失败（${err.message}），本次不启用偏好搜索`);
}

const products = new Map();
const tags = new Map();
let feedbackCount = 0;

for (const r of rows) {
  const n = Number(r.c) || 0;
  feedbackCount += n;
  const bump = (map, key, field) => {
    if (typeof key !== "string" || !key) return;
    const cur = map.get(key) ?? { up: 0, down: 0 };
    cur[field] += n;
    map.set(key, cur);
  };
  if (r.verdict === "up") {
    bump(products, r.product, "up");
    bump(tags, r.tag, "up");
  } else if (r.verdict === "down") {
    bump(products, r.product, "down");
    bump(tags, r.tag, "down");
  }
}

const data = {
  ...empty,
  feedbackCount,
  products: [...products.entries()].map(([name, v]) => ({ name, ...v })),
  tags: [...tags.entries()].map(([tag, v]) => ({ tag, ...v })),
};

// 附带导出筛选设置里的「抓取侧丢弃」配置（屏蔽词模式 / 低分不入库），
// brief.mjs 用它在加工前丢条目、seed.mjs 用它清理已入库的同类条目。
// 读不到设置（没保存过）就输出默认值，流水线按「不丢弃」处理。
try {
  const rs = await db.execute("SELECT value FROM settings WHERE key = 'filters'");
  const saved = rs.rows[0] ? JSON.parse(rs.rows[0].value) : {};
  data.userSettings = {
    blockedKeywords: Array.isArray(saved.blockedKeywords)
      ? saved.blockedKeywords.filter((k) => typeof k === 'string' && k.trim())
      : [],
    blockMode: saved.blockMode === 'drop' ? 'drop' : 'hide',
    dropLowScore: saved.dropLowScore === true,
  };
  console.log(`抓取侧设置：屏蔽词 ${data.userSettings.blockedKeywords.length} 个（${data.userSettings.blockMode === 'drop' ? '彻底不抓' : '仅隐藏'}）· 低分不入库 ${data.userSettings.dropLowScore ? '开' : '关'}`);
} catch (err) {
  console.warn(`⚠ 读取设置失败（${err.message}），本次不做抓取侧丢弃`);
  data.userSettings = { blockedKeywords: [], blockMode: 'hide', dropLowScore: false };
}

// OpenRouter 免费模型监控的昨日快照（id 列表）：brief.mjs 拿它做跨天 diff。
// 没有快照（首次运行）输出空数组，brief.mjs 只存快照不播报。
try {
  const rs = await db.execute("SELECT value FROM settings WHERE key = 'openrouter_free'");
  data.openrouterFree = rs.rows[0] ? JSON.parse(rs.rows[0].value) : [];
} catch {
  data.openrouterFree = [];
}

mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(data, null, 2));

console.log(`反馈统计：${feedbackCount} 条（产品 ${data.products.length} 个 / 分类 ${data.tags.length} 个）`);
console.log(`已写入 ${outFile}`);
