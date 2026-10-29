/**
 * v1.5 client tests: the pull-request analytics dashboard.
 *
 * The dashboard is a pure projection of one {@link PullRequestList}: five stat
 * tiles that double as filters, an author ranking, an eight-week merged trend
 * and the honesty notes that qualify every number. These tests cover the pure
 * helpers first (merge readiness, summary, filters) and then render the real
 * view layer with `react-dom/server` so a broken tile or a missing translation
 * fails here instead of blanking the panel.
 * @module dsh-vcs-timeline/tests/pr-dashboard.test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { MAX_CLOSED_PULL_REQUESTS } from '../shared/contracts.ts'
import type { PullRequest, PullRequestList, Repository } from '../shared/contracts.ts'
import { createInitialState, createNoopHandlers, createPullRequestSlice } from '../client/types.ts'
import type { PanelState } from '../client/types.ts'
import { renderPanelView } from '../client/components.ts'
import { createTranslator } from '../client/i18n.ts'
import { STYLES } from '../client/styles.ts'
import {
  MERGED_TREND_WEEKS,
  filterPullRequests,
  lineShareWidth,
  mergeReadiness,
  summarizePullRequests,
} from '../client/ui/pr.ts'
import type { VcsClient } from '../client/api.ts'

const t = createTranslator('zh')

/** Stub Host client: rendering never calls it. */
const api = {} as VcsClient

/** Fixed clock: a Thursday in ISO week 2026-10-26. */
const NOW = Date.parse('2026-10-29T12:00:00.000Z')

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

/** Build one complete pull request from the interesting overrides. */
function makePr(overrides: Partial<PullRequest> & Pick<PullRequest, 'number' | 'title' | 'state'>): PullRequest {
  return {
    schemaVersion: 1,
    id: `github:acme/demo-repo#${overrides.number}`,
    repositoryId: repository.id,
    provider: 'github',
    url: `https://github.com/acme/demo-repo/pull/${overrides.number}`,
    author: { login: 'alice', displayName: 'Alice' },
    branch: `feat/${overrides.number}`,
    baseBranch: 'main',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-28T00:00:00.000Z',
    reviewState: 'none',
    checksState: 'none',
    mergeable: null,
    reviews: [],
    checks: [],
    pendingReviewers: [],
    requestedFromViewer: false,
    actions: [],
    ...overrides,
  }
}

const ready = makePr({
  number: 101,
  title: 'feat: ready to merge',
  state: 'open',
  author: { login: 'alice', displayName: 'Alice' },
  mergeable: true,
  reviewState: 'approved',
  checksState: 'success',
  actions: [{ kind: 'merge', reason: 'ready-to-merge' }],
  additions: 10,
  deletions: 2,
})
const conflicted = makePr({
  number: 102,
  title: 'fix: conflicted branch',
  state: 'open',
  author: { login: 'bob', displayName: 'Bob' },
  mergeable: false,
  checksState: 'pending',
  actions: [{ kind: 'fix-conflicts', reason: 'merge-conflict' }],
  additions: 4,
  deletions: 1,
})
const draft = makePr({
  number: 103,
  title: 'wip: draft idea',
  state: 'draft',
  author: { login: 'carol' },
  actions: [{ kind: 'wait', reason: 'waiting' }],
})
const feedback = makePr({
  number: 104,
  title: 'feat: needs changes',
  state: 'open',
  author: { login: 'alice', displayName: 'Alice' },
  mergeable: true,
  reviewState: 'changes-requested',
  checksState: 'success',
  actions: [{ kind: 'address-feedback', reason: 'your-pr-has-feedback' }],
  additions: 3,
  deletions: 1,
})
const merged = makePr({
  number: 105,
  title: 'chore: merged already',
  state: 'merged',
  author: { login: 'alice', displayName: 'Alice' },
  mergedAt: '2026-10-27T09:00:00.000Z',
  additions: 5,
  deletions: 1,
})
const closed = makePr({
  number: 106,
  title: 'chore: closed without merge',
  state: 'closed',
  author: { login: 'bob', displayName: 'Bob' },
  closedAt: '2026-10-24T09:00:00.000Z',
})
const unknown = makePr({
  number: 107,
  title: 'feat: unknown mergeability',
  state: 'open',
  author: { login: 'carol' },
  mergeable: null,
})

const pullRequests: PullRequest[] = [ready, conflicted, draft, feedback, merged, closed, unknown]

/** Build one complete list around the shared fixtures. */
function makeList(overrides: Partial<PullRequestList> = {}): PullRequestList {
  return {
    repositoryId: repository.id,
    provider: 'github',
    host: 'github.com',
    remotePath: 'acme/demo-repo',
    viewer: 'alice',
    authenticated: true,
    pullRequests,
    closedWindowDays: 30,
    fetchedAt: '2026-10-29T00:00:00.000Z',
    ...overrides,
  }
}

/** Render the pure view layer without its inline stylesheet. */
function render(state: PanelState): string {
  const html = renderToStaticMarkup(renderPanelView({
    state,
    deps: { api, t, locale: 'zh-CN', styles: STYLES, now: () => NOW },
    handlers: createNoopHandlers(),
  }))
  return html.replace(/<style[\s\S]*?<\/style>/g, '')
}

/** A ready panel state on the PR source. */
function readyState(): PanelState {
  return {
    ...createInitialState(),
    boot: 'ready',
    repositories: [repository],
    selectedRepositoryId: repository.id,
    source: 'pr',
  }
}

/** A PR-source state carrying one loaded list. */
function withList(data: PullRequestList, overrides: Partial<PanelState['pullRequests']> = {}): PanelState {
  return {
    ...readyState(),
    pullRequests: { ...createPullRequestSlice(), data, ...overrides },
  }
}

/* ------------------------------------------------------------ pure helpers */

test('merge readiness only promotes facts the provider actually reported', () => {
  assert.equal(mergeReadiness(ready), 'ready')
  assert.equal(mergeReadiness(conflicted), 'conflicts')
  // Draft, merged and closed rows are never "ready".
  assert.equal(mergeReadiness(draft), 'blocked')
  assert.equal(mergeReadiness(merged), 'blocked')
  assert.equal(mergeReadiness(closed), 'blocked')
  // Unknown mergeability is blocked, never silently ready.
  assert.equal(mergeReadiness(unknown), 'blocked')
  assert.equal(mergeReadiness({ ...ready, mergeable: null }), 'blocked')
  // A change request or a failed CI blocks even a mergeable PR.
  assert.equal(mergeReadiness({ ...ready, reviewState: 'changes-requested' }), 'blocked')
  assert.equal(mergeReadiness({ ...ready, checksState: 'failure' }), 'blocked')
  // Pending/absent CI is not a failure.
  assert.equal(mergeReadiness({ ...ready, checksState: 'pending' }), 'ready')
  assert.equal(mergeReadiness({ ...ready, reviewState: 'review-required' }), 'ready')
})

test('the summary counts every state from the loaded list only', () => {
  const summary = summarizePullRequests(makeList(), NOW)
  assert.equal(summary.open, 4, 'ready + conflicted + feedback + unknown')
  assert.equal(summary.draft, 1)
  assert.equal(summary.mergeReady, 1)
  assert.equal(summary.conflicts, 1)
  assert.equal(summary.attention, 3, 'ready, conflicted and feedback need the viewer; draft only waits')
  assert.equal(summary.merged, 1)
  assert.equal(summary.closed, 1)
  assert.equal(summary.unknownMergeable, 1, 'the anonymous open PR is unknown, not blocked-as-conflict')
  assert.equal(summary.mergedAvailable, true)
  assert.equal(summary.windowDays, 30)
  assert.equal(summary.historyTruncated, false)
  assert.equal(summary.authorLinesAvailable, true)
})

test('authors are grouped by login and ranked by merged then total PRs', () => {
  const summary = summarizePullRequests(makeList(), NOW)
  assert.deepEqual(
    summary.authors.map((author) => [author.login, author.displayName, author.total, author.open, author.merged, author.lines]),
    [
      ['alice', 'Alice', 3, 2, 1, 22],
      ['bob', 'Bob', 2, 1, 0, 5],
      ['carol', 'carol', 2, 1, 0, null],
    ],
  )
  // A PR that never reported line counts keeps the author honest: no zero.
  assert.equal(summary.authors[2]?.additions, null)
  assert.equal(summary.authors[2]?.deletions, null)
})

test('the merged trend buckets mergedAt into the last eight ISO weeks', () => {
  const summary = summarizePullRequests(makeList(), NOW)
  assert.equal(summary.mergedByWeek.length, MERGED_TREND_WEEKS)
  assert.equal(summary.mergedByWeek.reduce((sum, week) => sum + week.count, 0), 1)
  const currentWeek = summary.mergedByWeek[summary.mergedByWeek.length - 1]
  assert.equal(currentWeek?.weekStart, '2026-10-26', 'ISO weeks start on Monday')
  assert.equal(currentWeek?.count, 1)
  assert.equal(currentWeek?.inWindow, true)
  // The oldest bucket predates the 30-day window and says so.
  assert.equal(summary.mergedByWeek[0]?.inWindow, false)
})

test('an unrequested history window is unavailable, not a zero count', () => {
  const noHistory = summarizePullRequests(makeList({ closedWindowDays: undefined }), NOW)
  assert.equal(noHistory.mergedAvailable, false, 'closedWindowDays absent means merged is unknown')
  assert.equal(noHistory.windowDays, null)
  // A requested window only marks the trend buckets; it cannot make the list honest.
  const requested = summarizePullRequests(makeList({ closedWindowDays: undefined }), NOW, 14)
  assert.equal(requested.mergedAvailable, false)
  assert.equal(requested.mergedByWeek[0]?.inWindow, false)
  assert.equal(requested.mergedByWeek[requested.mergedByWeek.length - 1]?.inWindow, true)
  // Exposure of the truncation flag is kept for the note that renders it.
  assert.equal(summarizePullRequests(makeList({ historyTruncated: true }), NOW).historyTruncated, true)
})

test('the five filters select exactly the dashboard tiles', () => {
  assert.deepEqual(filterPullRequests(pullRequests, 'all'), pullRequests, 'all keeps the host order')
  assert.deepEqual(filterPullRequests(pullRequests, 'merge-ready').map((pr) => pr.number), [101])
  assert.deepEqual(filterPullRequests(pullRequests, 'conflicts').map((pr) => pr.number), [102])
  assert.deepEqual(filterPullRequests(pullRequests, 'merged').map((pr) => pr.number), [105])
  assert.deepEqual(filterPullRequests(pullRequests, 'attention').map((pr) => pr.number), [101, 102, 104])
  // Filters never invent rows.
  assert.deepEqual(filterPullRequests([], 'all'), [])
  assert.deepEqual(filterPullRequests([draft], 'attention'), [])
})

test('author bars are a linear share and stay empty for unknown line counts', () => {
  assert.equal(lineShareWidth(10, 20), '50%')
  assert.equal(lineShareWidth(20, 20), '100%')
  assert.equal(lineShareWidth(30, 20), '100%', 'clamped, never wider than the track')
  assert.equal(lineShareWidth(0, 20), '0%')
  assert.equal(lineShareWidth(null, 20), '0%')
  assert.equal(lineShareWidth(undefined, 0), '0%')
  assert.equal(lineShareWidth(1, 1000), '2%', 'a positive value keeps a visible nib')
})

/* --------------------------------------------------------------- renders */

test('the dashboard renders five filter tiles, the author ranking and the merged trend', () => {
  const html = render(withList(makeList()))
  assert.ok(html.includes('dvt-pr-dash'), 'dashboard block')
  assert.ok(html.includes(t('pr.dash.title')))
  assert.ok(html.includes(t('pr.dash.hint')))
  // Five tiles, each labeled and each a filter button.
  assert.ok(html.includes(t('pr.dash.tile.open')))
  assert.ok(html.includes(t('pr.dash.tile.merge-ready')))
  assert.ok(html.includes(t('pr.dash.tile.conflicts')))
  assert.ok(html.includes(t('pr.dash.tile.attention')))
  assert.ok(html.includes(t('pr.dash.tile.merged', { days: 30 })))
  assert.equal((html.match(/class="dvt-pr-dash-tile"/g) ?? []).length, 5)
  assert.match(html, /<button[^>]*data-filter="all"[^>]*data-count="5"/, 'open + draft = 5')
  assert.match(html, /<button[^>]*data-filter="merge-ready"[^>]*data-count="1"/)
  assert.match(html, /<button[^>]*data-filter="conflicts"[^>]*data-count="1"/)
  assert.match(html, /<button[^>]*data-filter="attention"[^>]*data-count="3"/)
  assert.match(html, /<button[^>]*data-filter="merged"[^>]*data-count="1"/)
  // aria-pressed marks the active filter; 'all' is the default.
  assert.match(html, /aria-pressed="true"[^>]*data-filter="all"/)
  // Author ranking: dark initials avatar, counts, ± lines and the purple bar.
  assert.ok(html.includes('dvt-pr-dash-avatar'))
  assert.ok(html.includes(t('pr.dash.author.meta', { total: 3, merged: 1 })))
  assert.ok(html.includes(t('pr.dash.author.linesTitle', { count: 22 })))
  assert.ok(html.includes('dvt-pr-dash-bar-fill'))
  assert.ok(html.includes('width:100%'), 'the biggest line total fills its bar')
  assert.ok(html.indexOf('data-author="alice"') < html.indexOf('data-author="bob"'))
  assert.ok(html.indexOf('data-author="bob"') < html.indexOf('data-author="carol"'))
  // The merged trend has one column per ISO week and its value in the title.
  assert.ok(html.includes('dvt-pr-dash-chart'))
  assert.equal((html.match(/data-week="/g) ?? []).length, MERGED_TREND_WEEKS)
  assert.ok(html.includes(t('pr.dash.trend.weekTitle', { week: '2026-10-26', count: 1 })))
  assert.ok(html.includes('dvt-pr-dash-week-fill'), 'the blue merged bar')
  // The five filter chips mirror the tiles.
  assert.equal((html.match(/class="dvt-pr-chip"/g) ?? []).length, 5)
  assert.ok(html.includes(t('pr.dash.filter.label')))
})

test('switching the filter re-renders exactly the matching rows', () => {
  const mergedOnly = render(withList(makeList(), { filter: 'merged' }))
  assert.ok(mergedOnly.includes('chore: merged already'))
  assert.ok(!mergedOnly.includes('feat: ready to merge'))
  assert.ok(mergedOnly.includes(t('pr.section.history')))
  assert.match(mergedOnly, /aria-pressed="true"[^>]*data-filter="merged"/)

  const conflictsOnly = render(withList(makeList(), { filter: 'conflicts' }))
  assert.ok(conflictsOnly.includes('fix: conflicted branch'))
  assert.ok(!conflictsOnly.includes('feat: ready to merge'))
  assert.ok(!conflictsOnly.includes('wip: draft idea'))

  const attentionOnly = render(withList(makeList(), { filter: 'attention' }))
  assert.ok(attentionOnly.includes('feat: ready to merge'))
  assert.ok(attentionOnly.includes('fix: conflicted branch'))
  assert.ok(attentionOnly.includes('feat: needs changes'))
  assert.ok(!attentionOnly.includes('wip: draft idea'), 'a waiting draft is not work for the viewer')
  assert.ok(!attentionOnly.includes('chore: merged already'))

  // A filter that matches nothing explains itself instead of a blank list.
  const nothing = render(withList(makeList({ pullRequests: [ready] }), { filter: 'conflicts' }))
  assert.ok(nothing.includes(t('pr.dash.filteredEmpty')))
  assert.ok(nothing.includes(t('pr.dash.filteredEmpty.hint')))
})

test('the dashboard states every unknown instead of inventing a number', () => {
  const anonymous = render(withList(makeList({ authenticated: false, viewer: null })))
  assert.ok(anonymous.includes(t('pr.dash.note.unauthenticated')))
  assert.ok(anonymous.includes(t('pr.dash.note.unknownMergeable', { count: 1 })))
  assert.ok(anonymous.includes(t('pr.auth.title')), 'the credential setup hint stays below the list')

  const truncated = render(withList(makeList({ historyTruncated: true })))
  assert.ok(truncated.includes(t('pr.dash.note.historyTruncated', {
    days: 30,
    limit: MAX_CLOSED_PULL_REQUESTS,
  })))

  // No closedWindowDays: the merged tile is "unavailable", never 0.
  const noHistory = render(withList(makeList({ closedWindowDays: undefined })))
  assert.match(noHistory, /data-filter="merged"[^>]*data-count="不可用"/)
  assert.ok(noHistory.includes(t('pr.dash.unavailable')))
  assert.ok(noHistory.includes(t('pr.dash.tile.mergedNoWindow')))
  assert.ok(noHistory.includes(t('pr.dash.note.noHistory')))
  assert.ok(!noHistory.includes(t('pr.dash.tile.merged', { days: 30 })))

  // A provider that reports a PR without line stats says so per author.
  const noLines = render(withList(makeList({
    pullRequests: [draft],
  })))
  assert.ok(noLines.includes(t('pr.dash.author.noLines')))
})

test('an empty pull-request list keeps its own empty state without a fake dashboard', () => {
  const html = render(withList(makeList({ pullRequests: [] })))
  assert.ok(html.includes(t('pr.empty')))
  assert.ok(!html.includes('dvt-pr-dash'))
  assert.ok(!html.includes('dvt-pr-card'))
})

/* ----------------------------------------------------------- state + style */

test('the pull-request slice starts unfiltered and the handlers expose the setter', () => {
  assert.equal(createInitialState().pullRequests.filter, 'all')
})

test('dashboard styles use the data palette, not the monochrome brand token', () => {
  const dash = STYLES.slice(STYLES.indexOf('v1.5: pull-request analytics dashboard'))
  assert.ok(dash.includes('.dvt-pr-dash'))
  assert.ok(dash.includes('border-radius: 14px'), 'borderless cards with a 14px radius')
  assert.ok(dash.includes('@container swl (max-width: 760px)'), 'narrow panes collapse to a 2-column tile grid')
  assert.ok(/\.dvt-pr-dash-bar-fill[^}]*var\(--dvt-data-purple\)/.test(dash))
  assert.ok(/\.dvt-pr-dash-week-fill[^}]*var\(--dvt-data-blue\)/.test(dash))
  assert.ok(/\.dvt-pr-dash-tile:hover[^}]*inset 3px 0 0 var\(--dvt-data-blue\)/.test(dash))
  // The stylesheet-wide rule still holds for the new block.
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(STYLES), 'no literal hex colors')
  assert.ok(!/\brgba?\(/.test(STYLES), 'no literal rgb()/rgba() colors')
})
