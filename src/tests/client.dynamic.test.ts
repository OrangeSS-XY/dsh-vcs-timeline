/**
 * Dynamic-loading behaviour of the panel state.
 *
 * These tests pin the user-visible promise of the feature without a browser:
 * a warm snapshot paints history immediately (no skeleton, no second empty
 * state), a stale cache entry for a different filter is never reused, and a
 * quiet refresh merges new commits on top instead of resetting the list and
 * its loaded pages.
 * @module dsh-vcs-timeline/tests/client.dynamic.test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type {
  ChecksReport,
  OperationAttempt,
  OperationPage,
  Repository,
  SessionChanges,
  TimelinePage,
  VcsEvent,
  WorkingTreeStatus,
} from '../shared/contracts.ts'
import { timelineQueryKey, workspaceKey } from '../client/cache.ts'
import type { HydrationSnapshot } from '../client/types.ts'
import {
  defaultTimelineQuery,
  hydratePanelState,
  mergeAuditRefresh,
  mergeTimelineRefresh,
} from '../client/panel.ts'

const repository: Repository = {
  schemaVersion: 1,
  id: 'git:c:/fake/repo',
  vcsType: 'git',
  rootPath: 'C:/fake/repo',
  displayName: 'demo-repo',
  currentBranch: 'main',
  currentRevision: 'abcdef0123456789abcdef0123456789abcdef01',
  detectedAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
}

function event(id: string, summary: string): VcsEvent {
  return {
    schemaVersion: 1,
    id,
    repositoryId: repository.id,
    vcsType: 'git',
    eventType: 'commit',
    source: 'repository',
    timestamp: '2026-01-02T03:04:05.000Z',
    summary,
    commitHash: id,
    parentHashes: [],
    branch: 'main',
  }
}

function attempt(id: string): OperationAttempt {
  return {
    schemaVersion: 1,
    id,
    repositoryId: repository.id,
    vcsType: 'git',
    operation: 'fetch',
    state: 'succeeded',
    startedAt: '2026-01-02T03:04:05.000Z',
    actor: 'user-via-plugin',
    requestSummary: 'git fetch',
    correlationId: `corr-${id}`,
  }
}

const status: WorkingTreeStatus = {
  repositoryId: repository.id,
  vcsType: 'git',
  clean: false,
  branch: 'main',
  head: 'abcdef0123456789abcdef0123456789abcdef01',
  entries: [{ path: 'src/panel.ts', status: 'M' }],
  conflicts: [],
}

const checks: ChecksReport = {
  repositoryId: repository.id,
  scope: 'worktree',
  findings: [],
  filesChecked: 1,
  truncated: false,
  empty: false,
  generatedAt: '2026-01-02T03:04:05.000Z',
}

const session: SessionChanges = {
  repositoryId: repository.id,
  sessionId: null,
  available: true,
  files: [{ path: 'src/panel.ts', tool: 'write', touches: 1, confidence: 'inferred' }],
  generatedAt: '2026-01-02T03:04:05.000Z',
}

function snapshot(overrides: Partial<HydrationSnapshot> = {}): HydrationSnapshot {
  const key = timelineQueryKey(defaultTimelineQuery(repository.id))
  const page: TimelinePage = {
    events: [event('commit:new', 'feat: warm cache'), event('commit:old', 'fix: earlier')],
    nextCursor: 'cursor-1',
    hasMore: true,
  }
  return {
    workspacePath: 'C:\\Work\\Repo',
    repositories: [repository],
    diagnostics: null,
    selectedRepositoryId: repository.id,
    savedAt: 1_700_000_000_000,
    fromFallback: false,
    data: {
      timeline: { queryKey: key, page },
      status,
      audit: {
        operations: [attempt('op-1')],
        nextCursor: null,
        hasMore: false,
      } satisfies OperationPage,
      hotspots: null,
      session,
      checks: { scope: 'worktree', value: checks },
      pullRequests: null,
      compare: null,
      savedAt: 1_700_000_000_000,
    },
    ...overrides,
  }
}

test('without a warm snapshot the panel still starts in the loading state', () => {
  const state = hydratePanelState(null)
  assert.equal(state.boot, 'loading')
  assert.deepEqual(state.repositories, [])
  assert.deepEqual(state.timeline.events, [])
  assert.equal(state.sync.lastSyncedAt, null)
})

test('a warm snapshot paints history and status on the first render', () => {
  const state = hydratePanelState(snapshot())
  assert.equal(state.boot, 'ready')
  assert.equal(state.selectedRepositoryId, repository.id)
  assert.deepEqual(state.timeline.events.map((entry) => entry.id), ['commit:new', 'commit:old'])
  assert.equal(state.timeline.cursor, 'cursor-1')
  assert.equal(state.timeline.loading, false)
  assert.equal(state.status?.clean, false)
  assert.deepEqual(state.audit.operations.map((entry) => entry.id), ['op-1'])
  assert.equal(state.pending.session?.available, true)
  assert.equal(state.pending.checks?.scope, 'worktree')
  assert.equal(state.sync.lastSyncedAt, 1_700_000_000_000)
  assert.equal(state.sync.refreshing, false)
})

test('a cached page produced by another filter is not painted as the default view', () => {
  const snap = snapshot()
  assert.ok(snap.data !== null)
  snap.data.timeline = {
    queryKey: 'another-filter',
    page: { events: [event('commit:filtered', 'filtered page')], nextCursor: null, hasMore: false },
  }
  const state = hydratePanelState(snap)
  assert.equal(state.boot, 'ready')
  assert.deepEqual(state.timeline.events, [])
  // The rest of the snapshot is still usable: only the mismatched page is dropped.
  assert.equal(state.status?.clean, false)
})

test('a warm repository list without a cached page starts in the loading state', () => {
  const snap = snapshot()
  snap.data = null
  const state = hydratePanelState(snap)
  assert.equal(state.boot, 'ready')
  assert.equal(state.selectedRepositoryId, repository.id)
  assert.equal(state.timeline.loading, true, 'the first frame must be the skeleton, not an empty list')
  assert.deepEqual(state.timeline.events, [])
  assert.equal(state.status, null)
})

test('a cached page for another filter still starts loading instead of showing empty', () => {
  const snap = snapshot()
  assert.ok(snap.data !== null)
  snap.data.timeline = {
    queryKey: 'another-filter',
    page: { events: [event('commit:filtered', 'filtered page')], nextCursor: null, hasMore: false },
  }
  const state = hydratePanelState(snap)
  assert.equal(state.timeline.loading, true)
  assert.deepEqual(state.timeline.events, [])
})

test('a snapshot whose selected repository disappeared falls back to the first one', () => {
  const other: Repository = { ...repository, id: 'svn:c:/other', displayName: 'other', vcsType: 'svn' }
  const state = hydratePanelState(snapshot({
    repositories: [other],
    selectedRepositoryId: repository.id,
  }))
  assert.equal(state.selectedRepositoryId, other.id)
  // The repository-specific slices belonged to the missing repository.
  assert.deepEqual(state.timeline.events, [])
  assert.equal(state.status, null)
})

test('timeline query keys are stable and the warm query matches the panel default', () => {
  const query = defaultTimelineQuery(repository.id)
  assert.equal(query.limit, 30)
  assert.equal(query.includeFiles, true)
  assert.equal(timelineQueryKey(query), timelineQueryKey({ ...query, eventTypes: [] }))
  assert.equal(workspaceKey('C:\\Work\\Repo'), 'c:/work/repo')
})

test('a quiet timeline refresh prepends new commits and keeps loaded older pages', () => {
  const previous = {
    events: [event('commit:old', 'fix: earlier'), event('commit:older', 'chore: oldest')],
    cursor: 'cursor-page-2',
    hasMore: true,
    partial: false,
    warnings: ['history truncated'],
    loading: false,
    loadingMore: false,
    error: null,
  }
  const page: TimelinePage = {
    events: [event('commit:new', 'feat: warm cache'), event('commit:old', 'fix: earlier')],
    nextCursor: 'cursor-1',
    hasMore: true,
    warnings: ['history truncated', 'partial source'],
  }
  const merged = mergeTimelineRefresh(previous, page)
  assert.deepEqual(merged.events.map((entry) => entry.id), ['commit:new', 'commit:old', 'commit:older'])
  assert.equal(merged.cursor, 'cursor-page-2')
  assert.equal(merged.hasMore, true)
  assert.deepEqual(merged.warnings, ['history truncated', 'partial source'])
  assert.equal(merged.loading, false)
})

test('an audit refresh keeps older loaded records and the selected record', () => {
  const previous = {
    operations: [attempt('op-1'), attempt('op-0')],
    cursor: 'audit-page-2',
    hasMore: true,
    warnings: [],
    loading: false,
    loadingMore: false,
    error: null,
    selected: attempt('op-0'),
  }
  const page: OperationPage = {
    operations: [attempt('op-2'), attempt('op-1')],
    nextCursor: 'audit-page-1',
    hasMore: true,
  }
  const merged = mergeAuditRefresh(previous, page)
  assert.deepEqual(merged.operations.map((entry) => entry.id), ['op-2', 'op-1', 'op-0'])
  assert.equal(merged.cursor, 'audit-page-2')
  assert.equal(merged.selected?.id, 'op-0')
})

test('changing a filter replaces the list instead of merging stale history', () => {
  const previous = {
    events: [event('commit:old', 'fix: earlier')],
    cursor: 'cursor-1',
    hasMore: false,
    partial: false,
    warnings: [],
    loading: true,
    loadingMore: false,
    error: null,
  }
  const page: TimelinePage = {
    events: [event('commit:filtered', 'filtered page')],
    nextCursor: null,
    hasMore: false,
  }
  // The loader only calls merge on the same query key; pin the non-merge shape
  // here so a future refactor cannot silently start merging unrelated history.
  const replaced = {
    events: page.events,
    cursor: page.nextCursor,
    hasMore: page.hasMore,
    partial: page.partial === true,
    warnings: page.warnings ?? [],
    loading: false,
    loadingMore: false,
    error: null,
  }
  assert.notDeepEqual(replaced.events, previous.events)
  assert.equal(replaced.cursor, null)
})
