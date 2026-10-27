# 测试报告（dsh-vcs-timeline 0.1.0）

本报告只记录**实际执行**过的命令、退出码与结果，以及明确标注的未验证项。

## 1. 环境

| 项目 | 值 |
| --- | --- |
| 日期 | 2026-10-27 |
| OS | Windows（`win32 x64`） |
| DSH | 桌面端 `0.2.1-rc.3`（`E:\softData\DSH`，profile `desktop`） |
| GUI | `http://127.0.0.1:12050` |
| Node | v22.23.1 |
| npm | 12.1.0 |
| Git | `git version 2.45.1.windows.1` |
| SVN | **未安装**（`Get-Command svn` 无结果） |
| 本机浏览器（预览截图） | Microsoft Edge 155.0.4283.62（无头模式） |
| 插件目录 | `E:\softData\DP_Harness\dsh-plugin\dsh-vcs-timeline` |

## 2. 代码变更摘要

单个 bundle 包，双半边：

- **Host**（`lib/index.js`，约 167 KiB，仅 Node 内置依赖）：`/vcs` 13 条 JSON 路由、
  仓库发现与路径闸门、Git/SVN 适配器、只读/写服务、JSONL 存储与追加式审计、脱敏与限额；
  本轮新增 **Git 每提交变更统计**（额外一次同参数 `log --numstat -z`，合并进事件 metadata）
  与 SVN `filesChanged`。
- **Client**（`lib/client.js`，约 173 KiB，运行时仅 `require("react")`）：本轮按 IDE 风格重构：
  34px 工具栏 + `⋯` 版本控制菜单、紧凑来源页签、统一搜索/筛选工具条、graph 提交历史
  （真实 ± 行与文件数）、固定面包屑的提交详情与行号 Diff、审计列表/详情、
  写操作确认对话框、可折叠诊断与 24px 状态栏；zh/en 字典、token-only 样式。
- 资源：`cordis.patch.yml`、`locale/{zh,en}.json`、`icon.svg`。
- 测试工具：`scripts/render-preview.ts` + `scripts/preview-shots.mjs`（示例数据 → HTML → 无头截图）。

## 3. 实际执行的命令与结果

| # | 命令 | 退出码 | 结果 |
| --- | --- | --- | --- |
| 1 | `npm install --legacy-peer-deps --no-audit --no-fund` | 0 | added 51 packages；esbuild postinstall 经 `npm install-scripts approve esbuild` 授权后重建成功 |
| 2 | `node node_modules\typescript\bin\tsc -p tsconfig.json --noEmit` | 0 | **0 errors**（全包，含测试与预览脚本） |
| 3 | `node --experimental-strip-types --no-warnings src/tests/index.test.ts` | 0 | **191 tests / 191 pass / 0 fail** |
| 4 | `node scripts\build.mjs` | 0 | `lib/index.js` 170,042 B；`lib/client.js` 173,166 B；client bundle 唯一裸 `require` 为 `react` |
| 5 | `plugin_manager set_plugin include:dsh-vcs-timeline`（false → true） | 应用成功 | 两次均 `application: "applied"`；Host 行重新挂载 |
| 6 | `node scripts\verify-live.mjs` | 0 | **17/17 live checks passed**（含真实提交统计断言，见 §5） |
| 7 | `node --experimental-strip-types scripts/render-preview.ts` | 0 | 13 个预览页面（含亮/暗主题、320px 场景） |
| 8 | `node scripts\preview-shots.mjs` | 0 | 13 张 400px PNG + 4 张 320px PNG（无头 Edge） |
| 9 | 直接读取 `%DSH_HOME%\storages\dsh-vcs-timeline\*.jsonl` | — | `operations.jsonl` 含同 id 的 `started` + `succeeded` 两条；`events.jsonl` 含 `plugin-audit` 事件 |
| 10 | 重新挂载插件后 `POST /vcs/op/list` | — | 返回 1 条折叠后的 `succeeded` 审计记录（跨挂载可读） |

### 3.1 测试套件分布（命令 3 的分解）

| 套件 | 数量 | 覆盖 |
| --- | --- | --- |
| `security.test.ts` | 9 | 凭据脱敏、路径越界拒绝、游标编解码、UTF-8 截断、数字/时间校验、repositoryId 稳定性 |
| `discovery.test.ts` | 8 | 工作区有界发现、工作区自身为仓库、嵌套仓库不重复、跳过 node_modules/隐藏目录、深度上限、路径闸门、显式添加/移除、非仓库拒绝 |
| `operation-service.test.ts` | 13 | 预览→执行、token 单次/TTL/参数绑定、argv 复核、审计先落盘、超时/被杀→unknown、spawn 失败→failed、push 非零→confirmed-failure、审计写失败不执行、单仓库互斥、只读操作拒绝、审计折叠 |
| `storage.test.ts` | 16 | JSONL 追加/折叠/分页、200 并发写、坏尾行/坏中间行、schemaVersion 不兼容、轮转、扫描上限、脱敏 |
| `audit.test.ts` | 10 | start 先持久化、finish 追加终态且不改 started、失败保留 started、requestSummary/outputSummary 脱敏与上限、非法时钟 |
| `git.unit.test.ts` | 17 | NUL 日志解析、name-status/numstat（重命名/二进制空路径）、**numstat 统计解析（含 rename、二进制、畸形流）**、porcelain v2/v1、远端脱敏、hash/分支/远端名校验、binary/rename 合并 |
| `git.integration.test.ts` | 10 | **真实临时 Git 仓库**：探针/分页/重命名+二进制+中文文件名/过滤、**每提交统计值断言（3/1/1/1 等）**、无提交仓库、写计划（staged 判定、argv、pull/push 拒绝、detached）、远端脱敏、缺失 git、stats 命令失败降级 |
| `svn.unit.test.ts` | 62 | `svn --xml` 解析（log/info/status）、summarize、revision 注入拒绝、argv 构造、分页游标、重命名/复制、Diff 截断/二进制、update/commit 计划、缺客户端降级、路径归一回归 |
| `client.format.test.ts` | 17 | 时间/紧凑时间/哈希/字节、Diff 行分类与**行号计算**、事件统计读取（含 merge 全 0 抑制）、状态/事件/来源/操作标签、错误映射、字典键一致、插值回退 |
| `client.panel.test.ts` | 7 | 写操作 draft 保留/重置、`operationParams`、preview/execute 参数一致性（token 绑定契约） |
| `client.render.test.ts` | 22 | SSR 渲染：加载/错误/空仓库/未初始化/时间线/合并提交/**真实统计与“无统计不伪造”**/部分结果/工具条与菜单/详情/Diff 行号与二进制/审计/状态栏/诊断展开/对话框/样式 token-only/字典完整性 |

## 4. 桌面端验收

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| DSH 发现并加载插件 | 通过 | `install_bundle` → `application: "applied"`；`Config.listConfigs(name=dsh-vcs-timeline)` 有该行 |
| 右侧栏出现「代码时间线」页签 | 通过（注册层面） | `cordis_inspect_query`（client `Slots.listSubTree`，root `sidebar.right.pane.tab`）occupant 含 `{key: "vcs-timeline", active: true}` |
| 打开面板无控制台异常 | **未验证**（真实页面） | 组件层由 22 项 SSR 测试覆盖；无浏览器自动化 |
| 布局/明暗主题/窄栏 | 通过（组件渲染层） | 见 §6：400px 与 320px、亮/暗截图的目视检查 |
| 选择仓库并显示历史 | 通过（Host 路由层） | live check：`repos/add` → `timeline` 返回 2 条事件 |
| 提交统计真实可用 | 通过 | live check：`timeline carries real commit stats — files=1 +1 -1` |
| 查看文件列表与 Diff | 通过（Host 路由层） | live check：`changeset` → `modified:a.txt`；`diff` 114 B |
| 写操作可审计 | 通过 | live check：preview→execute 真实提交成功（`exit 0`，前后 revision 记录）；`op/list` 折叠 `succeeded`；JSONL 落盘 |
| 重启后审计可读 | 部分验证 | 插件**重新挂载**后仍可读；整进程重启未实测 |
| 禁用/卸载后释放注册 | 通过 | `set_plugin:false` 后 `/vcs/*` 返回 404；重新启用后恢复 |
| 无非预期仓库修改 | 通过 | 写操作只发生在 `%TEMP%` 临时仓库，测试后删除 |

## 5. Live 端到端检查（`scripts/verify-live.mjs`，17/17）

对运行中的 Host 依次验证（临时 Git 仓库 + 真实 HTTP）：

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

## 6. UI/UX 重构验证（组件渲染 + 截图）

没有浏览器自动化，因此用**真实组件 + 示例数据**做无头 Chromium 渲染验证
（`docs/ui-preview/`，400px 侧栏、320px 窄栏、亮/暗主题）。这不是运行时页面截图，
但能真实反映 CSS 布局、密度、溢出与主题表现。

生成命令（退出码 0）：`node --experimental-strip-types scripts/render-preview.ts` →
`node scripts/preview-shots.mjs`（Edge 155 无头，`--force-device-scale-factor=2`）。

截图目视检查发现并修复的布局缺陷：

| # | 缺陷（截图可见） | 修复 |
| --- | --- | --- |
| U1 | 文件数标签在窄宽度换行，撑高提交行 | 文件数移到第二行右侧，所有统计 `nowrap` |
| U2 | 工具栏/详情分支 chip 被硬裁切、无省略号 | 文本按字符截断 + 内层 `block` 省略；≤380px 隐藏工具栏 chip |
| U3 | 详情元信息网格值列异常右移 | `<dd>` 默认 `margin-inline-start` 未重置 |
| U4 | Diff 行各自横向滚动、右侧内容被裁 | 整块 Diff 横向滚动 + 行号槽 `sticky` 固定 |
| U5 | 重命名文件行把旧路径挤在中间，统计不对齐 | 旧路径改为路径前缀显示，统计固定右对齐 |
| U6 | 展开诊断只显示 2 行（flex 收缩） | 诊断/状态栏改为根的直接 flex 子项，去掉会收缩的包装层 |
| U7 | 审计行重复显示“结果待确认”（元信息 + 徽标） | 只保留状态徽标 |
| U8 | 状态栏各项粘连（“有未提交修改feature/…”） | 项间加入分隔点，窄栏限制分支宽度 |
| U9 | 320px 下工具栏分支 chip/VCS 标签挤压内容 | 媒体查询分级收敛（380/360/330px），实测 320px 无横向溢出 |

320px 验证方式：把面板嵌入 320px iframe（媒体查询按 iframe 视口生效），
截图见 `docs/ui-preview/narrow320-*.png`。

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
| 12–20 | 见 §6 的 U1–U9 | 布局/密度/对齐 | 已修复并重新截图确认 |

## 8. 未验证内容（明确列出）

1. **真实页面视觉与交互**：无浏览器自动化驱动 DSH 宿主页面。面板挂载、hover/focus、
   键盘导航、滚动、对话框在真实侧栏中的最终观感仍需人工确认；本轮已完成
   400px/320px 组件渲染截图与 22 项 SSR 测试。
2. **整进程重启**：未重启 DSH 桌面端；仅验证插件重新挂载后审计可读。
3. **SVN 实机联调**：本机无 `svn` 客户端；仅 62 项解析器/命令行/降级测试。
4. **远程访问**：`/vcs` 仅 loopback，配对设备场景未实现也未测试。
5. **大数据量**：未在超大真实仓库上压测（分页、统计命令每页一次额外进程）。
6. **跨进程写入**：单进程假设，未做双进程并发写同一数据目录的验证。

## 9. 已知限制 / 未实现

- Merge、Rebase、Switch、Reset、Clean、Force push：**不实现**，返回 blockedReason。
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
| 单元测试 | unit-tested（191 个测试全通过） |
| 真实仓库集成测试 | integration-tested（Git 临时仓库 10 项；SVN 仅解析器级） |
| 桌面端 Host 端到端 | desktop-verified（17/17 live checks，含真实 Git 提交、统计与审计落盘） |
| 面板视觉（组件渲染） | rendered-verified（400px/320px、亮/暗无头截图 + 目视检查） |
| 桌面端真实页面视觉/交互 | **not-verified**（无浏览器自动化） |
| SVN 实机 | **not-verified**（本机无客户端） |
| 整进程重启持久化 | **not-verified**（仅验证重新挂载后读取） |

## 11. 复现方式

```powershell
cd E:\softData\DP_Harness\dsh-plugin\dsh-vcs-timeline
npm install
npm run typecheck
npm test
npm run build
# 需要运行中的桌面端（默认 http://127.0.0.1:12050）
node scripts\verify-live.mjs
# 组件渲染截图（本机 Edge/Chrome）
npm run preview:ui
```

测试全部使用 `%TEMP%` 下的临时目录/临时 Git 仓库，结束后删除；不触碰用户的真实仓库。
