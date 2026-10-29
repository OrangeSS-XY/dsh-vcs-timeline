# 动态加载与热加载设计（v1.5）

读者：维护本插件的开发者与验收者，已了解 `docs/ARCHITECTURE.md` 里的 Client/Host 分层与 `/vcs` 只读路由。
目标：读完后能说明「缓存从哪来、什么时候刷新、什么时候才该出现加载动画」，并能在真实 DSH 页面上逐条跑完 §4 的验收清单。

一句话结论：**页面生命周期内做后台预热，打开面板时先用内存快照立即渲染，再静默重新验证；只有「确实没有任何数据」或「确实在加载一个新查询」时才显示骨架屏，其余刷新只用一条 3px 不确定进度条和旋转图标表达。**

本文所有行业数字都附来源链接；属于本插件的数值（定时器、退避上限、动画时长等）一律标注为「本插件默认值」，不是行业事实。

## 1 需求与目标

三条用户要求与对应行为：

| # | 用户要求 | 行为 | 可观察结果 |
| --- | --- | --- | --- |
| R1 | 装上插件后，历史、工作区状态、审计等只读数据要自己保持新鲜 | 插件客户端一激活就启动预热服务：首轮延迟后把只读数据刷新进页面内存缓存，之后按固定周期继续 | 用户还没点开面板，缓存已就绪 |
| R2 | 点进「代码时间线」要立刻有内容，不要闪骨架屏 | 面板挂载时先用内存快照构造初始状态，再静默 revalidate；有快照就不出现骨架 | 首次进入后的第二次打开：直接看到上次列表 |
| R3 | 只有确实在加载时才显示加载动画 | 无快照的冷启动、以及某个新查询首次加载 → 骨架屏；有数据时的刷新 → 3px 不确定进度条 + 旋转刷新图标 | 页面不闪、不跳动、不出现「假空」 |

目标：

- 刷新是「静默」的：不清空列表、不重置滚动位置、不收起已展开的目录、不改变当前选中文件。
- 缓存只存在于页面内存：不写 localStorage / IndexedDB / JSONL，页面刷新即失效（见 §5）。
- 不新增 Host 路由、不改 `/vcs` 协议，纯前端改动即可生效（见 §5）。

非目标：

- 不做跨窗口、跨标签页、跨会话的共享缓存。
- 不做「乐观写入」：本插件的写操作仍走「预览 → 单次 token → 执行 → 审计」，预热的只有只读读请求。
- 不用缓存掩盖错误：Host 没返回的数据不会用旧值或零值冒充新值。

## 2 行业做法

### 2.1 TanStack Query：把「有没有数据」和「是否在请求」拆开

做法（均来自官方仓库文档源码）：

- 默认把缓存数据视为过期（stale）；调大 `staleTime` 就减少重复请求。过期数据会在「新实例挂载、窗口重新聚焦、网络重连」时自动在后台重新请求；`refetchInterval` 与 `staleTime` 相互独立。
- `isFetching` 在任何状态下都可能为真，**包括后台重新验证**；而 `status === 'pending'` 只表示「还没有数据」。官方指南用这个区分来做「首次加载显示 Loading、后台刷新只显示 Refreshing」。
- 没有活跃实例的查询默认在 5 分钟后被垃圾回收（`gcTime`）。
- 失败的查询默认重试 3 次，并带指数退避。
- 查询结果默认做结构化共享：数据没变时保持原引用，便于 `useMemo`/`useCallback` 稳定。

对我们的启示：

- R3 的实现基础就是这两个状态分离：**「无数据」才骨架，「有数据在请求」只给进度条**。本插件对应 `PanelState.timeline.loading`（无数据）与 `PanelState.sync.refreshing`（有数据在刷新）。
- 官方默认 5 分钟回收、3 次重试这些数字说明：缓存需要**新鲜度语义 + 失败退避**，不能无限重试。本插件不照搬其数值，只借用语义（见 §3.7）。
- 结构化共享提醒我们：刷新后若直接替换整个列表对象，视图层会整片重建；本项目用「原位合并」达到同样目的（见 §3.5）。

来源：[Important Defaults](https://github.com/TanStack/query/blob/main/docs/framework/react/guides/important-defaults.md)、[Queries（isFetching / fetchStatus）](https://github.com/TanStack/query/blob/main/docs/framework/react/guides/queries.md)、[Background Fetching Indicators](https://github.com/TanStack/query/blob/main/docs/framework/react/guides/background-fetching-indicators.md)、[Window Focus Refetching（`refetchOnWindowFocus` 默认 true）](https://github.com/TanStack/query/blob/main/docs/framework/react/guides/window-focus-refetching.md)。

### 2.2 SWR：stale-while-revalidate 的原始语义

做法：

- SWR 名称取自 HTTP `stale-while-revalidate` 策略：「先返回缓存（stale），再发请求（revalidate），最后带回最新数据」。这个策略本身是 HTTP `Cache-Control` 扩展，定义在 [RFC 5861](https://datatracker.ietf.org/doc/html/rfc5861)。
- 内置缓存与**请求去重**。
- 重新聚焦页面或切换标签页时自动 revalidate，默认开启；网络恢复时自动 revalidate，默认开启。
- 间隔刷新只在「组件在屏幕上」时发生；`refreshWhenHidden` 与 `refreshWhenOffline` **默认关闭**。

对我们的启示：

- 「先渲染旧值」不是偷懒，而是这个模式的字面含义：**渲染路径不能等网络**。
- 去重/单飞是库的内建义务而不是可选项——本插件用 `warming` 标志做单飞（见 §3.7）。
- 「隐藏页面不刷新」与我们用 Page Visibility 停表的做法一致（见 §2.5）。

来源：[SWR README（stale-while-revalidate 与请求去重）](https://github.com/vercel/swr)、[Automatic Revalidation 文档源码](https://github.com/vercel/swr-site/blob/main/content/docs/revalidation.mdx)、[SWR 官方文档页](https://swr.vercel.app/docs/revalidation)。

### 2.3 VS Code Git 扩展：事件驱动刷新 + 空闲/聚焦闸门

做法（官方扩展源码与设置清单）：

- `git.autorefresh` 默认 `true`，描述就是「是否启用自动刷新」。
- `DotGitWatcher` 用文件系统监听器**监听整个 `.git` 目录**（`index`、`HEAD` 等文件的写入就是它的主要事件源），并过滤 `index.lock` 与 watchman 的 cookie 文件，避免自己的写入触发自己；当分支有上游时，另起一个监听器盯上游 ref 文件。
- 收到文件变化后 `onFileChange` 依次判断：`git.autorefresh` 关闭 → 跳过；仓库过大 → 跳过；已有 git 操作在跑 → 跳过；然后 **1000ms debounce**，再等到「操作空闲且窗口聚焦」才真正执行 `git status`，完成后停 5000ms。
- 网络侧的 `git.autofetch` 是**另一个开关**，默认 `false`；`git.autofetchPeriod` 默认 `180`（单位：秒）；计量网络下自动禁用；每轮 fetch 前同样先等空闲与聚焦。

对我们的启示：

- 优先用「事件 + 合并抖动」而不是纯定时：本插件拿不到 `.git` 的文件监听（Host 是进程内 HTTP），所以用 **10s 轻量状态探测**近似事件，只有指纹变化才触发重型历史刷新（见 §3.4）。
- 「窗口不聚焦就不刷新」「有操作在跑就不刷新」直接可借用：本插件把这类判断放在可见性与节流里。
- 本地状态刷新与网络操作刷新必须分开关：本插件预热只做本地只读数据，PR 列表这种需要出网/凭据的数据不预热（见 §3.2）。

来源：[VS Code Git 扩展 `repository.ts`（DotGitWatcher / onFileChange / debounce / whenIdleAndFocused）](https://github.com/microsoft/vscode/blob/main/extensions/git/src/repository.ts)、[`autofetch.ts`](https://github.com/microsoft/vscode/blob/main/extensions/git/src/autofetch.ts)、[`package.json`（`git.autorefresh`、`git.autofetch`、`git.autofetchPeriod` 默认值）](https://github.com/microsoft/vscode/blob/main/extensions/git/package.json)、[`package.nls.json`（设置描述文案）](https://github.com/microsoft/vscode/blob/main/extensions/git/package.nls.json)。

### 2.4 GitHub Desktop：后台 fetch 的「最低间隔 + 抖动」

做法：

- 后台 fetch 的周期由服务端下发的轮询间隔决定；客户端常量是：缺省 1 小时、下限 5 分钟、最多 30 秒随机抖动（避免所有客户端同时打请求）。
- 是否真的 fetch 还有一道闸门：上次 fetch 距今 **不足 30 分钟就跳过**（源码常量 `BackgroundFetchMinimumInterval`，注释说明后台 fetch 在应用活跃时按小时级进行，这个下限用于避免切仓库、切应用导致过度 fetch）；若已知远端有新推送（`lastPush` 晚于 `lastFetched`）才继续。
- 官方 issue #22217 记录了这个顺序的缺陷：代码先判断 30 分钟下限、后判断 `lastPush`，导致「已经知道远端更新了」仍然被下限挡住，仓库指示最多 30 分钟不更新。

对我们的启示：

- 后台刷新必须有**下限**，否则切标签页、切仓库都会变成请求风暴；本插件用 30s 周期 + 5s 的可见性/聚焦节流（见 §3.4）。
- 下限会牺牲新鲜度，所以「**已知有新数据**」或「用户主动操作」应能绕过它：本插件的手动刷新和面板内的 10s 轻探测就是绕过通道。
- 跳过与失败都要可解释：GitHub Desktop 会把跳过原因写日志；本插件把失败原因放进 `sync.lastError` 并在界面上显示（见 §3.7）。

来源：[`background-fetcher.ts`（DefaultFetchInterval / MinimumInterval / SkewUpperBound）](https://github.com/desktop/desktop/blob/development/app/src/lib/stores/helpers/background-fetcher.ts)、[`app-store.ts`（`BackgroundFetchMinimumInterval` 与 `shouldBackgroundFetch`）](https://github.com/desktop/desktop/blob/development/app/src/lib/stores/app-store.ts)、[Issue #22217：已知远端推送仍被 30 分钟下限挡住](https://github.com/desktop/desktop/issues/22217)。

### 2.5 Page Visibility API：隐藏时停，回来时补

做法：

- `visibilitychange` 在用户切换标签页、最小化、窗口被完全遮挡时触发；状态从 `document.visibilityState` / `document.hidden` 读取。
- MDN 明确把它列为「仪表盘类应用不应该在页面不可见时继续轮询」的标准手段，并指出隐藏是「停止 UI 更新与后台任务」的合适时机。
- 浏览器本身也会节流后台定时器（`setTimeout` 延迟变大），所以后台的定时刷新本来就不可靠。

对我们的启示：

- 面板内定时器在 `hidden` 时全部停掉，变可见时立即补一次刷新，而不是等下一个 30s。
- 预热服务同理：不可见不 warm，但定时链保留，回到前台再补；对 `visibilitychange` 触发的 warm 做节流（本插件默认 5s），否则反复切标签页会打爆 Host。

来源：[MDN Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)、[MDN `visibilitychange` 事件](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event)。

### 2.6 骨架屏、shimmer 与 prefers-reduced-motion

做法：

- web.dev 的离线 UX 指南把 skeleton layout 定义为「应用的线框版本，在内容加载期间显示」，用来告诉用户内容即将出现；建议与其他反馈机制（文案、预加载 UI）配合，并举例可以让线框**脉动**；同时明确反对用阻塞整个界面的加载弹窗。
- `prefers-reduced-motion: reduce` 表示用户已在设备上要求最小化非必要动效；MDN 指出缩放、平移这类动画可能触发前庭功能不适，因此需要为这类用户提供弱化/替代动画。
- ARIA 的 `aria-busy` 用于告诉辅助技术「内容正在被修改，先别播报」；当 live region 的多个部分不是同时更新时，用它避免零散播报。

对我们的启示：

- 骨架屏只用于「内容形状已知、数据还没有」的场景；有数据时的刷新绝不能再盖一层骨架，否则就是内容闪烁。
- 任何加载动效都必须提供 reduced-motion 的静态替代（本插件用一条静态 40% 蓝色进度条代替滑动条）。
- 加载状态要播报一次而不是每帧播报：本插件用 `role="progressbar"` + `role="status" aria-live="polite"` 的 live region，且 live region 空闲时不输出文本。

来源：[web.dev《Offline UX design guidelines》](https://web.dev/articles/offline-ux-design-guidelines)（正文源文件见 [GoogleChrome/web.dev](https://github.com/GoogleChrome/web.dev/blob/main/src/site/content/en/reliable/offline-ux-design-guidelines/index.md)）、[MDN `prefers-reduced-motion`](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)、[MDN `aria-busy`](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-busy)。

## 3 本插件设计

### 3.1 组成

| 层 | 文件 | 职责 |
| --- | --- | --- |
| 插件入口 | `src/client/index.ts` | 每次插件激活创建一个 `createDataSync({ api })`，在 `ctx.effect` 里 `sync.start()`，卸载时 `sync.stop()` |
| 预热服务 | `src/client/sync.ts` | 实现 `PanelSync`：首轮延迟、周期 warm、可见性闸门、面板打开暂停、单飞、失败退避、`hydrate()` 与 `remember*()` 转发 |
| 内存缓存 | `src/client/cache.ts` | `PanelCache`：工作区键归一化、每仓库切片 + `savedAt`、LRU 上限、按 `queryKey` 精确匹配时间线页 |
| 面板 | `src/client/panel.ts` | `hydratePanelState()` 首帧、`beginRefresh/endRefresh` 计数、`revalidateVisible()` 单一入口、10s 探测、30s 刷新、可见性与聚焦监听 |
| 可见反馈 | `src/client/ui/toolbar.ts`、`src/client/styles.ts` | 3px 不确定进度条、旋转刷新图标、live region、shimmer、reduced-motion 替代 |
| Host | 无改动 | 仍只用既有 `/vcs` 只读路由；预热不新增协议 |

### 3.2 缓存内容（什么预热、什么不预热）

| 切片 | 缓存入口 | 预热是否拉取 | 首帧是否可用 |
| --- | --- | --- | --- |
| 工作区仓库列表 + 诊断 | `rememberRepositories` | 是（`listRepositories`） | 是 |
| 时间线第一页 | `rememberTimeline`（带 `queryKey`） | 是（默认无筛选第一页） | 仅当 `queryKey` 完全一致 |
| 工作区状态 | `rememberStatus` | 是（`status`） | 是 |
| 审计第一页 | `rememberAudit` | 是（`listOperations`） | 是 |
| 热点报告 | `rememberHotspots` | 否（扫描重） | 仅面板自己读过之后 |
| 会话归因 | `rememberSession` | 否（依赖会话状态） | 仅面板自己读过之后 |
| 体检报告（staged / worktree 两侧） | `rememberChecks` | 否（依赖工作区 diff） | 仅面板自己读过之后 |
| PR 列表 / 分支洞察 | `rememberPullRequests` / `rememberCompare` | 否（要出网/凭据，见架构文档 §4.1） | 仅面板自己读过之后 |
| Diff 文本 | 不进 `PanelCache` | 否 | 面板内 `onPrefetchFile` 的 hover 预热与此无关 |

设计理由：

- 预热只覆盖「打开面板第一屏就需要」的四类数据，避免后台请求把 Host 拖慢。
- **仓库发现单独限流**：`listRepositories` 要扫描工作区并为每个仓库读 VCS 元信息，比 `status` 贵得多，
  所以缓存里的仓库列表在 **2 分钟内复用**（本插件默认值 `REPOSITORY_LIST_TTL_MS`），后台 warm 只重读
  status/timeline/audit；面板自己的「刷新仓库列表」不受这个窗口限制。
- 需要网络（PR）、需要重扫描（热点）、依赖实时工作区（体检、会话）的数据不预热：它们的价值低于代价，且很容易过期。
- 缓存上限是 **8 个仓库**（本插件默认值，`MAX_CACHED_REPOSITORIES`）；超出按最近使用淘汰。淘汰只影响「下次打开可能需要重新加载」，不影响已渲染内容。

### 3.3 时序

冷启动（无任何缓存）：

```text
用户点「代码时间线」
  └─ React mount
       ├─ hydratePanelState(sync.hydrate(workspace))
       │    └─ 无快照 → 原始初始状态：boot='loading'，列表为空
       ├─ 渲染灰块布局骨架（SkeletonSwap，按 source 匹配时间线/卡片/树结构）
       ├─ POST /vcs/repos/list → 仓库列表就绪 → boot='ready'
       ├─ POST /vcs/status、/vcs/timeline（第一页）
       └─ 数据到达 → 骨架替换为真实列表（此时才允许出现「空仓库」等真实空态）
```

已预热后打开（无感刷新）：

```text
面板挂载
  ├─ hydratePanelState(snapshot)     ← 内存缓存，同步完成
  │    └─ boot='ready'，直接渲染上次的仓库/历史/状态/审计
  ├─ 首帧没有任何骨架，滚动位置从 0 开始（新面板实例）
  ├─ 立即 revalidateVisible()：beginRefresh('background') → 顶部 3px 进度条
  ├─ 各接口返回 → mergeTimelineRefresh / mergeAuditRefresh 原位合并
  └─ endRefresh(null) → 进度条消失，lastSyncedAt 更新
```

面板打开后的持续刷新：

```text
每 10s  → GET /vcs/status → statusFingerprint 比对
                              ├─ 未变：只更新状态区，不重载历史
                              └─ 变化：revalidateVisible()（静默）
每 30s  → revalidateVisible()（仅当前来源）
可见性   → hidden：停掉两个定时器；visible：重新起表 + 立即探测 + 立即 revalidate
窗口聚焦 → 立即探测 + revalidate（5s 节流，本插件默认值）
写操作后 → 走原有 reload 路径，读到的结果同样回写缓存
```

### 3.4 刷新触发源

| 触发源 | 发起者 | 延迟 / 节流 | 动作 | 面板未打开 | 面板已打开 |
| --- | --- | --- | --- | --- | --- |
| 插件激活 | `sync.start()` | 首轮 1200ms，之后 30s（本插件默认值） | warm 四类只读数据 | 生效 | 暂停（面板接管） |
| 面板打开 | `sync.setPanelOpen(true)` | 立即 | 停掉预热定时链 | — | 生效 |
| 面板挂载 | `hydratePanelState` + `revalidateVisible` | 立即 | 首帧 + 静默刷新 | — | 生效 |
| 面板关闭 | `sync.setPanelOpen(false)` | 800ms（本插件默认值） | 安排一次 warm（不等满一个周期） | — | 生效 |
| 工作区状态探测 | 面板 `pollStatusOnce` | 10s | 指纹变化才触发历史刷新 | 不生效 | 生效 |
| 定时全量刷新 | 面板 `AUTO_REFRESH_INTERVAL_MS` | 30s | `revalidateVisible()` | 不生效 | 生效 |
| 页面重新可见 | 面板 `visibilitychange` + `sync.warmNow('visibility')` | 立即；预热侧 5s 节流 | 探测 + 静默刷新；预热侧补一次 warm | 生效 | 生效 |
| 窗口聚焦 | 面板 `window.focus` | 5s 节流 | 探测 + 静默刷新 | 不生效 | 生效 |
| 手动刷新（按钮 / `Alt+R`） | 面板 handler | 立即 | 递增 `refreshTick` / `statusTick`，按当前来源重新拉取（重跑各加载 effect） | — | 生效 |
| 写操作完成 | 既有 reload 路径 | 立即 | 读取结果回写缓存 | — | 生效 |
| 文件行 hover | `onPrefetchFile` | 防抖 | 预热该文件 diff（不经过 `PanelSync`） | 不生效 | 生效 |

### 3.5 无感刷新规则

1. **先渲染、后验证**：`hydratePanelState()` 只在挂载时执行一次，用同步的内存快照构造首态；随后才开始网络请求。
2. **快照必须同 query**：时间线缓存命中要求 `queryKey` 完全一致，键由 `repositoryId / limit / includeFiles / text / author / since / branch / branchScope / eventTypes（排序后）` 组成。筛选条件不同就宁可不命中，也不能把别的窗口的提交显示成当前结果。
3. **只刷新当前来源**：`revalidateVisible()` 按 `state.source` 分派（时间线只刷时间线、审计只刷审计、PR 只刷 PR 与分支洞察），不顺手刷新用户没在看的页签。
4. **原位合并而不是替换**：`mergeTimelineRefresh()` 把新第一页放前面，保留用户已「加载更多」出来的旧页，并保留原有 `cursor/hasMore/partial/warnings`；`mergeAuditRefresh()` 同理。这样刷新不会把翻页位置弄丢。
5. **不重置界面状态**：刷新不修改 `expandedDirs`、`selectedFilePath`、`filters`、当前页签与详情打开状态。
6. **轻探测触发重刷新**：`statusFingerprint()` 把分支、HEAD、是否干净、以及排序后的「状态+路径」串成一个指纹；指纹没变就不重载历史，避免每 10s 跑一次 `git log`。
7. **刷新计数而非布尔**：`beginRefresh()` 自增、`endRefresh()` 自减，最后一个请求结束才熄灭进度条；多个切片并行刷新时不会闪断。
8. **进度条不占布局**：`.dvt-syncslot` 是 `height: 0` 的相对定位槽，`.dvt-syncbar` 绝对定位覆盖在其上，出现/消失都不推动工具栏；`pointer-events: none` 保证它不吞点击。
9. **刷新中仍可手动刷新**：刷新图标保持可点（只在 `boot === 'loading'` 时禁用），旋转只表示「正在更新」。
10. **首帧就进 loading**：从缓存水合出仓库列表但没有该查询的页面时、切换仓库/页签的同一帧就把
    `loading` 置位；否则会先闪一帧“空历史/暂无记录”再出现骨架。

### 3.6 加载动画规则

| 场景 | 数据状态 | 表现 | 依据 |
| --- | --- | --- | --- |
| 首次进入且无任何快照 | 无数据 | **灰块布局骨架**（`SkeletonSwap` + `SkeletonContent`）：按时间线/卡片/树/热点/待办的真实布局排列，白色微光扫过循环；顶部进度条、刷新图标、“正在更新…”胶囊全部隐藏 | 确实没有任何数据可显示，骨架本身就是布局 |
| 切换仓库 / 筛选 / 来源，且该查询无缓存 | 该区域无数据 | 该区域换成对应布局骨架，其它栏不清空 | 新查询首次加载 |
| 加载完成 | 数据到达 | 骨架保留约 260ms 淡出（`dvt-skel-out`），真实内容同帧挂载并淡入（`dvt-content-in`），grid 同格叠层不跳动 | 避免骨架瞬间消失的跳变 |
| 有数据时的后台刷新（定时、可见性、聚焦、手动） | 有数据 | 3px 不确定进度条 + 旋转刷新图标 + 「正在更新…」文字胶囊，**无骨架** | §2.1 的 `isFetching` 语义 |
| 详情 / diff / PR 详情加载 | 主列表有数据 | 仅详情区灰块骨架（`SkeletonRows` 新样式） | 局部加载 |
| 预热（面板未打开） | 面板不可见 | 无任何 UI | 用户看不见，不打扰 |
| `prefers-reduced-motion: reduce` | 任意 | 骨架无扫光、无淡入淡出；进度条/图标不转，直接切换 | §2.6 |
| 刷新失败且已有旧数据 | 有数据 | 保留旧数据 + warn banner（含重试按钮），不显示加载动画 | §3.7 |

骨架细节（v1.5.1）：

- **灰块即布局**：每块是 `--dsw-alias-bg-layer-2` 的圆角矩形，尺寸/位置贴近真实内容；时间线保留
  140px 泳道画布与 64px 行高，卡片列表带可选头像/元信息行，树/热点/待办各有对应结构。
- **白色扫光**：`.dvt-skel-block::after` 的 90° 白色渐变（`color-mix`）用 `translateX(-100%→100%)`
  1.5s 循环；负 `animation-delay` 让第一帧就有一道微光，短加载也能看到动效。扫光不改块尺寸，不新增 DOM。
- **无文字/无品牌**：骨架层 `aria-hidden`，容器仅加载中 `aria-busy="true"`；冷启动时 chrome 不输出
  进度条/live 文案，底部状态栏也换成灰块，因此整屏不会出现“加载中”文字。
- **不挡交互**：骨架层 `pointer-events: none`，淡出期间真实内容已经可点击。

无障碍约定：

- 进度条：`role="progressbar"`，`aria-label` 为「后台数据同步」，`aria-valuetext` 为「正在更新…」；
  仅在「有数据时的静默刷新」出现。
- 播报：`role="status"` + `aria-live="polite"` 的 live region 常驻挂载，只在静默刷新时有文本，空闲时用
  `:empty` 隐藏；冷启动骨架阶段不播报文字，由 `aria-busy` 表达。
- 静默刷新不止进度条一个载体：文字胶囊与旋转图标同时存在，不靠颜色或动画单独表达状态。

### 3.7 失败与退避

| 层 | 失败表现 | 退避 / 重入 | 数据 |
| --- | --- | --- | --- |
| 预热 warm | 记录 `lastError`，不抛异常、不产生未处理 rejection | 连续失败按 2 的幂翻倍：30s → 60s → 120s → 240s 封顶（本插件默认值）；成功归零 | 旧缓存全部保留 |
| warm 内部单请求 | `listRepositories / status / timeline / audit` 各自独立结算 | 一个失败不影响其它三个已拿到的结果 | 成功项照常写入缓存 |
| 面板静默刷新 | `endRefresh(error)` 写入 `sync.lastError` | 不改变刷新节奏；手动刷新可随时重试 | `lastSyncedAt` 不更新，旧数据继续显示 |
| 面板冷启动（无数据） | 进入错误态并提供重试 | 用户点击重试 | 不把「读取失败」渲染成「0 个提交」 |
| 服务停止 | 所有在途响应因 token 过期被丢弃 | `stop()` 清定时器、移除监听 | 不写缓存、不改状态 |

「不伪造」规则：

- 缓存条目只是「某时刻 Host 返回过的快照」，带 `savedAt`；界面显示「已更新于 …」时引用的是这个时间戳，不冒充当前时刻。
- `queryKey` 不匹配、或缓存里没有该仓库时，宁可不命中并显示加载态，也不展示别的查询结果。
- 失败时保留旧数据，但必须同时给出「后台刷新失败，当前显示的是上次的数据」的提示，不能静默假装成功。

### 3.8 实现约束

- 定时器、时钟、可见性、`document` 全部可注入（`scheduler / now / visibility / documentLike`），因此测试不依赖真实计时与真实浏览器。
- 不在模块顶层触碰 DOM；`start()` / `stop()` 可重复调用，`stop()` 后能再次 `start()`。
- 缓存返回的对象按不可变快照对待，调用方不得原地修改。
- 预热只发只读请求，不触发 fetch/push/commit，也不产生审计记录。

## 4 验收清单

前置条件：

- 插件已安装并在 DSH Web GUI 中加载（浏览器页面已刷新）；
- 当前会话的工作区里有 Git 仓库，且 Host 能正常返回历史；
- 需要观察请求时，打开浏览器 DevTools 的 Network 面板（筛选 `vcs`）；
- 需要制造新提交时，在仓库里执行 `git commit --allow-empty -m "dynamic-loading check"`。

| # | 手工步骤 | 期望 | 判定 |
| --- | --- | --- | --- |
| 1 | 刷新页面（清空内存缓存）后**立即**点「代码时间线」 | 先出现骨架屏，随后被真实历史替换；不出现空白页或「0 个提交」 | 骨架在 1~2s 内消失，列表有真实提交 |
| 2 | 切回「对话」，再点「代码时间线」 | 立即显示上次的列表（无骨架）；约 1s 内顶部出现 3px 进度条并自动消失 | 全程无骨架、无空白、列表未被清空 |
| 3 | 面板停留时，手动点一次刷新（或等一次 30s 自动刷新） | 列表原地更新：滚动位置、已展开目录、选中文件与打开的详情都不变；只有进度条与旋转图标在变化 | 刷新前后界面状态一致，列表整片没有重建 |
| 4 | 面板停留不动，执行一次空提交并等待 | ≤30s 内新提交出现在列表顶部；期间只有进度条与旋转图标 | 无骨架；列表只多出一行，旧行位置不变 |
| 5 | 切到其它应用或最小化 ≥30s，再切回 DSH | 回到页面立刻刷新一次，而不是等下一个 30s 周期 | 回来 1~2s 内看到进度条出现又消失 |
| 6 | 在 DevTools 里把网络切到 Offline（或让 Host 不可达），等一次刷新，再恢复 | 旧数据仍在；顶部出现「后台刷新失败，当前显示的是上次的数据」提示与重试按钮；恢复后重试成功、提示消失 | 失败期间列表不清空、可继续浏览 |
| 7 | 系统开启「减少动态效果」（Windows：设置 → 辅助功能 → 视觉效果 → 动画效果关闭），刷新页面后触发一次刷新 | 顶部是静态 40% 蓝色进度条；刷新图标不旋转；骨架无 shimmer | 全程无动画但仍有「正在更新」反馈 |
| 8 | 打开面板后观察 Network 面板 1 分钟 | 只有面板自己的请求（10s 状态探测、30s 全量刷新），没有预热服务叠加的第二套请求 | 同一时刻不出现重复的 timeline 请求 |
| 9 | 关闭面板（切回「对话」）后观察 | 约 800ms 后出现一次预热请求（与 §3.2 的四类数据一致） | 请求范围是 list/status/timeline/audit，不含 PR 与热点 |
| 10 | 刷新整个页面后，用 DevTools 把网络限速为 Slow 3G，在预热首轮完成前点进面板 | 出现骨架屏 | 属预期：内存缓存不持久，此时确实是冷启动 |

## 5 明确边界

1. **内存不持久**：缓存随页面刷新、窗口关闭、插件重载而消失；不写 localStorage / IndexedDB，也不进 JSONL。JSONL 只承载仓库快照、审计等既有持久化事实，与本缓存无关。
2. **不跨窗口、不跨标签页**：每个 DSH 页面实例各有一份 `PanelCache`，彼此不共享，也不做广播同步。
3. **不跨 Host 重启**：本缓存是浏览器侧数据；Host 侧自己的缓存（如热点 60s、PR 60s 列表缓存）独立存在，两者不互相承诺。
4. **不伪造 Host 未返回的数据**：只展示 `queryKey` 完全匹配的快照；分页只预热第一页，`hasMore` 仍照实显示「加载更多」；读取失败不会补零、不会用旧值冒充新值。
5. **纯前端改动，无需重启 Host**：没有新增路由、没有改 `/vcs` 协议；安装/更新后按 `docs/DSH-COMPATIBILITY.md` 的热加载流程生效。
6. **预热只读**：不执行 fetch/pull/push/commit，不生成审计记录；写操作仍必须经过预览 + 单次 token。
7. **权限不因缓存而放松**：每次请求仍由 Host 重新 `gate()` 校验仓库归属与 VCS 元数据；缓存不是授权凭据。
8. **不替代手动刷新**：手动刷新始终可用，且在刷新进行中也能点击。
9. **资源上限**：最多缓存 8 个仓库（LRU）；预热只拉 4 类只读数据；需要出网或重扫描的数据不预热；失败退避封顶 4 分钟。

## 6 参考资料

### 6.1 数据获取与重新验证

- TanStack Query — Important Defaults：<https://github.com/TanStack/query/blob/main/docs/framework/react/guides/important-defaults.md>
- TanStack Query — Queries（`isFetching` / `fetchStatus`）：<https://github.com/TanStack/query/blob/main/docs/framework/react/guides/queries.md>
- TanStack Query — Background Fetching Indicators：<https://github.com/TanStack/query/blob/main/docs/framework/react/guides/background-fetching-indicators.md>
- TanStack Query — Window Focus Refetching：<https://github.com/TanStack/query/blob/main/docs/framework/react/guides/window-focus-refetching.md>
- SWR — README（stale-while-revalidate 与请求去重）：<https://github.com/vercel/swr>
- SWR — Automatic Revalidation（官方文档源码）：<https://github.com/vercel/swr-site/blob/main/content/docs/revalidation.mdx>
- SWR — 官方文档页：<https://swr.vercel.app/docs/revalidation>
- RFC 5861 — HTTP `Cache-Control` 的 `stale-while-revalidate` 扩展：<https://datatracker.ietf.org/doc/html/rfc5861>

### 6.2 编辑器与桌面客户端案例

- VS Code Git 扩展 — `repository.ts`：<https://github.com/microsoft/vscode/blob/main/extensions/git/src/repository.ts>
- VS Code Git 扩展 — `autofetch.ts`：<https://github.com/microsoft/vscode/blob/main/extensions/git/src/autofetch.ts>
- VS Code Git 扩展 — `package.json`（`git.autorefresh` / `git.autofetch` / `git.autofetchPeriod`）：<https://github.com/microsoft/vscode/blob/main/extensions/git/package.json>
- VS Code Git 扩展 — `package.nls.json`（设置文案）：<https://github.com/microsoft/vscode/blob/main/extensions/git/package.nls.json>
- GitHub Desktop — `background-fetcher.ts`：<https://github.com/desktop/desktop/blob/development/app/src/lib/stores/helpers/background-fetcher.ts>
- GitHub Desktop — `app-store.ts`（`BackgroundFetchMinimumInterval` / `shouldBackgroundFetch`）：<https://github.com/desktop/desktop/blob/development/app/src/lib/stores/app-store.ts>
- GitHub Desktop — Issue #22217：<https://github.com/desktop/desktop/issues/22217>

### 6.3 页面生命周期与可访问性

- MDN — Page Visibility API：<https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API>
- MDN — `visibilitychange` 事件：<https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event>
- MDN — `prefers-reduced-motion`：<https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion>
- MDN — `aria-busy`：<https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-busy>
- web.dev — Offline UX design guidelines：<https://web.dev/articles/offline-ux-design-guidelines>
- web.dev 文章源文件 — `offline-ux-design-guidelines`：<https://github.com/GoogleChrome/web.dev/blob/main/src/site/content/en/reliable/offline-ux-design-guidelines/index.md>
