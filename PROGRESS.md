# 项目进度存档

> 存档时间：2026-10-14 19:20（北京时间）
> 本文件是项目当前状态的完整快照，随进度更新；愿景与四阶段路线图见 [IDEA.md](IDEA.md)，使用说明见 [README.md](README.md)。

## 一句话状态

三件套全部上线并实现自动化：**数据管线**（每日抓取 12 个源 + LLM 中文加工）、**静态简报**（GitHub Pages）、**交互应用**（Netlify + Turso 云数据库，含已读/稍后读）。阶段 1、2 完成，阶段 3 部分提前。10/14 发现并修复了"限流会抹掉历史摘要"的数据覆盖缺陷，云端 117 条已全部回填中文加工（117/117）。

## 线上资产一览

| 资产 | 位置 | 状态 |
|---|---|---|
| 交互应用（主入口） | `https://morning-brief-junjie.netlify.app` | ✅ 在线；摘要/分类/今日必读/已读/稍后读全部可用 |
| 静态简报（备用） | `https://junjie-wjj.github.io/morning-brief/` | ✅ 每天自动更新 |
| 代码仓库 | `https://github.com/junjie-wjj/morning-brief` | ✅ 公开仓库 |
| 云数据库 | Turso（库名 `morning-brief`，东京节点） | ✅ 114 条，其中 51 条含中文摘要 |
| 数据管线 | `brief.mjs` + GitHub Actions `daily-brief` | ✅ 每天 07:00（北京时间）自动运行 |

## 系统如何运作

```
每天 07:00  GitHub Actions（免费云机器，无需本机开机）
    抓取 12 个源（大厂官方博客/HN 按 AI 关键词过滤/GitHub 发布/中英文 AI 媒体）
    → LLM（智谱 glm-4.7-flash 免费档）生成：中文标题 + 摘要 + 分类 + 兴趣分
    → ① 生成静态简报发布 GitHub Pages
    → ② 同步数据到 Turso 云数据库（web/scripts/seed.mjs --cloud）

你打开应用（Netlify）
    ← 实时从 Turso 读数据渲染页面
    → 点「已读/稍后读」写回 Turso，任何设备打开状态一致
```

代码推送自动化：`web/` 目录有改动推送到 main 后，`deploy-web` 工作流会在 Linux 机器上构建并自动部署到 Netlify。

## 阶段进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| 阶段 1 · 本地全栈骨架 | Next.js 16 + TS + Tailwind；`@libsql/client` 数据库层；已读/稍后读闭环 | ✅ 完成（10/11） |
| 阶段 2 · 上免费云 | Netlify 部署 + Turso 云库 + 手机可访问 + 数据持久 | ✅ 完成（10/12） |
| 阶段 3 · 管线接入与迭代 | 每日同步 Turso 已通；多源去重、点击反馈学习未做 | 🔶 部分完成 |
| 阶段 4 · 开源上架 | LICENSE、自部署 README、.env.example、截图、社区分发 | ⬜ 未开始 |

## 今日（10/14）验收记录

- LLM 限流恢复：本地接口测试 200 正常 → 手动触发每日任务 → CI 日志 `AI 加工（glm-4.7-flash）：51/51 条获得中文摘要与打分`
- 云端数据库：总 114 条、51 条含摘要；线上应用渲染出 51 段摘要、5 个分类分组（模型发布/福利资源/产品动态/研究进展/行业动态）和「今日必读」
- 已读/稍后读：功能在线上实测可用（此前验证写入成功，用户尚未开始使用）

## 10/14 事故与修复：限流抹掉历史摘要

**症状**：19:00 复查发现线上应用 117 条里只剩 3 条有中文摘要，静态页横幅为 `AI 加工失败（LLM HTTP 429）`，而 PROGRESS.md 记录的是 51 条。

**根因**：`brief.mjs` 在 LLM 加工失败时会优雅降级为「原始抓取」，此时 `docs/data.json` 中每条的 `zh / summary / tag / score` 全为 `null`；而 `seed.mjs` 的 upsert 把这几个字段照写进库，于是**一次限流不仅当天没有摘要，还会把库里已有的历史摘要覆盖成空**。作者原本只保护了 `status` 列（防覆盖用户已读/稍后读），漏掉了 AI 加工列。

**时间线（账目闭合）**：08:32 手动触发成功（51/51，PROGRESS.md 即此时所写）→ 09:27 定时任务撞上 429 降级 → 48 条摘要被覆盖为 null，另 3 条因链接已滑出抓取窗口未参与冲突而幸存（63 原有空 + 48 被抹 + 3 新增 = 114 条空，3 条幸存）。

**修复（三处）**：

1. `web/scripts/seed.mjs` —— upsert 改用 `COALESCE(excluded.x, items.x)` 逐列保护 AI 加工列，新值为 `null` 时保留库中旧值。已用红绿测试验证：旧版灌入降级数据后 `zh=null`（复现故障），新版保留 `zh="中文标题" score=5`。
2. `brief.mjs` —— 增加模型降级链（`LLM_MODEL` → `LLM_MODEL_FALLBACKS`，默认 `glm-4-flash`，缓解 429）；`enrichWithLLM` 改为分批容错，单批失败不再拖垮全局，仅全部批次失败才降级为原始抓取。
3. `web/scripts/backfill.mjs`（新增）—— 回填历史缺失的中文加工，只处理 `zh_title IS NULL` 的条目，可反复运行续传。命令：`npm run backfill`（云端）/ `npm run backfill -- --local`（本地）。

**结果**：云端 Turso 由 3/117 恢复至 **117/117**（中文标题、摘要、分类、兴趣分齐全），线上应用实测渲染 117 条摘要 + 117 个分类标签 + 今日必读，均正常。

## 关键技术决策（为什么这样做）

1. **数据库用 `@libsql/client`** 而非 better-sqlite3：同一套代码本地（`file:`）与云端（`libsql://`）通吃，规避 Windows 原生模块编译问题。
2. **托管选 Netlify 而非 Vercel**：Vercel 风控标记了新账号（要求人工申诉）；Netlify 功能等价且免费，五分钟完成注册。
3. **部署走 GitHub Actions（Linux）而非本地**：Windows 本地构建 Netlify 的 Next.js 插件需要符号链接权限（EPERM 报错），Linux 无此问题；附带好处是推送代码自动重新部署。
4. **关闭 Next 16 的 `cacheComponents`**，改用 `force-dynamic`：否则生产模式页面会被静态冻结，数据库更新不会反映到页面上（曾实测复现并修复）。
5. **Netlify 新站点默认开启 SSO 访问保护**（访客被要求登录 Netlify），需通过 API `PATCH` 关闭（`sso_login:false`），CLI 封装的调用无效、需用原始 API。
6. **定时任务实测有数小时级调度延迟**（10/12 实际 14:25 运行、10/13 实际 11:15 运行），是 GitHub 免费额度的平台特性，不是故障；页面更新晚到属正常。
7. **Netlify 推广徽章已关闭**（`built_with_badge_enabled:false`）；HTML 里仍有一段用户不可见的推广注释，无害，未处理。

## 密钥与凭证名索引（值一律不写入仓库）

| 名称 | 存放位置 |
|---|---|
| `LLM_API_KEY`（智谱） | 本地 `.env`（已 gitignore）；GitHub Secrets |
| `LIBSQL_URL` / `LIBSQL_AUTH_TOKEN`（Turso） | 本地 `web/.env.cloud`（已 gitignore）；GitHub Secrets；Netlify 环境变量 |
| `NETLIFY_AUTH_TOKEN`（部署用） | GitHub Secrets |

以上文件均被 `.gitignore` 覆盖，已确认不会进入公开仓库。若需轮换密钥：在对应平台重新生成后，同步更新上述三个存放位置。

## 账号清单

| 平台 | 账号 | 用途 |
|---|---|---|
| GitHub | junjie-wjj | 代码仓库、Actions、Pages |
| Netlify | junjie-wjj（GitHub 登录） | 应用托管 |
| Turso | junjie-wjj（GitHub 登录） | 云数据库 |
| 智谱 bigmodel.cn | —— | LLM API（glm-4.7-flash 免费档） |

## 本地常用命令

```bash
# 抓取 + LLM 加工（在仓库根目录）
node brief.mjs

# 启动本地应用（本地文件数据库模式）
cd web && npm run dev          # → http://localhost:3000

# 数据导入
cd web && npm run seed         # 导入本地库（开发用）
cd web && npm run seed:cloud   # 导入云端 Turso（线上数据源，需 web/.env.cloud）

# 回填缺失的中文摘要/分类/打分（可反复运行续传）
cd web && npm run backfill                 # 回填云端 Turso
cd web && npm run backfill -- --local      # 回填本地文件库
cd web && npm run backfill -- --limit 20   # 先小量试跑

# 推送代码（需代理）
git config --global http.https://github.com.proxy http://127.0.0.1:7897
```

## 已知问题与风险

1. **GitHub 定时任务延迟**数小时（免费额度特性）。若需准点，可考虑外部触发器（如 cron-job.org 调用 workflow dispatch）。
2. ~~**10/11–10/13 的约 63 条旧数据无摘要**~~ → 已由 `backfill.mjs` 补齐，云端 117/117 全有中文加工（10/14）。若日后再出现缺摘要，直接重跑 `npm run backfill` 即可。
3. **智谱免费档限流是常态**，不是故障：主模型 `glm-4.7-flash` 会整体 429（错误码 1302/1305），此时自动降级到 `glm-4-flash`。若两个模型同时被限流，当天仍会退化为原始抓取——但**不会再破坏历史摘要**（seed 已用 COALESCE 保护）。
4. **国内访问 Netlify 建议开代理更稳**；GitHub Pages 静态页可作备用入口。先前"打不开"经排查为浏览器缓存了旧的登录跳转页 + 代理瞬时波动，非站点故障。
5. **数据仅一份在 Turso 云端**，无定期备份；后续可加导出脚本（低优先级）。
6. **本地 `web/data/brief.db` 与云端不同步**（本地停在 10/12、35 条）：本地开发如需完整数据，先 `node brief.mjs` 再 `npm run seed`，或直接 `npm run backfill -- --local`。不影响线上。
7. **免费额度监控**：Netlify 每月 100GB 带宽 + 函数调用额度；Turso 免费档；智谱 Flash 免费——个人使用均绰绰有余。

## 下一步（按优先级）

1. **日常使用**：每天打开应用；记录"要是能……就好了"——这是功能需求的唯一来源，也是未来面试素材。
2. **阶段 3 收尾**：多源去重合并（同一事件多源报道合并为一条）；点击行为反馈给 LLM 调整打分。
3. **阶段 4**：LICENSE（MIT 等）、README 开源化改写（自部署三步指南）、`.env.example`、效果截图，再分发到社区。
4. **可选**：PWA（添加到主屏幕）、历史简报回看与搜索。
