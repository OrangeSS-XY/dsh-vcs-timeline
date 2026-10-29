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
│  ├ tab 类型+标题+正文注册 │  /vcs/*    │  ├ routes.ts        20 条路由 + 传输加固    │
│  ├ conversation.view 页签  │ ─────────► │  ├ services/timeline-service.ts  只读服务   │
│  ├ panel.ts 状态编排      │ ◄───────── │  ├ services/operation-service.ts 写服务     │
│  ├ file-index.ts 文件索引 │  信封      │  ├ checks/service.ts 提交前体检             │
│  ├ graph.ts 多泳道路由     │            │  ├ stats/service.ts 热点统计 + 缓存          │
│  ├ ui/fileinfo.ts 文件活动 │            │  ├ session/changes.ts 会话归因（推断）       │
│  ├ ui/workbench.ts 待处理  │            │  ├ discovery.ts     仓库发现 + 路径闸门     │
│  ├ ui/hotspots.ts 数据看板 │            │  ├ pr/*             PR 读取（远端/凭据/API）  │
│  ├ ui/addrepo.ts 添加仓库  │            │  ├ branch/*         本地分支洞察（离线 PR）  │
│  ├ components.ts 纯视图   │            │  ├ toolchain.ts     可执行文件探测/vcs-config │
│  ├ api.ts 信封客户端      │            │  ├ adapters/git/**  Git 适配器              │
│  ├ i18n.ts / format.ts    │            │  ├ adapters/svn/**  SVN 适配器              │
│  └ styles.ts (token only) │            │  ├ storage/jsonl.ts  JSONL 存储             │
└──────────────────────────┘            │  ├ audit/audit-service.ts 追加式审计        │
                                        │  └ security.ts      脱敏/路径/游标/截断     │
                                        └───────────────────────────────────────────┘
```

- Client **没有**文件系统或进程能力，只通过 20 条 `/vcs` 路由请求数据；
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

```
POST vcs/pr/list {repositoryId, refresh?, includeClosed?, windowDays?}
  → registry.gate(repositoryId) → 读取 origin 远端（git config，凭据剥离）
  → 识别 provider（github/gitlab）→ 凭据链（env → ~/.git-credentials → pr-auth.json → 匿名）
  → 有令牌：GitHub GraphQL 一次调用拿到 viewer/PR/评审/CI/可合并；无令牌：匿名 REST 基础字段
  → includeClosed（默认 true）时并发再读最近 MERGED/CLOSED 历史（默认 30 天、clamp 到 90 天、
    最多 40 条），映射 mergedAt/closedAt，按窗口过滤、按 number 去重（open 优先）；
    历史读失败只降级为 open + warning，不失败整个列表
  → 纯函数 deriveActions(PR 事实, viewer) → 「需要我做什么」
  → 60s 列表缓存（key 含 includeClosed+windowDays，open-only 与洞察读不会互相污染）；
    令牌永不出现在返回值/错误/日志中
```

```
POST vcs/branch/compare {repositoryId, baseBranch?}
  → registry.gate → git 本地计算：current、base（query → default → main/master）、
    rev-list 领先/落后、log（领先提交，≤30）、shortstat（文件/±）、merge-tree（潜在冲突）、
    上游（@{u} + 未推送计数）→ 纯函数动作表 push/create-pr/pull/fix-conflicts/wait
  → SVN 返回 available:false（不伪造分支语义）；空仓库/分离 HEAD 不抛错
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

### 3.3 v1.1 只读扩展（工作台 / 体检 / 会话归因 / 热点 / 分支筛选）

```
POST vcs/worktree/diff {repositoryId, filePath?, staged?}
  → gate → adapter.worktreeDiff：staged 用 git diff --cached，未暂存用 git diff
  → 单文件且未被索引跟踪 → 直接读该文件（bounded，仓库根内），合成「整文件新增」diff，
     kind=untracked；二进制识别；SVN 无暂存区时 staged=true 直接返回 invalid-request
POST vcs/checks {repositoryId, staged?}
  → adapter.worktreeDiff 整个一侧 → checks/rules.ts 纯规则引擎（冲突标记/私钥/疑似密钥/
    锁文件/删测试/二进制/超大变更）→ 服务层补 untracked-skipped、truncated、svn 无暂存区警告
POST vcs/session/changes {repositoryId, sessionId?}
  → ctx.sessions.get(sessionId)（只读活动会话；未注册/非活动 → available:false + 原因）
  → 两遍扫描：tool/result 按 callId 记录是否失败；tool/call 只取白名单写文件工具且 result 成功
  → 参数 file_path/filePath/path/... → 绝对化（会话 header.cwd）→ isInside(repo root) →
     仓库相对路径；聚合 touches/lastToolAt；上限 500；confidence 恒为 inferred
POST vcs/stats/hotspots {repositoryId, limit?, maxCommits?}
  → 仅 Git：同窗口两条 git log（numstat + hash/author/date/parents），请求 maxCommits+1 判截断
  → 聚合 commits/additions/deletions/churn/authors/lastChanged，并按 UTC 日期聚合 daily 桶
  → churn 排序；上限 100 行；60s 进程内缓存（≤32 条，命中 cached:true）
  → 报告带 scope{branch, mergesIncluded, windowCommits, since}
  → SVN：不跑命令，available:false + unsupportedReason
POST vcs/op/preview + vcs/op/execute {operation: 'stage' | 'unstage'}
  → 与其它写操作同一条「预览 → 单次 token → 执行 → 审计」管线
  → stage：git add -A 或 git add -- <仓库相对路径>；unstage：git restore --staged -- .
  → 插件不会自动暂存；只有用户点「暂存全部 / 取消暂存全部」才会产生这两个操作
  → SVN 没有暂存区：适配器给出 blockedReason，客户端本地化提示
POST vcs/timeline {…, branch?, branchScope?}
  → 分支名先过 isSafeBranchName/commit-hash 校验 → git log <ref>；branchScope=all → --branches
  → SVN 无分支引用：忽略过滤并返回 warnings（不伪造分支语义）
```

UI 侧（`panel.ts` 状态编排）：

- 来源页签从 3 个扩到 5 个：`时间线 / 待处理 / 热点 / PR / 审计`（Alt+1…5）。
- 待处理工作台是三栏派生视图：左列直接由 `WorkingTreeStatus.entries` 分组（冲突优先于暂存/未暂存/
  未跟踪，SVN 无 staged 字段时归入未暂存），中列即时 Diff，右列体检/会话归因/分支洞察三张卡；
  左列顶部是「提交已暂存 / 暂存全部 / 取消暂存全部」，没有已暂存文件时提交按钮禁用并说明原因。
- 热点来源是**多维度数据看板**（`ui/hotspots.ts`）：顶部胶囊分段控制器切换四个展示主体，
  四者共用同一扫描窗口但**渲染完全不同的 body**——`calendar` 是 26 周日历热力图（按 UTC 日桶，
  指标可切代码修改量 / 推送次数）、`files` 是 churn 文件榜（蓝色 √ 比例微条）、
  `authors` 是贡献者榜（深底白字头像 + 派生角色 + 紫色微条）、`activity` 是 GitHub 风格活动流
  （无进度条，头像 + 竖轴 + 操作描述 + 文件路径胶囊 + 时间/hash/±行）。日历的推送次数来自
  **本插件审计**里成功的 `push` 操作（git 无本地推送日志，失败/进行中不计）；代码修改量来自
  `HotspotReport.daily` 的 numstat 汇总。维度是 `hotspots.dimension`，日历指标是
  `hotspots.calendarMetric`，两者都只是纯渲染状态。
- 提交确认框里 Host 的 `blockedReason` 经 `blockedReasonLabel` 映射成本地化句子，
  未识别的理由回退原文（不隐藏原因）。
- 体检结果同时出现在提交确认框：存在 `blocking` 项时确认按钮禁用，必须勾选「我已确认上述风险」；
  勾选状态随预览重建重置，不跨操作复用。
- 审计节点只在时间线来源、且用户打开「显示操作」时混排；节点用独立图标/虚线卡/状态徽标与
  「N 次操作」日计数，`timeline.events` 与提交计数不变。
- 归因徽标：提交哈希命中审计 `afterRevision` → 「插件提交」（精确）；否则当该提交的全部变更文件
  都出现在本会话 `session/changes` 里 → 「本会话(推断)」；两者都不满足不显示。

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

### 4.1 PR / MR 提供方（只读）

| | GitHub | GitLab |
| --- | --- | --- |
| 远端解析 | `https://github.com/owner/repo(.git)`、`git@github.com:owner/repo.git`、`ssh://…` | 同上，host 含 gitlab |
| 列表（有令牌） | GraphQL `repository.pullRequests` 一次调用：评审决策、评审请求、review 列表、CI rollup、可合并、行数/文件数/提交数 | REST `/merge_requests`（PRIVATE-TOKEN），评审/CI 只取能如实映射的字段 |
| 列表（匿名） | REST `/repos/{owner}/{repo}/pulls`，只映射基础字段；评审/CI 为空、可合并未知 | 私有项目 → auth-required；公开项目基础字段 |
| 合并历史（洞察） | `includeClosed`：第二次 GraphQL（`states:[MERGED,CLOSED]`，`UPDATED_AT DESC`，first 40）或匿名 REST `state=closed`；映射 `mergedAt/closedAt`，窗口内去重合并 | `state=merged` + `state=closed` 两次列表（`updated_after=<窗口起始>`，per_page 40）；映射 `merged_at/closed_at`，合并后受本地 40 条上限约束 |
| 详情 | PR 描述 + `/pulls/{n}/files`（≤100 文件） | `/merge_requests/{iid}` + `/diffs` |
| 凭据 | `GITHUB_TOKEN`/`GH_TOKEN` → `~/.git-credentials` → `<dataDir>/pr-auth.json` → 匿名 | `GITLAB_TOKEN`/`GL_TOKEN` 同上 |
| 失败映射 | 401/403（非限流）→ auth-required；限流 → rate-limited（附 resetAt）；网络/超时 → network-unknown；>1MiB → output-too-large | 同左 |

- **动作推导是纯函数**（`src/host/pr/actions.ts`）：只依据真实读到的评审请求、评审决策、CI、可合并性
  给出 review / address-feedback / merge / fix-ci / fix-conflicts / wait / unknown 之一；
  未认证时只给 `unknown` + `needs-auth`，绝不猜测。
- **合并洞察也是纯函数**（`src/client/ui/pr.ts`）：`mergeReadiness` 只把「open 且 mergeable=true 且
  无 changes-requested/CI 失败」算作可合并；`summarizePullRequests` 从 Host 返回的 open+历史列表
  计算开放/可合并/冲突/待处理/已合并、作者榜与 8 周趋势。历史未返回时 `merged` 标记 unavailable，
  不把"没读到"渲染成 0；`historyTruncated`/匿名状态都在界面上标注。
- **安全**：令牌只进入请求头；不写日志、不返回、不进缓存；错误文本经 `redact`；
  fetch 有 10s 超时、1 MiB 响应上限、2 并发闸门。
- **本机事实**：Host 进程出网到 api.github.com 超时（直接 node 进程可通），匿名也无令牌可用，
  因此真实页面显示 network-unknown 错误态；这一限制已写进 README/TEST-REPORT。

### 4.2 本地分支洞察与工具链（离线能力）

- **本地分支洞察**（`src/host/branch/*`）：只用本地 git 计算「当前分支 vs 基准分支」的领先/落后、
  领先提交列表、变更文件/±、`merge-tree` 潜在冲突、上游未推送数，并推导
  push / create-pr / pull / fix-conflicts / wait 动作。它让 PR 页在无网络/无令牌时仍然可读
  （客户端以「本地分支洞察」卡片展示；有真实 PR 时退化为列表上方一条紧凑条）。
- **可执行文件探测与配置**（`src/host/toolchain.ts`）：挂载时按 `<dataDir>/vcs-config.json`
  → PATH → 常见 Windows 安装目录（Git / TortoiseSVN / SlikSVN / VisualSVN）解析 git/svn，
  `Runner` 在 argv[0] 为 `git`/`svn` 时改写为绝对路径；解析结果与失败原因进入诊断。
  可配置 `vcs-config.json` 固定）。本机 `E:\softData\TortoiseSVN` 只安装了 GUI 组件，
  `bin/` 中没有 `svn.exe`（官方安装器的 command line client tools 未勾选），因此探测链
  仍会如实报告 svn 缺失；SVN 配置 UI 属于下一批（v1.2）。
- **添加工作区之外的仓库**：发现只扫 DSH 工作区，客户端提供「添加仓库」对话框按路径加入
  （服务端仍校验 `.git`/`.svn` 元数据与路径闸门）；VCS 客户端缺失时 `add` 返回
  `vcs-not-installed` 并在界面给出安装/配置指引。

### 4.3 仓库发现策略

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

## 6. UI 结构（页面化的多轨道泳道时间线）

设计目标：像 Linear / GitKraken / GitHub Desktop 这类现代开发者工具，而不是管理后台。
页面上是「极浅灰页面底 + 纯白圆角卡片 + 柔和阴影」，没有生硬边框；左侧 260px 文件树卡片与
右侧主卡片用间距和圆角分隔。颜色只来自 `--dsw-alias-*` / `--dsw-specific-*` token
（`SWIMLANE_STYLES` 用 `hsl()` 回退值），因此明暗主题自动成立。

```
入口：顶部视图行页签（conversation.view，id vcs-timeline，order 40，label 代码时间线）
  —— 与 对话 / 轨迹 / 上下文 / 编队 同排；选中后整个对话内容区渲染本面板
（右侧栏 sidebar.right.pane.tab 的 key vcs-timeline 仍注册，当前桌面端侧栏未暴露入口）

dvt-root (flex column, 100%, overflow hidden)
├─ <style>                     STYLES（存量 dvt- 前缀，仅主题 token）
├─ SwimlaneShell               .swl-page（页面底 + 容器查询容器；内部挂载 SWIMLANE_STYLES）
│  └─ .swl-frame (flex row, gap 12px)
│     ├─ .swl-sidebar (260px)  左卡片 = renderFileTree
│     │   ├─ 头部              “文件 N” + 展开/收起全部
│     │   ├─ 搜索框            文件名搜索（client-side，匹配路径与重命名旧路径）
│     │   ├─ 统计胶囊          +增 / −删 / N 个文件（与下方树同源）
│     │   ├─ 状态筛选          ∗ 全部 / M / A / D / R，各带计数
│     │   └─ 树                “全部文件” + 目录（计数）/ 文件（A/M/D/R、×N、+行）
│     └─ .swl-main             右卡片
│        ├─ .swl-mobilebar     窄栏（<860px）抽屉开关（文件 N）
│        ├─ .swl-chrome
│        │   ├─ dvt-toolbar (58px)  仓库 + GIT 徽标 + 分支下拉 + 拉取/推送 + 添加/刷新/⋯
│        │   ├─ dvt-menu            Fetch / Pull / Commit / Push（SVN: Update / Commit）
│        │   ├─ dvt-tabstrip (44px) 时间线/待处理/热点/PR/审计 胶囊页签
│        │   └─ dvt-filterbar (46px) 搜索 + 全部/提交 + 时间范围 + 全部/当前分支 + 显示操作
│        └─ .swl-content
│           ├─ .dvt-pane (list/detail)
│           │   ├─ SwimlaneTimeline（140px 画布 + 40px 轨道；今天/昨天/日期分组）
│           │   │   图例：轨道色点 + 分支名 + 提交数
│           │   │   行：语义化胶囊（分支/合并/HEAD/归属）+ 摘要 + 头像/作者/相对时间/短 hash
│           │   │       + `+增` / `−删` / `N 个文件` 胶囊
│           │   ├─ 提交详情（面包屑 + 元信息网格 + 变更文件）
│           │   ├─ Diff（行号槽 + 统一 diff 着色 + 底部统计）
│           │   ├─ 审计列表/详情、PR 列表/详情
│           │   └─ 空/错误/加载（区分 10 种状态）
│           └─ 待处理工作台 / 热点数据看板 / 文件三栏视图（各自占满 content）
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
- **容器查询而非媒体查询**：侧栏宽度与窗口宽度无关，`@container swl (max-width: 860px/640px/520px)`
  按**面板**宽度依次收起左树为抽屉、压缩 Header/工具栏、隐藏次要胶囊；400px 侧栏仍可读，
  1440px 对话区不浪费空间。
- **泳道图是数据驱动的真实现**（`ui/swimlane.ts`）：`assignLanes()` 按分支族给出稳定轨道
  （main=0、feature 依次、hotfix 最后，最多 8 轨），节点 X = `20 + lane*40`（140px 画布，轨道数多时画布变宽）；
  同轨用 `<line>`、跨轨用三次贝塞尔 `<path d="M prevX 0 C prevX H/4, x H/4, x H/2">`；
  节点是绝对定位 DOM 圆点（`ring-4` 卡片色描边 + `z-index` 压住 SVG，形成断点），合并提交为空心双环；
  轨道底色淡线 + 标签「分支轨道」图例让并行分支一眼可读。
- **列表/详情分栏**：content 内固定为 list（flex 撑满）+ detail（42% 高，min 150px），详情含
  提交/文件 Diff/审计记录/PR 详情四种；列表与左树永不因打开详情而消失。
- **文件视图是三栏**：文件树 | Diff（`dvt-file-diffpane`，主区域）| 操作信息（`dvt-fileinfo`，右侧）。
  操作信息含：路径/状态/未提交标记、最近作者与相对时间、提交数/作者数/累计 ±、作者分布条形图、
  逐提交记录（点击切换中间 Diff，当前项高亮）、打开审计入口。所有派生自同一份过滤事件。
- **Composer 隐藏**：面板挂载时把 `[data-conversation-scroll]` 内除自己以外的兄弟节点
  （聊天输入框 seat）设为 `display:none` 并记录原值，高度按滚动容器重算；卸载时恢复，
  切回「对话」输入框自动回来。
- **添加入口与快捷键**：工具栏仓库图标 / `⋯` → 仓库 →「添加仓库」；`Alt+1/2/3/4/5` 切
  时间线/待处理/热点/PR/审计，`Alt+R` 刷新。
- **文件视图**：点左树文件 → 列表按路径收窄 + 路径条显示最近作者/作者数/提交数，
  同时打开最新提交的该文件 Diff（`openLatestFileDiff`，revision 取事件 hash，SVN 取 revision）。
- **PR 与审计**：PR 页签与审计页签复用同一 list/detail 分栏；审计顶部状态 chips 为客户端筛选，
  计数来自已加载记录；PR 的动作徽章/评审/CI 全部来自 Host 读到的真实事实。
- **v1.1 待处理工作台**：`ui/workbench.ts` 三栏（分组脏文件 | 即时 Diff | 体检/会话/分支洞察），
  分组直接来自 `WorkingTreeStatus.entries` 的 `staged`/`worktreeStatus`/`conflicts`，
  不额外发明一套「待处理」数据源；未选中文件时中列给出选择提示而不是空白。
- **v1.3 / v1.4 热点数据看板**：`ui/hotspots.ts` 的四个维度由 `hotspots.dimension` 驱动，Host 的
  `HotspotReport` 同时携带 `files` / `authors` / `recent` / `daily`（同一窗口、同一次扫描），
  条长与日历分档统一用 `sqrt(value)/sqrt(max)` 压缩长尾；角色不落库，由窗口内提交占比在客户端推导，
  避免第二份会漂移的事实源。活动日历的「推送次数」单独来自已加载的插件审计操作
  （只计 `state === 'succeeded'` 的 push，覆盖条数写进口径），所以零推送是可解释的零，
  而不是把提交数冒充推送数。数据口径（窗口/分支/截断/缓存/活跃天数）固定在头部，
  文件行可跳回时间线定位。
- **v1.1 审计混排**：提交行与审计节点共用同一竖轴与日期分组，但节点图标、卡片样式（虚线）、
  状态徽标与日计数都独立，点击打开审计详情，不改变提交计数与泳道。
- **时间线优先**：泳道图 + 日期分组让“谁在什么时候做了什么、在哪条分支上”一眼可读；行高 64px（两行），
  画布 140px、轨道 40px，树行 25px、详情文件行 26px、Diff 行 16px；控件高度统一 18/28/30px；
  字号层级 15 / 13 / 12.5 / 11.5 / 10.5 / 10px；圆角 7–14px。
- **单文件可复用的泳道页面**：`ui/swimlane.ts` 只依赖 React（`React.createElement`，无 JSX、无 Tailwind），
  导出 `GitCommit`、`assignLanes` / `nodeX` / `rowLinkPath` / `laneTrackWidth` 纯函数与
  `SwimlaneTimeline` / `SwimlaneHeader` / `SwimlaneToolbar` / `SwimlaneShell` / `SwimlaneDemo`；
  `SwimlaneDemo` 用 `MOCK_COMMITS` 渲染完整页面（1440×900 / 420×900 两张预览即由它生成），
  拷到任意 React 18 应用即可运行（样式自带 `hsl()` token 回退）。


## 7. 动态加载与热加载（v1.5）

目标：点开面板时不要先看到骨架屏。数据在插件加载后就被后台刷进**页面内存**，打开面板先渲染
缓存快照，再静默 revalidate；只有确实没有缓存时才显示加载动画。详细行业对照与验收步骤见
[docs/DYNAMIC-LOADING.md](DYNAMIC-LOADING.md)。

### 7.1 模块

| 模块 | 职责 |
| --- | --- |
| `client/cache.ts` | 页面生命周期内存缓存：按 workspace 存仓库列表，按 repository 存时间线第一页/status/audit/hotspots/session/checks/PR/compare；每条带 `savedAt`，仓库 LRU 上限 8；`timelineQueryKey()` 让不同筛选的页面互不复用 |
| `client/sync.ts` | 后台预热服务（每插件激活一个实例）：首轮 1.2s，之后 30s；面板打开时暂停，关闭 800ms 后补一轮；失败指数退避 30→60→120→240s；`hydrate()` 把缓存映射成 `HydrationSnapshot`；`remember*` 接收面板回写的成功结果 |
| `client/panel.ts` | 首帧 `hydratePanelState()` 水合；每次首屏加载在已有数据时走静默分支（不清列表、不设 `loading`）；10s `status` 指纹探测 + 30s 完整静默刷新 + visibility/focus 刷新；`sync.refreshing` 由计数器驱动，被新请求取代的请求会 `cancelRefresh()` 释放，进度条不会卡死 |
| `client/ui/toolbar.ts` | 唯一可见反馈：3px 不确定进度条（零高度定位槽，不推动布局）、旋转刷新图标、`role=status` live region；后台刷新失败且旧数据仍在时显示 stale Banner |
| `client/index.ts` | 插件激活即 `sync.start()`，卸载时 `sync.stop()`；把 `sync` 注入面板依赖 |

### 7.2 时序

```text
插件激活
  └─ sync.start()
       ├─ +1.2s 首次 warm（仅页面可见、面板未打开）
       └─ 每 30s warm：repos/list → status + timeline 第一页 + audit 第一页 → 写缓存

用户点开面板
  ├─ hydratePanelState(cache)         ← 第一帧就有历史/状态（无骨架）
  ├─ sync.setPanelOpen(true)          ← 暂停重型预热
  ├─ 立即静默 revalidate 可见数据      ← 有数据的分支不清空列表
  └─ 每 10s status 指纹 / 每 30s 全量静默刷新 / visibility·focus 立即刷新

关闭面板
  ├─ sync.setPanelOpen(false)
  └─ +800ms 补一轮 warm，随后恢复 30s 节奏
```

### 7.3 刷新触发源

| 触发 | 频率/时机 | 条件 | 行为 |
| --- | --- | --- | --- |
| 后台 warm | 首次 1.2s，之后 30s | 页面可见且面板未打开 | 拉仓库列表 + 目标仓库 status/timeline/audit 第一页写缓存；仓库列表在 2 分钟内复用（发现要扫描工作区，比重读切片贵） |
| 面板打开 | 每次 mount | 有缓存 | 先水合再静默刷新 |
| 工作区探测 | 10s | 面板可见、已选仓库 | `status` 的 HEAD/分支/脏文件指纹变化才重拉历史 |
| 完整刷新 | 30s | 面板可见 | 静默刷新当前页签的源 |
| 页面恢复可见 / 窗口聚焦 | 立即 | 可见 | 探测 + 静默刷新（聚焦 5s 节流） |
| 页面隐藏 | 立即 | — | 停掉面板轮询；后台 warm 也只在可见时执行 |
| 写操作完成 | 立即 | 有仓库 | 走已有 `refreshTick/statusTick`，因有数据而自动静默 |
| 手动刷新 | 用户点击 | — | 刷新仓库列表与当前源；刷新中按钮仍可用 |

### 7.4 无感规则（stale-while-revalidate）

- **有数据 → 不清空**：首屏加载只在无缓存时设置 `loading`；有缓存时保持列表、详情、选中项、
  滚动位置，仅把 `sync.refreshing` 置为 true。
- **原位合并**：静默刷新第一页时把新提交/新审计记录合并到顶部，已“加载更多”的旧页保留，
  `cursor` 与 `hasMore` 以已加载为准；只有查询条件变化（ticket 不同）才整体替换。
- **失败保留旧数据**：静默失败只置 `sync.lastError`，不把 `timeline.error` 写进有数据的列表；
  chrome 显示“后台刷新失败，当前显示的是上次的数据”，冷启动失败仍走原错误态。
- **查询键隔离**：缓存页面带 `timelineQueryKey`，不同搜索/作者/分支/时间范围的页面不会互相命中。

### 7.5 边界

- 缓存不落盘、不跨页面刷新、不跨窗口；`F5` 后重新预热。
- 后台只预热“当前/上次看过的仓库”，PR 与热点不预热（网络/重扫描成本）。
- 面板开关是布尔值而非实例计数：右侧栏与对话区两个实例同时存在时，任一关闭会恢复预热；
  当前桌面端只暴露对话区入口（见 README 已知限制）。
- 全部逻辑在浏览器半，未新增 Host 路由，`F5` 即生效，Host 无需重启。

### 7.6 骨架屏与交叉淡入淡出（v1.5.1）

- **模块**：`client/ui/skeleton.ts` 提供 `SkeletonBlock/Line`、按 source 的
  `SkeletonCardList / SkeletonTimelineList / SkeletonTree / SkeletonHotspots / SkeletonWorkbench`，
  由 `SkeletonContent` 分派；唯一的**有状态**组件是 `SkeletonSwap`。
- **何时出现**：`isContentLoading(state)` 是唯一判定——boot loading，或当前 source 首次加载且
  **没有任何已显示数据**。有数据的静默刷新永远不出骨架（由 3px 进度条反馈）。该谓词同时被
  `components.ts`（决定是否包 SkeletonSwap/树骨架）、`toolbar.ts`（冷启动隐藏同步文案）、
  `status.ts`（状态栏换灰块）复用，避免三处判断漂移。
- **布局一致**：骨架按真实布局画灰块——时间线 140px 泳道占位 + 64px 行、卡片列表头像/两行/胶囊、
  文件树标题/搜索/缩进行、热点 18×7 热力网格、待办三栏；块尺寸贴近内容，切换来源时不会“骨架 A 变成
  内容 B”的二次跳变。
- **动效**：`.dvt-skel-block::after` 用 90° 白色渐变 + `translateX(-100%→100%)` 循环扫光，负延迟保证
  首帧可见；`SkeletonSwap` 用 grid 两层同格叠放，loading 落下时骨架保留 `SKELETON_FADE_MS = 260ms`
  播放 `dvt-skel-out`，内容同帧挂载播放 `dvt-content-in`（0.28s，opacity + 4px 位移）。骨架层
  `pointer-events:none`，淡出期间内容即可交互。容器撑满内容区，因此骨架→内容不会推动布局。
- **无文字/无品牌**：骨架 DOM 全部 `aria-hidden`，容器只在加载中 `aria-busy="true"`；冷启动不渲染
  进度条、“正在更新…”胶囊与 live 文案，状态栏也换成灰块。
- **减少动效**：`prefers-reduced-motion: reduce` 时 JS 侧跳过淡出（同帧切换），CSS 侧关闭扫光与淡入
  淡出，最终状态不变。
- **局部加载**：详情/Diff/体检/会话/PR 详情继续用 `SkeletonRows` 的紧凑灰块，不参与主内容交叉淡入，
  避免同一屏出现两层动画。

## 8. 关键不变量

1. 只读与写操作彻底分离；写操作必须经过预览 + 单次 token。
2. 审计先于执行落盘；失败也保留记录；远端结果不确定时记为 `unknown`，不伪装成成功/失败。
3. 任何路径在使用前都经过 gate；任何命令都不经过 shell。
4. 仓库历史来自 VCS；插件审计只描述插件自己的操作，两者在 UI 上有来源徽标。
5. 客户端不可传入任意命令、任意工作区外的路径或任意 revision 语法。
6. 左右两栏由同一份派生视图渲染：目录计数、状态计数、时间线行必须能互相解释；
   未提供的数据显示为“未提供”，绝不补零或编造文件/提交。
7. PR 事实只来自宿主实际读取的 API：未认证/未读到的评审、CI、可合并性显示为未知；
   动作建议是纯函数推导，不含猜测；令牌不离开 Host 请求头。
8. 工作区 Diff 只描述真实内容：未跟踪文件按整文件读取并标注 `untracked`，超限/二进制如实标记；
   SVN 没有暂存区时拒绝 `staged` 请求，而不是把工作区内容冒充索引内容。
9. 体检只对真实 diff 的字节下结论；未跟踪文件、被截断的 diff、SVN 的缺失能力都以警告/规则项
   显式说明，不输出「全部通过」的假安心。
10. 会话归因只读活动会话且只认成功的写文件工具调用；路径必须落在仓库根内；结果一律标注推断。
11. 热点看板四个维度只展示可解释分项（活动日历 / 文件 churn / 作者提交与行数贡献 / 最近提交），
    全部共用同一扫描窗口并写出扫描口径（窗口/分支/截断/缓存/活跃天数），不出现单一神秘分数；
    角色由提交占比推导并在悬停说明；推送次数只来自插件审计里成功的 push；SVN 没有行级统计时
    显示不可用，不补零。
12. 图表颜色不复用 `--dsw-alias-brand-primary`：宿主该 token 是单色（浅色近黑、深色近白），
    数据可视化统一用 `--dvt-data-blue` / `--dvt-data-purple`，保证深浅主题下日历热力、进度条与
    悬浮指示线仍是设计色；中性面仍使用主题 token。
13. 缓存只复用同一个查询键的结果：筛选条件变化后绝不把旧筛选的页面当作新结果展示；
    静默刷新失败时保留最后一次成功的数据并明确标注，不把失败伪装成最新。
14. 后台刷新只读、不写仓库；预热/轮询不发写操作、不产生审计记录，也不在面板关闭时拉取
    需要网络凭据的数据（PR）或重扫描统计（热点）。
