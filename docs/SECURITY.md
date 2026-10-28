# 安全与隐私（dsh-vcs-timeline）

## 1. 威胁模型

| 威胁 | 场景 | 处置 |
| --- | --- | --- |
| 命令注入 | 提交信息 / 分支名 / 远端名 / 文件路径 / revision 被拼进 shell | 全部走 argv 数组，无 shell；输入白名单校验；revision 只允许数字（SVN）或 hex（Git） |
| 路径越界 | 客户端传入 `../../`、绝对路径、盘符或符号链接指向仓库外 | `normalizeRepoRelativePath` 拒绝绝对路径、盘符、`..`、NUL；`joinRepoPath` 再次 `isInside` 校验 |
| 仓库换位 | 发现后把目录换成 symlink，再发起操作 | 每次操作 `gate()` 重新 realpath + 重校验工作区归属 + 重识别 VCS 元数据 |
| 凭据泄漏 | remote URL 内含 `user:token@` 或 query token；错误输出含密码 | `redactUrl` / `redactText` 在持久化和返回 UI 前脱敏；不记录完整 stdout/stderr |
| 跨站请求（CSRF） | 其他站点向 `127.0.0.1:12050/vcs/*` 发 POST | 仅 loopback、仅 POST、强制 `application/json`（跨站表单无法设置）、`Origin` 同源校验 |
| 局域网滥用 | DSH 暴露到局域网时被调用 | `/vcs` 路由**只接受 loopback**；非 loopback 直接 403 |
| 资源耗尽 | 巨大仓库、超大 Diff、长输出、挂起的命令 | 历史分页（≤100/页）、Diff 字节上限（默认 256 KiB，硬上限 2 MiB）、单命令输出上限、超时（读 20s / 状态 15s / 写 60–180s） |
| 误操作破坏仓库 | 用户点错或客户端伪造写请求 | 预览 + 单次 token + argv 复核 + 明确 blockedReason；不实现 reset/clean/force-push/merge/rebase/switch |
| 审计被篡改 | 事后删除/改写记录 | 追加式 JSONL；终态是新记录；`started` 永不修改；UI 折叠展示 |
| 审计造假 | 把外部操作算作插件操作，或把未知结果写成成功 | `source: plugin-audit` 只由本插件执行路径产生；超时/被杀记 `unknown` |
| 渲染注入 | 提交说明/路径中含 HTML/ANSI/终端控制序列 | React 文本节点渲染，无 `dangerouslySetInnerHTML`；Diff 以 `<pre>` 纯文本呈现 |

## 2. 已实现的强制措施

- **命令安全**：`Runner` 只接受 `argv: string[]`，由 `ctx.subprocess.spawn` 执行；
  仓库路径作为 `cwd` 传入，不作为命令文本；所有 Git 调用带 `--no-pager`、禁用颜色与路径引号转义；
  SVN 调用带 `--non-interactive`，路径参数前加 `--`。
- **参数校验**：`isSafeBranchName` / `isSafeRemoteName` 拒绝前导 `-`、空白、`~^:?*[\`、引号、
  `$&|;<>` 等 shell/revspec 字符；Git hash 必须 7–64 位 hex；SVN revision 必须 1–12 位数字。
- **路径闸门**：所有 repositoryId 在服务层解析为缓存记录 → realpath → 工作区成员/显式授权检查 →
  VCS 元数据复查；失败返回 `unknown-repository` / `path-not-allowed` / `not-a-repository`。
- **确认令牌**：`randomBytes(24)`，120 秒 TTL，最多 32 个未决；绑定 repositoryId + operation +
  参数哈希 + 精确 argv；执行前重新 plan 并比对 argv；用后即焚。
- **单仓库写互斥**：同一仓库同时只允许一个 in-flight 写操作，其余返回 `operation-blocked`。
- **审计优先**：`audit.start()` 成功写入后才 spawn；存储失败 → `storage-failure` 且不执行命令。
- **输出与脱敏**：`safeErrorMessage` 限制 500 字符并脱敏；`outputSummary` 只保留前 12 行 ≤2000 字符；
  `changedPaths` 上限 200；repository remote 列表脱敏后入库。
- **前端**：无 `dangerouslySetInnerHTML`；无全局 CSS；仅主题 token；所有可见文案走 i18n；
  危险动作需要打开对话框并显示精确 argv/目标/影响后确认。
- **v1.1 只读面新增约束**：
  - `worktree/diff` 的单文件路径先过 `normalizeRepoRelativePath` + `joinRepoPath`；未跟踪文件只读
    `maxBytes×2` 字节（另加 64 KiB 余量），二进制/NUL 直接判为 binary，不渲染不可控文本。
  - `checks` 只消费适配器真实返回的 diff 文本，纯函数规则引擎不读文件、不跑命令、不联网；
    规则里检测到的密钥只在 `detail` 里写模式名，不返回任何密钥片段。
  - `session/changes` 只从 Host 内存中的活动会话读取（`ctx.sessions.get`，需显式 sessionId），
    不读磁盘存档；只认成功的写文件工具白名单；参数路径必须 `isInside` 仓库根后才转成相对路径；
    返回上限 500 条，且 `confidence` 恒为 `inferred`，UI 必须标注推断。
  - `stats/hotspots` 为只读聚合：Git 两条 `git log`、`--max-count` 有界、输出有上限、60 s 缓存；
    SVN 不执行命令并返回 `available:false`；返回的 `scope` 明确扫描窗口/分支/是否含 merge。
- **v1.2 暂存写操作**：`stage` / `unstage` 是显式写操作，和 commit/push 走同一条
  「预览 → 单次 token → argv 复核 → 执行 → 审计」管线；路径参数过仓库根闸门后才进入 argv；
  unstage 使用 `git restore --staged`，只改索引、不动工作区内容；插件没有自动暂存路径。

## 3. 明确不做（首版禁止）

- `reset --hard`、`clean -fdx`、强制 push、删除仓库文件、重写历史。
- 自动 stash、自动覆盖本地修改、自动解决冲突、自动切换分支。
- 修改用户的 Git/SVN 配置，或把凭据写入任何日志/审计。
- 把审计数据上传到任何远端。
- 声称审计覆盖外部终端/IDE/GUI 的操作。
- 请求超出工作区的全盘访问（发现范围受工作区约束；手动添加需要用户显式选择路径）。

## 4. 残余风险

1. **同源页面即信任**：`/vcs` 路由信任同源浏览器页面。若页面被 XSS 攻破，攻击者可发起写操作——
   但仍受“预览 token + 明确参数”约束，且插件自身不渲染不可信 HTML。
2. **loopback 限制**：远程访问（remote-web-ui 配对设备）无法使用该面板；这是安全默认值，
   未来如需支持，应接入 DSH 的配对鉴权而不是放松 loopback 检查。
3. **手动添加仓库**：经 UI 显式添加的仓库根会进入本次会话授权集合；客户端理论上可以伪造任意
   合法仓库路径发 `repos/add`（路径必须真实存在且确有 VCS 元数据）。写操作仍需用户在前端确认，
   且审计留痕。若需要更强约束，可改为强制走 Host 目录选择器并只接受其返回值。
4. **单进程写入假设**：JSONL 串行化仅在单个 Host 进程内有效；同时运行两个 DSH 进程写同一数据目录
   未做跨进程锁。
5. **脱敏规则有限**：只能识别已知形态（URL userinfo、key=value、Authorization、私钥块）；
   无键名的裸密钥字符串无法识别。
6. **会话归因是推断**：`session/changes` 读的是活动会话的工具调用参数，不是提交事实；失败结果、
   外部终端改动、非白名单工具（如 shell 命令间接改文件）都不会被归因。UI 必须显示「推断」，
   不能把它当作归属证明或绩效依据。
7. **待处理工作台能看到仓库内未跟踪文件内容**：这是「即时 Diff」的必要能力，受仓库根闸门与
   字节上限约束；它不读仓库根之外的路径，也不把内容写入审计/日志。

## 5. 上线前检查清单

- [x] 无 shell 拼接；全部 argv 数组
- [x] 路径规范化 + 仓库根约束 + 重校验闸门
- [x] remote URL / 错误信息 / 审计摘要脱敏
- [x] 命令超时、输出上限、Diff 上限
- [x] 写操作预览 + 单次 token + argv 复核 + 单仓库互斥
- [x] 审计先写后执行；失败/未知状态如实记录
- [x] 仅 loopback + JSON content-type + 同源校验
- [x] 前端无 HTML 注入面、无全局样式
- [x] 不实现 reset/clean/force-push/merge/rebase/switch
- [ ] 跨进程写锁（未实现；单进程假设）
- [ ] 配对设备鉴权（未实现；当前 loopback-only）
