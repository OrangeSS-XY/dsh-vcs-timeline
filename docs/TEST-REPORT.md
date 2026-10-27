# 测试报告（dsh-vcs-timeline 0.1.0）

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
- **Client**（`lib/client.js`，215,478 B，运行时仅 `require("react")`）：本轮改为
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
| 2 | `npm test` | 0 | **223 tests / 223 pass / 0 fail** |
| 3 | `npm run build` | 0 | `lib/index.js` 176,379 B；`lib/client.js` 215,478 B；client bundle 唯一裸 `require` 为 `react` |
| 4 | `plugin_manager set_plugin include:dsh-vcs-timeline`（false → true） | 应用成功 | 两次均 `application: "applied"`；Host 行重新挂载，`/vcs/timeline` 立即返回 `changedFiles` |
| 5 | `node scripts\verify-live.mjs http://127.0.0.1:7283` | 0 | **17/17 live checks passed**（含真实提交统计、token 单次使用、审计落盘） |
| 6 | `node --experimental-strip-types scripts/render-preview.ts` | 0 | 16 个预览页面（侧栏 400×900、对话区 1600×900，亮/暗） |
| 7 | `node scripts/preview-shots.mjs` | 0 | 16 张 PNG（无头 Edge，按页面声明尺寸截图） |
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
| `client.panel.test.ts` | 7 | 写操作 draft 保留/重置、`operationParams`、preview/execute 参数一致性（token 绑定契约） |
| `client.render.test.ts` | 29 | SSR 渲染：加载/错误/空仓库/未初始化/时间线/合并提交/真实统计与“无统计不伪造”/部分结果/工具条与菜单/**双栏文件树与共享过滤、单文件收窄、状态筛选、目录展开、“未提供文件清单”、时间线日期分组/HEAD/相对时间**/详情/Diff/审计/状态栏/诊断/对话框/token-only 样式/字典完整性 |

## 4. 桌面端验收

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| DSH 发现并加载插件 | 通过 | `install_bundle` → `application: "applied"`；`Config.listConfigs(name=dsh-vcs-timeline)` 有该行 |
| 对话区页签入口 | 通过（真实页面） | 顶部视图行（role=tablist，y≈50）：对话 / 轨迹 / 上下文 / 编队 / **代码时间线**（order 40，排最后）+ 宿主“…”；hero 与活动会话里均无插件 dock 条/浮层 |
| 点击页签在对话内容区渲染 | 通过（真实页面） | `[data-dvt-panel="vcs-timeline"]` rect **280,76,1633×876**，位于 `data-conversation-content` 内；无 overlay/dialog；点「对话」恢复聊天、再点页签恢复面板，URL 不变 |
| IDEA 风格时间线 | 通过（真实页面） | 3 行 = “3 条提交”；每行有 rail 线 + 节点（节点中心与 rail 中心对齐）、头像/作者/摘要/相对时间（title=精确时间）/7 位 hash/**HEAD 仅 1 个**/分支/±；日期头“今天 / 3 条提交”吸顶；合并空心节点与吸顶滚动因仓库无合并提交/仅 3 条提交未实测 |
| 真实数据一致性 | 通过（真实页面） | 与 `git log` 一致（最新 26952d8 / XiaoSS / 19:01）；HEAD 唯一；3 行 = “3 条提交” |
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

截图与原始 JSON：`E:softDataDP_Harnessdsh-plugin_scratch6`（33 张）、`_scratch7`（高度修复复验）。

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

## 9. 已知限制 / 未实现

- Merge、Rebase、Switch、Reset、Clean、Force push：**不实现**，返回 blockedReason。
- 文件树/单文件时间线只覆盖**已加载的提交页**（界面明确提示“文件索引覆盖已加载的 N 次提交”）。
- Git binary 检测以 diff 头 `Binary files ... differ` 为主；numstat `-` 兜底未单独实现。
- status v1 兜底解析对 rename/copy 记录不完整（仅 porcelain v2 不可用时触发）。
- SVN 忽略 `contextLines`；工作副本子树之外的路径无法通过该 wc 取 diff。
- JSONL 轮转后的 `.1.jsonl` 为归档，不被查询读取。
- 审计页签不自动轮询（写操作终态后刷新时间线与工作区状态）。
- Host 侧若干文本（warnings、blockedReason、requestSummary、errorCode）按原样展示，可能是英文。

## 10. 验证等级声明

| 层面 | 等级 |
| --- | --- |
| 代码实现 | implemented |
| 类型检查（0.2.1-rc.3 同版本类型包） | typechecked（`tsc --noEmit` 0 错误） |
| 单元测试 | unit-tested（223 个测试全通过） |
| 真实仓库集成测试 | integration-tested（Git 临时仓库 14 项；SVN 仅解析器级） |
| 桌面端 Host 端到端 | desktop-verified（17/17 live checks，含真实 Git 提交、统计、逐文件清单与审计落盘） |
| 面板视觉（组件渲染） | rendered-verified（400px/1600px、亮/暗无头截图 + 目视检查） |
| 桌面端真实页面视觉/交互 | desktop-verified（Playwright + Edge：对话区页签、IDEA 时间线、有界高度、双栏、筛选、详情/Diff、1440/1024 尺寸、深色主题） |
| SVN 实机 | **not-verified**（本机无客户端） |
| 整进程重启持久化 | **not-verified**（仅验证重新挂载后读取） |

## 11. 复现方式

```powershell
cd E:\softData\DP_Harness\dsh-plugin\dsh-vcs-timeline
npm install
npm run typecheck
npm test
npm run build
# 需要运行中的桌面端（本轮为 http://127.0.0.1:7283）
node scripts\verify-live.mjs http://127.0.0.1:7283
# 组件渲染截图（本机 Edge/Chrome）
npm run preview:ui
```

测试全部使用 `%TEMP%` 下的临时目录/临时 Git 仓库，结束后删除；不触碰用户的真实仓库。
