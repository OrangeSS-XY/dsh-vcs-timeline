# dsh-vcs-timeline（代码时间线）

DeepSeek Harness（DSH）桌面端插件：以**文件为中心**浏览 **Git / SVN 仓库变更**——
左侧文件树、右侧变更时间线、逐提交 Diff，并记录**本插件自己发起的写操作审计**。
第一验收环境为 DSH 桌面端 `0.2.1-rc.3`（Windows）。

- **对话区页签**：与「对话 / 轨迹 / 上下文 / 编队」同一行，标签 `代码时间线`；点击后整个对话内容区切换为时间线视图
- **右侧栏页签**（备用）：`代码时间线`（tab 类型 id `vcs-timeline`）已注册；当前桌面端侧栏未暴露该入口
- Host：仓库发现、Git/SVN CLI 调用、路径闸门、`/vcs` JSON 路由、JSONL 审计
- Client：React 面板（仅主题 token 样式），通过 `/vcs` 路由访问 Host

> 事实边界：仓库历史来自 Git/SVN 本身；审计只覆盖**本插件**实际发起并观察到的操作。
> 不声称捕获外部终端/IDE 的操作，也不把 commit 当成 push、把 SVN update 当成 commit。

## 功能

| 能力 | 状态 |
| --- | --- |
| 仓库发现（当前会话工作区 + 有界子目录扫描） | implemented / unit-tested / desktop-verified |
| **动态加载：插件激活后定时预热到内存，打开面板先渲染缓存再静默刷新** | implemented / unit+render tested / built-artifact verified |
| **加载反馈：灰块布局骨架 + 白色扫光 + 骨架淡出/内容淡入；有缓存只出细进度条（尊重 reduced-motion）** | implemented / unit+render tested / built-artifact verified |
| 手动添加仓库（校验 VCS 元数据与路径） | implemented / desktop-verified |
| 对话区页签入口（与 对话/轨迹/上下文/编队 同排，`conversation.view`） | implemented / desktop-verified |
| IDEA 风格提交时间线（竖轴 + 节点、日期分组、作者头像/姓名、相对时间、HEAD、分支、±） | implemented / unit-tested / desktop-verified |
| 多泳道提交图（父哈希推导泳道、合并空心节点、分支汇入曲线） | implemented / unit-tested / desktop-verified |
| IDE 式「列表 + 下方面板」分栏（详情/Diff/审计/PR 不再替换列表） | implemented / unit-tested / desktop-verified |
| 点文件查看「谁改的 + 最新 Diff」（最近作者、作者数、逐提交状态与 ±） | implemented / unit-tested / desktop-verified |
| 拉取请求（GitHub/GitLab）：作者、分支、评审、CI、可合并性与「需要我做什么」 | implemented / unit-tested / 本机 Host 无外网（见下） |
| 审计区可视化：状态计数 chips、状态筛选、记录详情（退出码/correlationId/前后 revision） | implemented / unit-tested / desktop-verified |
| 双栏变更浏览器：文件树（目录计数、状态字母、文件名搜索、状态筛选）+ 时间线 | implemented / unit-tested / desktop-verified |
| 单文件变更历史（点文件后只列该文件的提交，逐提交状态与 ± 行） | implemented / unit-tested / desktop-verified |
| Git 历史分页、关键字/作者/时间范围过滤，逐提交文件清单（name-status + numstat） | implemented / unit-tested / integration-tested / desktop-verified |
| Commit 详情（文件状态、重命名、二进制、行数） | 同上 |
| 单文件 Diff（截断、二进制提示、纯文本渲染） | 同上 |
| 工作区状态（干净/脏、暂存、冲突、ahead-behind） | 同上 |
| SVN 历史/详情/Diff/状态/update/commit | implemented / unit-tested（本机无 svn 客户端，未联调） |
| 插件操作审计（追加式 JSONL、折叠展示） | implemented / unit-tested / desktop-verified |
| 受控写操作：Fetch / Pull(--ff-only) / Commit(仅已暂存) / Push(仅当前分支) / SVN Update / Commit | implemented / desktop-verified（Git commit 实跑） |
| Merge / Rebase / Switch / Reset / Clean / Force push | 明确不实现（返回 blockedReason） |

### v1.1 新增（P0 六项）

| 能力 | 状态 |
| --- | --- |
| **待处理工作台**：脏文件按 冲突/已暂存/未暂存/未跟踪 分组 + 逐文件即时 Diff（未跟踪文件按整文件新增、真实读取、二进制识别） | implemented / unit+render tested / built-artifact verified |
| **提交前变更体检**：基于真实 diff 的规则（冲突标记、私钥、疑似密钥、锁文件、删测试、二进制、超大变更、未跟踪未检查），阻断项在 commit 确认框里必须显式勾选才能提交 | implemented / unit+render tested / built-artifact verified |
| **审计节点融入时间线**：插件操作以独立图标/虚线节点混排，来源徽标 + 状态徽标 + 单独「N 次操作」计数，不计入提交数 | implemented / render tested / built-artifact verified |
| **分支标签筛选**：点提交行分支标签 → Host 侧 `git log <ref>` 真过滤；「仅当前分支 / 全部分支（--branches）」开关；SVN 明确提示不支持分支语义 | implemented / unit+render tested / built-artifact verified |
| **会话改动集 + AI 归因徽标**：读当前活动会话的 `tool/call`→`tool/result`，只统计成功的写文件工具；路径限制在仓库内；一律标注「推断」；提交行可显示「插件提交」（审计精确匹配）或「本会话(推断)」 | implemented / unit+render tested / built-artifact verified（活动会话可读；历史存档不读） |
| **统计聚合缓存 + 文件热点排行**：Git numstat 窗口扫描（默认 500 提交、上限 2000）、churn/提交数/作者数/最近变更四维可切排序、60s Host 缓存、口径角标（扫描窗口/分支/是否截断/是否缓存）；SVN 如实返回不可用 | implemented / unit+render tested / built-artifact verified |

> 验收口径：`npm run check`（typecheck + 371 项测试 + 构建）与 `npm run verify:host`
>（把构建产物 `lib/index.js` 挂到假 Host 上，用真实 git 跑通全部新路由，21/21）通过。
> 运行中的桌面端仍需重启一次才能加载新的 Host 代码（见「安装」末段）。

### v1.5 动态加载 / 热加载（0.1.3）

目标是让“点开代码时间线”不再先看到骨架屏：**插件安装/页面加载后就在后台把只读数据刷进内存**，
用户点进来时先用内存里的快照渲染，再静默刷新；只有真的没有缓存时才显示加载动画。
详细设计、行业案例与验收步骤见 [docs/DYNAMIC-LOADING.md](docs/DYNAMIC-LOADING.md)。

- **页面生命周期内存缓存**（`src/client/cache.ts`）：按 workspace 缓存仓库列表，按 repository 缓存
  时间线第一页、工作区状态、审计第一页、热点、会话归因、体检、PR 列表与本分支洞察；
  带写入时间戳、LRU 上限 8 个仓库，**不落盘、不跨页面刷新**。
- **插件激活即预热**（`src/client/sync.ts`）：客户端插件加载后延迟 1.2s 做首次预热，之后每 30s 一次
  （仅在页面可见、且面板未打开时）。预热内容 = 仓库列表 + 目标仓库的 status / timeline 第一页 / audit
  第一页；目标仓库优先取用户当前/上次看过的仓库。仓库发现（工作区扫描 + 每个仓库读元信息）比
  `git status` 贵得多，因此列表在 2 分钟内复用，面板自己的「刷新仓库列表」不受此限制。
  面板打开后暂停重型预热，关闭面板 800ms 后补一次。
- **点开面板无感刷新**：面板首次 render 直接从缓存水合（无骨架、无空列表闪烁），随后立即静默
  revalidate：列表、详情、选中项、滚动位置都保持原位，新提交合并到顶部，已“加载更多”的旧页不丢失。
- **热加载**：面板可见时每 10s 用便宜的 `status` 探测工作区（HEAD/分支/脏文件指纹），只有变化时才
  重拉历史；每 30s 做一次完整静默刷新；页面隐藏时停止轮询，切回标签页或窗口聚焦时立即刷新一次
  （5s 节流）。失败按 30→60→120→240s 指数退避，**保留旧数据**并在工具栏下方提示“显示的是上次的数据”。
- **加载动画**：冷启动/首次加载当前页签时显示**灰色圆角布局骨架**（时间线骨架、卡片列表骨架、
  文件树骨架、热点/待办骨架按真实布局排列），一道柔和白色微光从左到右循环扫过；加载完成时骨架
  **平滑淡出、真实内容淡入**（约 260ms，grid 叠层不跳动）。已有数据时不出骨架，只在工具栏顶部出现
  3px 不确定进度条 + 旋转刷新图标 + “正在更新…”提示；`prefers-reduced-motion` 下扫光/淡入淡出全部
  退化为静态，骨架与状态栏都不含文字。
- **纯前端改动，无需重启 DSH Host**：新增的刷新/缓存都在浏览器半；重新构建后 `F5` 即可生效。

> 验收口径：`npm run check`（typecheck + 483 项测试 + 构建）与 `npm run verify:host`
>（把构建产物 `lib/index.js` 挂到假 Host 上，用真实 git 跑通全部路由，21/21）通过。
> 运行中的桌面端如需加载新的 Host 代码仍需重启一次（见「安装」末段）；v1.5 不涉及 Host 代码。

### v1.5.1 加载骨架细化（0.1.4）

按“X/Twitter 卡片列表加载”的视觉重做骨架屏：

- **灰块即布局**：`src/client/ui/skeleton.ts` 用灰色圆角块画出真实布局——
  - 时间线：140px 泳道画布占位 + 16px 头像 + 摘要/作者行 + 右侧 ±/文件数块，行高与真实 64px 行一致；
  - 卡片列表（审计/PR/boot）：34px 圆头像（可选）+ 两行文本块 + 右侧胶囊，无边框无文字；
  - 文件树：标题/工具/搜索/缩进文件行，冷启动与首次历史加载时保持两栏结构；
  - 热点：标题块 + 18×7 热力网格 + 条形图；待处理：三栏（文件列表 | Diff | 事实卡）。
- **白色扫光**：每块用 `::after` 铺一道 90° 白色微光（`color-mix` + `translateX(-100%→100%)`，
  1.5s ease-in-out 无限循环，负延迟保证第一帧就有光带），不额外增加 DOM。
- **交叉淡入淡出**：`SkeletonSwap` 在 loading 落下后保留骨架 260ms 播放淡出，真实内容同帧挂载并淡入；
  两层是 grid 同格叠放，且容器撑满内容区，所以**没有布局跳动**，骨架层 `pointer-events:none` 不挡交互。
- **无文字/无品牌**：骨架 DOM 全 `aria-hidden`，容器仅在加载中 `aria-busy`；冷启动时工具栏不渲染
  进度条/“正在更新…”胶囊，底部状态栏也换成灰块，整屏没有 loading 文案。
- 可访问性：`prefers-reduced-motion: reduce` 下 JS 直接切换、CSS 关闭扫光与淡入淡出；
  后台静默刷新已有数据时仍用原来的细进度条反馈，不闪骨架。
- 新增 `src/tests/client.skeleton.test.ts`（11 项）：两种 SkeletonSwap 状态、260ms 窗口、
  5 种 source 骨架无文本、树/时间线/卡片结构、样式扫光/淡入淡出/reduced-motion。
  效果截图（示例数据、非运行时录制）：`docs/ui-preview/loading-skeleton-light.png` /
  `loading-skeleton-dark.png`，由 `npm run preview:ui` 重新生成。

### v1.2 反馈修正（0.1.2）

- **热点页改成图表**：上半部分是提交活动**日历热力格子**（按 UTC 日期、最近 26 周；颜色深浅=当天提交数），
  下半部分是**文件条形图**（条长按当前指标，指标可切：提交次数 / 变更行数 / 作者数 / 最近变更），
  不是文件表格；点一条仍在时间线里定位该文件。
- **Commit 可用性**：待处理页新增「提交已暂存 / 暂存全部 / 取消暂存全部」。
  暂存也是显式写操作（预览 → 单次确认 → 审计），插件依然不会自动暂存；
  没有已暂存文件时「提交已暂存」禁用并给出具体指引，Host 的阻断原因也全部本地化，不再直接显示英文原句。
- **修复两个真实缺陷**：① 整侧工作区 Diff 里只要有一个二进制文件就被误判成“整份二进制”，
  导致体检显示“没有变更”；现在只有单文件请求才按二进制返回。② 会话归因在真实 Cordis Host 上
  通过 `ctx.get('sessions')` 读取活动会话，不再误报“无法读取当前会话”。
- 前端翻译增加二次插值兜底：即使某个 Host 版本的 bound translator 忽略参数，
  `{count}` 一类占位符也不会漏到界面上。

### v1.4 数据看板（0.1.2）

- **热点页新增「活动日历」维度并默认进入**：26 周日历热力图展示每天的代码修改量（新增+删除行数）
  与推送次数，两指标一键切换；`√` 比例分档、悬停同时显示当天行数/提交数/推送数，
  右侧摘要卡给出本期总量、活跃天数、峰值日与最活跃文件，扫描窗口外的日期显示为淡格而不是伪造零。
- **推送口径如实标注**：git 没有本地推送日志，推送次数只统计本插件审计里**成功**的推送操作
  （失败/进行中不计），并在图上写明来源与已加载的操作条数；Host 无法读取外部推送事件，
  因此不把提交数冒充推送数。
- **长列表滚动修复**：看板改为页面级滚动，代码榜/动态流很长时页脚不再被内容覆盖（此前 flex 子项收缩导致）。
- **PR 合并数据分析**：拉取请求页新增合并看板（开放/可合并/有冲突/待处理/近 30 天已合并五张卡片兼筛选器、
  作者榜、最近 8 周合并趋势）；Host 在打开洞察时额外读取最近合并/关闭的 PR（默认 30 天、上限 90 天、
  最多 40 条），窗口/截断/匿名状态都如实标注，未认证不伪造可合并性。
- **配色与主题解耦**：实测宿主 `--dsw-alias-brand-primary` 是**单色**（浅色近黑 `#0f1115`、深色近白），
  之前用它混出的日历热力/进度条在真实主题里变成灰阶；现在图表统一使用显式 `--dvt-data-blue`
  (`hsl(217 82% 56%)`) 与 `--dvt-data-purple` (`hsl(262 78% 62%)`)，日历时序热力、文件/作者条、
  悬浮 3px 指示线在明暗主题下都保持设计色（已用真实主题 token 渲染验证）。

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

安装后：会话顶部视图行出现「代码时间线」页签（右侧栏的 tab 类型同时注册，当前侧栏未暴露入口）；
重启或重新挂载不需要重建代码（构建产物已提交在 `lib/`）。

> 首次安装或重新构建后，请在 DSH 页面按一次 `F5` 刷新，让浏览器加载最新的前端 bundle
> （页签的 slot 注册是热生效的，但面板代码属于页面模块，需要刷新才能换成新版本）。
> v1.5 的动态加载/热加载**全部在浏览器半**（`src/client/cache.ts`、`src/client/sync.ts`），
> `F5` 后即生效，不需要重启桌面端。
> **Host 侧改动（`src/host/**`、新路由）才需要重启 DSH 桌面端**：Host 代码在进程启动时载入，
> 刷新页面只更新浏览器半。重启后可用 `npm run verify:live http://127.0.0.1:<port>` 对运行中的
> 实例做端到端验收（v1.1 已把新路由加入该脚本）。

卸载：

```powershell
plugin_manager remove_bundle target="dsh-vcs-timeline"
```

审计数据保存在 `%DSH_HOME%\storages\dsh-vcs-timeline\`（本机为
`C:\Users\Lenovo\.dsh\storages\dsh-vcs-timeline`），卸载插件不会删除该目录；需要清理时手动删除即可。

## 界面

页面化的开发者工具：极浅灰页面底、纯白卡片、柔和阴影、无硬边框，左侧 260px 文件树卡片 +
右侧主卡片（Header / 工具栏 / 泳道时间线 / 详情）。主入口是**对话区页签**（占据整个对话内容区）。
右侧栏的 tab 类型仍注册（窄栏备用），但当前桌面端侧栏的加页签入口没有暴露它，因此不把它算作可用入口。

- **对话区页签（主入口）**：与「对话 / 轨迹 / 上下文 / 编队」同一行，标签 `代码时间线`；
  点击后**整个对话内容区**切换为时间线视图（与「上下文」视图同一挂载方式），再点「对话」回到聊天。
  不再有悬浮在输入框上方的条带，也没有全屏浮层。
- **Header（58px）**：仓库图标 + 名称 + `GIT` 徽标 + 分支下拉（原生 select，键盘可用）·
  右侧 `拉取` / `推送` 按钮（先预览再确认）· 添加仓库 / 刷新 / `⋯` 版本控制菜单。
  Fetch / Pull / Commit / Push（SVN 为 Update / Commit）仍收在 `⋯` 菜单里。
- **工具栏**：`时间线 / 待处理 / 热点 / 拉取请求 / 审计` 胶囊页签（带条数）+
  搜索框 + `全部 / 当前分支` 胶囊切换 + 时间范围与「显示操作」开关。
- **多轨道泳道时间线（核心）**：真正的数据驱动泳道图，不是带装饰的列表。
  - 左侧固定 140px SVG 画布，轨道宽 40px，节点 X = `20 + lane * 40`；画布随轨道数变宽。
  - 同轨道用 `<line>` 垂直连线；跨轨道分叉/合流用三次贝塞尔
    `<path d="M prevX 0 C prevX H/4, x H/4, x H/2">`，线条取分支主题色、`strokeOpacity .5`。
  - 每个节点是绝对定位的圆点，`ring-4` 卡片色描边 + 高于 SVG 的 `z-index`，线条在节点处形成断点；
    合并提交为空心双环。轨道颜色：main 蓝 / feature 紫 / hotfix 玫红。
  - 顶部「分支轨道」图例（轨道色点 + 分支名 + 提交数）；按 `今天 / 昨天 / 日期` 分组，
    分组头 `position: sticky` + `backdrop-blur` 吸顶并显示当天提交数。
- **泳道行（谁、做了什么、什么时候）**：提交摘要 + 分支胶囊 + 合并/HEAD 胶囊 + 作者头像
  （姓名首字母、按姓名稳定着色）+ 作者名 + 相对时间（悬停精确时间）+ 等宽字体的短 hash +
  `+增` / `−删` / `N 个文件` 胶囊；行悬浮时背景微变、卡片阴影浮起、节点轻微放大。
  点行在下方详情面板打开提交/Diff，列表与左树不消失。
- **左侧 260px 文件树卡片**：顶部搜索框 + 变更统计胶囊（`+增`、`−删`、`N 个文件`）+
  状态筛选（`∗/M/A/D/R`，带计数）+ 目录计数、`A/M/D/R` 状态徽标；目录可展开/收起。
  窗口宽度 < 860px（右侧栏 400px 场景）时左树收起为抽屉，Header/工具栏自动换行压缩。
- **文件视图（点左树文件）**：右栏收窄为该文件历史，路径条显示**最近作者 + 相对时间 + 覆盖作者数**，
  下方直接展示**该文件最新一次提交的 Diff**；点其它提交行则在下方切换为该提交的详情。
- **拉取请求页签（含合并数据分析）**：顶部是合并看板——
  - 五个统计卡片兼筛选器：`开放` / `可合并`（mergeable 且无评审否决/CI 失败）/ `有冲突`（mergeable=false）/
    `需要处理`（按动作紧迫度）/ `最近 N 天已合并`；点卡片即筛选下方列表；
  - 作者榜：深底白字首字母头像 + `N PR · M 已合并` + 等宽 ±行数 + 紫色贡献微条（行数缺失显示"未提供"）；
  - 最近 8 周的合并趋势柱（蓝色），悬停给出周起始与次数；
  - 诚实边界：未认证时明确标注"合并状态/评审/CI 未知"，历史被截断时标注"只覆盖最近 N 天/最多 N 条"，
    Host 未返回合并历史时卡片显示"不可用"而不是 0。
  列表仍显示开放 PR、作者、head → base、评审/CI/可合并状态徽章，以及按紧迫度排序的
  「需要我评审 / 需要我处理反馈 / 可以合并 / 需要修复 CI / 需要解决冲突 / 等待中」动作；
  PR 详情在下方分栏展示描述、评审列表、检查列表与变更文件，并可跳转浏览器；未配置凭据时明确提示来源。
- **审计可视化**：顶部状态计数 chips（成功/失败/未知/运行中/部分，点击筛选）、记录数摘要；
  记录详情包含操作、状态、退出码、correlationId、前后 revision、耗时。
- **双栏主体**：
  - 左栏**文件树**（260px 白色卡片）：目录显示其下变更文件数，文件显示 `A/M/D/R` 状态字母；
    支持展开/收起、展开全部/收起全部、文件名搜索、状态筛选（`∗/M/A/D/R`，带计数）；
    顶部“全部文件”行取消文件选择，回到整个仓库的时间线。
  - 右栏在选中文件后由时间线收窄为该文件历史，顶部出现路径条（状态、提交数、`×` 返回全部）。
  - 两栏共用同一份过滤状态与同一页已加载历史：目录计数、时间线行、状态计数永远一致。
    窗口只覆盖已加载的提交（分页加载更多会扩大范围），界面明确提示这一点。
- **详情与 Diff 留在双栏内**：点提交 → 右栏显示 32px 面包屑 + 元信息网格 + 变更文件列表；
  点文件 → 行号 Diff。左栏树始终可见，不跳到占满页面的元数据页。
- **统一过滤条**：提交搜索（说明/作者，Host 侧 grep）、`全部/提交` 事件类型、
  时间范围（全部/近 24 小时/近 7 天/近 30 天，Host 侧 `--since`）、作者；
  v1.1 增加「仅当前分支 / 全部分支」、分支标签筛选 chip（带清除）、「显示操作」开关。
- **来源页签**：`时间线` / `待处理` / `热点` / `PR` / `审计`，各带条数；五类数据的来源与计数互不混用。
- **待处理工作台（v1.1）**：左列按 冲突/已暂存/未暂存/未跟踪 分组列出脏文件；中间是选中文件的
  即时 Diff（未跟踪文件明确标注「整文件新增」）；右列三张事实卡：变更体检（可切已暂存/工作区）、
  本会话改动（推断）、分支洞察（领先/落后/未推送/潜在冲突）。v1.2 左列顶部增加
  「提交已暂存 / 暂存全部 / 取消暂存全部」，没暂存时直接说明原因。
- **Git 数据看板（热点页，v1.4）**：顶部胶囊分段控制器切换**四个维度**，四者共用同一扫描窗口但展示主体完全不同：
  - **活动日历**：26 周日历热力图，一格一天。指标可切「代码修改量」（当天新增 + 删除行数，来自 Host numstat 扫描）
    与「推送次数」（本插件审计记录里的成功推送；git 没有本地推送日志，所以明确标注来源，失败/进行中的推送不计）。
    条色按 `√` 比例分 5 档（无活动 / 4 档强度），悬停浮层同时给出当天行数、提交数与推送数；右侧摘要卡显示
    本期修改行数、推送次数、有提交天数、峰值日，以及最活跃文件 Top3；扫描窗口外的日期显示为淡格而不是"零活动"。
  - **文件 Churn**：按 churn 排名的文件榜。左侧等宽字体的代码路径（目录浅灰、文件名深色），右侧蓝色微型进度条，
    条尾是等宽数值；条长用 `Math.sqrt(value)/Math.sqrt(max)` 压缩长尾。
  - **作者排名**：深底白字彩色首字母头像 + 姓名 + 角色胶囊（按窗口内提交占比推导）+「N 次提交 · M 个文件」副标题，
    右侧紫色微型进度条与等宽行数贡献。
  - **最近动态**：GitHub 风格活动流（没有进度条）：彩色头像 + 竖轴、操作描述、提交标题、文件路径胶囊、时间/hash/±行。
  - 列表行悬浮时背景变浅灰并出现 **3px 品牌蓝内阴影指示线**；所有数值与路径使用等宽字体；点文件行回到时间线定位。
- **审计混排（v1.1）**：过滤条「显示操作」把插件审计节点插入提交时间线，节点用虚线卡 + 独立图标 +
  状态徽标，日分组头单独显示「N 次操作」，且**不计入提交数**。
- **状态栏**：工作区状态点（干净/有修改/冲突）、分支、变更数、VCS；
  右侧“诊断”展开插件/运行时/Git/SVN/工作区/数据目录/警告。
- **空状态区分**：未选择工作区 / 未检测到仓库 / Git/SVN 客户端缺失 / 空历史 /
  筛选无结果 / 文件窗口无变更 / 仓库尚无提交 / 数据源未提供文件清单 / 部分数据 / 请求失败。
  数据源未提供逐提交文件清单时，树明确说明原因，而不是显示“没有变更”。
- 明暗主题由 DSH 主题 token 自动适配；样式无字面颜色、无全局选择器：存量 `dvt-` 前缀 +
  新增泳道页面的 `.swl-` 前缀；窄栏用容器查询按**面板宽度**收缩（而非窗口宽度），400px 侧栏仍可读。
- **独立单文件组件**：`src/client/ui/swimlane.ts` 只依赖 React（`React.createElement`，无 JSX / 无 Tailwind），
  导出 `GitCommit` 数据结构、`assignLanes` / `nodeX` / `rowLinkPath` / `laneTrackWidth` 等纯函数、
  `SwimlaneTimeline` / `SwimlaneHeader` / `SwimlaneToolbar` / `SwimlaneShell`，以及带 Mock 数据的
  完整页面 `SwimlaneDemo`；拷到任意 React 18 应用即可运行（`SWIMLANE_STYLES` 自带主题变量回退）。

设计验证截图（示例数据渲染，非运行时截图）见 [docs/ui-preview/render.md](docs/ui-preview/render.md)：
`npm run preview:ui` 可重新生成 400px 侧栏与 1600px 对话区宽度的明暗主题截图、
`swimlane-wide`（1440×900 独立页面）与 `swimlane-sidebar`（420×900 窄栏）两张泳道页截图、
热点看板的 `hotspot-calendar-{churn-light,pushes-light,churn-dark}` 与 `hotspot-calendar-sidebar`
四张日历热力图截图，以及 PR 合并看板的 `pr-dashboard-{light,conflicts-light,anonymous-light,dark}`
与 `pr-dashboard-sidebar` 五张截图。预览使用**真实宿主主题 token**（品牌色为单色近黑/近白），
因此截图能暴露/证明图表颜色不依赖品牌 token。

## 使用

1. 打开任意会话，点顶部视图行的「代码时间线」页签 → 对话内容区切换为时间线；再点「对话」回到聊天。
   插件加载后已在后台预热：第二次及以后点开是**无感**的（先显示内存里的历史，再在后台刷新，
   只有真正冷启动才出现骨架屏）。
2. 顶部选择仓库（Git/SVN · 名称 · 当前分支或 base revision）。
3. 右栏按日期分组浏览提交时间线：谁、什么时候、改了什么；点提交看详情与文件列表，点文件看行号 Diff。
4. 左栏点目录展开、点文件 → 右栏只剩该文件的变更历史，并显示最近作者 + 最新 Diff；
   点“全部文件”或路径条的 `×` 回到全部。
5. 「拉取请求」查看开放 PR、谁在等你、需要你做什么；未配置凭据时的提示见下文「PR 凭据」。
6. 「待处理」看待提交的脏文件、逐文件即时 Diff、提交前体检、本会话改动与分支洞察；
   没有已暂存文件时先点「暂存全部」（同样走预览 + 确认 + 审计），再点「提交已暂存」；
   提交前如果体检出现阻断项，commit 确认框会要求显式勾选「我已确认上述风险」。
7. 「热点」看提交活动日历热力与文件条形图，点一条回到时间线定位。
6. 「审计」查看本插件执行过的写操作（状态、退出码、前后 revision、correlationId）；顶部 chips 可按状态筛选。
7. 右上 `⋯` → Fetch / Pull / Push / Commit（SVN：Update / Commit）：先弹预览，
   显示将执行的确切 argv、当前分支/HEAD/干净状态/暂存数、警告；确认后才真正执行，
   执行结果追加审计。Commit 只提交**已暂存**的改动（插件从不自动 `git add`）。

## PR 凭据（GitHub / GitLab）

PR 的评审、CI、可合并状态需要访问令牌；插件按以下顺序读取（令牌永不展示/回传/写日志）：

1. 环境变量：`GITHUB_TOKEN` / `GH_TOKEN`（GitHub 仓库），`GITLAB_TOKEN` / `GL_TOKEN`（GitLab 仓库）
2. `~/.git-credentials`（`https://user:token@github.com` 形式的行，按远端 host 匹配）
3. `<数据目录>/pr-auth.json`，例如 `{"github":"<token>","gitlab":"<token>"}`
   （数据目录见状态栏“诊断”，本机为 `C:\Users\Lenovo\.dsh\storages\dsh-vcs-timeline`）

都没有时以**匿名**方式读取公开仓库：只显示基础信息（作者/分支/更新时间），评审/CI/可合并显示为未知，
并在页面提示凭据来源。当前验收机器的 **Host 进程无法访问 api.github.com**（直连 node 进程可以），
因此页面会显示「无法连接 GitHub/GitLab」网络错误态，这是环境的真实状态而不是插件伪造。

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
src/host/routes.ts               20 条 JSON 路由（v1.1 新增 4 条）+ 传输加固 + 错误映射
src/host/discovery.ts            工作区有界发现 + 路径闸门 + 仓库缓存
src/host/services/*.ts           只读服务（含 includeFiles 逐提交文件清单）/ 写服务（预览、token、审计、互斥）
src/host/pr/*                    拉取请求读取：远端解析、凭据链、GitHub GraphQL/REST、GitLab、动作推导
src/host/adapters/git/*          Git argv 构造与机器可读解析（log/name-status/numstat）+ 适配器
src/host/adapters/svn/*          无依赖 XML 读取 + SVN argv/解析（log -v 逐路径映射）+ 适配器
src/host/storage/jsonl.ts        JSONL 存储（串行写、坏行容忍、轮转、索引）
src/host/audit/*                 追加式审计写入
src/host/security.ts             脱敏、路径规范化、游标、UTF-8 截断
src/client/index.ts              对话区页签（conversation.view）+ 右侧栏页签注册 + 启动后台预热
src/client/cache.ts              动态加载的内存缓存：按 workspace/仓库保存只读切片 + 时间戳（LRU 8 仓库）
src/client/sync.ts               后台预热服务：激活即定时 warm、可见性/面板开关联动、失败指数退避、hydrate 快照
src/client/file-index.ts         文件中心索引：按提交聚合、目录树、共享过滤（纯函数）
src/client/graph.ts              多泳道提交图：父哈希 → 泳道/合并边（纯函数）
src/client/ui/graph.ts           提交图 SVG 渲染（节点/泳道/合并曲线）
src/client/ui/pr.ts              拉取请求列表与详情（动作、评审、CI、变更文件）
src/client/panel.ts              面板状态机（数据加载、写操作预览→确认→执行）
src/client/ui/*                  纯视图：工具栏、文件树、时间线、详情、Diff、审计、对话框
src/client/styles.ts             仅主题 token 的样式表（含容器查询窄栏适配）
src/tests/*                      单元 + 真实临时仓库集成 + SSR 渲染冒烟 + 路由/服务测试
docs/                            兼容性、架构、安全、测试报告
```

## 文档

- [docs/DSH-COMPATIBILITY.md](docs/DSH-COMPATIBILITY.md) — 0.2.1-rc.3 实际 API、证据与限制
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 分层、数据流、发现策略、存储、UI
- [docs/DYNAMIC-LOADING.md](docs/DYNAMIC-LOADING.md) — 动态加载/热加载：行业案例、缓存与时序、验收步骤、边界
- [docs/SECURITY.md](docs/SECURITY.md) — 威胁模型、强制措施、残余风险、检查清单
- [docs/TEST-REPORT.md](docs/TEST-REPORT.md) — 实际执行的命令、退出码、结果、未验证项

## 已知限制

- 本机 `E:\softData\TortoiseSVN` 只装了 GUI 组件，`bin/` 里**没有 `svn.exe`**（TortoiseSVN 的
  command line client tools 未安装），PATH 也没有 svn。SVN 仅完成解析器/命令行/降级路径的单元测试，
  未做真实仓库联调；v1.1 的热点排行对 SVN 如实返回 `available:false`，不伪造行数。
- v1.1 的会话归因只读**当前 Host 进程内的活动会话**；历史会话是 zstd 内部存档，不猜格式，返回不可用。
  归因一律标注「推断」，提交行只有在提交哈希与插件审计完全一致时才标「插件提交」。
- **插件不会自动暂存**：v1.2 提供「暂存全部 / 取消暂存全部」显式动作（同样预览 + 单次确认 + 审计），
  SVN 没有暂存区，因此 SVN 仓库上不提供这两个动作；commit 仍只提交已暂存内容。
- 热点统计只覆盖扫描窗口（默认 500 次提交、上限 2000），窗口不足时显示「历史长于扫描窗口」；
  merge 提交计入窗口（`mergesIncluded: true`），文件行数只累加 VCS 真实给出的 numstat；
  活动日历显示的 26 周以 Host 返回的最新一天为锚点，窗口外的日子留空而不是补零。
- 待处理工作台的即时 Diff 与体检只覆盖工作区/索引的实际内容：未跟踪文件可单文件查看，
  但**不进入整文件体检**（会以 `untracked-skipped` 如实提示）。
- 真实页面已用 Playwright + Edge 对运行中的桌面端自动化核对（对话区页签、时间线、双栏、筛选、
  详情/Diff、关闭路径、1280/900 尺寸、深色主题，见 [docs/TEST-REPORT.md](docs/TEST-REPORT.md) §6），
  但仍是脚本化的 DOM/计算样式/截图核对，不是人工逐像素签收。v1.1 的 Host 侧需要重启桌面端后才能
  在真实页面验收；本轮用 `npm run verify:host`（构建产物 + 真实 git）覆盖路由级验收。
- 文件树与单文件时间线只覆盖**已加载的提交页**（列表底部明确提示；加载更多会扩大范围）。
- **动态加载的边界**：内存缓存只在当前页面生命周期内有效，`F5`/关窗即清空，不跨窗口、不写磁盘；
  后台预热只覆盖“上次看过的仓库”一个（LRU 最多缓存 8 个仓库的历史），多仓库切换仍走首次加载；
  PR 列表与热点不会在面板关闭时自动预热（前者需要网络/令牌，后者是重扫描），只在打开对应页签时
  加载并随后台刷新；面板打开期间的 10s 状态探测依赖 `git status`，超大仓库上仍有可感知的 Host 开销。
  若右侧栏页签与对话区页签**同时**挂载两个面板实例，任一实例关闭都会让后台预热恢复（面板开关是
  布尔值，未做实例计数）——当前桌面端侧栏没有暴露该入口，实际只会有对话区一个实例。
- PR 评审/CI/可合并状态需要令牌；当前机器 Host 进程无外网访问，PR 页显示网络错误态（已在文档/UI 说明）。
- 提交图为单页推导：页面截断时首行泳道从当前页开始（不越界读取上一页），跨页泳道可能不从顶部延续。
- 详情分栏高度固定为面板高度的 42%（可读性优先），暂不支持拖拽调整。
- 未做整进程重启验证（已验证插件重新挂载后审计数据仍可读）。
- `/vcs` 路由仅接受 loopback（桌面端）；配对设备远程访问不支持。
- 右侧栏的「代码时间线」tab 类型已注册，但当前桌面端侧栏的加页签 UI 未暴露该类型入口；
  主入口是对话区页签（未做侧栏可达性验收）。
- Merge/Rebase/Switch/Reset/Clean/Force-push 不实现。
