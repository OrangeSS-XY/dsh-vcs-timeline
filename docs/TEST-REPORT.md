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
| 插件目录 | `E:\softData\DP_Harness\dsh-plugin\dsh-vcs-timeline` |

## 2. 代码变更摘要

单个 bundle 包，双半边：

- Host（`lib/index.js`，163 KiB，仅 Node 内置依赖）：`/vcs` 13 条 JSON 路由、仓库发现与路径闸门、
  Git/SVN 适配器、只读/写服务、JSONL 存储与追加式审计、脱敏与限额。
- Client（`lib/client.js`，117 KiB，运行时仅 `require("react")`）：右侧栏 tab 注册（正文 + 标题 + guide）、
  时间线/详情/Diff/审计视图、写操作预览→确认→执行对话框、zh/en 字典、token-only 样式。
- 资源：`cordis.patch.yml`（插入行 `dsh-vcs-timeline`）、`locale/{zh,en}.json`（含 `meta.title/description`）、`icon.svg`。

## 3. 实际执行的命令与结果

| # | 命令 | 退出码 | 结果 |
| --- | --- | --- | --- |
| 1 | `npm install --legacy-peer-deps --no-audit --no-fund` | 0 | added 51 packages；esbuild postinstall 经 `npm install-scripts approve esbuild` 授权后重建成功 |
| 2 | `node node_modules\typescript\bin\tsc -p tsconfig.json --noEmit` | 0 | **0 errors**（全包，含测试） |
| 3 | `node --experimental-strip-types --no-warnings src/tests/index.test.ts` | 0 | **171 tests / 171 pass / 0 fail**（约 7.4 s） |
| 4 | `node scripts\build.mjs` | 0 | `lib/index.js` 167,248 B；`lib/client.js` 120,060 B；client bundle 唯一裸 `require` 为 `react` |
| 5 | `plugin_manager install_bundle`（target = 包目录） | 应用成功 | `application: "applied"`，`warnings: []`；profile 中出现 `dsh-vcs-timeline 0.1.0 <- E:\...` |
| 6 | `plugin_manager set_plugin include:dsh-vcs-timeline`（false → true） | 应用成功 | 两次均 `application: "applied"`；Host 行重新挂载后新路由生效 |
| 7 | `node scripts\verify-live.mjs` | 0 | **16/16 live checks passed**（见 §5） |
| 8 | 直接读取 `%DSH_HOME%\storages\dsh-vcs-timeline\*.jsonl` | — | 4 个文件存在；`operations.jsonl` 含同 id 的 `started` + `succeeded` 两条；`events.jsonl` 含 `source: plugin-audit` 事件 |
| 9 | 重新挂载插件后 `POST /vcs/op/list` | — | 返回 1 条折叠后的 `succeeded` 审计记录（跨挂载可读） |

### 3.1 测试套件分布（命令 3 的分解）

| 套件 | 数量 | 覆盖 |
| --- | --- | --- |
| `security.test.ts` | 9 | 凭据脱敏、路径越界拒绝、游标编解码、UTF-8 截断、数字/时间校验、repositoryId 稳定性 |
| `discovery.test.ts` | 8 | 工作区有界发现、工作区自身为仓库、嵌套仓库不重复、跳过 node_modules/隐藏目录、深度上限、路径闸门、显式添加/移除、非仓库拒绝 |
| `operation-service.test.ts` | 13 | 预览→执行、token 单次/TTL/参数绑定、argv 复核、审计先落盘、超时/被杀→unknown、spawn 失败→failed、push 非零→confirmed-failure、审计写失败不执行、单仓库互斥、只读操作拒绝、审计折叠 |
| `storage.test.ts` | 16 | JSONL 追加/折叠/分页、200 并发写、坏尾行/坏中间行、schemaVersion 不兼容、轮转、扫描上限、脱敏 |
| `audit.test.ts` | 10 | start 先持久化、finish 追加终态且不改 started、失败保留 started、requestSummary/outputSummary 脱敏与上限、非法时钟 |
| `git.unit.test.ts` | 15 | NUL 日志解析（空/unicode/多行 body）、name-status/numstat（重命名/二进制空路径）、porcelain v2 各类记录、v1 兜底、远端脱敏、hash/分支/远端名校验、binary/Renamed 合并 |
| `git.integration.test.ts` | 9 | **真实临时 Git 仓库**：探针/信息/分页/重命名+二进制+中文文件名/过滤/无提交仓库/写计划（staged 判定、argv、pull/push 拒绝、detached）/远端脱敏/缺失 git/解析器夹具 |
| `svn.unit.test.ts` | 62 | `svn --xml` 解析（log/info/status）、summarize、revision 注入拒绝、argv 构造（`--non-interactive`、`--`）、分页游标、重命名/复制、Diff 截断/二进制、update/commit 计划、缺客户端降级、**仓库相对 summarize 路径与 log 路径合并回归** |
| `client.format.test.ts` | 11 | 时间/哈希/字节格式化、Diff 行分类、状态/事件/来源/操作标签、错误映射、字典键一致、插值回退 |
| `client.render.test.ts` | 18 | SSR 渲染：加载/错误/空仓库/时间线/空历史/详情/文本 Diff/二进制 Diff/审计列表与详情/部分结果/对话框/样式无字面颜色/字典完整性，以及写操作参数绑定回归（字段在预览前可见、输入跨重预览保留、preview 与 execute 参数一致） |

## 4. 桌面端验收

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| DSH 发现并加载插件 | 通过 | `install_bundle` → `application: "applied"`；`Config.listConfigs(name=dsh-vcs-timeline)` 有该行 |
| 右侧栏出现「代码时间线」页签 | 通过（注册层面） | `cordis_inspect_query`（client `Slots.listSubTree`，root `sidebar.right.pane.tab`）occupant 含 `{key: "vcs-timeline", active: true}`；标题 slot 同样注册 |
| 打开面板无控制台异常 | **未验证** | 无浏览器自动化；仅 SSR 渲染测试与类型/构建保证 |
| 选择仓库并显示历史 | 通过（Host 路由层） | live check：`repos/add` → `timeline` 返回 2 条事件 |
| 查看文件列表与 Diff | 通过（Host 路由层） | live check：`changeset` 返回 `modified:a.txt`；`diff` 返回 114 B 文本 |
| 写操作可审计 | 通过 | live check：preview→execute 真实提交成功（`exit 0`，before/after revision 记录）；`op/list` 折叠出 `succeeded`；JSONL 落盘 |
| 重启后审计可读 | 部分验证 | 插件**重新挂载**后仍可读；整进程重启未实测 |
| 禁用/卸载后释放注册 | 通过 | `set_plugin:false` 后 `/vcs/*` 返回 404；重新启用后恢复 |
| 无非预期仓库修改 | 通过 | 所有写操作只发生在 `%TEMP%` 下临时仓库，测试后删除 |

## 5. Live 端到端检查（`scripts/verify-live.mjs`，16/16）

对运行中的 Host 依次验证（临时 Git 仓库 + 真实 HTTP）：

1. `diagnostics`（插件版本、git 版本、svn 缺失、数据目录）
2. `repos/add`（识别 git、当前分支、HEAD）
3. `repos/list`（含新仓库、诊断）
4. `timeline`（2 条、最新提交说明正确、倒序）
5. `changeset`（`modified:a.txt`）
6. `diff`（文本含 `+three`、非二进制、未截断）
7. `status`（脏、1 条已暂存）
8. 不支持的 `merge` 预览被拒（`invalid-request`）
9. 空提交信息预览被阻止（`a commit message is required`，allowed=false）
10. commit 预览（返回精确 argv）
11. commit 执行（`succeeded`、`exitCode 0`、前后 revision）
12. 时间线出现新提交（3 条）
13. 审计折叠（1 条 `succeeded`，correlationId 可读）
14. token 单次使用（第二次 `confirmation-invalid`）
15. 非 JSON content-type 被拒（HTTP 415）
16. 未知路由 404

## 6. 集成期间发现并修复的缺陷

| # | 缺陷 | 影响 | 处置 |
| --- | --- | --- | --- |
| 1 | 客户端预览不带参数、执行带参数，Host 将 token 绑定到参数哈希 | **commit/push 永远 `confirmation-invalid`**，功能不可用 | 客户端统一用同一参数构造函数生成 preview/execute 请求；输入变更即作废旧 token 并防抖重预览；新增 4 条回归测试 |
| 2 | Git 缺少 `-c core.quotepath=false` | Diff 头里中文路径被八进制转义 | 所有 Git 命令加入该配置 |
| 3 | `# branch.oid (initial)` 被当成 HEAD | 空仓库显示伪 hash | 解析时忽略 `(initial)` |
| 4 | porcelain v2 仅工作区改动时 `status='.'` | UI 显示 `.` 而非 `M` | 回退到 worktree 列字母 |
| 5 | 作者过滤直接把输入作为正则 | 输入 `[` 导致 `operation-failed` | 加 `--fixed-strings`，非法模式不再崩溃 |
| 6 | push 计划允许任意分支名 | 可能推送未校验的 ref | v1 只允许推当前分支 |
| 7 | pull 未要求 upstream | 执行时必然失败 | 无 upstream 时明确 blocked |
| 8 | `detect()` 返回正斜杠路径 | 与 realpath 形式不一致 | `realpath` 规范化 |
| 9 | SVN summarize 路径（无前导 `/`，如 `trunk/a.txt`）与 log 路径（`/trunk/a.txt`）坐标不同 | 同一文件在变更列表重复出现 | 按 working-copy 前缀归一 + 回归测试 |
| 10 | SVN `parseRevision` 先 trim 后校验 | `"\n5"` 被接受为 revision 5 | 先拒绝控制字符再规范化（由 SVN 负责人修复） |

## 7. 未验证内容（明确列出）

1. **浏览器视觉与交互**：无浏览器自动化。面板在真实 GUI 中的挂载、320–520 px 布局/横向溢出、
   对话框定位、防抖/键盘/焦点/剪贴板行为均未实测；仅通过 SSR 渲染测试、类型检查与代码审查。
2. **整进程重启**：未重启 DSH 桌面端；仅验证插件重新挂载后审计可读。
3. **SVN 实机联调**：本机无 `svn` 客户端。SVN 适配器仅通过夹具 XML/文本 + 脚本化 Runner 测试，
   未连接真实 SVN 服务器/工作副本。以下细节未实测：`svn log -v` 路径格式、`relative-url` 百分号编码、
   `status --xml` 路径拼接、`diff --summarize` 列填充与 `(from …:REV)`、`--` 结束符支持。
4. **远程访问**：`/vcs` 仅 loopback，配对设备场景未实现也未测试。
5. **大数据量**：极小分包上限/轮转与 200 并发写在临时目录验证；未在超大真实仓库上压测。
6. **跨进程写入**：单进程假设，未做双进程并发写同一数据目录的验证。

## 8. 已知限制 / 未实现

- Merge、Rebase、Switch、Reset、Clean、Force push：**明确不实现**，返回 blockedReason。
- Git binary 检测以 diff 头 `Binary files ... differ` 为主；numstat `-` 兜底未单独实现（正常二进制提交可检测）。
- status v1 兜底解析对 rename/copy 记录不完整（仅在 porcelain v2 不可用时触发，git ≥ 2.11 不会走到）。
- SVN `contextLines` 无对应 CLI 能力，被忽略；SVN changeSet 中工作副本子树之外的路径保持仓库相对、无法通过该 wc 取 diff。
- JSONL 轮转后的 `.1.jsonl` 为归档，不被查询读取。
- 客户端 UI 中少数专有名词（`Git`/`SVN`/`bin`/审计齿轮）为字面量或图标；Host 侧数据文本（warnings、
  blockedReason、requestSummary、errorCode、correlationId）按原样展示，可能是英文。
- 审计页签不自动轮询（写操作终态后会刷新时间线与工作区状态，审计需重新进入页签/刷新）。

## 9. 验证等级声明

| 层面 | 等级 |
| --- | --- |
| 代码实现 | implemented |
| 类型检查（0.2.1-rc.3 同版本类型包） | typechecked（`tsc --noEmit` 0 错误） |
| 单元测试 | unit-tested（171 个测试全通过） |
| 真实仓库集成测试 | integration-tested（Git 临时仓库 9 项；SVN 仅解析器级） |
| 桌面端 Host 端到端 | desktop-verified（16/16 live checks，含真实 Git 提交与审计落盘） |
| 桌面端 UI 视觉/交互 | **not-verified**（无浏览器自动化） |
| SVN 实机 | **not-verified**（本机无客户端） |
| 整进程重启持久化 | **not-verified**（仅验证重新挂载后读取） |

## 10. 复现方式

```powershell
cd E:\softData\DP_Harness\dsh-plugin\dsh-vcs-timeline
npm install
npm run typecheck
npm test
npm run build
# 需要运行中的桌面端（默认 http://127.0.0.1:12050）
node scripts\verify-live.mjs
```

测试全部使用 `%TEMP%` 下的临时目录/临时 Git 仓库，结束后删除；不触碰用户的真实仓库。
