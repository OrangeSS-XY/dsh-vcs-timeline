# 架构说明（dsh-vcs-timeline）

## 1. 定位与边界

插件在 DSH 右侧栏提供一个「代码时间线」页签，统一查看 **Git / SVN 仓库历史**，
以及**本插件自己发起的 VCS 操作审计**。两类事实在数据模型和 UI 上都严格区分：

| 事实来源 | 数据 | 可信度 |
| --- | --- | --- |
| `repository` | 仓库历史（commit / revision） | 由 Git/SVN 自身提供，是版本事实 |
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
│  ├ panel.ts 状态编排      │ ─────────► │  ├ services/timeline-service.ts  只读服务   │
│  ├ components.ts 纯视图   │ ◄───────── │  ├ services/operation-service.ts 写服务     │
│  ├ api.ts 信封客户端      │  信封      │  ├ discovery.ts     仓库发现 + 路径闸门     │
│  ├ i18n.ts / format.ts    │            │  ├ adapters/git/**  Git 适配器              │
│  └ styles.ts (token only) │            │  ├ adapters/svn/**  SVN 适配器              │
└──────────────────────────┘            │  ├ storage/jsonl.ts  JSONL 存储             │
                                        │  ├ audit/audit-service.ts 追加式审计        │
                                        │  └ security.ts      脱敏/路径/游标/截断     │
                                        └───────────────────────────────────────────┘
```

- Client **没有**文件系统或进程能力，只通过 13 条 `/vcs` 路由请求数据；
  写操作必须携带预览阶段签发的单次确认 token。
- Host 负责路径校验、命令构造（argv 数组）、输出限额、超时、脱敏、审计持久化。

## 3. 数据流

### 3.1 只读

```
选中会话 → session cwd → POST vcs/repos/list {workspacePath}
  → discovery: 校验 path 属于已注册工作区 → 在工作区内有界扫描（深度 3，跳过 node_modules/.git 等）
  → 每个根用 adapter.info() 读取元信息（分支、HEAD、远端、默认分支）
  → 返回 Repository[] + Diagnostics
POST vcs/timeline {repositoryId, cursor, filters}
  → registry.gate(repositoryId)（重新 realpath + 重校验工作区归属 + 重新识别 VCS）
  → adapter.history() → git log（NUL 分隔、机器可读）或 svn log --xml
  → VcsEvent[]（source: 'repository'）+ nextCursor
POST vcs/changeset / vcs/diff / vcs/status
  → adapter.changeSet() / diff() / status() → 文件状态、统一 diff 文本、工作区状态
```

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
| 变更文件 | `--name-status -z` + `--numstat -z`（重命名、二进制 `-`） | `svn log -v --xml` + `diff --summarize` |
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

## 6. UI 结构

```
dvt-root
├─ <style>            仅主题 token 的组件样式（前缀 dvt-）
├─ header             仓库选择器 + 刷新 + 来源页签（时间线 / 审计）
├─ notices            部分结果/工具缺失/错误横幅
├─ body
│   ├─ 列表模式        过滤栏 + 写操作栏 + 时间线列表（或审计列表）
│   ├─ 事件详情        元信息 + 变更文件列表 → 点击文件进入 Diff
│   ├─ Diff 视图       纯文本、加/删着色、二进制与截断提示
│   └─ 审计详情        startedAt/finishedAt/exitCode/errorCode/前后 revision/correlationId
├─ footer             分支/base revision、工作区干净状态、冲突数、工具与数据目录
└─ dialog             写操作预览（argv、before 状态、警告）→ 确认 → 结果
```

状态机覆盖：无工作区、无仓库、客户端缺失、加载中、空历史、部分结果、超时、
权限拒绝、冲突、Diff 超限、Host 路由不可用。所有错误文案包含原因 + 影响 + 下一步。

## 7. 关键不变量

1. 只读与写操作彻底分离；写操作必须经过预览 + 单次 token。
2. 审计先于执行落盘；失败也保留记录；远端结果不确定时记为 `unknown`，不伪装成成功/失败。
3. 任何路径在使用前都经过 gate；任何命令都不经过 shell。
4. 仓库历史来自 VCS；插件审计只描述插件自己的操作，两者在 UI 上有来源徽标。
5. 客户端不可传入任意命令、任意工作区外的路径或任意 revision 语法。
