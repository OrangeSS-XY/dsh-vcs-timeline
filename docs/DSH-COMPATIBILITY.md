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

## 3. 右侧栏契约（逐项确认）

### 3.1 Tab 类型注册（Client）

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
- 实测：`POST /vcs/diagnostics` 等 13 条路由全部返回预期信封；非 JSON content-type 返回 415；
  未知路由 404；跨源被拒（同源校验）。

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

1. **无浏览器自动化**：面板在真实 GUI 中的视觉效果、窄屏溢出、交互路径（防抖、Esc、焦点、剪贴板）
   只经过 SSR 渲染测试与代码审查，未做像素级验证；tab 的实时挂载与 slot occupant 已通过 inspector 验证。
2. **未做整进程重启验证**：已验证「禁用/启用插件（重新挂载）」后审计数据仍可读；
   完整关闭并重启 DSH 桌面端的持久化未实测（JSONL 语义上是磁盘文件，风险低）。
3. **SVN 客户端未安装**：SVN 适配器只做了解析器/命令行/降级路径的单元测试，
   未与真实 SVN 服务器联调；`svn` 缺失时 UI 显示明确的安装提示。
4. 右侧栏内部布局、`sidebarRightTabs` 的未公开字段（如 `priority`、图标对象）没有官方类型，
   本插件只使用已被 `dsh-context` 证实的字段子集。
