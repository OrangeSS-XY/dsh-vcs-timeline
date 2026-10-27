/**
 * File-centered index: aggregation, tree building and shared filtering.
 *
 * These are the rules that keep the tree and the timeline on one filter state,
 * so they are pinned without React or a DOM.
 * @module dsh-vcs-timeline/tests/client.fileindex.test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { VcsEvent } from '../shared/contracts.ts'
import { authorHue, authorInitials, dayLabel, localDayKey, relativeTime } from '../client/format.ts'
import {
  aggregateChangedFiles,
  buildFileTree,
  buildTimelineView,
  directoryPaths,
  eventFileStatus,
  eventFiles,
  eventsForFile,
  eventsHavingFiles,
  filterFileEntries,
  groupEventsByDay,
  reportsFiles,
  statusCounts,
} from '../client/file-index.ts'

function event(overrides: Partial<VcsEvent> & Pick<VcsEvent, 'id'>): VcsEvent {
  return {
    schemaVersion: 1,
    repositoryId: 'git:c:/repo',
    vcsType: 'git',
    eventType: 'commit',
    source: 'repository',
    timestamp: '2026-01-02T03:04:05.000Z',
    summary: 'commit',
    actor: 'Alice',
    ...overrides,
  }
}

const newest = event({
  id: 'e1',
  timestamp: '2026-01-03T00:00:00.000Z',
  summary: 'newest',
  changedFiles: [
    { path: 'src/client/panel.ts', status: 'modified', additions: 5, deletions: 2 },
    { path: 'docs/readme.md', status: 'added', additions: 9 },
  ],
})

const older = event({
  id: 'e2',
  timestamp: '2026-01-02T00:00:00.000Z',
  summary: 'older',
  changedFiles: [
    { path: 'src/client/panel.ts', status: 'modified', additions: 1, deletions: 1 },
    { path: 'src/old.ts', status: 'renamed', oldPath: 'src/legacy.ts', additions: 2, deletions: 2 },
  ],
})

test('a commit without a reported file list is distinguishable from an empty one', () => {
  const bare = event({ id: 'bare' })
  assert.equal(eventFiles(bare), null)
  assert.equal(eventFiles(event({ id: 'empty', changedFiles: [] }))?.length, 0)
  assert.equal(reportsFiles([bare]), false)
  assert.equal(reportsFiles([bare, newest]), true)
})

test('files aggregate across commits with the newest status and summed line counts', () => {
  const entries = aggregateChangedFiles([newest, older])
  assert.equal(entries.length, 3)
  const panel = entries.find((entry) => entry.path === 'src/client/panel.ts')
  assert.deepEqual(panel, {
    path: 'src/client/panel.ts',
    status: 'modified',
    changes: 2,
    additions: 6,
    deletions: 3,
    binary: false,
    lastEventId: 'e1',
    lastTimestamp: '2026-01-03T00:00:00.000Z',
    lastSummary: 'newest',
    lastActor: 'Alice',
  })
  const renamed = entries.find((entry) => entry.path === 'src/old.ts')
  assert.equal(renamed?.status, 'renamed')
  assert.equal(renamed?.oldPath, 'src/legacy.ts')
  // Unreported line counts contribute nothing rather than a fake zero entry.
  const added = entries.find((entry) => entry.path === 'docs/readme.md')
  assert.equal(added?.deletions, 0)
})

test('status counts stay exact for the tree chips', () => {
  const counts = statusCounts(aggregateChangedFiles([newest, older]))
  assert.deepEqual(counts, { all: 3, added: 1, modified: 1, deleted: 0, renamed: 1 })
})

test('the tree search matches paths, names and rename sources; status filters are exact', () => {
  const entries = aggregateChangedFiles([newest, older])
  assert.deepEqual(filterFileEntries(entries, 'panel', 'all').map((entry) => entry.path), ['src/client/panel.ts'])
  assert.deepEqual(filterFileEntries(entries, 'CLIENT/', 'all').map((entry) => entry.path), ['src/client/panel.ts'])
  assert.deepEqual(filterFileEntries(entries, 'legacy', 'all').map((entry) => entry.path), ['src/old.ts'])
  assert.deepEqual(filterFileEntries(entries, '', 'renamed').map((entry) => entry.path), ['src/old.ts'])
  assert.deepEqual(filterFileEntries(entries, 'zzz', 'all'), [])
})

test('the tree nests by path, counts files per directory and sorts dirs first', () => {
  const tree = buildFileTree(aggregateChangedFiles([newest, older]))
  assert.deepEqual(tree.map((node) => node.name), ['docs', 'src'])
  const docs = tree[0]
  assert.equal(docs?.kind, 'dir')
  if (docs?.kind !== 'dir') return
  assert.equal(docs.count, 1)
  assert.deepEqual(docs.children.map((node) => node.name), ['readme.md'])
  const src = tree[1]
  if (src?.kind !== 'dir') return
  assert.equal(src.count, 2)
  const client = src.children.find((node) => node.kind === 'dir' && node.name === 'client')
  assert.ok(client !== undefined && client.kind === 'dir')
  if (client === undefined || client.kind !== 'dir') return
  assert.equal(client.count, 1)
  assert.deepEqual(directoryPaths(tree), ['docs', 'src', 'src/client'])
})

test('per-file history and per-commit file status are read from the same events', () => {
  const panel = eventsForFile([newest, older], 'src/client/panel.ts')
  assert.deepEqual(panel.map((entry) => entry.id), ['e1', 'e2'])
  assert.deepEqual(eventFileStatus(newest, 'src/client/panel.ts'), {
    path: 'src/client/panel.ts',
    status: 'modified',
    additions: 5,
    deletions: 2,
  })
  assert.equal(eventFileStatus(newest, 'missing.ts'), null)
  assert.deepEqual(
    eventsHavingFiles([newest, older], new Set(['src/old.ts'])).map((entry) => entry.id),
    ['e2'],
  )
})

test('the derived view narrows both panes by selection, search and status', () => {
  const all = buildTimelineView([newest, older], { query: '', status: 'all', selectedPath: null })
  assert.equal(all.filesReported, true)
  assert.equal(all.files.length, 3)
  assert.equal(all.visibleEvents.length, 2)
  assert.deepEqual(all.totals, { files: 3, commits: 2, additions: 17, deletions: 5 })

  const selected = buildTimelineView([newest, older], { query: '', status: 'all', selectedPath: 'src/old.ts' })
  assert.deepEqual(selected.visibleEvents.map((entry) => entry.id), ['e2'])
  assert.equal(selected.selected?.path, 'src/old.ts')

  const filtered = buildTimelineView([newest, older], { query: 'panel', status: 'all', selectedPath: null })
  assert.deepEqual(filtered.visibleEvents.map((entry) => entry.id), ['e1', 'e2'])
  assert.deepEqual(filtered.totals, { files: 1, commits: 2, additions: 6, deletions: 3 })

  const statusOnly = buildTimelineView([newest, older], { query: '', status: 'added', selectedPath: null })
  assert.deepEqual(statusOnly.visibleEvents.map((entry) => entry.id), ['e1'])
  assert.deepEqual(statusOnly.visibleFiles.map((entry) => entry.path), ['docs/readme.md'])
})

test('a host without file lists keeps every event visible and reports the gap', () => {
  const bare = event({ id: 'bare', summary: 'no files' })
  const view = buildTimelineView([bare], { query: 'panel', status: 'all', selectedPath: null })
  assert.equal(view.filesReported, false)
  assert.equal(view.tree.length, 0)
  assert.deepEqual(view.visibleEvents.map((entry) => entry.id), ['bare'])
})

test('history groups into local calendar days, newest day first and without reordering rows', () => {
  const groups = groupEventsByDay([newest, older])
  assert.equal(groups.length, 2)
  assert.equal(groups[0]?.events[0]?.id, 'e1')
  assert.equal(groups[1]?.events[0]?.id, 'e2')
  assert.equal(groups[0]?.key, localDayKey('2026-01-03T00:00:00.000Z'))
  assert.equal(groups[1]?.key, localDayKey('2026-01-02T00:00:00.000Z'))

  const sameDay = older
  const grouped = groupEventsByDay([newest, { ...sameDay, id: 'e3', timestamp: newest.timestamp }])
  assert.equal(grouped.length, 1)
  assert.deepEqual(grouped[0]?.events.map((entry) => entry.id), ['e1', 'e3'])
})

test('relative time answers "when" for the last week and defers older rows to a date', () => {
  const now = Date.parse('2026-01-10T12:00:00.000Z')
  assert.deepEqual(relativeTime('2026-01-10T11:59:40.000Z', now), { unit: 'justNow', count: 0 })
  assert.deepEqual(relativeTime('2026-01-10T11:30:00.000Z', now), { unit: 'minutes', count: 30 })
  assert.deepEqual(relativeTime('2026-01-10T08:00:00.000Z', now), { unit: 'hours', count: 4 })
  assert.deepEqual(relativeTime('2026-01-08T12:00:00.000Z', now), { unit: 'days', count: 2 })
  assert.equal(relativeTime('2025-12-01T12:00:00.000Z', now), null)
  assert.equal(relativeTime('not-a-date', now), null)
  assert.equal(relativeTime(undefined, now), null)
})

test('day headers say today/yesterday, otherwise a real date', () => {
  const now = new Date('2026-01-10T12:00:00.000Z')
  assert.equal(dayLabel('2026-01-10T08:00:00.000Z', 'zh-CN', now).kind, 'today')
  assert.equal(dayLabel('2026-01-09T08:00:00.000Z', 'zh-CN', now).kind, 'yesterday')
  const dated = dayLabel('2025-12-01T08:00:00.000Z', 'zh-CN', now)
  assert.equal(dated.kind, 'date')
  assert.ok(dated.text.length > 0)
  assert.equal(dayLabel(undefined, 'zh-CN', now).kind, 'date')
})

test('author avatars are stable per name and never empty', () => {
  assert.equal(authorInitials('Alice Chen'), 'AC')
  assert.equal(authorInitials('Alice'), 'A')
  assert.equal(authorInitials(''), '?')
  assert.equal(authorInitials(undefined), '?')
  assert.equal(authorHue('Alice'), authorHue('Alice'))
  assert.ok(authorHue('Alice') >= 0 && authorHue('Alice') < 360)
  assert.ok(authorHue('Bob') !== authorHue('Alice'))
})
