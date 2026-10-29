/**
 * dsh-vcs-timeline — background warming service (dynamic loading).
 *
 * 插件激活即启动：先把仓库数据周期性地刷进 `PanelCache`，用户点开面板时
 * `hydrate()` 直接从内存渲染，随后面板自己静默 revalidate —— 只有真的没有
 * 数据时才显示骨架屏。
 *
 * 服务本身绝不抛异常：每一次 Host 调用都显式判断 `ok`，单次失败不影响本次
 * warm 里的其它请求；连续失败进入指数退避；`stop()` 之后所有在途结果按 token
 * 丢弃，不再回写缓存。定时器和可见性都可注入，测试不需要真实计时。
 * @module dsh-vcs-timeline/client/sync
 */

import { DEFAULT_PAGE_SIZE } from '../shared/contracts.ts'
import { PanelCache, timelineQueryKey } from './cache.ts'
import type {
  ApiError,
  BranchCompare,
  ChecksReport,
  Diagnostics,
  HotspotReport,
  OperationPage,
  OperationQuery,
  PullRequestList,
  Repository,
  SessionChanges,
  TimelinePage,
  TimelineQuery,
  WorkingTreeStatus,
} from '../shared/contracts.ts'
import type { ApiResult, VcsClient } from './api.ts'
import type { CachedChecks, CachedWorkspace } from './cache.ts'
import type {
  CachedRepositorySnapshot,
  ChecksScope,
  HydrationSnapshot,
  PanelSync,
  SyncRuntimeState,
  SyncState,
} from './types.ts'

/** 首次 warm 的默认延迟（安装/激活后马上拉数据会和应用启动抢资源）。 */
export const DEFAULT_INITIAL_WARM_DELAY_MS = 1_200
/** 两次后台 warm 的默认间隔。 */
export const DEFAULT_WARM_INTERVAL_MS = 30_000
/** `visibilitychange` 触发 warm 的最小节流间隔。 */
export const DEFAULT_VISIBILITY_THROTTLE_MS = 5_000
/** 面板关闭后补一次轻量 warm 的默认延迟。 */
export const DEFAULT_RESUME_WARM_DELAY_MS = 800
/** 指数退避的封顶间隔（4 分钟）。 */
export const MAX_WARM_BACKOFF_MS = 240_000
/**
 * 仓库列表在内存里的复用时长（本插件默认值）。
 *
 * 仓库发现要扫描工作区并对每个仓库读一次 VCS 元信息，比 `git status` 贵得多；
 * 30s 一次的后台刷新如果每次都重新发现，会在后台白白消耗 I/O 和子进程。
 * 列表在 2 分钟内直接复用；面板自己的“刷新仓库列表”不受这个限制。
 */
export const REPOSITORY_LIST_TTL_MS = 120_000

/**
 * 定时器接口。
 *
 * 生产用全局 `setTimeout` / `clearTimeout`；测试注入手动调度的假实现，
 * 因此断言不依赖任何真实时钟。
 */
export interface SyncScheduler {
  setTimeout(handler: () => void, timeoutMs: number): unknown
  clearTimeout(handle: unknown): void
}

/** 本服务用到的 `document` 最小面（SSR 下可以完全没有）。 */
export interface SyncDocumentLike {
  visibilityState?: string
  addEventListener?(type: string, listener: () => void): void
  removeEventListener?(type: string, listener: () => void): void
}

/** `createDataSync` 的依赖与调参。 */
export interface DataSyncOptions {
  /** Host 读取客户端；本服务只读不写。 */
  api: VcsClient
  /** 复用调用方持有的缓存；缺省时内部新建一个。 */
  cache?: PanelCache
  /** 时钟（缓存时间戳、退避与状态都用它）；默认 `Date.now`。 */
  now?: () => number
  /** 两次后台 warm 的间隔，默认 {@link DEFAULT_WARM_INTERVAL_MS}。 */
  warmIntervalMs?: number
  /** 首次 warm 延迟，默认 {@link DEFAULT_INITIAL_WARM_DELAY_MS}。 */
  initialDelayMs?: number
  /** 回到前台时触发 warm 的节流间隔，默认 {@link DEFAULT_VISIBILITY_THROTTLE_MS}。 */
  visibleTimeoutMs?: number
  /** 面板关闭后补一次 warm 的延迟，默认 {@link DEFAULT_RESUME_WARM_DELAY_MS}。 */
  resumeDelayMs?: number
  /** 定时器实现；测试注入假调度器。 */
  scheduler?: SyncScheduler
  /** 页面当前是否可见；默认读 `document.visibilityState`，无 document 时视为可见。 */
  visibility?: () => boolean
  /**
   * 监听 `visibilitychange` 的 document。缺省用全局 `document`（SSR 下没有则
   * 不监听）；传 `null` 可显式关闭监听。
   */
  documentLike?: SyncDocumentLike | Document | null
}

/** 生产环境的定时器实现（模块顶层不触碰任何 DOM / 计时器）。 */
const DEFAULT_SCHEDULER: SyncScheduler = {
  setTimeout: (handler, timeoutMs) => globalThis.setTimeout(handler, timeoutMs),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as Parameters<typeof globalThis.clearTimeout>[0])
  },
}

/** 无 document 的 SSR/Node 环境视为可见。 */
function defaultVisibility(): boolean {
  try {
    if (typeof document === 'undefined') return true
    return document.visibilityState !== 'hidden'
  } catch {
    return true
  }
}

/** 客户端调用本身抛错时折叠出的稳定错误，保证不会向上冒泡。 */
function abnormalFailure(): ApiError {
  return { code: 'internal', message: 'request-failed', retryable: true }
}

/**
 * 执行一次 Host 调用并兜住同步异常和 rejection。
 *
 * `VcsClient` 的约定是返回 `ApiResult` 而不是 reject，但注入的假实现、
 * 被 polyfill 的 fetch 或未来改动都可能违约，这里兜底成普通错误结果。
 */
async function settle<T>(start: () => Promise<ApiResult<T>>): Promise<ApiResult<T>> {
  try {
    return await start()
  } catch {
    return { ok: false, error: abnormalFailure() }
  }
}

/**
 * 创建后台预热服务（每个插件激活一个实例）。
 *
 * 生命周期：`start()` → `initialDelayMs` 后首次 warm → 之后按间隔（失败则
 * 指数退避）继续；面板打开期间暂停重型 warm，关闭后补一次；`stop()` 清空
 * 全部定时器与监听，`start()` 可以再次进入。
 */
export function createDataSync(options: DataSyncOptions): PanelSync {
  const api = options.api
  const now = options.now ?? Date.now
  const warmIntervalMs = options.warmIntervalMs ?? DEFAULT_WARM_INTERVAL_MS
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_WARM_DELAY_MS
  const visibleTimeoutMs = options.visibleTimeoutMs ?? DEFAULT_VISIBILITY_THROTTLE_MS
  const resumeDelayMs = options.resumeDelayMs ?? DEFAULT_RESUME_WARM_DELAY_MS
  const scheduler = options.scheduler ?? DEFAULT_SCHEDULER
  const isVisible = options.visibility ?? defaultVisibility
  const cache = options.cache ?? new PanelCache(now)

  let running = false
  let panelOpen = false
  let warming = false
  let workspacePath: string | null = null
  let repositoryId: string | null = null
  let lastWarmAt: number | null = null
  let nextWarmAt: number | null = null
  let lastError: ApiError | null = null
  /** 连续失败次数；成功归零，失败按 2^n 退避。 */
  let failures = 0
  /** 每次 warm / stop 自增；异步结果回写前比对，过期（stop 后）直接丢弃。 */
  let runToken = 0
  /** 已排定的定时器句柄；null 表示没有排定。 */
  let timerHandle: unknown = null
  /** 上次由 visibilitychange 触发 warm 的时刻，用于节流。 */
  let lastVisibilityWarmAt = Number.NEGATIVE_INFINITY
  let visibilityListener: (() => void) | null = null
  let documentLike: SyncDocumentLike | null = null

  /** 清空定时器并同步清空 `nextWarmAt`。 */
  function clearTimer(): void {
    if (timerHandle !== null) {
      scheduler.clearTimeout(timerHandle)
      timerHandle = null
    }
    nextWarmAt = null
  }

  /** 下一次间隔：成功用基础间隔，连续失败按 2^n 翻倍并封顶 4 分钟。 */
  function nextDelay(): number {
    if (failures === 0) return warmIntervalMs
    // 上限取 16 是为了让 2^n 不溢出成 Infinity；真正封顶由 MAX_WARM_BACKOFF_MS 完成。
    return Math.min(warmIntervalMs * 2 ** Math.min(failures, 16), MAX_WARM_BACKOFF_MS)
  }

  /**
   * 排定下一次后台 warm。
   *
   * 面板打开或服务已停止时不排定（`nextWarmAt` 保持 null）：面板打开意味着
   * 面板自己负责刷新，服务不再抢 Host。
   */
  function schedule(delayMs: number): void {
    clearTimer()
    if (!running || panelOpen) return
    const at = now() + delayMs
    timerHandle = scheduler.setTimeout(() => {
      timerHandle = null
      nextWarmAt = null
      if (!running) return
      void runWarm()
    }, delayMs)
    nextWarmAt = at
  }

  /** 记录一次成功：连续失败归零、清掉错误、更新时间戳。 */
  function recordSuccess(): void {
    failures = 0
    lastError = null
    lastWarmAt = now()
  }

  /** 记录一次失败：只更新错误与退避计数，不清除已有缓存数据。 */
  function recordFailure(error: ApiError): void {
    failures += 1
    lastError = error
  }

  /**
   * 选本次 warm 的目标仓库。
   *
   * 顺序：用户当前选中的仓库（且仍在发现列表里）→ 上次看过的仓库（且仍在
   * 列表里）→ 列表第一项。缓存里过期的 id 会被忽略，不会对已删除的仓库发请求。
   */
  function pickRepository(repositories: Repository[]): string | null {
    const known = new Set(repositories.map((repository) => repository.id))
    if (repositoryId !== null && known.has(repositoryId)) return repositoryId
    const remembered = cache.readLocation().repositoryId
    if (remembered !== null && known.has(remembered)) return remembered
    return repositories[0]?.id ?? null
  }

  /**
   * 一次后台 warm。
   *
   * 单飞（warming）防重入；不可见或面板打开时跳过（定时链不中断）。所有请求
   * 都经过 `settle`，因此任何单项失败只记 `lastError`，不影响同批其它结果，
   * 更不会产生未处理的 rejection。结束（含失败）都会重新排定下一次。
   */
  async function runWarm(): Promise<void> {
    if (!running || warming) return
    if (panelOpen) {
      // 面板自己负责实时刷新：暂停重型预热，`nextWarmAt` 保持 null。
      clearTimer()
      return
    }
    if (!isVisible()) {
      // 不可见时不做请求，但定时链继续走，回到前台后再补。
      schedule(nextDelay())
      return
    }

    warming = true
    const token = ++runToken
    try {
      // Repository discovery is the expensive part (workspace scan + per-repo
      // VCS metadata). Reuse the cached list while it is fresh and only refresh
      // the cheap slices; the panel's manual refresh still re-discovers.
      const cachedListing = cache.readRepositories(workspacePath)
      let listing: CachedWorkspace
      if (cachedListing !== null && now() - cachedListing.savedAt < REPOSITORY_LIST_TTL_MS) {
        listing = cachedListing
      } else {
        const listResult = await settle(() => api.listRepositories(workspacePath))
        if (token !== runToken) return
        if (!listResult.ok) {
          recordFailure(listResult.error)
          return
        }
        const repositories = listResult.value.repositories
        listing = {
          repositories,
          diagnostics: listResult.value.diagnostics,
          selectedRepositoryId: pickRepository(repositories),
          savedAt: now(),
        }
        cache.rememberRepositories(workspacePath, repositories, listing.diagnostics, listing.selectedRepositoryId)
      }
      const selected = pickRepository(listing.repositories)
      if (selected === null) {
        // 没有任何仓库：这也是一次成功的“读到空列表”。
        recordSuccess()
        return
      }
      if (repositoryId === null) repositoryId = selected

      // 第一页 query 必须和面板默认 query 完全一致，否则缓存 key 对不上。
      const query: TimelineQuery = {
        repositoryId: selected,
        limit: DEFAULT_PAGE_SIZE,
        includeFiles: true,
      }
      const queryKey = timelineQueryKey(query)
      const [statusResult, timelineResult, auditResult] = await Promise.all([
        settle(() => api.status(selected)),
        settle(() => api.timeline(query)),
        settle(() => api.listOperations({ repositoryId: selected } satisfies OperationQuery)),
      ])
      if (token !== runToken) return

      // 单项独立回写：一个失败不能抹掉另外两个已经拿到的结果。
      let failure: ApiError | null = null
      if (statusResult.ok) cache.rememberStatus(selected, statusResult.value)
      else failure ??= statusResult.error
      if (timelineResult.ok) cache.rememberTimeline(selected, queryKey, timelineResult.value)
      else failure ??= timelineResult.error
      if (auditResult.ok) cache.rememberAudit(selected, auditResult.value)
      else failure ??= auditResult.error

      if (failure === null) recordSuccess()
      else recordFailure(failure)
    } catch {
      // 兜底：任何未预料的同步/异步异常都只落成 lastError。
      if (token === runToken) recordFailure(abnormalFailure())
    } finally {
      if (token === runToken) {
        warming = false
        schedule(nextDelay())
      }
    }
  }

  /** 解析注入的 document；缺省时取全局 document（SSR 下为 null）。 */
  function resolveDocument(): SyncDocumentLike | null {
    const injected = options.documentLike
    if (injected === undefined) {
      return typeof document === 'undefined' ? null : (document as unknown as SyncDocumentLike)
    }
    if (injected === null) return null
    return injected as unknown as SyncDocumentLike
  }

  /** 开始监听 visibilitychange（只在 running 期间挂着）。 */
  function attachVisibility(): void {
    if (visibilityListener !== null) return
    const doc = resolveDocument()
    if (doc === null
      || typeof doc.addEventListener !== 'function'
      || typeof doc.removeEventListener !== 'function') {
      return
    }
    documentLike = doc
    visibilityListener = () => {
      if (!running || panelOpen) return
      if (!isVisible()) return
      warmNow('visibility')
    }
    doc.addEventListener('visibilitychange', visibilityListener)
  }

  /** 移除 visibilitychange 监听并清空注入的 document 引用。 */
  function detachVisibility(): void {
    if (documentLike !== null
      && visibilityListener !== null
      && typeof documentLike.removeEventListener === 'function') {
      documentLike.removeEventListener('visibilitychange', visibilityListener)
    }
    documentLike = null
    visibilityListener = null
  }

  function start(): void {
    if (running) return
    running = true
    attachVisibility()
    schedule(initialDelayMs)
  }

  function stop(): void {
    running = false
    warming = false
    clearTimer()
    detachVisibility()
    // 让所有在途结果过期：之后到达的响应不再写缓存、不再采样。
    runToken += 1
  }

  function setPanelOpen(open: boolean): void {
    if (panelOpen === open) return
    panelOpen = open
    if (open) {
      // 面板打开：停掉重型 warm，`nextWarmAt` 变为 null。
      clearTimer()
      return
    }
    // 面板关闭：安排一次轻量 warm（下一 tick），而不是等满一个周期。
    if (running) schedule(resumeDelayMs)
  }

  function setWorkspace(targetWorkspacePath: string | null): void {
    workspacePath = targetWorkspacePath
    cache.noteLocation(workspacePath, repositoryId)
  }

  function setActiveRepository(targetRepositoryId: string | null): void {
    repositoryId = targetRepositoryId
    cache.noteLocation(workspacePath, repositoryId)
  }

  function warmNow(reason: SyncState['reason'] = 'manual'): void {
    if (!running) return
    if (reason === 'visibility') {
      // 回到前台时立即补一次，但节流到 visibleTimeoutMs 以免频繁切换标签页打爆 Host。
      const at = now()
      if (at - lastVisibilityWarmAt < visibleTimeoutMs) return
      lastVisibilityWarmAt = at
    }
    clearTimer()
    void runWarm()
  }

  /** 把缓存里一个仓库的全部切片映射成面板可直接渲染的快照。 */
  function readChecks(checks: Map<ChecksScope, CachedChecks>): CachedRepositorySnapshot['checks'] {
    const worktree = checks.get('worktree')
    if (worktree !== undefined) return { scope: 'worktree', value: worktree.value }
    const staged = checks.get('staged')
    if (staged !== undefined) return { scope: 'staged', value: staged.value }
    return null
  }

  /** 读一个仓库的缓存快照；从未缓存过则返回 null。 */
  function readRepositorySnapshot(targetRepositoryId: string): CachedRepositorySnapshot | null {
    const cached = cache.readRepository(targetRepositoryId)
    if (cached === null) return null
    return {
      timeline: cached.timeline === null
        ? null
        : { queryKey: cached.timeline.queryKey, page: cached.timeline.page },
      status: cached.status?.value ?? null,
      audit: cached.audit?.page ?? null,
      hotspots: cached.hotspots?.value ?? null,
      session: cached.session?.value ?? null,
      checks: readChecks(cached.checks),
      pullRequests: cached.pullRequests?.value ?? null,
      compare: cached.compare?.value ?? null,
      savedAt: cached.savedAt,
    }
  }

  function hydrate(targetWorkspacePath: string | null): HydrationSnapshot | null {
    // 先精确匹配 workspace；没有则回退到“全部工作区”那次 warm 的列表。
    let listing = cache.readRepositories(targetWorkspacePath)
    let fromFallback = false
    if (listing === null && targetWorkspacePath !== null) {
      listing = cache.readRepositories(null) // ALL_WORKSPACES_KEY
      fromFallback = listing !== null
    }
    if (listing === null) return null

    const known = new Set(listing.repositories.map((repository) => repository.id))
    const remembered = listing.selectedRepositoryId
    const selected = remembered !== null && known.has(remembered)
      ? remembered
      : (listing.repositories[0]?.id ?? null)
    const data = selected === null ? null : readRepositorySnapshot(selected)
    return {
      workspacePath: targetWorkspacePath,
      repositories: [...listing.repositories],
      diagnostics: listing.diagnostics,
      selectedRepositoryId: selected,
      data,
      savedAt: data?.savedAt ?? listing.savedAt,
      fromFallback,
    }
  }

  function noteActiveView(view: { workspacePath: string | null; repositoryId: string | null }): void {
    workspacePath = view.workspacePath
    repositoryId = view.repositoryId
    cache.noteLocation(workspacePath, repositoryId)
  }

  function state(): SyncRuntimeState {
    return {
      running,
      panelOpen,
      workspacePath,
      repositoryId,
      warming,
      lastWarmAt,
      nextWarmAt,
      lastError: lastError === null ? null : { ...lastError },
    }
  }

  return {
    start,
    stop,
    setPanelOpen,
    setWorkspace,
    setActiveRepository,
    warmNow,
    hydrate,
    rememberRepositories(
      targetWorkspacePath: string | null,
      repositories: Repository[],
      diagnostics: Diagnostics,
      selectedRepositoryId: string | null,
    ): void {
      cache.rememberRepositories(targetWorkspacePath, repositories, diagnostics, selectedRepositoryId)
    },
    rememberTimeline(targetRepositoryId: string, queryKey: string, page: TimelinePage): void {
      cache.rememberTimeline(targetRepositoryId, queryKey, page)
    },
    rememberStatus(targetRepositoryId: string, status: WorkingTreeStatus): void {
      cache.rememberStatus(targetRepositoryId, status)
    },
    rememberAudit(targetRepositoryId: string, page: OperationPage): void {
      cache.rememberAudit(targetRepositoryId, page)
    },
    rememberHotspots(targetRepositoryId: string, report: HotspotReport): void {
      cache.rememberHotspots(targetRepositoryId, report)
    },
    rememberSession(targetRepositoryId: string, changes: SessionChanges): void {
      cache.rememberSession(targetRepositoryId, changes)
    },
    rememberChecks(targetRepositoryId: string, scope: ChecksScope, report: ChecksReport): void {
      cache.rememberChecks(targetRepositoryId, scope, report)
    },
    rememberPullRequests(targetRepositoryId: string, list: PullRequestList): void {
      cache.rememberPullRequests(targetRepositoryId, list)
    },
    rememberCompare(targetRepositoryId: string, compare: BranchCompare): void {
      cache.rememberCompare(targetRepositoryId, compare)
    },
    noteActiveView,
    state,
  }
}
