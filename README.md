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
node brief.mjs --html-only   # 不重新抓取，只用现有 data.json 重渲染静态页（回填后同步用）
cd web
npm run seed           # 导入本地数据库（开发用）
npm run seed:cloud     # 导入云端 Turso（线上应用的数据源，需要 web/.env.cloud）
```

## 筛选与个性化（顶栏「设置」）

首页只展示你关心的内容，规则全部可调（`/settings`）：

| 设置项 | 作用 |
|---|---|
| 兴趣分下限 | 默认 3 分；低于它的资讯收进首页底部折叠区 |
| 分类 | 多选，只留你关心的分类（模型发布/产品动态/研究进展/福利资源/行业动态/其他） |
| 来源 | 关掉不想看的源（量子位、HN、Reddit、TechCrunch、官方博客……） |
| 产品关注清单 | 12 个产品可多选，默认全部保留 |
| 只显示未读 | 隐藏已读条目 |
| 屏蔽关键词 | 标题包含即隐藏（一行一个） |
| 隐藏 👎 条目 | 默认开启 |

**反馈学习**：每条卡片有 👍（有用）/ 👎（不感兴趣），再点一次撤销。
👍 会提升该条排序（+1.5），👎 会降权（-3）并从首页隐藏；
分类与来源也会按反馈累计偏好（每个 👍 +0.4 / 👎 -0.8，封顶 ±2）。
所以用得越久，「今日必读」越贴近你的口味。

边界：筛选只影响首页显示，不删除数据；`/archive` 历史页始终完整。产品条目只受「产品关注清单」约束。

## 首页与期号

- 首页只显示**最新一期**（北京时间日期，如 `2026-10-21`），页头标注「最新一期 · 日期 · 共 N 条」
- 兴趣分 ≤ 2 的资讯默认收进页面底部的折叠区，未评分条目不隐藏；产品追踪始终展示
- 全部历史在 **`/archive`**（顶栏「历史」入口），按期号分组回看

## 多源去重

同一事件被多家媒体同时报道时，首页只保留一条主条目（兴趣分最高，同分取更早），
其余条目的标题与链接以「相关报道」附在卡片下方，并从首页与历史页隐藏。

- 由 LLM 判断「是否同一事件」并分组（每批 40 条，单批失败只影响该批，其余照常）
- 只在不同来源之间合并；**每组内每个来源最多一条**，同一来源的多条（例如同一仓库的多个 commit）视为独立更新，绝不合并
- 产品追踪条目不参与事件去重，只做链接级去重（同一链接只出现一次）
- 去重不删除数据：重复条目仍在数据库里（`dup_of` 列指向主条目），随时可追溯

## 信息源（行业资讯层）

| 栏目 | 来源 | 时效窗口 |
|---|---|---|
| 免费 LLM API 动态 | GitHub 仓库 mnfst/awesome-free-llm-apis（约 1 万星）的提交 | 最新 4 条 |
| Hacker News · AI 热帖 | Algolia 官方接口，按 OpenAI/Claude/DeepSeek 等 8 个关键词过滤，5 分以上 | 48 小时 |
| Hugging Face / r/LocalLLaMA / Simon Willison | 官方 RSS | 3-7 天 |
| TechCrunch · AI 新闻 | 官方 RSS | 3 天 |
| 量子位 · AI 资讯 | 官方 RSS | 48 小时 |

## 产品追踪（12 个产品，第一手）

DeepSeek、智谱 GLM、Kimi、Qwen、MiniMax、Claude、OpenAI / Codex、Gemini、OpenCode、Cursor、Qoder、WorkBuddy。
每个产品挂 1-2 类来源，加删产品改 `brief.mjs` 顶部的 `PRODUCTS` 数组即可。

| 来源类型 | 用途 | 说明 |
|---|---|---|
| Hugging Face 模型库 | 开源模型发布 | 公开 API，过滤 BF16/FP8/GGUF 等量化副本 |
| GitHub Releases（Atom） | 工具版本更新 | `releases.atom`，无 API 限流；跳过 alpha/beta/rc |
| GitHub 组织发布扫描 | 组织下各仓库的 Release | 走 GitHub API（每组织 1+4 次调用/日） |
| 官方博客 | 闭源模型与公司新闻 | 复用 OpenAI / DeepMind / Anthropic 官方源 |
| 关键词新闻 | 无官方渠道的产品（Cursor/Qoder/WorkBuddy） | Google 新闻 RSS（中文）+ Hacker News 搜索（英文社区） |

页面上「产品追踪」按产品分组（最新更新时间排序，每产品最多 3 条），不参与资讯层的兴趣分过滤；同一链接只出现一次（产品追踪优先）。

时效说明：页面按"今天 / 昨天 / N 天前"显示，今天的条目橙色高亮。官方大厂博客**本来就不是日更**——一周几篇是常态，"每天都有新内容"主要来自 HN·AI 热帖、量子位、TechCrunch 这几个日更栏目；官方栏目经常显示"近 7 天无更新"，这是现实，不是故障。

已知边界：Hugging Face、Reddit、Simon Willison、GitHub 在国内网络环境下本地抓不到（栏目会显示原因），部署到 GitHub Actions 后自动恢复；本地跑可用 `NODE_USE_ENV_PROXY=1` + 代理。免费 token / 福利类消息的覆盖靠"免费 LLM API 动态"和 r/LocalLLaMA，公众号/X 上的瞬时福利仍抓不到（X API 收费，不做）。国内媒体的 RSS 质量参差（机器之心的 feed 已死，故未收录）。

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
