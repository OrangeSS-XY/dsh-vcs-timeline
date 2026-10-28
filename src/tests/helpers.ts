/**
 * Test helpers: an in-memory {@link TimelineStore}, a scriptable adapter, and
 * a fake {@link Runner}. Kept dependency-free so host-service tests never
 * depend on the JSONL implementation under test elsewhere.
 * @module dsh-vcs-timeline/tests/helpers
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  ChangeSet,
  DiffResult,
  OperationAttempt,
  OperationPage,
  OperationQuery,
  Repository,
  TimelinePage,
  TimelineQuery,
  VcsEvent,
  WorktreeDiffResult,
} from '../shared/contracts.ts'
import type {
  AdapterDiffQuery,
  AdapterWorktreeDiffQuery,
  HistoryPage,
  HistoryQuery,
  OperationBeforeState,
  OperationParams,
  OperationPlan,
  RunOptions,
  RunResult,
  Runner,
  VcsAdapter,
} from '../host/adapters/types.ts'
import type { TimelineStore } from '../host/storage/interface.ts'

/** Create a temp directory removed by the returned disposer. */
export async function makeTempDir(prefix = 'dvt-test-'): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const path = await mkdtemp(join(tmpdir(), prefix))
  return {
    path,
    cleanup: async () => {
      await rm(path, { recursive: true, force: true, maxRetries: 3 })
    },
  }
}

/** In-memory store with the same observable semantics as the JSONL store. */
export function createMemoryStore(): TimelineStore & {
  events: VcsEvent[]
  operations: OperationAttempt[]
  repositories: Repository[]
  changesets: ChangeSet[]
} {
  const events: VcsEvent[] = []
  const operations: OperationAttempt[] = []
  const repositories: Repository[] = []
  const changesets: ChangeSet[] = []

  const fold = (): OperationAttempt[] => {
    const byId = new Map<string, OperationAttempt>()
    for (const attempt of operations) {
      const previous = byId.get(attempt.id)
      if (previous === undefined || previous.state === 'started' || previous.state === 'running') byId.set(attempt.id, attempt)
    }
    return [...byId.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  }

  return {
    events,
    operations,
    repositories,
    changesets,
    location: () => ':memory:',
    async init() {},
    async appendRepository(record) { repositories.push(record) },
    async appendEvent(record) { events.push(record) },
    async appendChangeSet(record) { changesets.push(record) },
    async appendOperation(record) { operations.push(record) },
    async listRepositories() {
      const byId = new Map<string, Repository>()
      for (const repository of repositories) byId.set(repository.id, repository)
      return [...byId.values()]
    },
    async getRepository(id) {
      let found: Repository | undefined
      for (const repository of repositories) if (repository.id === id) found = repository
      return found
    },
    async queryEvents(query: TimelineQuery): Promise<TimelinePage> {
      const filtered = events
        .filter(event => event.repositoryId === query.repositoryId)
        .filter(event => query.eventTypes === undefined || query.eventTypes.length === 0 || query.eventTypes.includes(event.eventType))
        .filter(event => query.author === undefined || (event.actor ?? '').toLowerCase().includes(query.author.toLowerCase()))
        .filter(event => query.text === undefined || event.summary.toLowerCase().includes(query.text.toLowerCase()))
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      const limit = Math.min(100, Math.max(1, query.limit ?? 30))
      return { events: filtered.slice(0, limit), nextCursor: filtered.length > limit ? 'next' : null, hasMore: filtered.length > limit }
    },
    async queryOperations(query: OperationQuery): Promise<OperationPage> {
      const all = fold().filter(attempt => query.repositoryId === undefined || attempt.repositoryId === query.repositoryId)
      const limit = Math.min(100, Math.max(1, query.limit ?? 30))
      return { operations: all.slice(0, limit), nextCursor: all.length > limit ? 'next' : null, hasMore: all.length > limit }
    },
    async getOperation(id) {
      return fold().find(attempt => attempt.id === id)
    },
    async close() {},
  }
}

/** Options for the scriptable adapter. */
export interface FakeAdapterOptions {
  vcsType?: 'git' | 'svn'
  history?: (query: HistoryQuery) => Promise<HistoryPage>
  before?: OperationBeforeState
  plan?: (operation: string, params: OperationParams) => OperationPlan
  detectRoot?: string | null
  info?: (root: string) => Repository
  status?: Awaited<ReturnType<VcsAdapter['status']>>
  changeset?: ChangeSet
  diff?: (query: AdapterDiffQuery) => Promise<DiffResult>
  worktreeDiff?: (query: AdapterWorktreeDiffQuery) => Promise<WorktreeDiffResult>
}

/** Build a scriptable adapter. */
export function createFakeAdapter(options: FakeAdapterOptions = {}): VcsAdapter {
  const vcsType = options.vcsType ?? 'git'
  const root = options.detectRoot ?? 'C:/fake/repo'
  const repository: Repository = options.info?.(root) ?? {
    schemaVersion: 1,
    id: `${vcsType}:${root.toLowerCase()}`,
    vcsType,
    rootPath: root,
    displayName: 'repo',
    currentBranch: 'main',
    currentRevision: 'abc123',
    detectedAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
  }
  return {
    vcsType,
    async detect() {
      return options.detectRoot === null ? { ok: true, value: null } : { ok: true, value: { rootPath: root } }
    },
    async info(requestedRoot) {
      if (options.info !== undefined) return { ok: true, value: options.info(requestedRoot) }
      return { ok: true, value: repository }
    },
    async history(_root, _repositoryId, query): Promise<Awaited<ReturnType<VcsAdapter['history']>>> {
      if (options.history !== undefined) return { ok: true, value: await options.history(query) }
      return { ok: true, value: { events: [], nextCursor: null, hasMore: false } }
    },
    async changeSet() {
      return options.changeset === undefined
        ? { ok: false, error: { code: 'operation-failed', message: 'no changeset' } }
        : { ok: true, value: options.changeset }
    },
    async diff(_root, _repositoryId, query) {
      if (options.diff !== undefined) return { ok: true, value: await options.diff(query) }
      return { ok: true, value: { repositoryId: repository.id, revisionA: null, revisionB: 'abc', text: '', truncated: false, binary: false, bytes: 0 } }
    },
    async worktreeDiff(_root, _repositoryId, query) {
      if (options.worktreeDiff !== undefined) return { ok: true, value: await options.worktreeDiff(query) }
      return {
        ok: true,
        value: {
          repositoryId: repository.id,
          filePath: query.filePath ?? null,
          staged: query.staged,
          kind: 'tracked',
          text: '',
          truncated: false,
          binary: false,
          bytes: 0,
        },
      }
    },
    async status() {
      return options.status ?? { ok: true, value: { repositoryId: repository.id, vcsType, clean: true, entries: [], conflicts: [] } }
    },
    async beforeState() {
      return { ok: true, value: options.before ?? { branch: 'main', head: 'abc123', clean: true } }
    },
    async planOperation(_root, operation, params) {
      return {
        ok: true,
        value: options.plan?.(operation, params) ?? {
          allowed: true,
          argv: ['git', operation],
          cwd: root,
          summary: `${operation} on repo`,
          warnings: [],
          network: operation !== 'commit',
        },
      }
    },
  }
}

/** Fake runner that records every invocation and answers from a script. */
export function createFakeRunner(answer: (argv: readonly string[], cwd: string, options?: RunOptions) => Promise<RunResult> | RunResult): Runner & { calls: Array<{ argv: readonly string[]; cwd: string }> } {
  const calls: Array<{ argv: readonly string[]; cwd: string }> = []
  return {
    calls,
    async run(argv, cwd, options) {
      calls.push({ argv, cwd })
      return answer(argv, cwd, options)
    },
    async resolveExecutable(command) {
      return `${command}-path`
    },
  }
}

/** A minimal valid git-like commit event factory. */
export function commitEvent(overrides: Partial<VcsEvent> = {}): VcsEvent {
  return {
    schemaVersion: 1,
    id: 'evt-1',
    repositoryId: 'git:c:/fake/repo',
    vcsType: 'git',
    eventType: 'commit',
    source: 'repository',
    timestamp: '2026-01-02T03:04:05.000Z',
    actor: 'Dev',
    summary: 'initial commit',
    commitHash: 'a'.repeat(40),
    ...overrides,
  }
}

/** Audit double that records the lifecycle into the in-memory store. */
export function createFakeAudit(store: TimelineStore, options: { failStart?: boolean } = {}) {
  let sequence = 0
  return {
    async start(input: {
      repositoryId: string
      vcsType: 'git' | 'svn'
      operation: OperationAttempt['operation']
      requestSummary: string
      before?: OperationBeforeState
    }): Promise<OperationAttempt> {
      if (options.failStart === true) throw new Error('audit store unavailable')
      sequence += 1
      const attempt: OperationAttempt = {
        schemaVersion: 1,
        id: `op-${String(sequence).padStart(4, '0')}`,
        repositoryId: input.repositoryId,
        vcsType: input.vcsType,
        operation: input.operation,
        state: 'started',
        startedAt: new Date(2026, 0, 1, 0, 0, sequence).toISOString(),
        actor: 'user-via-plugin',
        requestSummary: input.requestSummary,
        correlationId: `corr-${sequence}`,
      }
      await store.appendOperation(attempt)
      return attempt
    },
    async finish(attempt: OperationAttempt, input: {
      state: 'succeeded' | 'failed' | 'partial' | 'unknown'
      exitCode?: number | null
      errorCode?: string
      safeErrorMessage?: string
      outputSummary?: string
      after?: OperationBeforeState
      changedPaths?: string[]
      remoteOutcome?: 'confirmed-success' | 'confirmed-failure' | 'unknown'
    }): Promise<OperationAttempt> {
      const finished: OperationAttempt = {
        ...attempt,
        state: input.state,
        finishedAt: new Date(2026, 0, 1, 0, 1, sequence).toISOString(),
        ...(input.exitCode === undefined ? {} : { exitCode: input.exitCode ?? -1 }),
        ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
        ...(input.safeErrorMessage === undefined ? {} : { safeErrorMessage: input.safeErrorMessage }),
        ...(input.outputSummary === undefined ? {} : { outputSummary: input.outputSummary }),
        ...(input.after?.revision === undefined ? {} : { afterRevision: input.after.revision }),
        ...(input.changedPaths === undefined ? {} : { changedPaths: input.changedPaths }),
        ...(input.remoteOutcome === undefined ? {} : { remoteOutcome: input.remoteOutcome }),
      }
      await store.appendOperation(finished)
      return finished
    },
  }
}
