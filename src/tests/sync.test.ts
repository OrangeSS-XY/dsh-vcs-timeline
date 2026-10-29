/**
 * Background warming service (`client/sync.ts`).
 *
 * 定时器用假调度器手动触发、时钟用注入的 now，所以这些用例不依赖真实计时，
 * 也不会触碰 DOM。覆盖：首次延迟 warm、面板打开暂停、不可见跳过、单项失败
 * 隔离、指数退避与重置、stop 后在途结果丢弃、hydrate 精确/回退、remember*
 * 转发以及 state() 字段。
 * @module dsh-vcs-timeline/tests/sync.test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_PAGE_SIZE } from '../shared/contracts.ts'
import { PanelCache, timelineQueryKey } from '../client/cache.ts'
import { createDataSync } from '../client/sync.ts'
import type { DataSyncOptions, SyncScheduler } from '../client/sync.ts'
import type { ApiResult, VcsClient } from '../client/api.ts'
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
  RepositoryList,
  SessionChanges,
  TimelinePage,
  TimelineQuery,
  VcsEvent,
  WorkingTreeStatus,
} from '../shared/contracts.ts'
import type { ChecksScope, PanelSync } from '../client/types.ts'

// ───────────────────────────────────────────────────────────────────────────
// Fixtures
// ───────────────────────────────────────────────────────────────────────────

const repository: Repository = {
  schemaVersion: 1,
  id: 'git:c:/fake/repo',
  vcsType: 'git',
  rootPath: 'C:/fake/repo',
  displayName: 'repo',
  currentBranch: 'main',
  defaultBranch: 'main',
  detectedAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
}

const diagnostics: Diagnostics = {
  pluginVersion: '0.1.2',
  dshVersion: '0.2.1',
  platform: 'win32',
  dataDir: 'C:/fake/data',
  gitVersion: '2.43.0',
  svnVersion: null,
  workspaceCount: 1,
  warnings: [],
}

const event: VcsEvent = {
  schemaVersion: 1,
  id: 'evt-1',
  repositoryId: repository.id,
  vcsType: 'git',
  eventType: 'commit',
  source: 'repository',
  timestamp: '2026-01-01T00:00:00.000Z',
  actor: 'Alice',
  summary: 'feat: initial commit',
  commitHash: 'abcdef0123456789',
  parentHashes: [],
  branch: 'main',
}

const timelinePage: TimelinePage = {
  events: [event],
  nextCursor: null,
  hasMore: false,
  partial: false,
  warnings: [],
}

const status: WorkingTreeStatus = {
  repositoryId: repository.id,
  vcsType: 'git',
  clean: true,
  branch: 'main',
  head: 'abcdef0123456789',
  entries: [],
  conflicts: [],
}

const auditPage: OperationPage = {
  operations: [],
  nextCursor: null,
  hasMore: false,
  warnings: [],
}

const worktreeChecks: ChecksReport = {
  repositoryId: repository.id,
  scope: 'worktree',
  findings: [],
  filesChecked: 0,
  truncated: false,
  empty: true,
  generatedAt: '2026-01-01T00:00:00.000Z',
}

const stagedChecks: ChecksReport = { ...worktreeChecks, scope: 'staged' }

const hotspotReport: HotspotReport = {
  repositoryId: repository.id,
  vcsType: 'git',
  available: true,
  files: [],
  authors: [],
  recent: [],
  daily: [],
  scannedCommits: 0,
  truncated: false,
  scope: { branch: 'main', mergesIncluded: true, windowCommits: 500 },
  computedAt: '2026-01-01T00:00:00.000Z',
  cached: false,
}

const sessionChanges: SessionChanges = {
  repositoryId: repository.id,
  sessionId: null,
  available: true,
  files: [],
  generatedAt: '2026-01-01T00:00:00.000Z',
}

const pullRequestList: PullRequestList = {
  repositoryId: repository.id,
  provider: 'github',
  host: 'github.com',
  remotePath: 'acme/repo',
  viewer: null,
  authenticated: false,
  pullRequests: [],
  fetchedAt: '2026-01-01T00:00:00.000Z',
}

const branchCompare: BranchCompare = {
  repositoryId: repository.id,
  vcsType: 'git',
  currentBranch: 'main',
  baseBranch: 'main',
  available: true,
  ahead: 0,
  behind: 0,
  commits: [],
  filesChanged: 0,
  conflictPaths: null,
  unpushed: null,
  hasUpstream: true,
  actions: [],
  computedAt: '2026-01-01T00:00:00.000Z',
}

// ───────────────────────────────────────────────────────────────────────────
// Fake scheduler and Host client (no real timers, no DOM)
// ───────────────────────────────────────────────────────────────────────────

interface FakeTimer {
  id: number
  handler: () => void
  delayMs: number
  cancelled: boolean
  fired: boolean
}

interface FakeTimers {
  scheduler: SyncScheduler
  pending(): FakeTimer[]
  pendingDelays(): number[]
  fireNext(): Promise<void>
  flush(): Promise<void>
}

/** 清空微任务队列；setImmediate 不是计时器，因此不引入真实等待。 */
async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve)
  })
}

/** 手动调度的假定时器：测试自己决定什么时候“到点”。 */
function createFakeTimers(): FakeTimers {
  const timers: FakeTimer[] = []
  let nextId = 1

  const scheduler: SyncScheduler = {
    setTimeout(handler: () => void, delayMs: number): unknown {
      const timer: FakeTimer = { id: nextId, handler, delayMs, cancelled: false, fired: false }
      nextId += 1
      timers.push(timer)
      return timer
    },
    clearTimeout(handle: unknown): void {
      if (typeof handle === 'object' && handle !== null) (handle as FakeTimer).cancelled = true
    },
  }

  const pending = (): FakeTimer[] => timers.filter((timer) => !timer.cancelled && !timer.fired)

  return {
    scheduler,
    pending,
    pendingDelays: () => pending().map((timer) => timer.delayMs),
    async fireNext(): Promise<void> {
      const timer = pending()[0]
      if (timer === undefined) throw new Error('no pending timer to fire')
      timer.fired = true
      timer.handler()
      await flushMicrotasks()
    },
    flush: flushMicrotasks,
  }
}

interface FakeApi {
  api: VcsClient
  /** 每个方法的真实调用次数（被 overrides 替换的方法不计入）。 */
  calls: Record<string, number>
  timelineQueries: TimelineQuery[]
  operationQueries: OperationQuery[]
  workspaceQueries: Array<string | null>
}

const unused: ApiError = { code: 'internal', message: 'not-used' }

/** 未被本服务调用的方法返回的稳定错误。 */
function unusedResult(): ApiResult<never> {
  return { ok: false, error: unused }
}

function accepted<T>(value: T): ApiResult<T> {
  return { ok: true, value }
}

/**
 * 完整的 {@link VcsClient} 假实现。
 *
 * 默认 listRepositories/status/timeline/listOperations 成功并记录调用参数，
 * 其余方法返回 `not-used`（预热服务不应该碰它们）。
 */
function createFakeApi(
  overrides: Partial<VcsClient> = {},
  listed: Repository[] = [repository],
): FakeApi {
  const calls: Record<string, number> = {
    diagnostics: 0,
    listRepositories: 0,
    addRepository: 0,
    repository: 0,
    timeline: 0,
    changeSet: 0,
    diff: 0,
    worktreeDiff: 0,
    checks: 0,
    statsHotspots: 0,
    sessionChanges: 0,
    status: 0,
    previewOperation: 0,
    executeOperation: 0,
    listOperations: 0,
    getOperation: 0,
    listPullRequests: 0,
    pullRequestDetail: 0,
    branchCompare: 0,
  }
  const timelineQueries: TimelineQuery[] = []
  const operationQueries: OperationQuery[] = []
  const workspaceQueries: Array<string | null> = []
  const count = (name: string): void => {
    calls[name] = (calls[name] ?? 0) + 1
  }

  const base: VcsClient = {
    diagnostics: async () => {
      count('diagnostics')
      return unusedResult()
    },
    listRepositories: async (workspacePath: string | null) => {
      count('listRepositories')
      workspaceQueries.push(workspacePath)
      return accepted<RepositoryList>({ repositories: [...listed], diagnostics })
    },
    addRepository: async () => {
      count('addRepository')
      return unusedResult()
    },
    repository: async () => {
      count('repository')
      return accepted(repository)
    },
    timeline: async (query: TimelineQuery) => {
      count('timeline')
      timelineQueries.push(query)
      return accepted(timelinePage)
    },
    changeSet: async () => {
      count('changeSet')
      return unusedResult()
    },
    diff: async () => {
      count('diff')
      return unusedResult()
    },
    worktreeDiff: async () => {
      count('worktreeDiff')
      return unusedResult()
    },
    checks: async () => {
      count('checks')
      return unusedResult()
    },
    statsHotspots: async () => {
      count('statsHotspots')
      return unusedResult()
    },
    sessionChanges: async () => {
      count('sessionChanges')
      return unusedResult()
    },
    status: async () => {
      count('status')
      return accepted(status)
    },
    previewOperation: async () => {
      count('previewOperation')
      return unusedResult()
    },
    executeOperation: async () => {
      count('executeOperation')
      return unusedResult()
    },
    listOperations: async (query: OperationQuery) => {
      count('listOperations')
      operationQueries.push(query)
      return accepted(auditPage)
    },
    getOperation: async () => {
      count('getOperation')
      return unusedResult()
    },
    listPullRequests: async () => {
      count('listPullRequests')
      return unusedResult()
    },
    pullRequestDetail: async () => {
      count('pullRequestDetail')
      return unusedResult()
    },
    branchCompare: async () => {
      count('branchCompare')
      return unusedResult()
    },
  }

  return {
    api: { ...base, ...overrides } as VcsClient,
    calls,
    timelineQueries,
    operationQueries,
    workspaceQueries,
  }
}

interface Harness {
  sync: PanelSync
  fake: FakeApi
  timers: FakeTimers
  cache: PanelCache
  clock: { value: number }
}

/** 组装一个测试用服务：假 api + 假调度器 + 可控时钟。 */
function createHarness(
  options: Partial<DataSyncOptions> = {},
  apiOverrides: Partial<VcsClient> = {},
  listed: Repository[] = [repository],
): Harness {
  const clock = { value: 1_000 }
  const timers = createFakeTimers()
  const cache = options.cache ?? new PanelCache(() => clock.value)
  const fake = createFakeApi(apiOverrides, listed)
  const sync = createDataSync({
    api: fake.api,
    cache,
    now: () => clock.value,
    scheduler: timers.scheduler,
    visibility: () => true,
    documentLike: null,
    warmIntervalMs: 1_000,
    initialDelayMs: 100,
    visibleTimeoutMs: 5_000,
    resumeDelayMs: 800,
    ...options,
  })
  return { sync, fake, timers, cache, clock }
}

/** 便捷断言：没有排定的定时器。 */
function assertNoTimers(timers: FakeTimers): void {
  assert.deepEqual(timers.pendingDelays(), [])
}

// ───────────────────────────────────────────────────────────────────────────
// 首次 warm 与默认节奏
// ───────────────────────────────────────────────────────────────────────────

test('the first warm runs after the initial delay and fills the cache', async () => {
  const h = createHarness()
  h.sync.start()
  assert.deepEqual(h.timers.pendingDelays(), [100])
  assert.equal(h.sync.state().nextWarmAt, 1_100)

  await h.timers.fireNext()

  const runtime = h.sync.state()
  assert.equal(runtime.warming, false)
  assert.equal(runtime.lastWarmAt, 1_000)
  assert.deepEqual(runtime.lastError, null)
  assert.equal(h.fake.calls.listRepositories, 1)
  assert.equal(h.fake.calls.status, 1)
  assert.equal(h.fake.calls.timeline, 1)
  assert.equal(h.fake.calls.listOperations, 1)
  // hotspots / PR / checks / session / diagnostics 不主动拉取
  for (const name of ['diagnostics', 'checks', 'statsHotspots', 'listPullRequests', 'sessionChanges']) {
    assert.equal(h.fake.calls[name], 0, `${name} must not be warmed`)
  }

  const expectedQuery: TimelineQuery = {
    repositoryId: repository.id,
    limit: DEFAULT_PAGE_SIZE,
    includeFiles: true,
  }
  assert.deepEqual(h.fake.timelineQueries, [expectedQuery])
  assert.deepEqual(h.fake.operationQueries, [{ repositoryId: repository.id }])

  const snapshot = h.sync.hydrate(null)
  assert.ok(snapshot)
  assert.equal(snapshot.fromFallback, false)
  assert.deepEqual(snapshot.repositories?.map((entry) => entry.id), [repository.id])
  assert.equal(snapshot.selectedRepositoryId, repository.id)
  assert.equal(snapshot.data?.timeline?.queryKey, timelineQueryKey(expectedQuery))
  assert.deepEqual(snapshot.data?.timeline?.page, timelinePage)
  assert.equal(snapshot.data?.status, status)
  assert.equal(snapshot.data?.audit, auditPage)

  // 下一次按 warmIntervalMs 排定
  assert.deepEqual(h.timers.pendingDelays(), [1_000])
  assert.equal(h.sync.state().nextWarmAt, 2_000)
})

test('the defaults are a 1200ms first delay and a 30s interval', async () => {
  const h = createHarness({ initialDelayMs: undefined, warmIntervalMs: undefined })
  h.sync.start()
  assert.deepEqual(h.timers.pendingDelays(), [1_200])
  assert.equal(h.sync.state().nextWarmAt, 2_200)

  await h.timers.fireNext()
  assert.deepEqual(h.timers.pendingDelays(), [30_000])
})

test('start() is idempotent and the service can be started again after stop()', async () => {
  const h = createHarness()
  h.sync.start()
  h.sync.start()
  assert.deepEqual(h.timers.pendingDelays(), [100])

  h.sync.stop()
  assertNoTimers(h.timers)

  h.sync.start()
  assert.deepEqual(h.timers.pendingDelays(), [100])
  await h.timers.fireNext()
  assert.equal(h.fake.calls.listRepositories, 1)
  h.sync.stop()
})

// ───────────────────────────────────────────────────────────────────────────
// 面板打开 / 页面不可见
// ───────────────────────────────────────────────────────────────────────────

test('an open panel pauses heavy warming and closing it schedules one light warm', async () => {
  const h = createHarness()
  h.sync.start()
  h.sync.setPanelOpen(true)
  assert.equal(h.sync.state().panelOpen, true)
  assert.equal(h.sync.state().nextWarmAt, null)
  assertNoTimers(h.timers)

  // 面板打开期间即使显式要求 warm 也不发请求
  h.sync.warmNow('manual')
  await flushMicrotasks()
  assert.equal(h.fake.calls.listRepositories, 0)

  h.sync.setPanelOpen(false)
  assert.deepEqual(h.timers.pendingDelays(), [800])
  assert.equal(h.sync.state().nextWarmAt, 1_800)
  await h.timers.fireNext()
  assert.equal(h.fake.calls.listRepositories, 1)
})

test('a warm is skipped while the page is hidden and retried on the next tick', async () => {
  const h = createHarness({ visibility: () => false })
  h.sync.start()
  assert.equal(h.sync.state().nextWarmAt, 1_100)

  await h.timers.fireNext()
  assert.equal(h.fake.calls.listRepositories, 0)
  assert.equal(h.sync.state().lastWarmAt, null)
  // 定时链没有断：一个周期后继续检查可见性
  assert.deepEqual(h.timers.pendingDelays(), [1_000])
  assert.equal(h.sync.state().nextWarmAt, 2_000)
})

test('visibilitychange warms once, is throttled, and the listener is removed on stop', async () => {
  const listeners = new Set<() => void>()
  let visible = false
  const h = createHarness({
    visibility: () => visible,
    documentLike: {
      visibilityState: 'hidden',
      addEventListener(type: string, listener: () => void): void {
        if (type === 'visibilitychange') listeners.add(listener)
      },
      removeEventListener(type: string, listener: () => void): void {
        if (type === 'visibilitychange') listeners.delete(listener)
      },
    },
  })
  h.sync.start()
  assert.equal(listeners.size, 1)

  visible = true
  h.clock.value = 6_000
  for (const listener of [...listeners]) listener()
  await flushMicrotasks()
  assert.equal(h.fake.calls.listRepositories, 1)

  // 5s 内再次可见被节流
  h.clock.value = 9_000
  for (const listener of [...listeners]) listener()
  await flushMicrotasks()
  assert.equal(h.fake.calls.listRepositories, 1)

  // 节流窗口过去后允许再次立即 warm。仓库列表还在复用窗口（2 分钟）内，
  // 因此只重读轻量切片：listRepositories 不再重复，status 增加一次。
  h.clock.value = 11_000
  for (const listener of [...listeners]) listener()
  await flushMicrotasks()
  assert.equal(h.sync.state().lastWarmAt, 11_000)
  assert.equal(h.fake.calls.listRepositories, 1)
  assert.equal(h.fake.calls.status, 2)

  h.sync.stop()
  assert.equal(listeners.size, 0)
})

test('the repository list is reused for two minutes between warm runs', async () => {
  const h = createHarness()
  h.sync.start()
  h.clock.value = 1_200
  await h.timers.fireNext()
  assert.equal(h.fake.calls.listRepositories, 1)

  // 下一轮 warm 仍复用 2 分钟内的仓库列表，只重读轻量切片。
  h.clock.value = 31_200
  await h.timers.fireNext()
  assert.equal(h.fake.calls.listRepositories, 1)
  assert.equal(h.fake.calls.status, 2)

  // 超过复用窗口后才重新发现仓库。
  h.clock.value = 150_000
  await h.timers.fireNext()
  assert.equal(h.fake.calls.listRepositories, 2)
  assert.equal(h.fake.calls.status, 3)
})

// ───────────────────────────────────────────────────────────────────────────
// 失败、退避与单飞
// ───────────────────────────────────────────────────────────────────────────

test('a failed repository listing records lastError and skips the slice reads', async () => {
  const failure: ApiError = { code: 'timeout', message: 'git timed out', retryable: true }
  const h = createHarness({}, { listRepositories: async () => ({ ok: false, error: failure }) })
  h.sync.start()
  await h.timers.fireNext()

  assert.deepEqual(h.sync.state().lastError, failure)
  assert.equal(h.sync.state().lastWarmAt, null)
  assert.equal(h.fake.calls.status, 0)
  assert.equal(h.fake.calls.timeline, 0)
  assert.equal(h.fake.calls.listOperations, 0)
  assert.deepEqual(h.timers.pendingDelays(), [2_000])
  assert.equal(h.sync.hydrate(null), null)
})

test('continuous failures double the interval up to the 4 minute cap', async () => {
  const failure: ApiError = { code: 'network-unknown', message: 'host down' }
  const h = createHarness({}, { listRepositories: async () => ({ ok: false, error: failure }) })
  h.sync.start()

  const expectedDelays = [2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 128_000, 240_000, 240_000]
  for (const delay of expectedDelays) {
    await h.timers.fireNext()
    assert.deepEqual(h.timers.pendingDelays(), [delay])
    assert.deepEqual(h.sync.state().lastError, failure)
  }
})

test('a success resets the exponential backoff', async () => {
  let failing = true
  const failure: ApiError = { code: 'network-unknown', message: 'host down' }
  const h = createHarness({}, {
    listRepositories: async () => (failing
      ? { ok: false, error: failure }
      : accepted<RepositoryList>({ repositories: [repository], diagnostics })),
  })
  h.sync.start()

  await h.timers.fireNext()
  await h.timers.fireNext()
  assert.deepEqual(h.timers.pendingDelays(), [4_000])

  failing = false
  await h.timers.fireNext()
  assert.deepEqual(h.sync.state().lastError, null)
  assert.equal(h.sync.state().lastWarmAt, 1_000)
  assert.deepEqual(h.timers.pendingDelays(), [1_000])
})

test('a failed slice is reported without discarding the slices that succeeded', async () => {
  const timelineFailure: ApiError = { code: 'output-too-large', message: 'too big' }
  const h = createHarness({}, { timeline: async () => ({ ok: false, error: timelineFailure }) })
  h.sync.start()
  await h.timers.fireNext()

  assert.deepEqual(h.sync.state().lastError, timelineFailure)
  const snapshot = h.sync.hydrate(null)
  assert.ok(snapshot)
  assert.equal(snapshot.data?.timeline, null)
  assert.equal(snapshot.data?.status, status)
  assert.equal(snapshot.data?.audit, auditPage)
  // 部分失败同样计入退避
  assert.deepEqual(h.timers.pendingDelays(), [2_000])
})

test('status and audit failures each only clear their own slice', async () => {
  const statusError: ApiError = { code: 'not-a-repository', message: 'gone' }
  const statusHarness = createHarness({}, { status: async () => ({ ok: false, error: statusError }) })
  statusHarness.sync.start()
  await statusHarness.timers.fireNext()
  const fromStatus = statusHarness.sync.hydrate(null)
  assert.ok(fromStatus)
  assert.equal(fromStatus.data?.status, null)
  assert.equal(fromStatus.data?.timeline?.page, timelinePage)
  assert.equal(fromStatus.data?.audit, auditPage)
  assert.deepEqual(statusHarness.sync.state().lastError, statusError)

  const auditError: ApiError = { code: 'internal', message: 'audit broken' }
  const auditHarness = createHarness({}, {
    listOperations: async () => ({ ok: false, error: auditError }),
  })
  auditHarness.sync.start()
  await auditHarness.timers.fireNext()
  const fromAudit = auditHarness.sync.hydrate(null)
  assert.ok(fromAudit)
  assert.equal(fromAudit.data?.audit, null)
  assert.equal(fromAudit.data?.timeline?.page, timelinePage)
  assert.equal(fromAudit.data?.status, status)
  assert.deepEqual(auditHarness.sync.state().lastError, auditError)
})

test('a rejected host promise becomes lastError instead of an unhandled rejection', async () => {
  const h = createHarness({}, { listRepositories: () => Promise.reject(new Error('boom')) })
  h.sync.start()
  await h.timers.fireNext()

  assert.equal(h.sync.state().lastError?.code, 'internal')
  assert.equal(h.sync.state().warming, false)
  assert.deepEqual(h.timers.pendingDelays(), [2_000])
})

test('an in-flight warm is single-flight and reported through state()', async () => {
  const gates: Array<() => void> = []
  const h = createHarness({}, {
    listRepositories: () => new Promise<ApiResult<RepositoryList>>((resolve) => {
      gates.push(() => resolve(accepted<RepositoryList>({ repositories: [repository], diagnostics })))
    }),
  })
  h.sync.start()
  await h.timers.fireNext()
  assert.equal(h.sync.state().warming, true)

  h.sync.warmNow('manual')
  h.sync.warmNow('focus')
  await flushMicrotasks()
  assert.equal(gates.length, 1, 'a second warm must not start while one is in flight')

  gates[0]?.()
  await flushMicrotasks()
  assert.equal(h.sync.state().warming, false)
  assert.equal(h.sync.state().lastWarmAt, 1_000)
  assert.deepEqual(h.timers.pendingDelays(), [1_000])
})

// ───────────────────────────────────────────────────────────────────────────
// stop 后在途结果必须丢弃
// ───────────────────────────────────────────────────────────────────────────

test('stop() clears timers and discards results that land afterwards', async () => {
  const gates: Array<() => void> = []
  const h = createHarness({}, {
    listRepositories: () => new Promise<ApiResult<RepositoryList>>((resolve) => {
      gates.push(() => resolve(accepted<RepositoryList>({ repositories: [repository], diagnostics })))
    }),
  })
  h.sync.start()
  await h.timers.fireNext()
  assert.equal(h.sync.state().warming, true)

  h.sync.stop()
  assert.equal(h.sync.state().running, false)
  assert.equal(h.sync.state().warming, false)
  assertNoTimers(h.timers)

  // 在途响应现在才回来：不得写入缓存、不得再排定定时器
  gates[0]?.()
  await flushMicrotasks()
  assert.equal(h.sync.hydrate(null), null)
  assert.equal(h.sync.state().lastWarmAt, null)
  assertNoTimers(h.timers)

  // stop 之后可以重新 start
  h.sync.start()
  assert.deepEqual(h.timers.pendingDelays(), [100])
  h.sync.stop()
})

// ───────────────────────────────────────────────────────────────────────────
// hydrate / remember* / 目标和 state
// ───────────────────────────────────────────────────────────────────────────

test('hydrate prefers the exact workspace and falls back to all workspaces', () => {
  const h = createHarness()
  h.sync.rememberRepositories('C:/Work/A', [repository], diagnostics, repository.id)
  h.sync.rememberStatus(repository.id, status)

  const exact = h.sync.hydrate('c:/work/a/')
  assert.ok(exact)
  assert.equal(exact.fromFallback, false)
  assert.equal(exact.workspacePath, 'c:/work/a/')
  assert.equal(exact.selectedRepositoryId, repository.id)
  assert.equal(exact.data?.status, status)
  assert.equal(exact.savedAt, 1_000)

  // 精确未命中且没有 all-workspaces 数据时返回 null
  assert.equal(h.sync.hydrate('C:/elsewhere'), null)

  h.sync.rememberRepositories(null, [repository], diagnostics, null)
  const fallback = h.sync.hydrate('C:/elsewhere')
  assert.ok(fallback)
  assert.equal(fallback.fromFallback, true)
  assert.equal(fallback.workspacePath, 'C:/elsewhere')
  // 列表没有记住选中项时取第一项
  assert.equal(fallback.selectedRepositoryId, repository.id)

  // workspace 为 null 时 all-workspaces 就是精确匹配，不算回退
  const all = h.sync.hydrate(null)
  assert.ok(all)
  assert.equal(all.fromFallback, false)
})

test('hydrate maps every cached slice and prefers the worktree checks report', () => {
  const h = createHarness()
  const queryKey = timelineQueryKey({
    repositoryId: repository.id,
    limit: DEFAULT_PAGE_SIZE,
    includeFiles: true,
  })
  h.sync.rememberRepositories(null, [repository], diagnostics, repository.id)
  h.sync.rememberTimeline(repository.id, queryKey, timelinePage)
  h.sync.rememberStatus(repository.id, status)
  h.sync.rememberAudit(repository.id, auditPage)
  h.sync.rememberHotspots(repository.id, hotspotReport)
  h.sync.rememberSession(repository.id, sessionChanges)
  h.sync.rememberChecks(repository.id, 'staged', stagedChecks)
  h.sync.rememberPullRequests(repository.id, pullRequestList)
  h.sync.rememberCompare(repository.id, branchCompare)

  const staged = h.sync.hydrate(null)
  assert.ok(staged)
  assert.equal(staged.data?.timeline?.queryKey, queryKey)
  assert.deepEqual(staged.data?.timeline?.page, timelinePage)
  assert.equal(staged.data?.checks?.scope, 'staged')
  assert.equal(staged.data?.checks?.value, stagedChecks)
  assert.equal(staged.data?.hotspots, hotspotReport)
  assert.equal(staged.data?.session, sessionChanges)
  assert.equal(staged.data?.pullRequests, pullRequestList)
  assert.equal(staged.data?.compare, branchCompare)

  // worktree 侧优先于 staged 侧
  h.sync.rememberChecks(repository.id, 'worktree', worktreeChecks)
  const both = h.sync.hydrate(null)
  assert.ok(both)
  assert.equal(both.data?.checks?.scope, 'worktree')
  assert.equal(both.data?.checks?.value, worktreeChecks)
})

test('remember* forwards every slice to the shared cache', () => {
  const h = createHarness()
  const queryKey = timelineQueryKey({ repositoryId: repository.id })

  h.sync.rememberTimeline(repository.id, queryKey, timelinePage)
  h.sync.rememberStatus(repository.id, status)
  h.sync.rememberAudit(repository.id, auditPage)
  h.sync.rememberHotspots(repository.id, hotspotReport)
  h.sync.rememberSession(repository.id, sessionChanges)
  h.sync.rememberChecks(repository.id, 'worktree', worktreeChecks)
  h.sync.rememberPullRequests(repository.id, pullRequestList)
  h.sync.rememberCompare(repository.id, branchCompare)

  assert.equal(h.cache.readTimeline(repository.id)?.queryKey, queryKey)
  assert.equal(h.cache.readStatus(repository.id)?.value, status)
  assert.equal(h.cache.readAudit(repository.id)?.page, auditPage)
  assert.equal(h.cache.readHotspots(repository.id)?.value, hotspotReport)
  assert.equal(h.cache.readSession(repository.id)?.value, sessionChanges)
  assert.equal(h.cache.readChecks(repository.id, 'worktree')?.value, worktreeChecks)
  assert.equal(h.cache.readPullRequests(repository.id)?.value, pullRequestList)
  assert.equal(h.cache.readCompare(repository.id)?.value, branchCompare)
})

test('the next warm targets the active, then the remembered, repository', async () => {
  const other: Repository = {
    ...repository,
    id: 'git:c:/fake/other',
    rootPath: 'C:/fake/other',
    displayName: 'other',
  }

  // 显式选中的仓库优先，并把 workspace 传给 listRepositories
  const active = createHarness({}, {}, [repository, other])
  active.sync.setWorkspace('C:/fake')
  active.sync.setActiveRepository(other.id)
  assert.equal(active.sync.state().repositoryId, other.id)
  active.sync.start()
  await active.timers.fireNext()
  assert.deepEqual(active.fake.workspaceQueries, ['C:/fake'])
  assert.equal(active.fake.timelineQueries[0]?.repositoryId, other.id)
  assert.deepEqual(active.fake.operationQueries[0], { repositoryId: other.id })

  // 没有显式选中时用缓存里上次看过的仓库
  const rememberedCache = new PanelCache(() => 1)
  rememberedCache.noteLocation(null, other.id)
  const remembered = createHarness({ cache: rememberedCache }, {}, [repository, other])
  remembered.sync.start()
  await remembered.timers.fireNext()
  assert.equal(remembered.fake.timelineQueries[0]?.repositoryId, other.id)

  // 显式选中的仓库已从列表消失时回退到记住的仓库（而不是列表第一项）
  const stale = createHarness({}, {}, [repository, other])
  stale.sync.setActiveRepository('git:c:/gone')
  stale.cache.noteLocation(null, other.id)
  stale.sync.start()
  await stale.timers.fireNext()
  assert.equal(stale.fake.timelineQueries[0]?.repositoryId, other.id)

  // 两个都没有时取列表第一项
  const first = createHarness({}, {}, [repository, other])
  first.sync.start()
  await first.timers.fireNext()
  assert.equal(first.fake.timelineQueries[0]?.repositoryId, repository.id)
})

test('noteActiveView records the location for the next warm', () => {
  const other: Repository = {
    ...repository,
    id: 'git:c:/fake/other',
    rootPath: 'C:/fake/other',
    displayName: 'other',
  }
  const h = createHarness({}, {}, [repository, other])
  h.sync.noteActiveView({ workspacePath: 'C:/fake', repositoryId: other.id })

  assert.deepEqual(h.cache.readLocation(), { workspacePath: 'C:/fake', repositoryId: other.id })
  assert.equal(h.sync.state().workspacePath, 'C:/fake')
  assert.equal(h.sync.state().repositoryId, other.id)
})

test('state() exposes the runtime facts of the service', () => {
  const h = createHarness()
  assert.deepEqual(h.sync.state(), {
    running: false,
    panelOpen: false,
    workspacePath: null,
    repositoryId: null,
    warming: false,
    lastWarmAt: null,
    nextWarmAt: null,
    lastError: null,
  })

  h.sync.setWorkspace('C:/work/project')
  h.sync.setActiveRepository(repository.id)
  h.sync.start()
  assert.deepEqual(h.sync.state(), {
    running: true,
    panelOpen: false,
    workspacePath: 'C:/work/project',
    repositoryId: repository.id,
    warming: false,
    lastWarmAt: null,
    nextWarmAt: 1_100,
    lastError: null,
  })

  h.sync.setPanelOpen(true)
  assert.equal(h.sync.state().panelOpen, true)
  assert.equal(h.sync.state().nextWarmAt, null)

  h.sync.setPanelOpen(false)
  assert.equal(h.sync.state().nextWarmAt, 1_800)

  h.sync.stop()
  assert.equal(h.sync.state().running, false)
  assert.equal(h.sync.state().nextWarmAt, null)
})
