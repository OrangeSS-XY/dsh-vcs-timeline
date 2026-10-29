# 测试报告（dsh-vcs-timeline 0.1.2；历史轮次见 §12 / §13）

本报告只记录**实际执行**过的命令、退出码与结果，以及明确标注的未验证项。

## 1. 环境

| 项目 | 值 |
| --- | --- |
| 日期 | 2026-10-27 |
| OS | Windows（`win32 x64`） |
| DSH | 桌面端 `0.2.1-rc.3`（`E:\softData\DSH`，profile `desktop`） |
| GUI | `http://127.0.0.1:7283`（本轮实测端口；历史记录中的 12050 为上一环境） |
| Node | v22.23.1 |
| npm | 12.1.0 |
| Git | `git version 2.45.1.windows.1` |
| SVN | **未安装**（`Get-Command svn` 无结果） |
| 真实页面验证 | Python Playwright + Microsoft Edge（`channel=msedge`, headless），loopback auth cookie 注入 |
| 预览截图浏览器 | Microsoft Edge 155.0.4283.62（无头模式） |
| 插件目录 | `E:\softData\DP_Harness\dsh-plugin\dsh-vcs-timeline` |

## 2. 代码变更摘要

单个 bundle 包，双半边：

- **Host**（`lib/index.js`，176,379 B，仅 Node 内置依赖）：`/vcs` 13 条 JSON 路由、
  仓库发现与路径闸门、Git/SVN 适配器、只读/写服务、JSONL 存储与追加式审计、脱敏与限额。
  本轮新增 **`TimelineQuery.includeFiles` 逐提交文件清单**：Git 额外执行一次同
  filters/skip/limit 的 `log --name-status -z`，与既有 numstat 流按新路径合并为
  `changedFiles[]`（状态 / ± / binary / oldPath，上限 `MAX_EVENT_FILES=200`，超出置
  `changedFilesTruncated`）；SVN 由 `svn log --xml -v` 的逐路径 action/copyfrom 映射
  （仅请求时补一次本地 `svn info` 做路径映射）。未请求时事件**完全不带** `changedFiles`
  （“未请求”≠“没有变更”）；探针失败只降级为 partial 警告，不让整页失败。
- **Client**（`lib/client.js`，298,607 B，运行时仅 `require("react")`）：本轮改为
  **文件中心双栏**——左文件树（目录计数 / 状态字母 / 文件名搜索 / 状态筛选 / 展开收起）
  + 右变更时间线（单文件历史、逐提交状态与 ± 行）、34px 工具栏 + `⋯` 版本控制菜单、
  统一搜索/时间范围/作者过滤、右栏内提交详情与行号 Diff、审计列表/详情、
  写操作确认对话框、可折叠诊断与 24px 状态栏；新增**对话区页签（conversation.view）**
  ；右栏为 IDEA 风格时间线（竖轴 + 节点、日期分组吸顶、作者头像/姓名、相对时间、
  HEAD/分支标记、± 统计）；zh/en 字典、token-only 样式。
- 资源：`cordis.patch.yml`、`locale/{zh,en}.json`、`icon.svg`。
- 测试工具：`scripts/render-preview.ts` + `scripts/preview-shots.mjs`
  （示例数据 → HTML → 无头截图；支持 400px 侧栏与 1600px 对话区两种画布）。

## 3. 实际执行的命令与结果

| # | 命令 | 退出码 | 结果 |
| --- | --- | --- | --- |
| 1 | `npx tsc -p tsconfig.json --noEmit` | 0 | **0 errors**（全包，含测试与预览脚本） |
| 2 | `npm test` | 0 | **313 tests / 313 pass / 0 fail** |
| 3 | `npm run build` | 0 | `lib/index.js` 253,767 B；`lib/client.js` 298,607 B；client bundle 唯一裸 `require` 为 `react` |
| 4 | `plugin_manager set_plugin include:dsh-vcs-timeline`（false → true） | 应用成功 | 两次均 `application: "applied"`；Host 行重新挂载，`/vcs/timeline` 立即返回 `changedFiles` |
| 5 | `node scripts\verify-live.mjs http://127.0.0.1:7283` | 0 | **17/17 live checks passed**（含真实提交统计、token 单次使用、审计落盘） |
| 6 | `node --experimental-strip-types scripts/render-preview.ts` | 0 | 19 个预览页面（侧栏 400×900、对话区 1600×900，含 PR/文件 Diff 分栏） |
| 7 | `node scripts/preview-shots.mjs` | 0 | 19 张 PNG（无头 Edge，按页面声明尺寸截图） |
| 8 | 直接读取 `%DSH_HOME%\storages\dsh-vcs-timeline\*.jsonl` | — | `operations.jsonl` 含同 id 的 `started` + `succeeded` 两条；`events.jsonl` 含 `plugin-audit` 事件 |
| 9 | 真实页面自动化（Playwright + Edge，多轮全新 page 会话） | — | 两轮 13 项检查：首轮 9/10，修复“详情/Diff 撑高面板”后复验通过 |
| 10 | 真实桌面端 `POST /vcs/timeline {includeFiles:true}` | 200 | 本仓库最新提交返回 65 个文件；历史全部 2 个提交均带 `changedFiles` |

### 3.1 测试套件分布（命令 2 的分解）

| 套件 | 数量 | 覆盖 |
| --- | --- | --- |
| `security.test.ts` | 9 | 凭据脱敏、路径越界拒绝、游标编解码、UTF-8 截断、数字/时间校验、repositoryId 稳定性 |
| `discovery.test.ts` | 8 | 工作区有界发现、工作区自身为仓库、嵌套仓库不重复、跳过 node_modules/隐藏目录、深度上限、路径闸门、显式添加/移除、非仓库拒绝 |
| `operation-service.test.ts` | 13 | 预览→执行、token 单次/TTL/参数绑定、argv 复核、审计先落盘、超时/被杀→unknown、spawn 失败→failed、push 非零→confirmed-failure、审计写失败不执行、单仓库互斥、只读操作拒绝、审计折叠 |
| `storage.test.ts` | 16 | JSONL 追加/折叠/分页、200 并发写、坏尾行/坏中间行、schemaVersion 不兼容、轮转、扫描上限、脱敏 |
| `audit.test.ts` | 10 | start 先持久化、finish 追加终态且不改 started、失败保留 started、requestSummary/outputSummary 脱敏与上限、非法时钟 |
| `git.unit.test.ts` | 23 | NUL 日志解析、name-status/numstat（重命名/二进制空路径）、**log --name-status -z 解析（R/C/T/D、合并提交空列表、畸形流容忍）**、**逐文件 numstat 解析（binary/rename/merge）**、统计解析、name-status+numstat 合并、200 文件截断、argv 过滤参数一致性、porcelain v2/v1、hash/分支/远端名校验 |
| `git.integration.test.ts` | 14 | **真实临时 Git 仓库**：探针/分页/过滤、每提交统计值、**includeFiles 的逐文件状态与 ±（增/改/删/重命名/二进制）**、**无 includeFiles 时事件不带 changedFiles**、真实 merge 提交 `changedFiles: []`、name-status 探针失败降级为 partial、写计划与降级 |
| `svn.unit.test.ts` | 65 | `svn --xml` 解析（log/info/status）、summarize、revision 注入拒绝、argv 构造、分页游标、重命名/复制、Diff 截断/二进制、update/commit 计划、缺客户端降级、路径归一回归、**log -v 逐路径映射（copy/rename/info 失败回退/205→200 截断）** |
| `client.format.test.ts` | 17 | 时间/紧凑时间/哈希/字节、Diff 行分类与行号计算、事件统计读取（含 merge 全 0 抑制）、状态/事件/来源/操作标签、错误映射、字典键一致、插值回退 |
| `client.fileindex.test.ts` | 12 | **文件聚合（状态取最新、变更次数、± 累计）、状态计数、文件名/路径/旧路径搜索、目录树与目录计数、单文件历史、按状态/搜索过滤后两栏一致性、未提供文件清单的降级** |
| `client.graph.test.ts` | 7 | **提交图泳道：线性/合并/父已在其它泳道时汇入/页边界/泳道上限/几何辅助函数** |
| `pr.test.ts` | 29 | **PR 远端解析（https/scp/ssh/凭据剥离）、凭据链优先级与令牌不外泄、GitHub GraphQL/匿名 REST 映射、详情文件、动作推导全分支、错误映射（401/403/限流/网络/超限）、60s 缓存与 refresh、路由入参校验** |
| `insight.test.ts` | 45 | **工具链探测/配置（config>PATH>probe、argv[0] 改写、无效配置忽略）、本地分支对比（领先/落后、log -z、shortstat、merge-tree 冲突与降级、分离 HEAD、SVN unsupported）、动作表全分支、真实 git 集成（ahead/behind、冲突）** |
| `client.panel.test.ts` | 7 | 写操作 draft 保留/重置、`operationParams`、preview/execute 参数一致性（token 绑定契约） |
| `client.render.test.ts` | 38 | SSR 渲染：加载/错误/空仓库/未初始化/时间线/合并提交/真实统计与“无统计不伪造”/部分结果/工具条与菜单/**双栏文件树与共享过滤、三栏文件视图（树/Diff/操作信息）、作者分布、单文件收窄、状态筛选、目录展开、“未提供文件清单”、时间线日期分组/HEAD/相对时间、添加仓库对话框、本地分支洞察**/详情/Diff/审计/状态栏/诊断/对话框/token-only 样式/字典完整性 |

## 4. 桌面端验收

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| DSH 发现并加载插件 | 通过 | `install_bundle` → `application: "applied"`；`Config.listConfigs(name=dsh-vcs-timeline)` 有该行 |
| 对话区页签入口 | 通过（真实页面） | 顶部视图行（role=tablist，y≈50）：对话 / 轨迹 / 上下文 / 编队 / **代码时间线**（order 40，排最后）+ 宿主“…”；hero 与活动会话里均无插件 dock 条/浮层 |
| 点击页签在对话内容区渲染 | 通过（真实页面） | `[data-dvt-panel="vcs-timeline"]` rect **280,76,1633×876**，位于 `data-conversation-content` 内；无 overlay/dialog；点「对话」恢复聊天、再点页签恢复面板，URL 不变 |
| IDEA 风格时间线 | 通过（真实页面） | 3 行 = “3 条提交”；每行有 rail 线 + 节点（节点中心与 rail 中心对齐）、头像/作者/摘要/相对时间（title=精确时间）/7 位 hash/**HEAD 仅 1 个**/分支/±；日期头“今天 / 3 条提交”吸顶；合并空心节点与吸顶滚动因仓库无合并提交/仅 3 条提交未实测 |
| 真实数据一致性 | 通过（真实页面） | 与 `git log` 一致；HEAD 唯一；行数 = 提交数 |
| 多泳道提交图 | 通过（真实页面 + 临时 merge 仓库） | SVG 节点/泳道/合并曲线/空心合并节点与“合并”标签；临时仓库实测 lanes{0,1} |
| 列表/详情分栏 | 通过（真实页面） | 列表保留 + 下方详情；详情内 Diff；返回关闭详情且列表保留 |
| 文件树可见 | 修复后通过（真实页面） | 旧 Host（无 changedFiles）导致树空；重建 + 重新挂载后恢复（根条目 12 行，目录可展开） |
| 三栏文件视图 | 通过（Lead 真实页面探针） | 树 300px / Diff 993px / 操作信息 340px；Diff 14 行、作者分布/提交记录/打开审计齐全；文件模式下列表隐藏 |
| 聊天输入框隐藏 | 通过（Lead 真实页面探针） | composerSeat display:none、rect 0×0；面板填满内容区（883px）；切回对话需恢复 |
| 添加仓库 | 通过（真实页面 + Host 路由） | 对话框可用；添加 st-agent 返回 vcs-not-installed 并显示 TortoiseSVN / vcs-config.json 指引 |
| 本地分支洞察 | 通过（真实页面 + /vcs/branch/compare） | 领先 3 / 落后 0 / 0 未推送 / 94 文件 / 可以发起 PR；提交列表 3 条 |
| PR 页签 | 通过（真实页面，受限环境） | 网络超时 → 诚实错误态 + 重试；匿名成功 → 未认证 + 空列表；未认证不伪造评审/CI |
| 审计区（真实记录） | 通过（真实页面 + 插件路由） | 成功/失败记录、chips 计数、状态筛选、空筛选、详情（退出码/前后 revision/correlationId）；临时仓库已清理 |
| 高度有界（列表/详情/Diff） | 通过（真实页面，修复后复验） | 三种状态面板均 876px；宿主滚动容器 scrollHeight == clientHeight（1004）；内部 `.dvt-scroll` 为滚动容器（723/2062、723/2421）；滚到 800px 时 toolbar y=76、面包屑 y=110、树 y=173、状态栏 y=928 全部固定 |
| 双栏真实数据一致 | 通过（真实页面） | 110 个文件；展开全部 110 行 = 头部 110、17 个目录 0 处徽标不一致；状态 chips M60/A46/D4；单文件收窄与 × 清除 |
| 状态筛选 / 搜索 / 时间范围 | 通过（真实页面） | M 60 行、A 46 行、搜索收窄；时间预设 4 次均触发 `/vcs/timeline` 重载且无错误 |
| 提交详情与 Diff | 通过（真实页面） | 详情面包屑 + 6 字段元信息 + 71 文件；README.md diff 147 行（137 行带行号、6 个 hunk）；左树保持可见 |
| 1440×800 / 1024×768 | 通过（真实页面） | 页面 overflowX = 0，控件无裁切；面板高度随视口收敛，1024 下摘要正常省略 |
| 明暗主题 | 通过（真实页面） | 深色下时间线 rail/节点/头像/日期头可读（日期头对比度 9.54，rail 2.45）；恢复“跟随系统” |
| 控制台 | 通过（真实页面） | 多轮全新 page 与全部交互 0 pageerror、0 console error/warning |
| 选择仓库并显示历史 | 通过 | live check 返回 2→3 条事件；页面显示真实提交 |
| 提交统计真实可用 | 通过 | live check：`timeline carries real commit stats — files=1 +1 -1` |
| 逐提交文件清单 | 通过（Host + 页面） | 真实仓库最新提交 71→65 文件；页面树/列表均由该数据派生 |
| 查看文件列表与 Diff | 通过 | live check：`changeset`、`diff` 114 B；页面内真实 Diff 带行号 |
| 写操作可审计 | 通过 | live check：preview→execute 真实提交成功（`exit 0`）；`op/list` 折叠 `succeeded`；JSONL 落盘 |
| 右侧栏页签 | 注册存在，UI 不可达（已知限制） | `sidebar.right.pane.tab` occupant 含 `vcs-timeline`；但侧栏“开始”条只有 1 个页签，更多工具里也无该入口（未改动，非本轮回归） |
| 插件重新挂载后审计可读 | 通过 | 禁用→启用后 `op/list` 仍返回折叠记录 |
| 禁用/卸载后释放注册 | 通过 | `set_plugin:false` 后 `/vcs/*` 返回 404；重新启用后恢复 |
| 无非预期仓库修改 | 通过 | 写操作只发生在 `%TEMP%` 临时仓库，测试后删除 |
| 整进程重启后审计可读 | **未验证** | 仅验证重新挂载 |

## 5. Live 端到端检查（`scripts/verify-live.mjs`，17/17）

对运行中的 Host 依次验证（临时 Git 仓库 + 真实 HTTP，目标 `http://127.0.0.1:7283`）：

1. `diagnostics`（插件版本、git 版本、svn 缺失、数据目录）
2. `repos/add`（识别 git、当前分支、HEAD）
3. `repos/list`
4. `timeline`（2 条、最新提交说明正确、倒序）
5. **`timeline` 事件带真实统计**：`files=1 +1 -1`
6. `changeset`（`modified:a.txt`）
7. `diff`（文本含 `+three`、非二进制）
8. `status`（脏、1 条已暂存）
9. 不支持的 `merge` 预览被拒（`invalid-request`）
10. 空提交信息预览被阻止（allowed=false + blockedReason）
11. commit 预览（返回精确 argv）
12. commit 执行（`succeeded`、`exitCode 0`、前后 revision）
13. 时间线出现新提交（3 条）
14. 审计折叠（1 条 `succeeded`，correlationId 可读）
15. token 单次使用（第二次 `confirmation-invalid`）
16. 非 JSON content-type 被拒（HTTP 415）
17. 未知路由 404

## 6. UI 验证（组件渲染 + 真实页面）

### 6.1 组件渲染截图（`docs/ui-preview/`）

`node --experimental-strip-types scripts/render-preview.ts` → `node scripts/preview-shots.mjs`
（Edge 155 无头，按页面声明尺寸：400×900 侧栏 / 1600×900 对话区，亮/暗）。16 个场景：

- `list-light/dark`、`tree-file-light`：双栏（树 + IDEA 时间线）、单文件收窄
- `wide-light/dark`：对话区宽度下的时间线
- 详情、Diff、审计列表/详情、写操作对话框、操作菜单、诊断展开、加载中、空仓库、未初始化仓库

### 6.2 真实页面自动化（Playwright + Edge，1920×1080）

两轮共 13 项检查（入口/时间线/详情/Diff/筛选/尺寸/主题/关闭路径/控制台），首轮 9/10，
发现并修复以下缺陷后复验通过：

| # | 缺陷（真实页面证据） | 根因 | 修复 |
| --- | --- | --- | --- |
| D1 | 详情/Diff 时面板从 876px 增长到 2215/2574px，宿主滚动整页，toolbar/面包屑/树/状态栏滚走 | Conversation View 挂在聊天滚动区内，`height: 100%` 解析到内容尺寸的外层；`.dvt-scroll` 永远不滚 | 面板挂载时测量宿主滚动容器（`[data-conversation-scroll]`）：高度 = 容器 clientHeight − 面板顶部偏移 − 容器内其他“座位”（composer seat）高度，并用 ResizeObserver 跟随；右侧栏宿主无此容器，继续走 CSS `height:100%` |
| D2 | rail 竖线对比度仅 1.9:1（浅色） | 1.5px @ 0.28 品牌色过淡 | 2px @ 0.5；深色 2.45:1，浅色约 3.9:1 |
| D3 | `.dvt-tl-card` 的 aria-label 显示字面量“查看提交 {label}” | i18n 模板参数名是 `label`，调用方传了 `revision/summary` | 调用方改为传 `label: "hash 摘要"` |
| D4 | 400px 侧栏行内分支标签挤压摘要/作者 | 窄栏信息优先级 | 容器查询按面板宽度隐藏行内分支标签等次要信息 |
| D5 | 全屏/宽视图搜索框拉伸到 1300px+ | 侧栏与宽视图共用 flex | 搜索框 max-width 380px，树宽 160–300px |

通过项（节选）：页签唯一且排最后、无 dock/浮层、点击/切回对话正常、时间线与 `git log` 一致、
HEAD 唯一、头像/作者/相对时间/± 正确、树展开计数 0 不一致、单文件收窄、详情与真实 Diff 留在视图内、
1440/1024 无横向溢出、深色可读、0 控制台错误。

第二轮最终验收（本轮改动：文件三栏 / 隐藏输入框 / 添加仓库 / 本地分支洞察）同样 7/7 PASS：

1. 输入框隐藏与恢复：`composerSeat` display:none、rect 0×0，面板撑满 1004px；点「对话」恢复输入框，再切回再次隐藏。
2. 文件树：133 个文件，docs 51 / src 67 等目录计数与展开后行数完全一致，折叠回 7 个根条目。
3. 三栏文件视图：树 300px / Diff 993px / 操作信息 340px（信息在 Diff 右侧），文件模式下列表隐藏；
   Diff 93 行；在操作信息里点另一提交，Diff 切到 122 行、当前项高亮移动；作者分布/提交记录/打开审计齐全。
4. 添加仓库：工具栏按钮与 `⋯` → 仓库入口都能打开；输入 `D:/haiyiData/myCode/st-agent` 后给出
   TortoiseSVN / vcs-config.json 的安装指引。1024×768 下为模态（overlay 737×692、dialog 400×162，输入与按钮完整）。
5. PR 0 个开放时的本地分支洞察：fix-upload → main、领先 3、落后 0、0 未推送、94 文件、可以发起 PR，
   3 条领先提交；与 `/vcs/branch/compare` 返回值一致。
6. 回归：时间线（5 行/2 个日期组/HEAD/±）、提交详情 + Diff 分栏、审计 chips（全部2/成功1/失败1）、
   面板有界（1440→824px、1024→692px）、页面无横向溢出、深色主题可读。
7. 控制台：0 pageerror、0 console error、无失败的 `/vcs` 请求。

本轮缺陷：添加仓库对话框缺少 `.dvt-overlay` 模态包装（1920 压住状态栏、1024 裁成 54.6px 表头条）
→ 包进 `dvt-overlay`；切换来源残留文件选择（返回时间线显示“暂无 Diff”）→ `onSetSource` 清空
`selectedFilePath`；预览中泳道重复/断线 → 父已在其它泳道时汇入 + `opened` 页边界 + 行高对齐；
分离 HEAD 出现重复 HEAD 标签、审计行 aria 占位符未替换 → 分别过滤 `HEAD` 伪分支与改传 `label`。

截图与原始 JSON：`_scratch/v10`（上一轮）、`_scratch/v13`（本轮 27 张 + 5 份 JSON）、`_scratch/v12`、`_scratch/v14`。

6`（33 张）、`_scratch
7`（高度修复复验）。

## 7. 集成期间发现并修复的缺陷（累计）

| # | 缺陷 | 影响 | 处置 |
| --- | --- | --- | --- |
| 1 | 客户端预览不带参数、执行带参数，Host 将 token 绑定到参数哈希 | commit/push 永远 `confirmation-invalid` | 客户端统一参数构造函数；输入变更作废旧 token 并防抖重预览；7 项契约测试 |
| 2 | Git 缺少 `-c core.quotepath=false` | Diff 头中文路径被八进制转义 | 所有 Git 命令加入 |
| 3 | `# branch.oid (initial)` 被当成 HEAD | 空仓库显示伪 hash | 解析忽略 `(initial)` |
| 4 | porcelain v2 仅工作区改动时 `status='.'` | UI 显示 `.` 而非 `M` | 回退到 worktree 列字母 |
| 5 | 作者过滤直接作为正则 | 输入 `[` 导致 `operation-failed` | `--fixed-strings` |
| 6 | push 计划允许任意分支名 | 可能推送未校验 ref | v1 只允许当前分支 |
| 7 | pull 未要求 upstream | 执行必失败 | 无 upstream 时明确 blocked |
| 8 | `detect()` 返回正斜杠路径 | 与 realpath 形式不一致 | `realpath` 规范化 |
| 9 | SVN summarize 与 log 路径坐标不同 | 变更列表重复 | 按 wc 前缀归一 + 回归测试 |
| 10 | SVN `parseRevision` trim 后才校验 | `"\n5"` 被接受 | 先拒绝控制字符 |
| 11 | merge commit 的 numstat 为空 → 全 0 统计 | 会显示误导性的 `+0 −0` | 合并提交全 0 视为“未提供”，不渲染 |
| 12 | 窄栏/宽视图共用尺寸，行内分支标签挤压摘要 | 400px 下图例不可读 | 容器查询按面板宽度收敛；宽视图限定搜索框与树宽 |
| 13 | （上一轮入口方案）dock 样式不在面板树内 → UA 按钮样式 | 主入口外观走样 | 本轮入口改为对话区页签后整条链路不再存在；记录保留为历史 |
| 14 | 树头部总数与状态筛选后的行数不一致 | 计数看起来矛盾 | 头部显示渲染行数；chip 计数 = 搜索后/状态前 |
| 15 | 详情/Diff 在对话视图中撑高面板（876→2215/2574px），宿主整页滚动 | toolbar/树/状态栏滚走，非 IDE 行为 | 挂载时按宿主滚动容器计算有界高度（减 composer seat），内部滚动；ResizeObserver 跟随 |
| 16 | 时间线 rail 对比度 1.9:1、aria 模板参数名错误 | 可读性/a11y | rail 2px @ .5；调用方传 `label` |

## 8. 未验证内容（明确列出）

1. **整进程重启**：未重启 DSH 桌面端；仅验证插件重新挂载后审计可读。
2. **SVN 实机联调**：本机无 `svn` 客户端；仅 65 项解析器/命令行/降级测试。
3. **远程访问**：`/vcs` 仅 loopback，配对设备场景未实现也未测试。
4. **大数据量**：未在超大真实仓库上压测（每页额外一次 name-status 进程；文件索引窗口受分页限制）。
5. **跨进程写入**：单进程假设，未做双进程并发写同一数据目录的验证。
6. **人工视觉签收**：真实页面截图与 DOM/计算样式已核对，但最终“是否像 IDEA”仍由用户签发。
7. **时间线的两个数据依赖场景**：本机仓库只有 3 条提交（同日、无 merge），
   因此「日期头吸顶滚动」与「合并提交空心节点」只做了 DOM/CSS 与单元测试核对，未在真实滚动/合并提交上实测。
8. **右侧栏入口**：tab 类型注册仍在，但当前桌面端侧栏没有暴露加页签入口（真实页面探针确认：
   侧栏 begin 条只有“开始”，更多工具也无该项）；本轮未做侧栏可达性验收，主入口为对话区页签。
9. **PR 已认证路径**：本机无任何令牌、Host 进程无外网到 api.github.com，因此只验证了
   错误态与匿名空列表；评审/CI/可合并的真实渲染、GraphQL 映射、动作徽章在有令牌+网络时未实测
   （单元测试覆盖了映射与动作推导）。
10. **真实合并提交的图**：插件仓库本身无 merge，合并泳道用临时 `git merge --no-ff` 仓库验证；
   未在大型多分支历史上压测。

## 9. 已知限制 / 未实现

- Merge、Rebase、Switch、Reset、Clean、Force push：**不实现**，返回 blockedReason。
- 文件树/单文件时间线只覆盖**已加载的提交页**（界面明确提示“文件索引覆盖已加载的 N 次提交”）。
- Git binary 检测以 diff 头 `Binary files ... differ` 为主；numstat `-` 兜底未单独实现。
- status v1 兜底解析对 rename/copy 记录不完整（仅 porcelain v2 不可用时触发）。
- SVN 忽略 `contextLines`；工作副本子树之外的路径无法通过该 wc 取 diff。
- JSONL 轮转后的 `.1.jsonl` 为归档，不被查询读取。
- 审计页签不自动轮询（写操作终态后刷新时间线与工作区状态）。
- Host 侧若干文本（warnings、blockedReason、requestSummary、errorCode）按原样展示，可能是英文。
- 详情分栏高度固定为面板高度的 42%（可读性优先），暂不支持拖拽调整。
- PR 评审/CI/可合并状态需令牌且需 Host 出网；本机显示网络错误态（已在文档/UI 说明）。
- 提交图为单页推导：页边界首行泳道从当前页开始，跨页泳道可能不从顶部延续。
- **重建后必须重新挂载插件**：本次实测 DSH 进程曾继续运行旧 bundle（/vcs/timeline 无 changedFiles、
  /vcs/pr/list 404），重新 set_plugin false→true 后恢复；UI 已对旧 Host 的 PR 路由给出专门提示。
- 本机 svn.exe 缺失：SVN 工作副本可添加但读不到历史；需安装 CLI 或配置 svnPath 后重新挂载。
- 聊天输入框在插件视图打开期间被隐藏（DOM 级 display:none，卸载恢复）；若宿主改变聊天区 DOM 需同步调整。

## 10. 验证等级声明

| 层面 | 等级 |
| --- | --- |
| 代码实现 | implemented |
| 类型检查（0.2.1-rc.3 同版本类型包） | typechecked（`tsc --noEmit` 0 错误） |
| 单元测试 | unit-tested（313 个测试全通过） |
| 真实仓库集成测试 | integration-tested（Git 临时仓库 14 项；SVN 仅解析器级） |
| 桌面端 Host 端到端 | desktop-verified（17/17 live checks，含真实 Git 提交、统计、逐文件清单与审计落盘） |
| 面板视觉（组件渲染） | rendered-verified（400px/1600px、亮/暗无头截图 + 目视检查） |
| 桌面端真实页面视觉/交互 | desktop-verified（Playwright + Edge：对话区页签、多泳道图、列表/详情分栏、文件 who+Diff、PR 错误/匿名态、审计真实记录与筛选、有界高度、1440/1024、深色主题） |
| SVN 实机 | **not-verified**（本机无客户端） |
| 整进程重启持久化 | **not-verified**（仅验证重新挂载后读取） |

## 11. 复现方式

```powershell
cd E:\softData\DP_Harness\dsh-plugin\dsh-vcs-timeline
npm install
npm run typecheck
npm test
npm run build
# v1.1：构建产物 + 真实 git 的路由级验收（不需要运行中的桌面端）
node scripts\verify-host.mjs
# 需要运行中的桌面端（本轮为 http://127.0.0.1:7283）
node scripts\verify-live.mjs http://127.0.0.1:7283
# 组件渲染截图（本机 Edge/Chrome）
npm run preview:ui
```

测试全部使用 `%TEMP%` 下的临时目录/临时 Git 仓库，结束后删除；不触碰用户的真实仓库。

## 12. v1.1（0.1.1）追加验收 — 2026-10-28

### 12.1 范围

P0 六项：待处理工作台（含逐文件工作区 Diff）、提交前变更体检、审计节点融入时间线、
分支标签筛选 + 仅当前分支/全部分支、会话改动集 + AI 归因徽标、统计聚合缓存 + 文件热点排行。

### 12.2 实际执行的命令与结果

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck`（`tsc --noEmit`） | **exit 0**，0 error |
| `npm test`（`node --experimental-strip-types src/tests/index.test.ts`） | **exit 0**，`# tests 366 / pass 366 / fail 0`（0.1.0 的 313 项 + v1.1 新增 53 项） |
| `npm run build`（esbuild） | **exit 0**，`lib/index.js` 287.1 kb、`lib/client.js` 365.6 kb |
| `node scripts/verify-host.mjs`（构建产物 + 真实 git，14 项） | **14/14 PASS**（详见 12.3） |
| `node --experimental-strip-types src/tests/checks.test.ts` | 18/18 |
| `node --experimental-strip-types src/tests/stats.test.ts` | 13/13 |
| `node --experimental-strip-types src/tests/worktree.test.ts` | 5/5 |
| `node --experimental-strip-types src/tests/checks-service.test.ts` | 3/3 |
| `node --experimental-strip-types src/tests/session.test.ts` | 3/3 |
| `node --experimental-strip-types src/tests/client.v11.test.ts` | 11/11 |

### 12.3 `verify:host`（不需要重启桌面端）

把 `lib/index.js` 挂到一个仅提供 `webServer / subprocess / workspaceRegistry / sessions` 的假 Host 上，
在 `%TEMP%` 建一次性 Git 仓库（1 个提交 + 已暂存/未暂存/未跟踪/锁文件改动），用真实 `git` 进程
驱动全部新路由，14/14 通过：

1. `repos/list` 发现工作区仓库；2. `timeline` 带逐提交文件清单；3. `branchScope=all`；
4. `status` 分组字段；5. 未暂存 Diff；6. 已暂存 Diff；7. 未跟踪文件整文件 Diff；
8. `checks`（已暂存侧）；9. `checks`（工作区侧，lockfile + untracked-skipped）；
10. `stats/hotspots`（真实窗口/分支/文件）；11. `session/changes`（成功 write → inferred）；
12. 非活动会话返回 `available:false`；13. `op/preview` 提交预览；14. diagnostics。

### 12.4 未验证 / 明确声明

- **运行中的桌面端页面未做 v1.1 验收**：Host 代码在进程启动时载入，本轮未重启 DSH 桌面端
  （重启会中断当前会话）。因此新路由在真实实例上的验收以 `verify:host` 的构建产物级结果为准；
  重启后应运行 `npm run verify:live http://127.0.0.1:<port>`（脚本已加入 v1.1 新路由检查）。
- **SVN 仍未联调**：本机 `E:\softData\TortoiseSVN` 只装 GUI 组件，`bin/` 无 `svn.exe`；
  SVN 的工作区 Diff（无暂存区拒绝）、热点不可用、分支过滤警告只有单元测试覆盖。
- **会话归因未在真实活动会话上人工核对 UI**：服务层用假 SessionStore 覆盖成功/失败/非白名单/
  越界路径/去重；真实 UI 上的「推断」徽标只有渲染测试。
- 热点统计的真实验证只覆盖 1 次提交的仓库（窗口/缓存/截断有单元测试）。
- 长历史/大仓库性能（500–2000 提交窗口）未做基准测试。

## 13. v1.2（0.1.2）反馈修正验收 — 2026-10-28

### 13.1 修了什么

1. **热点页改为图表**：`HotspotReport.daily`（Host 按 UTC 日聚合的真实提交桶）驱动日历热力格；
   文件排行改为条形图（指标可切）。不再渲染文件表格。
2. **Commit 可用性**：`stage` / `unstage` 成为显式写操作（同预览 → 单次 token → 审计），
   待处理页提供「提交已暂存 / 暂存全部 / 取消暂存全部」；Host `blockedReason` 客户端本地化。
3. **整侧 Diff 二进制误判**：工作区整个一侧的 diff 含二进制文件时不再把 text 置空并标 `binary:true`，
   只有单文件请求才做二进制短路（Git/SVN 均修）。
4. **会话归因**：Host 通过 Cordis `ctx.get('sessions')` 取活动会话，读不到才降级；
   `verify:host` 的假 Host 同时提供 `get()` 与 `sessions` 属性覆盖该路径。
5. **翻译兜底**：客户端 bound translator 之后再做一次 `interpolate`，`{count}` 不会漏到界面。

### 13.2 实际执行的命令与结果

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | **exit 0** |
| `npm test` | **exit 0**，`# tests 371 / pass 371 / fail 0` |
| `npm run build` | **exit 0**，0.1.2 bundle |
| `node scripts/verify-host.mjs` | **21/21 PASS**（新增 stage/unstage 预览与真实执行、daily 桶、会话 get 路径） |
| `node --experimental-strip-types src/tests/worktree.test.ts` | 8/8（新增整侧二进制、单文件二进制、stage/unstage 计划） |
| `node --experimental-strip-types src/tests/stats.test.ts` | 13/13（新增 daily 桶断言） |
| `node --experimental-strip-types src/tests/client.v11.test.ts` | 13/13（新增图表/操作按钮/阻断原因本地化） |

### 13.3 未验证 / 明确声明

- 运行中的桌面端仍是上一版 Host（本轮未重启，重启会中断会话）。因此新 Host 的
  `daily` 热力数据、`stage/unstage` 路由、会话归因修复需重启后复查；
  重启后运行 `npm run verify:live http://127.0.0.1:<port>`。
- 新 UI 已用真实客户端 bundle + 探针页（把 `/vcs` 代理到运行中的 Host）渲染核对：
  热点页显示日历热力 + 条形图，待处理页显示三个操作按钮；旧 Host 没有 `daily` 时图表显示
  诚实的空状态而不是崩溃。
- 26 周热力图的宽度/窄栏换行只有渲染级验证，未做真实窗口的多分辨率人工签收。

## 14. v1.5（0.1.3）动态加载 / 热加载验收 — 2026-10-29

### 14.1 范围

纯浏览器半改动，未新增/修改 Host 路由：

- `src/client/cache.ts`（新增）：页面生命周期内存缓存（workspace 列表 + repository 切片 + 时间戳），
  `timelineQueryKey` / `workspaceKey` 保证不同筛选与 Windows 路径不会互相命中；仓库 LRU 8。
- `src/client/sync.ts`（新增）：插件激活即预热（1.2s 首轮 → 30s），面板打开暂停、关闭 800ms 补一轮，
  visibility 恢复时补 warm（5s 节流），失败指数退避 30→60→120→240s，token 丢弃 stop 后在途结果。
- `src/client/panel.ts`：首帧 `hydratePanelState` 水合；首屏加载在已有数据时静默（不清列表）；
  `mergeTimelineRefresh` / `mergeAuditRefresh` 原位合并并保留已加载旧页；10s status 指纹探测、
  30s 完整静默刷新、visibility/focus 立即刷新（5s 节流）；刷新计数器成对释放（被取代的请求
  `cancelRefresh`），进度条不会卡死；冷启动失败仍走原错误态，静默失败保留旧数据并写 `sync.lastError`。
- `src/client/index.ts`：激活时 `sync.start()`，卸载 `sync.stop()`，并把 `sync` 注入面板。
- `src/client/styles.ts` / `ui/toolbar.ts` / `i18n.ts`：3px 不确定进度条（零高度槽，不推动布局）、
  旋转刷新图标、`role=status` live region、stale 警告 Banner、shimmer 骨架屏、reduced-motion 退化。
- `src/client/types.ts`：`SyncState`、`HydrationSnapshot`、`PanelSync`、`SyncRuntimeState`。

### 14.2 实际执行的命令与结果

| 命令 | 结果 |
| --- | --- |
| `npx tsc -p tsconfig.json --noEmit` | **exit 0**，0 诊断 |
| `npm test` | **exit 0**，`# tests 470 / pass 470 / fail 0`（新增 41 项：cache 6 / dynamic 8 / sync 21 / sync-ui 6） |
| `npm run build` | **exit 0**，`built dsh-vcs-timeline@0.1.3: lib/index.js, lib/client.js` |
| `node scripts/verify-host.mjs` | **21/21 PASS**（Host 未改，回归） |
| `node scripts/verify-live.mjs http://127.0.0.1:2613` | **28/28 PASS**（运行中的桌面端 Host 仍是 0.1.2 进程；v1.5 不涉及 Host 代码） |
| `node --experimental-strip-types src/tests/client.cache.test.ts` | 6/6 |
| `node --experimental-strip-types src/tests/client.dynamic.test.ts` | 8/8（水合、错误筛选不命中、仓库回退、原位合并、审计合并） |
| `node --experimental-strip-types src/tests/sync.test.ts` | 21/21（假调度器 + 可控时钟，零真实计时；含 2 分钟仓库列表复用） |
| `node --experimental-strip-types src/tests/client.sync-ui.test.ts` | 6/6（进度条/live region/stale Banner/样式断言） |

补充一次**临时视觉核对**（产物未入库）：用真实 `renderPanelView` + `sync.refreshing = true` 渲染
1600×900 浅色页面，Edge headless 截图确认工具栏出现“正在更新…”胶囊、刷新图标为旋转态、
主卡片顶部 3px 进度条槽渲染（像素采样 y≈12–14 为 `--dsw-alias-bg-layer-2`）；因 headless
截图不推进 CSS 动画，只核对了布局与静态形态，动画本身由样式/渲染测试覆盖。

### 14.3 未验证 / 明确声明

- **未在真实页面上做 F5 后的人工/自动化视觉签收**：本轮环境里 GUI 需要会话授权，且没有启动新的
  Playwright 浏览器核对；首次/二次打开的骨架差异、进度条位置、滚动保持等都是组件级渲染 + 纯状态测试，
  不是真实桌面端截图。可按 [docs/DYNAMIC-LOADING.md](DYNAMIC-LOADING.md) §4 的 10 条步骤手工验收。
- **预热/计时的“感知性能”未量化**：`sync.test.ts` 验证了调度、退避、单飞与缓存写入，但没有在真实
  Host 上测 30s 轮询的 CPU 占用或点击到首帧的毫秒数；10s 状态探测依赖 `git status`，超大仓库的开销
  未测。
- **运行中的桌面端 Host 插件版本仍是 0.1.2**：`diagnostics` 返回 0.1.2，说明 Host 进程未重启；
  v1.5 全部在 `lib/client.js`，浏览器 F5 后加载 0.1.3 客户端，不需要重启 Host。若应用启动时缓存了
  旧客户端 bundle，需重挂载/重装插件。
- 多面板实例边界（右侧栏 + 对话区同时挂载）没有做实例计数，见 README 已知限制。
- 未重新生成 `docs/ui-preview/` 截图（样式新增进度条/shimmer，但预览页是示例数据渲染，不是运行时状态）。

## 15. v1.5.1（0.1.4）加载骨架细化验收 — 2026-10-29

### 15.1 范围

按“X/Twitter 卡片列表加载”的视觉重做加载动画（纯客户端）：

- 新增 `src/client/ui/skeleton.ts`：`SkeletonBlock/Line`、`SkeletonCardList`、`SkeletonTimelineList`、
  `SkeletonTree`、`SkeletonHotspots`、`SkeletonWorkbench`、`SkeletonContent`，以及有状态的
  `SkeletonSwap`（骨架 260ms 淡出 + 内容同帧淡入，grid 同格叠层防跳动）。
- `src/client/components.ts`：`isContentLoading(state)` 决定是否铺骨架（boot loading 或当前 source
  首次加载且无已显示数据；有数据的静默刷新绝不出骨架）；主内容包 `SkeletonSwap`；timeline 首次加载
  /冷启动时左树用 `SkeletonTree`。
- `src/client/ui/history.ts / audit.ts / pr.ts / hotspots.ts / workbench.ts`：主列表 loading 分支改为
  返回 `null`（由 composition root 的覆盖层负责骨架），局部 pane（detail/diff/checks/session/compare/
  dialog）继续用 `SkeletonRows`，但内部换成新灰块样式。
- `src/client/ui/toolbar.ts` / `status.ts`：冷启动骨架阶段隐藏进度条、“正在更新…”胶囊与 live 文案；
  状态栏换成灰块，保证骨架屏无文字。
- `src/client/styles.ts`：`.dvt-skel-block` 灰块 + `::after` 白色微光扫光（1.5s 循环，负延迟首帧可见）、
  `dvt-skel-out` / `dvt-content-in` 交叉淡入淡出、`prefers-reduced-motion` 退化；状态栏/时间线/卡片/
  树/热点/待办骨架布局样式。
- 新增 `src/tests/client.skeleton.test.ts`（11 项），并加入 `src/tests/index.test.ts` 的默认测试入口。

### 15.2 实际执行的命令与结果

| 命令 | 结果 |
| --- | --- |
| `npx tsc -p tsconfig.json --noEmit` | **exit 0**，0 诊断 |
| `npm test` | **exit 0**，`# tests 483 / pass 483 / fail 0`（新增 13 项：skeleton 11 + dynamic 2 个“首帧 loading”用例） |
| `npm run build` | **exit 0**，`built dsh-vcs-timeline@0.1.4: lib/index.js, lib/client.js` |
| `node scripts/verify-host.mjs` | **21/21 PASS**（Host 未改，回归） |
| `node scripts/verify-live.mjs http://127.0.0.1:2613` | **28/28 PASS**（运行中的桌面端 Host 仍是旧进程；v1.5.1 不涉及 Host） |
| `node --experimental-strip-types src/tests/client.skeleton.test.ts` | 11/11 |

补充**视觉核对**：新增预览场景 `loading-skeleton-light` / `loading-skeleton-dark`（1600×900，
`npm run preview:ui` 用真实 `renderPanelView` + 示例数据渲染并由本机 Edge 截图，产物见
[docs/ui-preview/loading-skeleton-light.png](ui-preview/loading-skeleton-light.png) 与
[docs/ui-preview/loading-skeleton-dark.png](ui-preview/loading-skeleton-dark.png)）。核对结果：
左树为 `SkeletonTree`、主内容为时间线灰块（140px 泳道占位 + 行结构）、底部状态栏为灰块、
无“正在更新…”胶囊/无空状态文字；灰块白色扫光渐变已做像素采样确认（浅色下 238→245 再回落）。
截图不推进 CSS 动画，循环扫光与交叉淡入淡出的时长/关键帧由样式断言 + `SkeletonSwap` 契约测试覆盖。

### 15.3 未验证 / 明确声明

- **未在真实 DSH 页面做 F5 后的人工/自动化视觉签收**：本环境 GUI 需要会话授权，且没有启动新的
  Playwright 浏览器；骨架布局、无文字、淡入淡出的最终观感需在真实页面按 F5 后确认
  （`README` v1.5.1 与 `docs/DYNAMIC-LOADING.md` §4 有验收步骤）。
- 交叉淡入淡出的**运行时时序**（React effect、260ms 后卸载骨架）只能在浏览器里发生；Node 测试固定了
  两态渲染、260ms 窗口、grid 叠层与 `aria-busy/aria-hidden` 契约，不是逐帧动画核对。
- 未重新生成 `docs/ui-preview/` 截图；`docs/ui-preview/loading-dark.*` 仍是旧版加载态预览。
- 运行中的桌面端 Host 插件版本仍是旧进程；v1.5.1 全部在 `lib/client.js`，F5 后加载新客户端。

## 16. v1.5.2（0.1.5）PR Token 兼容性验收 — 2026-10-29

### 16.1 现场诊断（为什么配了 `GITHUB_TOKEN` 还拉不到）

| 检查 | 结果 |
| --- | --- |
| Windows 用户环境变量 `GITHUB_TOKEN` | **存在**（长度 40，未打印内容） |
| 运行中的 DSH 进程环境 | **不存在** `GITHUB_TOKEN` / `GH_TOKEN`（本会话子进程同样读不到） |
| DSH 进程 | PID 36756（父 19364），创建于 2026-10-29 17:42:45 →
  Host 在 token 生效前启动，或不是从带该变量的上下文启动 |
| 直接验证 token | `GET /user` 200（login 已确认）、`GET /repos/...` 私有仓库 200、scope=`repo` |
| Host 网络 | 可达 api.github.com：公开仓库匿名 PR 能读到；私有仓库返回 `auth-required`（凭据缺失） |
| 回退凭据 | `~/.git-credentials`、`<dataDir>/pr-auth.json` 均不存在 |

结论：**两个独立原因叠加**。①环境变量只在新进程启动时继承，运行中的 Host 看不到；
②token 只有 `repo` scope，而 v1.5.1 的 GitHub GraphQL 查询无条件请求 `Team.name`（需要 `read:org`），
于是即使 token 被读到，查询也会被 GitHub 拒绝（`INSUFFICIENT_SCOPES`）。

现场处理：先用插件支持的 `<dataDir>/pr-auth.json` 写入用户已配置的 token（不打印内容），
Host 立即从匿名切到 authenticated，复现出第二个错误；确认后已删除该临时文件（最终依赖重启继承
环境变量；文件是可选的免重启路径，插件文档已说明）。

### 16.2 代码修复

`src/host/pr/github.ts`：

- `PULL_REQUEST_FIELDS` 拆成带/不带 `... on Team { name }` 两个版本；
  `GITHUB_LIST_QUERY` / `GITHUB_CLOSED_QUERY` / `GITHUB_DETAIL_QUERY` 各生成 full / reduced 两版，
  公开导出的 full 版查询文本保持不变。
- 新增 `isInsufficientScopes()`（识别 `INSUFFICIENT_SCOPES` / `required scopes` / `read:org`）与
  `postGraphQLWithScopeFallback()`：仅当第一次 GraphQL 响应是 scope 缺失时，用 reduced 查询重试一次；
  限流/凭证失效/畸形响应不重试。
- 降级成功后在 `warnings` 追加
  `team review requests were omitted: the token lacks the read:org scope`，列表/详情/历史都会带出；
  service 会因 warnings 标 `partial: true`，UI 不会把它当完整数据。
- `src/tests/pr.test.ts` 新增 3 项：列表 scope 降级重试（断言第二次查询不含 `on Team`、只重试一次）、
  详情 scope 降级重试、限流不触发降级。

### 16.3 实际执行的命令与结果

| 命令 | 结果 |
| --- | --- |
| `npx tsc -p tsconfig.json --noEmit` | **exit 0**，0 诊断 |
| `npm test` | **exit 0**，`# tests 486 / pass 486 / fail 0`（pr 套件 44/44，含新增 3 项） |
| `npm run build` | **exit 0**，`built dsh-vcs-timeline@0.1.5: lib/index.js, lib/client.js` |
| `node scripts/verify-host.mjs` | **21/21 PASS** |
| `node scripts/verify-live.mjs http://127.0.0.1:14392` | **28/28 PASS**（运行中的 Host 仍是 0.1.4 进程） |
| 手工 GitHub GraphQL（用用户 token、reduced 查询） | 私有仓库 200；已合并/关闭 PR 5 条、字段（review/checks/changedFiles/mergeCommit）均可读 |

### 16.4 未验证 / 明确声明

- **没有重启用户的 DSH 进程**：环境变量继承与 Host 新代码都需要完全退出 DSH（含托盘）后重新启动，
  本轮只验证了进程环境缺失这一事实与修复后的单元/手工请求，**未在重启后的真实 Host 上复测**
  `/vcs/pr/list`；重启后可用 `GET /vcs/pr/list` 确认 `authenticated:true`。
- 用户的 token scope 仍是 `repo`；团队评审请求会按设计降级省略，若需要团队名请重新签发带
  `read:org` 的 token。
- 临时 `pr-auth.json` 已删除；若以后选择不重启而用文件方式，请确保文件权限仅当前用户可读。
