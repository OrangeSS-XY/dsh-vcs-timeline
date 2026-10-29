/**
 * In-memory cache tests for the dynamic-loading layer.
 *
 * The cache is the only shared state between the background warmer and the
 * panel, so these tests pin the two things that can silently corrupt a view:
 * the timeline query key (a filtered page must never be reused for another
 * filter) and workspace key normalization on Windows paths.
 * @module dsh-vcs-timeline/tests/client.cache.test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_CACHED_REPOSITORIES, PanelCache, timelineQueryKey, workspaceKey } from '../client/cache.ts'

test('workspaceKey normalizes Windows separators, case and trailing slashes', () => {
  assert.equal(workspaceKey('E:\\SoftData\\Repo\\'), 'e:/softdata/repo')
  assert.equal(workspaceKey('E:/SoftData/Repo'), 'e:/softdata/repo')
  assert.equal(workspaceKey(null), '*')
  assert.equal(workspaceKey('   '), '*')
})

test('timelineQueryKey ignores event-type order but distinguishes real filters', () => {
  const base = { repositoryId: 'git:c:/repo', limit: 30, includeFiles: true }
  const a = timelineQueryKey({ ...base, eventTypes: ['push', 'commit'] })
  const b = timelineQueryKey({ ...base, eventTypes: ['commit', 'push'] })
  assert.equal(a, b)
  assert.notEqual(a, timelineQueryKey({ ...base, eventTypes: ['commit'] }))
  assert.notEqual(a, timelineQueryKey({ ...base, text: 'fix' }))
  assert.notEqual(a, timelineQueryKey({ ...base, branch: 'main' }))
  assert.notEqual(a, timelineQueryKey({ ...base, branchScope: 'all' }))
  assert.notEqual(a, timelineQueryKey({ ...base, includeFiles: false }))
  assert.notEqual(a, timelineQueryKey({ ...base, repositoryId: 'git:c:/other' }))
})

test('cache stores and timestamps every slice independently', () => {
  let clock = 1_000
  const cache = new PanelCache(() => clock)
  cache.rememberRepositories('C:\\Work\\Repo', [], {} as never, null)
  assert.equal(cache.readRepositories('c:/work/repo')?.savedAt, 1_000)
  assert.equal(cache.readRepositories('C:\\Other')?.savedAt, undefined)

  cache.rememberStatus('git:c:/repo', {
    repositoryId: 'git:c:/repo',
    vcsType: 'git',
    clean: true,
    entries: [],
    conflicts: [],
  })
  clock += 500
  cache.rememberTimeline('git:c:/repo', 'key-1', { events: [], nextCursor: null, hasMore: false })
  assert.equal(cache.readStatus('git:c:/repo')?.savedAt, 1_000)
  assert.equal(cache.readTimeline('git:c:/repo')?.savedAt, 1_500)
  assert.equal(cache.readTimeline('git:c:/repo')?.queryKey, 'key-1')
  assert.equal(cache.readRepository('git:c:/repo')?.savedAt, 1_500)
})

test('cache remembers the last viewed location', () => {
  const cache = new PanelCache(() => 0)
  cache.noteLocation('C:\\Work', 'git:c:/work')
  assert.deepEqual(cache.readLocation(), { workspacePath: 'C:\\Work', repositoryId: 'git:c:/work' })
})

test('cache bounds how many repositories keep slices', () => {
  const cache = new PanelCache(() => 0)
  for (let index = 0; index < MAX_CACHED_REPOSITORIES + 3; index += 1) {
    cache.rememberTimeline(`git:c:/repo-${index}`, 'key', { events: [], nextCursor: null, hasMore: false })
  }
  assert.equal(cache.repositoryCount(), MAX_CACHED_REPOSITORIES)
  // The three oldest entries were evicted; the newest ones remain.
  assert.equal(cache.hasRepository('git:c:/repo-0'), false)
  assert.equal(cache.hasRepository(`git:c:/repo-${MAX_CACHED_REPOSITORIES + 2}`), true)
})

test('clear forgets repositories and location', () => {
  const cache = new PanelCache(() => 0)
  cache.rememberStatus('git:c:/repo', {
    repositoryId: 'git:c:/repo',
    vcsType: 'git',
    clean: true,
    entries: [],
    conflicts: [],
  })
  cache.noteLocation('C:\\Work', 'git:c:/repo')
  cache.clear()
  assert.equal(cache.repositoryCount(), 0)
  assert.equal(cache.hasRepository('git:c:/repo'), false)
  assert.deepEqual(cache.readLocation(), { workspacePath: null, repositoryId: null })
})
