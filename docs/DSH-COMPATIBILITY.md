# DSH 兼容性记录（dsh-vcs-timeline）

本文件记录**实际验证过**的目标环境与 API。所有结论都来自本机安装包、运行中的 DSH 进程、
npm registry 上的同版本类型包，以及一次真实的桌面端加载验证；不采用 `master` 分支文档推断。

## 1. 目标环境

| 项目 | 实测值 |
| --- | --- |
| 产品 | DeepSeek Harness 桌面端（Electron） |
| 版本 | `0.2.1-rc.3`（`E:\softData\DSH\resources\app.asar\dsh\package.json`） |
| 操作系统 | Windows（`win32 x64`，Node 22.23.1） |
| 安装目录 | `E:\softData\DSH`（运行时在 `resources/app.asar` 内，安装包**未附带** `lib/types/**/*.d.ts`） |
| DSH_HOME | `C:\Users\Lenovo\.dsh`（环境变量 `DSH_HOME`，进程内可用） |
| Profile | `desktop`（`DSH_PROFILE=desktop`，`C:\Users\Lenovo\.dsh\profiles\desktop`） |
| Web GUI | `http://127.0.0.1:12050`（`DSH_WEB_URL`） |
| 已安装插件形态 | 大量官方 `@deepseek-ai/dsh-*` 包 + 第三方 bundle（`dsh-context`、`dsh-pet`、`@linxin666/dsh-client-ui-git-graph` 等） |

读取 `app.asar` 内部文件时可以确认：**shell / ripgrep / Node 都读不到 asar 内部路径**，
只有 Host 进程自身的文件读取（本会话中的 `read` 工具）能打开它。因此本项目的类型检查改为
从 npm registry 安装 `0.2.1-rc.3` 的**同版本类型包**作为 devDependencies（见 §4）。

## 2. 插件发现、加载与生命周期（实测）

- 插件包通过 `package.json` 的 `dsh.bundle.patch` 声明 Loader patch，通过 `dsh.client` 声明浏览器半边。
- 本机安装方式：`plugin_manager install_bundle`（target 为包目录）。
  - 实测返回 `application: "applied"`，包被 link 进 profile（`+ dsh-vcs-timeline 0.1.0 <- E:\...`）。
  - 安装会**立即热加载**：Host 行激活，浏览器端模块也进入页面模块表（无需刷新）。
  - 修改 `lib/index.js` 后，重新 `install_bundle` 返回 `already-installed`；
    用 `plugin_manager set_plugin`（entryId `include:dsh-vcs-timeline`）先 `enabled:false` 再 `enabled:true`
    可让 Host 行重新挂载新代码（实测 `application: "applied"`，新路由立刻生效）。
- 行 id：patch 中 `id: dsh-vcs-timeline`，Loader entryId 为 `include:dsh-vcs-timeline`。
- `export const inject = ['webServer', 'subprocess', 'workspaceRegistry']` 生效；
  `ctx.effect()` 返回的清理函数在禁用/卸载时执行（`/vcs` 路由随之注销，实测 404）。
- 本插件没有 `Config` 导出；`Config.listConfigs` 查询结果为 `status: "absent"`，
  Loader 仍正常激活。可选行配置 `dataDir` 通过 `apply(ctx, config)` 第二个参数读取。

## 3. 入口与 Slot 契约（逐项确认）

### 3.1 右侧栏 Tab 类型注册（Client，备用路径）

> 现状：该 tab 类型与 body 仍注册（`sidebar.right.pane.tab` 的 occupant 可见），
> 但当前桌面端侧栏的加页签 UI 没有暴露它；主入口已改为 §3.4 的对话区页签。
> 以下契约保留，供未来侧栏入口暴露时复用。

```ts
ctx.inject(['sidebarRightTabs'], (scope) => {
  const disposers = []
  disposers.push(scope.sidebarRightTabs.register({
    id: 'vcs-timeline',          // tab 类型 id，也是 keyed slot 的 key
    kind: 'vcs-timeline',        // sidebarRight.openTab(kind) 使用的 kind
    title: () => t('tab.title'),
    guide: [{ order: 30, title: () => t('tab.title'), description: () => t('guide.description') }],
  }))
  disposers.push(scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register(
    { name: 'sidebar.right.pane.tab', key: 'vcs-timeline', locale: 'vcs-timeline' },
    Component,
  )))
  disposers.push(scope.slots.inject('sidebar.right.pane.tab.title', () => scope.slots.register(
    { name: 'sidebar.right.pane.tab.title', key: 'vcs-timeline', locale: 'vcs-timeline' },
    TitleComponent,
  )))
  return () => disposers.forEach(dispose => dispose())
})
```

验证证据：

- 本机 `dsh-context@0.77.0` 使用完全相同的调用形状（`lib/client.js`，含
  `sidebarRightTabs.register({id, kind, title, guide})`、`slots.inject('sidebar.right.pane.tab', ...)`）。
- 本插件安装后，`cordis_inspect_query`（client `Slots.listSubTree`，root `sidebar.right.pane.tab`）
  的 occupant 列表出现 `{registrant: "Gb", key: "vcs-timeline", active: true}`；
  `sidebar.right.pane.tab.title` 同样出现该 key。这一结果在安装后**未刷新页面**即出现。
- 导航服务 `ctx.sidebarRight.openTab(kind)` 与 `openResource(uri, opts)` 由同一插件提供
  （`dsh-context` 使用），本项目只读 `<select>`/面板内交互，不依赖导航服务。

### 3.2 Slot 与组件

- `slots.inject(ownerKey, () => slots.register(definition, Component))`：回调内注册，owner 塌缩时自动释放。
- 组件通过 props 接收标准 props（`sessionId`、`useSessions`、`useSession` 等），
  但本插件只依赖 `sessionId`（用于解析工作区 cwd），并对缺失做降级（全部工作区模式）。
- 组件必须返回 React 元素；崩溃会让该 slot 条目变空白（console: `slot entry crashed in ...`）。
  本项目用 `react-dom/server` 覆盖所有主要状态的渲染冒烟测试来降低该风险。

### 3.3 主题与本地化

- 主题 token（`cordis_inspect_query` client `Theme.listTokens`）：
  `--dsw-alias-bg-base`、`--dsw-alias-bg-layer-1/2`、`--dsw-alias-bg-overlay`、
  `--dsw-alias-border-l1/l2`、`--dsw-alias-label-primary/secondary/tertiary`、
  `--dsw-alias-brand-primary`、`--dsw-alias-state-success/warn/error-primary`、
  `--dsw-alias-interactive-hover/selected`、`--dsw-specific-sidebar-fill` 等。
  样式表只用这些 token，测试断言无字面十六进制颜色、无 `rgb()/rgba()`、无全局选择器。
- `ctx.locale.register(ns, {zh, en})` + `ctx.locale.bind(ns)` 返回 `t(key, params)`。
  面板全部可见文案走 `t()`；zh/en 字典键完全一致（测试断言）。

### 3.4 对话区页签（`conversation.view`）

主入口是**对话内容区的 View 页签**，与官方的 对话 / 轨迹 以及第三方的 上下文 / 编队 同一行：

```ts
scope.slots.inject('conversation.view', () => scope.slots.register(
  {
    name: 'conversation.view',
    id: 'vcs-timeline',
    order: 40,
    locale: 'vcs-timeline',
    label: () => translate('view.tab'),   // 页签文字，thunk 随语言重读
  },
  PanelComponent,
))
```

- Slot 事实（`cordis_inspect_query` client `Slots.listSubTree`，root `conversation.view`）：
  kind `list`、scope `session`、purpose “Registered Conversation target Views, rendered one
  at a time”；注册字段 `{ id（必填，自有 id 为新增，复用已占用 id 会替换该格）, order?, label? }`。
  实测 occupants：`chat(0)`、`trajectory(10)`、`context(20)`、`fleet(30)`（后两者来自
  dsh-context@0.77.0），本插件以 order 40 排在 编队 之后。
- 同版本已安装的 `dsh-context` 就是这一用法的正例：其 `lib/client.js` 中
  `np(e,t,n,r,i)` 调用 `e.slots.inject('conversation.view', () => e.slots.register({
  name:'conversation.view', id:'fleet', order:30, locale:i, label:()=>r('tab.fleet') }, n))`，
  与官方 View 完全同构；`package.json` 的 `dsh.client.inject` 声明
  `@deepseek-ai/dsh-client-ui-conversation`（本插件同样声明）。
- 行为：选中页签后宿主把**整个对话内容区**替换为该 View，聊天记录/输入框布局不受影响；
  切回「对话」即恢复聊天。没有覆盖层、没有再套一层全屏浮层、没有新的焦点陷阱。
- 组件拿到标准 props（`sessionId` 等）；本插件用它解析会话 cwd，再通过 `/vcs` 路由加载仓库。
- 验证：真实页面里顶部视图行出现「代码时间线」，点击后
  `[data-dvt-panel="vcs-timeline"]` 出现在对话内容区（1920×1080 下 x≈280 y≈76 w≈1633 h≈876），
  页面上不存在插件自己的浮层/输入框条带元素。

> 历史实现说明：早期版本用 `conversation.input.dock`（输入框上方条带）+ portal 全屏浮层；
> 该方案功能可用但入口位置不符合「与对话同一行、占据对话区」的期望，已移除，
> 相关 slot 契约仍记录在 §3.6 供参考。

### 3.5 窄栏适配：容器查询

面板宽度与窗口宽度无关，因此本插件的窄栏规则使用 `@container`
（`.dvt-split { container-type: inline-size }` + `@container (max-width: 520px)`），
而不是 `@media`：右侧栏 400px 时隐藏行内分支标签等次要信息，对话区 1600px 时自动展开。
DSH 桌面端为 Chromium ≥ 110，容器查询可用（真实页面截图验证）。

### 3.6 可用的其他挂载点（参考）

- `conversation.input.dock`（list, session）：输入框上方的条带，occupants
  `todo(0)/goal(10)/queue(20)/git-graph(100)`；注册字段 `{ id, order?, label? }`。
  本插件不再使用，但它是同版本第三方 `@linxin666/dsh-client-ui-git-graph` 的实际用法。
- `shell.overlay`（list, root）：frame-wide 浮层，occupants 含 toast/pet 等。
- `sidebar.right.pane.tab` / `sidebar.right.pane.tab.title`（keyed, session）：
  本插件仍注册 key `vcs-timeline`（当前侧栏 UI 未暴露入口，见 §3.1 注）。

## 4. Host/Client 通信（实测选择的方案）

**结论：0.2.1-rc.3 的桌面端没有面向第三方插件的公开 “Remote 命名空间注册” 入口可用**
（`@Remote` 装饰器 + typert 代码生成属于官方包构建链；第三方 bundle 无法在本机生成 typert schema）。
因此本插件采用 DSH 自带的 **Host Web 路由**机制，与已验证可用的
`@linxin666/dsh-client-ui-git-graph`（同为 0.2.1-rc.3 目标）相同：

- Host：`ctx.webServer.register({ kind: 'prefix', path: '/vcs', handler })` 返回 disposer。
- Client：`fetch('vcs/<name>', { method: 'POST', headers: {'content-type':'application/json'}, body })`，
  路径为**文档相对路径**（页面 `<base href="./">`），不能以 `/` 开头。
- 统一信封：`{"ok":true,"value":...}` / `{"ok":false,"error":{"code","message","detail?","retryable?"}}`。
- 传输层加固：仅 loopback、仅 POST、仅 `application/json`、`Origin` 同源校验、请求体 256 KiB 上限。
- 实测：`POST /vcs/diagnostics` 等路由全部返回预期信封；非 JSON content-type 返回 415；
  未知路由 404；跨源被拒（同源校验）。v1.1 新增 4 条只读路由
  （`worktree/diff`、`checks`、`stats/hotspots`、`session/changes`）已由 `npm run verify:host`
  在构建产物上以真实 git 验证（14/14）。

## 4.2 PR / MR 路由与运行环境（实测）

- 新增只读路由：`POST /vcs/pr/list {repositoryId, refresh?}`、`POST /vcs/pr/detail {repositoryId, number}`，
  复用同一套 loopback/同源/JSON/256 KiB 加固；`number` 非正整数返回 invalid-request（实测负值被拒）。
- 远端解析用 `git config --get remote.origin.url`（仓库根内），支持 https / scp / ssh 形式并剥离凭据；
  远端 host 不含 github/gitlab 时返回 `unsupported-remote`（实测：无远端临时仓库 → 该错误）。
- 凭据链：env（provider 限定）→ `~/.git-credentials` → `<dataDir>/pr-auth.json` → 匿名。
  本机实测：四类环境变量与 `~/.git-credentials`/`pr-auth.json` 均缺失 → 只能匿名；
  匿名 GitHub REST 对公开仓库可用（用直连 node 进程验证过），但 **Host 进程出网到 api.github.com 超时**
  （10s → `network-unknown`，retryable），这是环境/网络策略问题，不是插件代码问题。
- 匿名列表在热门仓库可能超过 1 MiB 响应上限 → 映射 `output-too-large`；GitHub 匿名限流 → `rate-limited`。

## 4.3 工具链探测与本地分支洞察（实测）

- `<dataDir>/vcs-config.json`（可选）：`{"gitPath":"...","svnPath":"..."}`，仅接受 Windows 的
  `.exe`/`.com` 绝对路径（Host 不经 shell）；挂载时读取一次，修改需重新挂载/重启。
- 解析顺序：config → PATH → 常见安装目录。本机实测：git 解析为
  `E:\softData\Git\cmd\git.EXE`（PATH，2.45.1），**svn 全空**（PATH 与 7 个常见目录都没有），
  诊断给出可执行修复：安装 TortoiseSVN 的 command line client tools / SlikSVN，或写
  `svnPath`。`Runner` 已把 argv[0] 的 `git`/`svn` 改写为绝对路径（实测 spawn 生效）。
- `POST /vcs/branch/compare {repositoryId, baseBranch?}`：同一 loopback/JSON/256KiB 加固；
  实测返回 current=`fix-upload`、base=`main`、ahead=3、files=94、conflicts=0、
  actions=[create-pr]；SVN 返回 `available:false`（unsupportedReason: svn-branches-not-compared）。
- `/vcs/repos/add` 读取元数据失败时不再折成 internal：缺少客户端返回 `vcs-not-installed`
  并说明原因（实测添加 `D:\haiyiData\myCode\st-agent` → svn-not-installed）。

## 5. Host 运行时能力（实测）

- **子进程**：`ctx.subprocess.spawn({ argv, cwd, stdio: { stdin: 'ignore', stdout: { maxBytes }, stderr: { maxBytes } }, graceMs, signal })`
  → `handle.done` (`{exitCode}`) + `handle.collected.stdout/stderr.readFrom(0).text`。
  `argv[0] = 'git'` 可由服务解析 PATH（实测 live 调用成功，见 TEST-REPORT）。
  `ctx.subprocess.resolveExecutable(name)` 用于探测 `git`/`svn` 是否存在。
- **工作区**：`ctx.workspaceRegistry.list()` → `{ id, path }[]`（本机 7 个工作区）。
- **日志**：`ctx.logger.warn(message)`。
- **文件系统**：用 Node 内置 `node:fs/promises`（Host 进程内）。数据目录由 `DSH_HOME`
  环境变量解析为 `<DSH_HOME>/storages/dsh-vcs-timeline`，实测写入成功且重启挂载后可读回。

## 6. 构建与类型检查

asar 内没有 `.d.ts`，因此：

- 运行时只依赖内置模块与页面模块表中的 `react`（Host bundle 无第三方运行时依赖）。
- devDependencies 从 npm registry 安装 `0.2.1-rc.3` 同版本类型包用于 `tsc`：
  `@deepseek-ai/cordis@4.0.5`、`dsh-host-webserver`、`dsh-subprocess`、`dsh-workspace`、
  `dsh-client-ui-sidebar-right`、`dsh-client-ui-slots`、`dsh-client-ui-renderer`、
  `dsh-client-locale`、`dsh-client-connection`、`dsh-api-remotes`（均为 `0.2.1-rc.3`）。
- 浏览器半边由 `scripts/build.mjs`（esbuild）打成 CJS 并包进
  `window.__ModuleLoader__.load({ id: 'dsh-vcs-timeline', factory(require) {...} })`；
  `react` / `react/jsx-runtime` / `react-dom` 标记为 external，由页面模块表提供。
- 未在 asar 中暴露的类型（如 `sidebarRightTabs` 服务的完整 `register` 定义）以**运行时可观测形状**
  和同版本已安装插件 `dsh-context@0.77.0` 的实现为准，并在 `src/client/index.ts` 中以结构化类型声明，
  不导入不存在的类型文件。

## 7. 已知限制与未验证项

1. **真实页面验证的边界**：已用 Playwright + Edge（headless）对运行中的桌面端做了真实页面检查
   （对话区页签入口、IDEA 风格时间线、双栏、筛选、详情/Diff、尺寸、深色主题，见 TEST-REPORT §6），
   但仍是脚本化 DOM/计算样式/截图核对，不是人工逐像素签收；clipboard、输入法、拖动等细节未覆盖。
2. **未做整进程重启验证**：已验证「禁用/启用插件（重新挂载）」后审计数据仍可读；
   完整关闭并重启 DSH 桌面端的持久化未实测（JSONL 语义上是磁盘文件，风险低）。
3. **SVN 客户端未安装**：SVN 适配器只做了解析器/命令行/降级路径的单元测试，
   未与真实 SVN 服务器联调；`svn` 缺失时 UI 显示明确的安装提示。
4. 右侧栏内部布局、`sidebarRightTabs` 的未公开字段（如 `priority`、图标对象）没有官方类型，
   本插件只使用已被 `dsh-context` 证实的字段子集。
5. **`conversation.view` 的 owner 语义**：页签按 session 注册；若未来 shell 移除该 slot，
   注册会被 try/catch 降级为“无对话区页签”，右侧栏页签仍可用。
6. **PR 数据依赖网络与凭据**：本机 Host 进程无外网到 api.github.com，匿名也只覆盖公开仓库基础字段；
   评审/CI/可合并状态需配置令牌（env / ~/.git-credentials / pr-auth.json），未配置时 UI 明确提示；
   无 PR 或读不到时，PR 页展示**本地分支洞察**（本地 git 计算，无需网络）。
7. **SVN 客户端缺失**：本机无 svn.exe，SVN 工作副本可被「添加仓库」识别但读不到历史；
   安装 CLI 或配置 `svnPath` 后重新挂载插件即可。
