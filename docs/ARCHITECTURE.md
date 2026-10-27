# 架构说明（dsh-vcs-timeline）

## 1. 定位与边界

插件在 DSH 里提供**文件为中心**的版本视图，两个入口共用同一个面板：
顶部视图行的**对话区页签**「代码时间线」（与 对话/轨迹/上下文/编队 同排，占据整个对话内容区）。
右侧栏的 tab 类型仍保留注册（窄栏备用），但当前桌面端侧栏没有暴露该类型入口。
统一查看 **Git / SVN 仓库历史与逐文件变更**，以及**本插件自己发起的 VCS 操作审计**。
两类事实在数据模型和 UI 上都严格区分：

| 事实来源 | 数据 | 可信度 |
| --- | --- | --- |
| `repository` | 仓库历史（commit / revision）与逐文件变更 | 由 Git/SVN 自身提供，是版本事实 |
| `plugin-audit` | 本插件预览、执行的操作与结果 | 只覆盖本插件实际发起并观察到的操作 |
| `external-observation` | 外部终端/IDE 操作（首版不实现） | 若将来实现必须标记为推断，不能冒充审计 |

插件不声称能捕获用户在外部终端执行的操作；不修改仓库历史；不做 reset/clean/force-push；
不自动 stash、不自动解决冲突；不把 Git commit 与 push 混为一谈，也不把 SVN update 当成 commit。

## 2. 分层

```
Client (浏览器)                          Host (DSH 主进程)
┌──────────────────────────┐   POST     ┌───────────────────────────────────────────┐
│ src/client/index.ts      │  JSON      │ src/host/index.ts  (ctx.effect 生命周期)   │
│  ├ tab 类型+标题+正文注册 │  /vcs/*    │  ├ routes.ts        13 条路由 + 传输加固    │
│  ├ conversation.view 页签  │ ─────────► │  ├ services/timeline-service.ts  只读服务   │
│  ├ panel.ts 状态编排      │ ◄───────── │  ├ services/operation-service.ts 写服务     │
│  ├ file-index.ts 文件索引 │  信封      │  ├ discovery.ts     仓库发现 + 路径闸门     │
│  ├ components.ts 纯视图   │            │  ├ adapters/git/**  Git 适配器              │
│  ├ api.ts 信封客户端      │            │  ├ adapters/svn/**  SVN 适配器              │
│  ├ i18n.ts / format.ts    │            │  ├ storage/jsonl.ts  JSONL 存储             │
│  └ styles.ts (token only) │            │  ├ audit/audit-service.ts 追加式审计        │
└──────────────────────────┘            │  └ security.ts      脱敏/路径/游标/截断     │
                                        └───────────────────────────────────────────┘
```

- Client **没有**文件系统或进程能力，只通过 13 条 `/vcs` 路由请求数据；
  写操作必须携带预览阶段签发的单次确认 token。
- Host 负责路径校验、命令构造（argv 数组）、输出限额、超时、脱敏、审计持久化。
- **双栏是派生视图，不是独立数据源**：`file-index.ts` 把一页已加载历史聚合成文件条目、
  目录树和过滤后的提交行；两个栏位都从同一个结果渲染，因此不存在“树里有、列表里没有”的分叉。

## 3. 数据流

### 3.1 只读

```
选中会话 → session cwd → POST vcs/repos/list {workspacePath}
  → discovery: 校验 path 属于已注册工作区 → 在工作区内有界扫描（深度 3，跳过 node_modules/.git 等）
  → 每个根用 adapter.info() 读取元信息（分支、HEAD、远端、默认分支）
  → 返回 Repository[] + Diagnostics
POST vcs/timeline {repositoryId, cursor, filters, includeFiles:true}
  → registry.gate(repositoryId)（重新 realpath + 重校验工作区归属 + 重新识别 VCS）
  → adapter.history() → git log（NUL 分隔、机器可读）+ 同参数的 numstat 统计命令
     （includeFiles 时再加一次同窗口的 --name-status）
  → VcsEvent[]（source: 'repository'，metadata 带真实 filesChanged/±行数，
    changedFiles 带逐文件 status/±/binary；超出上限只置 changedFilesTruncated）
  → nextCursor
  → Client：file-index.ts 聚合为文件条目 + 目录树；左右两栏从同一结果派生
POST vcs/changeset / vcs/diff / vcs/status
  → adapter.changeSet() / diff() / status() → 文件状态、统一 diff 文本、工作区状态
```

**对话区页签**（`conversation.view`）只负责注册一个 View 与标签；
选中后宿主用本插件的面板替换对话内容区，面板自己按会话 cwd 加载仓库与历史。
它与右侧栏页签渲染同一组件，区别只是可用宽度（容器查询按面板宽度收缩）。

### 3.2 写操作（预览 → 确认 → 执行）

```
POST vcs/op/preview {repositoryId, operation, params}
  → adapter.beforeState() 读取分支/HEAD/干净状态/暂存列表/ahead-behind
  → adapter.planOperation() 产出**精确 argv**，或明确 blockedReason
  → 生成单次 token（120s TTL，绑定 repo+operation+paramsHash+argv），返回预览
POST vcs/op/execute {..., confirmationToken}
  → token 校验（存在、未过期、未使用、repo/operation/params 一致）
  → 重新读取 beforeState 并**重新 plan**；argv 与预览不一致则拒绝（状态已变）
  → audit.start() 先落盘 started 记录（写失败则拒绝执行）
  → runner.run(argv) 执行
  → 读取 afterState（best effort）→ 判定状态：
       exit 0 → succeeded（网络操作为 confirmed-success）
       超时/被杀/exit null → 网络操作 unknown（远端结果未知），本地操作 failed
       非 0 退出 → failed（网络操作为 confirmed-failure）
  → audit.finish() 追加终态记录；追加 plugin-audit VcsEvent
```

单仓库同时只允许一个写操作（内存互斥）。token 用后即焚，参数变化后必须重新预览。

## 4. VCS 适配器

统一接口 `VcsAdapter`（`src/host/adapters/types.ts`）：`detect / info / history / changeSet / diff / status /
beforeState / planOperation`。各自保留语义：

| | Git | SVN |
| --- | --- | --- |
| 标识 | commit hash（40/64 hex） | revision 数字字符串 |
| 历史 | `git log --no-color -z --format=...`（NUL 分隔，含 %D 分支装饰） | `svn log --xml -v -r HEAD:1 -l N`（游标为 revision） |
| 变更文件 | `--name-status -z` + `--numstat -z`（重命名、二进制 `-`）；history 的 `includeFiles` 复用同窗口命令 | `svn log -v --xml`（逐路径 action/copyfrom 直接映射）+ `diff --summarize` |
| Diff | `git show` / `git diff`（`-U<n>`） | `svn diff -c` / `svn diff -r` |
| 工作区 | `status --porcelain=v2 -z --branch`（v1 兜底） | `svn status --xml` |
| 写操作 | fetch / pull --ff-only / commit（仅已暂存）/ push（仅当前分支） | update / commit |

所有命令：argv 数组、无 shell、`--no-pager`、`-c core.quotepath=false`、
`-c i18n.logOutputEncoding=UTF-8`、`--non-interactive`（SVN）、输出上限与超时。
用户输入（提交信息、远端、分支、文件路径、revision）从不进入 shell 字符串；
分支/远端名经过白名单字符校验，revision 只允许数字，路径必须留在仓库根内。

### 4.1 仓库发现策略

- 默认只扫描 DSH 已注册的工作区（`ctx.workspaceRegistry.list()`），**不扫描整盘**。
- 工作区根自身是仓库则直接采用；否则有界 BFS（深度 3、条目上限 4000），
  跳过 `node_modules`/`.git`/`dist`/`build`/隐藏目录等。
- **一旦识别为仓库根就不再向下钻取**：嵌套仓库不会被重复列出（避免把 monorepo 子仓库当独立条目）。
- 允许“手动添加”任意目录，但要求：目录存在、可解析、包含 `.git` 或 `.svn` 元数据，
  且在目录或其祖先中找到仓库根；添加后进入本次会话的 “granted roots”。
- 去重键 = `repositoryId(vcsType, canonicalRoot)`，Windows 下大小写不敏感。
- 所有后续操作都通过 `gate(repositoryId)`：重新 realpath、重新校验工作区归属/授权、
  重新确认 VCS 元数据仍然存在。防止 symlink 替换或目录换位后的越界访问。

## 5. 持久化（JSONL）

接口 `TimelineStore`（`src/host/storage/interface.ts`）隔离存储实现；业务与 UI 不直接触碰文件。

```
<DSH_HOME>/storages/dsh-vcs-timeline/
  repositories.jsonl   仓库快照（发现/添加时写入，去重折叠）
  events.jsonl         本插件操作产生的 VcsEvent（source: plugin-audit）
  changesets.jsonl     读取过的 ChangeSet 缓存
  operations.jsonl     审计记录（追加式：started 一条，终态一条，同 id 折叠）
```

- 每行一个带 `schemaVersion: 1` 的 JSON 对象；UTF-8；按文件串行化写入（避免并发撕裂）。
- 写入失败必须抛错（审计写失败时**拒绝执行**该操作）；读取时容忍损坏行并降级为警告。
- 新增行索引（流式扫描 + 按需 JSON.parse）避免每次查询全量加载；文件超限时轮转为 `<name>.1.jsonl`。
- 审计永不篡改 `started` 记录：终态是**追加**记录，读取时按 id 折叠。
- 敏感信息（凭据、token、私钥、Authorization）在写入前脱敏；不保存完整命令输出，只保存摘要。

## 6. UI 结构（文件中心的双栏 IDE 面板）

设计目标：像一个成熟的开发者工具窗口（JetBrains Git 工具窗口 / IDEA 的 Log），
而不是管理后台。垂直空间优先给文件树和时间线，装饰性卡片全部去掉，分区只用 1px 分隔线；
颜色只来自 `--dsw-alias-*` / `--dsw-specific-*` token，因此明暗主题自动成立。

```
入口：顶部视图行页签（conversation.view，id vcs-timeline，order 40，label 代码时间线）
  —— 与 对话 / 轨迹 / 上下文 / 编队 同排；选中后整个对话内容区渲染本面板
（右侧栏 sidebar.right.pane.tab 的 key vcs-timeline 仍注册，当前桌面端侧栏未暴露入口）

dvt-root (flex column, 100%, overflow hidden)
├─ <style>                     组件样式（dvt- 前缀，仅主题 token）
├─ dvt-chrome
│   ├─ dvt-toolbar (34px)      仓库选择（原生 select 覆盖层）+ 分支 chip + 刷新 + “⋯”
│   ├─ dvt-menu (popover)      Fetch / Pull / Commit / Push 分组菜单（SVN: Update / Commit）
│   ├─ dvt-tabstrip (30px)     来源页签：时间线（提交数）/ 审计（记录数）
│   └─ dvt-filterbar (28px)    搜索框 + 全部/提交 chip + 时间范围 select + 筛选按钮（作者输入）
├─ dvt-body
│   └─ dvt-split (container-type: inline-size)   ← 双栏，容器查询按面板宽度收缩
│      ├─ dvt-tree (160–300px) 左栏文件树
│      │   ├─ 头部             “文件 N” + 展开全部/收起全部
│      │   ├─ 文件名搜索        （client-side，匹配路径与重命名旧路径）
│      │   ├─ 状态筛选          ∗ 全部 / M / A / D / R，各带计数（0 计数的隐藏）
│      │   └─ 树               “全部文件”入口 + 目录（计数）/ 文件（A/M/D/R、×N 变更次数）
│      └─ dvt-pane            右栏
│          ├─ dvt-pinned       详情/Diff 的 32px 面包屑（返回 + 标题 + 副标题 + 状态徽标）
│          └─ dvt-scroll
│              ├─ dvt-selection  选中文件时的 26px 路径条（状态/提交数/×）
│              ├─ 变更时间线   IDEA 风格竖轴：连续 rail + 每提交节点（合并空心）
│              │                日期分组头（今天/昨天/日期 + 条数，吸顶）
│              │                每行：头像(姓名首字母,按名稳定着色) + 作者 + 摘要 + ±
│              │                第二行：相对时间(悬停精确时间) · hash · HEAD · 分支 · 文件数
│              │                选中文件时为该文件状态与 ± 行
│              ├─ 提交详情     hero 摘要 + 元信息网格 + 变更文件（状态字母/重命名旧路径/BIN/±行）
│              ├─ Diff         行号槽 + 统一 diff 着色 + 底部（路径/行数/字节/截断）
│              ├─ 审计列表     状态图标 + 操作 · 仓库 + 时间/correlation + 状态徽标
│              └─ 空/错误/加载  区分：无工作区、未检测到仓库、客户端缺失、空历史、
│                              筛选无结果、文件窗口无变更、仓库尚无提交、
│                              数据源未提供文件清单、部分数据、请求失败、加载骨架
├─ dvt-diag (可折叠)           插件/运行时/Git/SVN/工作区/数据目录/警告
├─ dvt-statusbar (24px)        工作区状态点 + 分支 + 变更数/冲突 + VCS + 诊断开关
└─ dvt-dialog (面板内 absolute overlay，非全屏模态)
```

关键取舍：

- **两栏共享一套过滤状态**：`file-index.ts` 从 `timeline.events[].changedFiles` 聚合出
  文件条目（最新状态、变更次数、累计 ± 行）和目录计数；树的搜索/状态筛选与右栏的行过滤
  都是同一份 `visibleFiles` / `visibleEvents`，所以计数与行永远一致，无法用假数据圆场。
- **文件历史窗口是显式的**：树和时间线只覆盖已加载的提交页（分页“加载更多”扩大范围）；
  列表底部明确写出“文件索引覆盖已加载的 N 次提交”，不暗示扫描了全部历史。
- **写操作不再占卡片**：收进头部 “⋯” 菜单，点击后仍走同一套
  “预览 → 单次 token → 确认执行” 流程，危险操作确认没有削弱。
- **详情是右栏内的“编辑器页”**：面包屑固定、内容滚动，左栏树始终可见；
  对话框也限制在面板内（`position:absolute`），不会像全屏模态那样盖住整个应用。
- **逐提交文件清单是真实数据**：Git 历史为每页额外执行一次
  `git log --name-status -z --format=<SOH>%H`（与主查询同 filters/skip/limit），
  与已有 numstat 流按新路径合并成 `changedFiles`（状态、±、binary，重命名带 oldPath）；
  SVN 由 `svn log --xml -v` 的逐路径 action/copyfrom 映射（A/M/D/R，复制源被删除时判为 rename）。
  merge commit 的 name-status 为空 → `changedFiles: []`，不臆造文件。
- **入口是一个 View，不是浮层**：`conversation.view` 让面板像「上下文」一样占据对话内容区，
  聊天记录与输入框不受影响；切回「对话」即恢复聊天，不存在覆盖层或焦点陷阱。
- **容器查询而非媒体查询**：侧栏宽度与窗口宽度无关，`@container (max-width: 520px)`
  按**面板**宽度隐藏行内分支标签等次要信息；400px 侧栏仍可读，1600px 对话区不浪费空间。
- **时间线优先**：竖轴 + 日期分组让"谁在什么时候做了什么"一眼可读；行高约 51px（两行），
  树行 23px、详情文件行 26px、Diff 行 16px；控件高度统一 22/24px；
  字号层级 12 / 11.5 / 10.5 / 10px；圆角 3–8px。


## 7. 关键不变量

1. 只读与写操作彻底分离；写操作必须经过预览 + 单次 token。
2. 审计先于执行落盘；失败也保留记录；远端结果不确定时记为 `unknown`，不伪装成成功/失败。
3. 任何路径在使用前都经过 gate；任何命令都不经过 shell。
4. 仓库历史来自 VCS；插件审计只描述插件自己的操作，两者在 UI 上有来源徽标。
5. 客户端不可传入任意命令、任意工作区外的路径或任意 revision 语法。
6. 左右两栏由同一份派生视图渲染：目录计数、状态计数、时间线行必须能互相解释；
   未提供的数据显示为“未提供”，绝不补零或编造文件/提交。
