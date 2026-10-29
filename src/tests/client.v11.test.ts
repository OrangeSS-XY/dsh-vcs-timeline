/**
 * v1.1 client tests: the pending workbench, pre-commit checks, interleaved
 * audit nodes, branch filtering, session attribution and hotspot ranking.
 *
 * Same approach as `client.render.test.ts`: `react-dom/server` renders the
 * pure view layer from a hand-built state, so a broken branch or a missing
 * string fails here instead of blanking the panel.
 * @module dsh-vcs-timeline/tests/client.v11.test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import type {
  ChecksReport,
  HotspotReport,
  OperationAttempt,
  Repository,
  SessionChanges,
  VcsEvent,
  WorkingTreeStatus,
} from '../shared/contracts.ts'
import { createInitialState, createNoopHandlers, type PanelState } from '../client/types.ts'
import { renderPanelView } from '../client/components.ts'
import { createTranslator } from '../client/i18n.ts'
import { STYLES } from '../client/styles.ts'
import { blockedReasonLabel } from '../client/format.ts'
import { groupPendingEntries } from '../client/ui/workbench.ts'
import { sortHotspots } from '../client/ui/hotspots.ts'
import type { VcsClient } from '../client/api.ts'

const t = createTranslator('zh')
const api = {} as VcsClient

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

const status: WorkingTreeStatus = {
  repositoryId: repository.id,
  vcsType: 'git',
  clean: false,
  branch: 'main',
  head: 'abcdef0123456789',
  entries: [
    { path: 'src/staged.ts', status: 'M', worktreeStatus: 'M', staged: true },
    { path: 'src/unstaged.ts', status: 'M', worktreeStatus: 'M' },
    { path: 'src/new.ts', status: '?' },
    { path: 'src/both.ts', status: 'M', worktreeStatus: 'M' },
  ],
  conflicts: ['src/both.ts'],
}

const event: VcsEvent = {
  schemaVersion: 1,
  id: 'commit:abcdef',
  repositoryId: repository.id,
  vcsType: 'git',
  eventType: 'commit',
  source: 'repository',
  timestamp: '2026-01-02T03:04:05.000Z',
  actor: 'Alice',
  summary: 'feat: add the timeline panel',
  commitHash: 'abcdef0123456789abcdef0123456789abcdef01',
  parentHashes: ['1234567890abcdef1234567890abcdef12345678'],
  branch: 'main',
  metadata: { filesChanged: 2, additions: 12, deletions: 4 },
  changedFiles: [
    { path: 'src/staged.ts', status: 'modified', additions: 10, deletions: 4 },
    { path: 'src/unstaged.ts', status: 'modified', additions: 2, deletions: 0 },
  ],
}

const checks: ChecksReport = {
  repositoryId: repository.id,
  scope: 'staged',
  findings: [
    { rule: 'conflict-marker', severity: 'blocking', path: 'src/both.ts', line: 3 },
    { rule: 'lockfile', severity: 'warning', path: 'package-lock.json' },
    { rule: 'untracked-skipped', severity: 'info', count: 2 },
  ],
  filesChecked: 3,
  truncated: false,
  empty: false,
  generatedAt: '2026-01-02T03:04:05.000Z',
}

const session: SessionChanges = {
  repositoryId: repository.id,
  sessionId: 'session-1',
  available: true,
  files: [
    { path: 'src/staged.ts', tool: 'edit', touches: 2, confidence: 'inferred' },
    { path: 'src/unstaged.ts', tool: 'write', touches: 1, confidence: 'inferred' },
    { path: 'src/new.ts', tool: 'write', touches: 1, confidence: 'inferred' },
  ],
  generatedAt: '2026-01-02T03:04:05.000Z',
}

const attempt: OperationAttempt = {
  schemaVersion: 1,
  id: 'op-1234',
  repositoryId: repository.id,
  vcsType: 'git',
  operation: 'commit',
  state: 'succeeded',
  startedAt: '2026-01-03T03:04:05.000Z',
  finishedAt: '2026-01-03T03:04:06.000Z',
  actor: 'user-via-plugin',
  requestSummary: 'commit 2 staged paths on main',
  afterRevision: 'abcdef0123456789abcdef0123456789abcdef01',
  correlationId: 'corr-1234',
}

const hotspots: HotspotReport = {
  repositoryId: repository.id,
  vcsType: 'git',
  available: true,
  files: [
    { path: 'src/a.ts', commits: 4, additions: 10, deletions: 2, churn: 12, authors: ['Alice'], authorCount: 1, lastChangedAt: '2026-01-02T00:00:00.000Z' },
    { path: 'src/b.ts', commits: 2, additions: 1, deletions: 1, churn: 2, authors: ['Bob'], authorCount: 1, lastChangedAt: '2026-01-01T00:00:00.000Z' },
    { path: 'assets/logo.png', commits: 1, churn: null, authors: ['Alice'], authorCount: 1 },
  ],
  authors: [
    { name: 'Ada Lovelace', commits: 4, churn: 900, additions: 800, deletions: 100, files: 3, firstCommitAt: '2026-01-01T00:00:00.000Z', lastCommitAt: '2026-01-02T00:00:00.000Z' },
    { name: 'Bob', commits: 2, churn: 40, additions: 30, deletions: 10, files: 2 },
  ],
  recent: [
    {
      hash: 'abcdef0123456789abcdef0123456789abcdef01',
      author: 'Ada Lovelace',
      timestamp: '2026-01-02T00:00:00.000Z',
      subject: 'feat: multi-dimensional dashboard',
      files: ['src/a.ts', 'src/b.ts', 'assets/logo.png', 'src/c.ts'],
      fileCount: 5,
      additions: 11,
      deletions: 3,
      merge: false,
    },
    {
      hash: 'deadbeef0123456789abcdef0123456789abcdef',
      author: 'Bob',
      timestamp: '2026-01-01T00:00:00.000Z',
      subject: "Merge branch 'feature'",
      files: ['src/b.ts'],
      fileCount: 1,
      merge: true,
    },
  ],
  daily: [
    { date: '2026-01-02', commits: 4, files: 2, additions: 11, deletions: 3 },
    { date: '2026-01-01', commits: 2, files: 1, additions: 1, deletions: 1 },
  ],
  scannedCommits: 6,
  truncated: false,
  scope: { branch: 'main', mergesIncluded: true, windowCommits: 500 },
  computedAt: '2026-01-02T00:00:00.000Z',
  cached: false,
}

/** Render the pure panel view without the `<style>` block. */
function render(overrides: Partial<PanelState>): string {
  const state: PanelState = { ...createInitialState(), ...overrides }
  const html = renderToStaticMarkup(renderPanelView({
    state,
    deps: { api, t, locale: 'zh-CN', styles: STYLES },
    handlers: createNoopHandlers(),
  }))
  return html.replace(/<style[\s\S]*?<\/style>/g, '')
}

/** A ready state over the fake repository. */
function ready(overrides: Partial<PanelState> = {}): PanelState {
  const base = createInitialState()
  return {
    ...base,
    boot: 'ready',
    repositories: [repository],
    selectedRepositoryId: repository.id,
    status,
    timeline: { ...base.timeline, events: [event] },
    ...overrides,
  }
}

test('the pending workbench groups dirty files by their real git state', () => {
  const groups = groupPendingEntries(ready())
  assert.deepEqual(groups.map((group) => group.key), ['conflicts', 'staged', 'unstaged', 'untracked'])
  assert.deepEqual(groups[0]?.rows.map((row) => row.path), ['src/both.ts'])
  assert.deepEqual(groups[1]?.rows.map((row) => row.path), ['src/staged.ts'])
  assert.deepEqual(groups[2]?.rows.map((row) => row.path), ['src/unstaged.ts'])
  assert.deepEqual(groups[3]?.rows.map((row) => row.path), ['src/new.ts'])
  // A clean tree produces no groups at all (the view then shows its empty state).
  const clean = ready({ status: { ...status, clean: true, entries: [], conflicts: [] } })
  assert.deepEqual(groupPendingEntries(clean), [])
})

test('the pending workbench renders groups, checks, session attribution and branch insight', () => {
  const html = render(ready({
    source: 'pending',
    pending: {
      ...createInitialState().pending,
      checks,
      session,
      checksScope: 'staged',
    },
    pullRequests: {
      ...createInitialState().pullRequests,
      compare: {
        repositoryId: repository.id,
        vcsType: 'git',
        currentBranch: 'main',
        baseBranch: 'main',
        available: true,
        ahead: 2,
        behind: 1,
        commits: [],
        filesChanged: 3,
        conflictPaths: ['src/both.ts'],
        unpushed: 2,
        hasUpstream: true,
        actions: [],
        computedAt: '2026-01-02T00:00:00.000Z',
      },
    },
  }))
  assert.ok(html.includes('dvt-wb-list'))
  assert.ok(html.includes(t('pending.group.conflicts')))
  assert.ok(html.includes(t('pending.group.staged')))
  assert.ok(html.includes(t('pending.group.unstaged')))
  assert.ok(html.includes(t('pending.group.untracked')))
  assert.ok(html.includes(t('pending.checks.title')))
  assert.ok(html.includes(t('check.conflict-marker')))
  assert.ok(html.includes(t('check.untracked-skipped')))
  assert.ok(html.includes(t('pending.session.title')))
  assert.ok(html.includes(t('pending.session.badge')))
  assert.ok(html.includes(t('pending.compare.ahead', { count: 2 })))
  assert.ok(html.includes(t('pending.compare.unpushed', { count: 2 })))
})

test('the pending workbench shows the selected untracked file as a whole-file diff', () => {
  const html = render(ready({
    source: 'pending',
    pending: {
      ...createInitialState().pending,
      path: 'src/new.ts',
      staged: false,
      diff: {
        repositoryId: repository.id,
        filePath: 'src/new.ts',
        staged: false,
        kind: 'untracked',
        text: 'diff --git a/src/new.ts b/src/new.ts\n+hello\n',
        truncated: false,
        binary: false,
        bytes: 42,
      },
    },
  }))
  assert.ok(html.includes(t('pending.kind.untracked')))
  assert.ok(html.includes('dvt-diff-row dvt-diff-add'))
  assert.ok(html.includes('hello'))
})

test('the hotspot dashboard switches between calendar, file churn, contributors and activity', () => {
  const base = { ...createInitialState().hotspots, data: hotspots, dimension: 'files' as const }
  const files = render(ready({ source: 'hotspots', hotspots: base }))
  assert.ok(files.includes(t('hotspot.dashboard.title')))
  assert.ok(files.includes('dvt-hs-seg'))
  assert.ok(files.includes('dvt-hs-row-file'))
  assert.ok(files.includes('dvt-hs-fill-blue'))
  assert.ok(files.includes('src/a.ts'))
  assert.ok(files.includes(t('hotspot.files.hint')))
  assert.ok(files.includes(t('hotspot.coverage', { count: 6 })))
  // sqrt compression: 12 is the max (100%) and 2 is sqrt(2/12) ≈ 40.8%.
  assert.ok(files.includes('width:100%'))
  assert.ok(files.includes('width:40.8%'))
  // A file without line stats says so instead of printing a zero.
  assert.ok(files.includes(t('hotspot.churn.unavailable')))
  // The other two bodies must not leak into this tab.
  assert.ok(!files.includes(t('hotspot.authors.hint')))
  assert.ok(!files.includes('dvt-hs-fill-purple'))
  assert.ok(!files.includes('dvt-hs-feed'))

  const authors = render(ready({
    source: 'hotspots',
    hotspots: { ...base, dimension: 'authors' },
  }))
  assert.ok(authors.includes('dvt-hs-row-author'))
  assert.ok(authors.includes('dvt-hs-fill-purple'))
  assert.ok(authors.includes(t('hotspot.author.role.lead')))
  assert.ok(authors.includes('Ada Lovelace'))
  assert.ok(authors.includes(t('hotspot.author.meta', { commits: 4, files: 3 })))
  assert.ok(!authors.includes('dvt-hs-row-file'))
  assert.ok(!authors.includes('dvt-hs-feed'))

  const activity = render(ready({
    source: 'hotspots',
    hotspots: { ...base, dimension: 'activity' },
  }))
  assert.ok(activity.includes('dvt-hs-feed'))
  assert.ok(activity.includes('dvt-hs-rail'))
  assert.ok(activity.includes(t('hotspot.activity.commit', { branch: 'main' })))
  assert.ok(activity.includes(t('hotspot.activity.merge', { branch: 'main' })))
  assert.ok(activity.includes(t('hotspot.activity.moreFiles', { count: 1 })))
  assert.ok(activity.includes('src/a.ts'))
  // Timeline feed: no micro bars on this tab.
  assert.ok(!activity.includes('dvt-hs-meter'))
  assert.ok(!activity.includes('dvt-hs-row-file'))
})

test('the calendar heatmap shows daily churn and plugin-audited pushes', () => {
  const base = { ...createInitialState().hotspots, data: hotspots }
  const pushed: OperationAttempt = {
    ...attempt,
    id: 'op-push-1',
    operation: 'push',
    state: 'succeeded',
    startedAt: '2026-01-02T10:00:00.000Z',
    requestSummary: 'push main',
  }
  const failedPush: OperationAttempt = {
    ...attempt,
    id: 'op-push-2',
    operation: 'push',
    state: 'failed',
    startedAt: '2026-01-01T10:00:00.000Z',
    requestSummary: 'push main',
  }
  const audit = { ...createInitialState().audit, operations: [pushed, failedPush] }
  const calendar = render(ready({
    source: 'hotspots',
    hotspots: { ...base, dimension: 'calendar', calendarMetric: 'churn' },
    audit,
  }))
  assert.ok(calendar.includes(t('hotspot.dim.calendar')))
  assert.ok(calendar.includes('dvt-hs-cal-grid'))
  assert.ok(calendar.includes('dvt-hs-heat-churn-4'), 'the busiest day is the darkest bucket')
  // 26 weeks × 7 days = 182 measured-or-future cells.
  assert.equal((calendar.match(/data-date="/g) ?? []).length, 182)
  // daily fixture: (11+3) + (1+1) = 16 churn lines over two active days.
  assert.ok(calendar.includes(t('hotspot.calendar.total.churn', { count: 16 })))
  assert.ok(calendar.includes(t('hotspot.calendar.activeDays', { count: 2 })))
  assert.ok(calendar.includes(t('hotspot.calendar.metric.churn')))
  assert.ok(calendar.includes(t('hotspot.calendar.metric.pushes')))
  assert.ok(!calendar.includes('dvt-hs-row-file'), 'the calendar is not a file list')
  assert.ok(!calendar.includes('dvt-hs-feed'))

  const pushes = render(ready({
    source: 'hotspots',
    hotspots: { ...base, dimension: 'calendar', calendarMetric: 'pushes' },
    audit,
  }))
  // Only the succeeded push counts; the failed one is not activity.
  assert.ok(pushes.includes(t('hotspot.calendar.total.pushes', { count: 1 })))
  assert.ok(pushes.includes('dvt-hs-heat-pushes-4'))
  assert.ok(pushes.includes(t('hotspot.calendar.pushSource', { count: 2 })))
  assert.ok(!pushes.includes(t('hotspot.calendar.cell.future', { date: '2026-01-01' })))
})

test('an unavailable hotspot report says why instead of showing fake zeros', () => {
  const html = render(ready({
    source: 'hotspots',
    hotspots: {
      ...createInitialState().hotspots,
      data: { ...hotspots, available: false, files: [], unsupportedReason: 'svn-history-line-stats-unsupported' },
    },
  }))
  assert.ok(html.includes(t('hotspot.unavailable')))
  assert.ok(html.includes(t('hotspot.unavailable.hint')))
})

test('audit nodes interleave into the timeline without joining the commit count', () => {
  const html = render(ready({
    source: 'timeline',
    filters: { ...createInitialState().filters, auditInTimeline: true },
    audit: { ...createInitialState().audit, operations: [attempt] },
  }))
  assert.ok(html.includes('dvt-tl-audit-card'))
  assert.ok(html.includes(t('timeline.audit.node')))
  assert.ok(html.includes(t('timeline.audit.source')))
  assert.ok(html.includes(t('timeline.count.label', { count: 1 })), 'one commit stays one commit')
  assert.ok(!html.includes(t('timeline.count.label', { count: 2 })), 'audit nodes are not commits')
  assert.ok(html.includes(t('timeline.audit.count', { count: 1 })))
  assert.ok(html.includes(t('timeline.audit.notice')))
})

test('a branch decoration is a clickable host-side filter, not a lane guess', () => {
  const html = render(ready())
  assert.ok(html.includes('dvt-branch-btn'))
  assert.ok(html.includes(t('timeline.filterBranch', { branch: 'main' })))
})

test('a plugin commit is labelled exactly; a session-only commit is labelled as inferred', () => {
  const exact = render(ready({
    audit: { ...createInitialState().audit, operations: [attempt] },
  }))
  assert.ok(exact.includes(t('timeline.attribution.audit')))

  const inferred = render(ready({
    pending: { ...createInitialState().pending, session },
  }))
  assert.ok(inferred.includes(t('timeline.attribution.inferred')))
  assert.ok(inferred.includes(t('timeline.attribution.inferred.hint')))

  const unknown = render(ready())
  assert.ok(!unknown.includes(t('timeline.attribution.audit')))
})

test('blocking checks disable the commit button until they are acknowledged', () => {
  const dialogBase = {
    operation: 'commit' as const,
    phase: 'previewed' as const,
    preview: {
      repositoryId: repository.id,
      operation: 'commit' as const,
      allowed: true,
      summary: 'commit 1 staged path on main',
      argv: ['git', 'commit', '-m', 'msg'],
      before: { branch: 'main', clean: false },
      warnings: [],
      confirmationToken: 'token',
      expiresAt: '2999-01-01T00:00:00.000Z',
    },
    previewError: null,
    executeError: null,
    result: null,
    message: 'msg',
    remote: 'origin',
    branch: 'main',
    checks,
  }
  const blocked = render(ready({
    dialog: { ...dialogBase, checksLoading: false, acknowledged: false },
  }))
  assert.ok(blocked.includes(t('dialog.checks.title')))
  assert.ok(blocked.includes(t('dialog.checks.blocking')))
  assert.ok(blocked.includes(t('dialog.checks.ack')))
  assert.match(blocked, /<button[^>]*disabled[^>]*>[^<]*确认执行/)

  const acknowledged = render(ready({
    dialog: { ...dialogBase, checksLoading: false, acknowledged: true },
  }))
  const confirm = acknowledged.match(/<button[^>]*>[^<]*确认执行/)?.[0] ?? ''
  assert.ok(confirm !== '')
  assert.ok(!confirm.includes('disabled'))
})

test('hotspot sorting is explainable and never hides the unmeasured value', () => {
  const files = hotspots.files
  assert.deepEqual(sortHotspots(files, 'churn').map((file) => file.path), ['src/a.ts', 'src/b.ts', 'assets/logo.png'])
  assert.deepEqual(sortHotspots(files, 'commits').map((file) => file.path), ['src/a.ts', 'src/b.ts', 'assets/logo.png'])
  assert.deepEqual(sortHotspots(files, 'authors').map((file) => file.path).length, 3)
  assert.deepEqual(sortHotspots(files, 'recent').map((file) => file.path), ['src/a.ts', 'src/b.ts', 'assets/logo.png'])
})

test('the new state slices and filters start empty and the tab strip exposes them', () => {
  const state = createInitialState()
  assert.deepEqual(state.pending, {
    path: null,
    staged: false,
    diff: null,
    diffLoading: false,
    diffError: null,
    checks: null,
    checksLoading: false,
    checksError: null,
    checksScope: 'worktree',
    session: null,
    sessionLoading: false,
    sessionError: null,
  })
  assert.equal(state.hotspots.dimension, 'calendar')
  assert.equal(state.hotspots.calendarMetric, 'churn')
  assert.equal(state.filters.branch, '')
  assert.equal(state.filters.branchScope, 'current')
  assert.equal(state.filters.auditInTimeline, false)
  const html = render(ready())
  assert.ok(html.includes(t('source.pending')))
  assert.ok(html.includes(t('source.hotspots')))
})

test('the pending workbench offers commit and explicit staging controls', () => {
  const stagedState = ready({
    source: 'pending',
    status: {
      ...status,
      entries: [
        { path: 'src/staged.ts', status: 'M', staged: true },
        { path: 'src/unstaged.ts', status: 'M' },
      ],
    },
  })
  const html = render(stagedState)
  assert.ok(html.includes(t('pending.actions.commit')))
  assert.ok(html.includes(t('pending.actions.stageAll')))
  assert.ok(html.includes(t('pending.actions.unstageAll')))
  const commitButton = html.match(/<button[^>]*>[^<]*提交已暂存/)?.[0] ?? ''
  assert.ok(commitButton !== '')
  assert.ok(!commitButton.includes('disabled'), 'a staged file makes the commit action available')

  const emptyStaged = render(ready({
    source: 'pending',
    status: { ...status, entries: [{ path: 'src/unstaged.ts', status: 'M' }], conflicts: [] },
  }))
  const disabledCommit = emptyStaged.match(/<button[^>]*>[^<]*提交已暂存/)?.[0] ?? ''
  assert.ok(disabledCommit.includes('disabled'), 'no staged file disables the commit action')
})

test('the blocked reason is localized instead of leaking the host sentence', () => {
  assert.equal(blockedReasonLabel('a commit message is required', t), t('blocked.commitMessage'))
  assert.equal(blockedReasonLabel('nothing is staged; stage changes first (this plugin never stages files for you)', t), t('blocked.nothingStaged'))
  assert.equal(blockedReasonLabel('the working tree is clean; there is nothing to stage', t), t('blocked.nothingToStage'))
  assert.equal(blockedReasonLabel('nothing is staged; there is nothing to unstage', t), t('blocked.nothingToUnstage'))
  assert.equal(blockedReasonLabel('some brand new host reason', t), 'some brand new host reason')
  assert.equal(blockedReasonLabel(undefined, t), t('op.blocked.generic'))
})
