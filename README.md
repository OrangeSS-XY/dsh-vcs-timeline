# dsh-vcs-timeline（代码时间线）

DeepSeek Harness（DSH）桌面端右侧栏插件：统一查看 **Git / SVN 仓库历史、变更文件、Diff**，
并记录**本插件自己发起的写操作审计**。第一验收环境为 DSH 桌面端 `0.2.1-rc.3`（Windows）。

- 右侧栏页签：**代码时间线**（tab 类型 id `vcs-timeline`）
- Host：仓库发现、Git/SVN CLI 调用、路径闸门、`/vcs` JSON 路由、JSONL 审计
- Client：React 面板（仅主题 token 样式），通过 `/vcs` 路由访问 Host

> 事实边界：仓库历史来自 Git/SVN 本身；审计只覆盖**本插件**实际发起并观察到的操作。
> 不声称捕获外部终端/IDE 的操作，也不把 commit 当成 push、把 SVN update 当成 commit。

## 功能

| 能力 | 状态 |
| --- | --- |
| 仓库发现（当前会话工作区 + 有界子目录扫描） | implemented / unit-tested / desktop-verified |
| 手动添加仓库（校验 VCS 元数据与路径） | implemented / desktop-verified |
| Git 历史分页、作者/关键字/时间过滤 | implemented / unit-tested / integration-tested / desktop-verified |
| Commit 详情（文件状态、重命名、二进制、行数） | 同上 |
| 单文件 Diff（截断、二进制提示、纯文本渲染） | 同上 |
| 工作区状态（干净/脏、暂存、冲突、ahead-behind） | 同上 |
| SVN 历史/详情/Diff/状态/update/commit | implemented / unit-tested（本机无 svn 客户端，未联调） |
| 插件操作审计（追加式 JSONL、折叠展示） | implemented / unit-tested / desktop-verified |
| 受控写操作：Fetch / Pull(--ff-only) / Commit(仅已暂存) / Push(仅当前分支) / SVN Update / Commit | implemented / desktop-verified（Git commit 实跑） |
| Merge / Rebase / Switch / Reset / Clean / Force push | 明确不实现（返回 blockedReason） |

## 安装

插件已以本地 bundle 形式安装到当前 `desktop` profile。仓库路径：

```
E:\softData\DP_Harness\dsh-plugin\dsh-vcs-timeline
```

重新安装（例如换机器）：

```powershell
# 在 DSH 会话中通过 plugin_manager 安装（target 为包目录）
plugin_manager install_bundle target="E:\softData\DP_Harness\dsh-plugin\dsh-vcs-timeline"
```

安装后右侧栏出现「代码时间线」页签；重启或重新挂载不需要重建代码（构建产物已提交在 `lib/`）。

> 首次安装或重新构建后，请在 DSH 页面按一次 `F5` 刷新，让浏览器加载最新的前端 bundle
> （页签注册本身是热生效的，但面板代码属于页面模块，需要刷新才能换成新版本）。

卸载：

```powershell
plugin_manager remove_bundle target="dsh-vcs-timeline"
```

审计数据保存在 `%DSH_HOME%\storages\dsh-vcs-timeline\`（本机为
`C:\Users\Lenovo\.dsh\storages\dsh-vcs-timeline`），卸载插件不会删除该目录；需要清理时手动删除即可。

## 界面

按 IDE 工具窗口的密度重构（VS Code / JetBrains Git 窗口的量级，不是管理后台）：

- **34px 工具栏**：仓库选择（原生下拉覆盖层，键盘可用）· 分支 chip · 刷新 · `⋯` 版本控制菜单。
  不再有占据空间的“写操作卡片”；Fetch / Pull / Commit / Push（SVN 为 Update / Commit）
  收进菜单，仍然先预览再确认。
- **来源页签**：`时间线` 与 `审计` 并排，带条数；两者视觉与数据都不混用。
- **统一工具条**：搜索、`全部/提交` 事件类型、作者筛选在同一个 28px 工具条体系内。
- **提交历史**：左侧 graph 槽（提交节点 / 合并环 / 连线），右侧两行信息：
  提交说明 + `+增 −删`；短 hash · 作者 · 本地时间 · 分支标签 · 变更文件数。
  统计来自 Git `--numstat`（SVN 只显示文件数），**不伪造任何数字**。
- **提交详情**：32px 固定面包屑（返回 / hash / 来源徽标）+ 摘要 + 元信息网格 +
  变更文件列表（状态字母、重命名旧路径、BIN 标记、每文件 ± 行）。
- **Diff**：行号槽 + 统一 diff 着色 + 底部路径/行数/字节；二进制与截断各有明确提示。
- **状态栏**：工作区状态点（干净/有修改/冲突）、分支、变更数、VCS；
  右侧“诊断”展开插件/运行时/Git/SVN/工作区/数据目录/警告。
- **空状态区分**：未选择工作区 / 未检测到仓库 / Git/SVN 客户端缺失 / 空历史 /
  筛选无结果 / 仓库尚无提交 / 部分数据 / 请求失败，各自给出原因和下一步。
- 明暗主题由 DSH 主题 token 自动适配；样式无字面颜色、无全局选择器，全部 `dvt-` 前缀。

设计验证截图（示例数据渲染，非运行时截图）见 [docs/ui-preview/render.md](docs/ui-preview/render.md)：
`npm run preview:ui` 可在本机重新生成 400px 与 320px 的明暗主题截图。

## 使用

1. 打开任意会话，右侧栏打开「代码时间线」。
2. 顶部选择仓库（Git/SVN · 名称 · 当前分支或 base revision）。
3. 「时间线」查看历史；点条目看详情与文件列表；点文件看 Diff。
4. 「审计」查看本插件执行过的写操作（状态、退出码、前后 revision、correlationId）。
5. 右上 `⋯` → Fetch / Pull / Push / Commit（SVN：Update / Commit）：先弹预览，
   显示将执行的确切 argv、当前分支/HEAD/干净状态/暂存数、警告；确认后才真正执行，
   执行结果追加审计。Commit 只提交**已暂存**的改动（插件从不自动 `git add`）。

## 开发

要求 Node ≥ 22.19（使用 `--experimental-strip-types` 直接跑 TypeScript 测试）。

```powershell
npm install                      # 仅 devDependencies（类型 + 构建 + 测试）
npm run typecheck                # tsc --noEmit，0 错误
npm test                         # 全部测试（单一进程执行所有套件）
npm run build                    # lib/index.js (Host ESM) + lib/client.js (ModuleLoader 包装)
npm run check                    # typecheck + test + build
node scripts\verify-live.mjs     # 对运行中的桌面端做端到端 HTTP 验证（会创建并删除临时 Git 仓库）
npm run preview:ui               # 用示例数据渲染面板并截图到 docs/ui-preview/
```

目录：

```
src/shared/contracts.ts          跨 Host/Client 的线格式与持久化类型（含运行时守卫）
src/host/index.ts                Host 入口：装配服务 + /vcs 路由（ctx.effect 生命周期）
src/host/routes.ts               13 条 JSON 路由 + 传输加固 + 错误映射
src/host/discovery.ts            工作区有界发现 + 路径闸门 + 仓库缓存
src/host/services/*.ts           只读服务 / 写服务（预览、token、审计、互斥）
src/host/adapters/git/*          Git argv 构造与机器可读解析 + 适配器
src/host/adapters/svn/*          无依赖 XML 读取 + SVN argv/解析 + 适配器
src/host/storage/jsonl.ts        JSONL 存储（串行写、坏行容忍、轮转、索引）
src/host/audit/*                 追加式审计写入
src/host/security.ts             脱敏、路径规范化、游标、UTF-8 截断
src/client/*                     右侧栏注册、面板状态机、纯视图、i18n、token-only 样式
src/tests/*                      单元 + 真实临时仓库集成 + SSR 渲染冒烟 + 路由/服务测试
docs/                            兼容性、架构、安全、测试报告
```

## 文档

- [docs/DSH-COMPATIBILITY.md](docs/DSH-COMPATIBILITY.md) — 0.2.1-rc.3 实际 API、证据与限制
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 分层、数据流、发现策略、存储、UI
- [docs/SECURITY.md](docs/SECURITY.md) — 威胁模型、强制措施、残余风险、检查清单
- [docs/TEST-REPORT.md](docs/TEST-REPORT.md) — 实际执行的命令、退出码、结果、未验证项

## 已知限制

- 本机未安装 `svn` 客户端，SVN 仅完成解析器/命令行/降级路径的单元测试，未做真实仓库联调。
- 无浏览器自动化驱动真实宿主页面：面板的视觉密度、明暗主题与窄栏布局通过
  `react-dom/server` + 无头 Chromium 的**组件渲染截图**验证（400px / 320px），
  页签注册通过 DSH inspector 验证；真实页面内的 hover/焦点/滚动仍需人工确认。
- 未做整进程重启验证（已验证插件重新挂载后审计数据仍可读）。
- `/vcs` 路由仅接受 loopback（桌面端）；配对设备远程访问不支持。
- Merge/Rebase/Switch/Reset/Clean/Force-push 不实现。
