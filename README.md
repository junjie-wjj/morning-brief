# 信息早餐（morning-brief）V0

每天自动抓取 AI 领域的官方信息源，生成一份纯静态的简报网页。**零依赖、零成本**；可选接入智谱免费的 GLM-Flash 模型，自动把条目加工成「中文标题 + 摘要 + 兴趣打分 + 低分折叠」（不配置则展示原始抓取列表）。这是正式开发（见 IDEA.md）之前的 V0 验证版，先跑两周确认"我真的会每天看"，再决定是否扩展。

## 在线地址

| 版本 | 地址 | 说明 |
|---|---|---|
| **交互应用（推荐）** | https://morning-brief-junjie.netlify.app | Next.js + Turso 云数据库；带已读/稍后读，数据云端保存；每天早上自动更新 |
| 静态简报 | https://junjie-wjj.github.io/morning-brief/ | V0 纯静态页，每天 7 点自动生成 |

## 本地开发（应用）

```bash
cd web
npm run dev            # 启动本地应用 → http://localhost:3000（用本地文件数据库）

# 更新数据（在仓库根目录执行抓取，然后导入）
node brief.mjs         # 抓取 + LLM 加工 → docs/data.json
cd web
npm run seed           # 导入本地数据库（开发用）
npm run seed:cloud     # 导入云端 Turso（线上应用的数据源，需要 web/.env.cloud）
```

## 信息源（12 个，以 AI 垂直为主）

| 栏目 | 来源 | 时效窗口 |
|---|---|---|
| OpenAI / DeepMind / Anthropic 官方 | 官方 RSS / 新闻页 | 7 天（官方博客本就一周数更） |
| DeepSeek / 智谱 GLM | GitHub Release（API） | 7 天 |
| 免费 LLM API 动态 | GitHub 仓库 mnfst/awesome-free-llm-apis（约 1 万星）的提交 | 最新 4 条 |
| Hacker News · AI 热帖 | Algolia 官方接口，按 OpenAI/Claude/DeepSeek 等 8 个关键词过滤，5 分以上 | 48 小时 |
| Hugging Face / r/LocalLLaMA / Simon Willison | 官方 RSS | 3-7 天 |
| TechCrunch · AI 新闻 | 官方 RSS | 3 天 |
| 量子位 · AI 资讯 | 官方 RSS | 48 小时 |

时效说明：页面按"今天 / 昨天 / N 天前"显示，今天的条目橙色高亮。官方大厂博客**本来就不是日更**——一周几篇是常态，"每天都有新内容"主要来自 HN·AI 热帖、量子位、TechCrunch 这几个日更栏目；官方栏目经常显示"近 7 天无更新"，这是现实，不是故障。

已知边界：Hugging Face、Reddit、Simon Willison 在国内网络环境下本地抓不到（栏目会显示原因），部署到 GitHub Actions 后自动恢复；免费 token / 福利类消息的覆盖靠"免费 LLM API 动态"和 r/LocalLLaMA，公众号/X 上的瞬时福利仍抓不到。国内媒体的 RSS 质量参差（机器之心的 feed 已死，故未收录）。

## 立即体验（本地）

需要 Node.js 18+（无任何第三方依赖，不需要 npm install）：

```bash
node brief.mjs
```

然后用浏览器打开 `docs/index.html` 即可。每天想看就跑一次，等价于"手动版早餐"。

## 开启 AI 中文摘要与打分（免费，推荐）

不配置 LLM 时，页面是原始标题列表（英文源居多）；配置后每条自动变成**中文标题 + 一两句中文摘要 + 分类 + 1-5 兴趣分**：顶部生成「今日必读 3 条」，低分营销内容折叠到页面底部。

1. 到智谱开放平台 [bigmodel.cn](https://bigmodel.cn) 注册并创建 API Key。GLM-Flash 系列模型免费（如 `glm-4.7-flash`，以控制台显示的免费模型为准），月成本 0 元；也可在 `brief.mjs` 顶部换成 DeepSeek 等任何 OpenAI 兼容接口（设 `LLM_BASE_URL` / `LLM_MODEL` 环境变量）。
2. 本地使用：Git Bash 里 `export LLM_API_KEY=你的key` 后再运行 `node brief.mjs`（PowerShell 写法：`$env:LLM_API_KEY="你的key"`）。
3. GitHub Actions：仓库 **Settings → Secrets and variables → Actions → New repository secret**，名称 `LLM_API_KEY`，值填你的 key，定时任务会自动带上。

摘要由小模型生成，可能有错漏——它只负责帮你**筛**，结论以原文为准。

## 原文精简版：不打开原网页也能读（默认开启）

光有摘要还是得点出去才知道讲了什么。所以对**高分条目（兴趣分 ≥ 4）**会额外抓取原文正文，
生成一份「精简版」：

- **交互应用**：点卡片空白处就地展开读完，不必跳转；想深入再点标题跳原文。
- **静态简报**：每条高分的下面有一个「📖 原文精简版」折叠块，点开即读。

正文抓取按三级降级，都是免费方案：

| 顺序 | 方式 | 解决什么 |
|---|---|---|
| ① | 直抓 | 大多数站点的正常路径 |
| ② | Reddit 单帖 `.rss` | Reddit 直抓只有 6 个字（JS 渲染） |
| ③ | [Jina Reader](https://jina.ai/reader/) 代理 | OpenAI 官方 403、量子位超时等 |

抓不到时会**如实标注**（如 Reuters 付费墙），不会假装成功。

**为什么分段而不是整篇丢给模型**：一次性把 8000 字塞进去，长文中段的信息最容易丢。
所以先分段（默认每段 2000 字）逐段抽取，再合并压缩——这样「关键信息不漏」是结构性保证，
而不是指望模型自觉。压缩时**数字与风险取「原值 ∪ 模型补充」**，模型漏给就回退原值。

**调节旋钮**（环境变量，见 `brief.mjs` 顶部）：

```bash
POINTS_MIN_SCORE=1    # 降到 1 则所有条目都生成（默认 4）
POINTS_MAX_ITEMS=30   # 单次上限（默认 15）
POINTS_CONCURRENCY=2  # 并发，限流严重时调低（默认 3）
node brief.mjs --skip-points   # 完全跳过这一块，只做摘要
```

**注意**：分段会让 LLM 调用量涨十倍以上。免费档限流严重时，建议只对高分条目开，
或换用付费模型（DeepSeek 等，每月几元）。

## 每天早上自动更新（GitHub Actions + Pages，免费）

1. 在 GitHub 上新建一个**公开**仓库（如 `morning-brief`，公开仓库的 Pages 才免费）。
2. 在本文件夹（Git Bash）执行：

   ```bash
   git init
   git add .
   git commit -m "morning-brief v0"
   git branch -M main
   git remote add origin https://github.com/<你的用户名>/morning-brief.git
   git push -u origin main
   ```

3. 打开仓库页面 → **Settings → Pages → Build and deployment → Source 选择 "GitHub Actions"**（只需设置这一次）。
4. 完成。之后每天**北京时间 07:00** 自动生成并发布，访问：

   `https://<你的用户名>.github.io/morning-brief/`

想立即看效果而不等第二天早上：仓库 **Actions** 页 → 选 **daily-brief** → **Run workflow**。

### 注意事项

- GitHub 定时任务不保证准点，可能比设定时间晚几分钟到半小时。
- 仓库连续 60 天没有任何提交，定时任务会被 GitHub 自动停用（收到邮件通知后手动 Run 一次即可恢复）。
- 加 / 删信息源：编辑 [brief.mjs](brief.mjs) 顶部的 `SOURCES` 数组，每项含栏目名、类型（`rss` / `anthropic` / `hn` / `gh`）和地址。

## 下一步（V0 验证通过后）

见 [IDEA.md](IDEA.md)：LLM 摘要与"为什么值得你看"、按兴趣打分、已读/稍后读、完整 Web 界面等。V0 里哪些源你真的在看、哪些从来没人点，就是加 LLM 打分时最好的依据。
