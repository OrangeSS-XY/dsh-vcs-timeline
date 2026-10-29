/**
 * Hotspot dashboard helpers and dimension wiring.
 *
 * The three bodies share one scan, so these tests pin the parts that decide
 * what a reader believes: the sqrt compression that keeps long tails visible,
 * the derived contributor role, and the fact that each dimension renders a
 * different body (a dashboard must never show the same list three times).
 * @module dsh-vcs-timeline/tests/hotspot-dashboard
 */

import { strict as assert } from 'node:assert'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { HotspotAuthor, HotspotReport, OperationAttempt } from '../shared/contracts.ts'
import { createInitialState, createNoopHandlers, type PanelState } from '../client/types.ts'
import { renderPanelView } from '../client/components.ts'
import { createTranslator } from '../client/i18n.ts'
import {
  authorRoleKey,
  barWidth,
  CALENDAR_WEEKS,
  calendarDays,
  heatLevel,
  metricValue,
  pushCountByDay,
  sortHotspots,
  sqrtRatio,
} from '../client/ui/hotspots.ts'
import { STYLES } from '../client/styles.ts'

const t = createTranslator('zh')

function author(input: Partial<HotspotAuthor> & { name: string; commits: number }): HotspotAuthor {
  return {
    name: input.name,
    commits: input.commits,
    churn: input.churn ?? null,
    ...(input.additions === undefined ? {} : { additions: input.additions }),
    ...(input.deletions === undefined ? {} : { deletions: input.deletions }),
    files: input.files ?? 1,
  }
}

const report: HotspotReport = {
  repositoryId: 'git:demo',
  vcsType: 'git',
  available: true,
  files: [
    { path: 'src/a.ts', commits: 3, additions: 10, deletions: 2, churn: 12, authors: ['Ada'], authorCount: 1 },
    { path: 'src/b.ts', commits: 1, additions: 1, deletions: 1, churn: 2, authors: ['Bob'], authorCount: 1 },
    { path: 'assets/logo.png', commits: 1, churn: null, authors: ['Ada'], authorCount: 1 },
  ],
  authors: [
    author({ name: 'Ada Lovelace', commits: 6, churn: 900, additions: 800, deletions: 100, files: 3 }),
    author({ name: 'Bob', commits: 3, churn: 40, additions: 30, deletions: 10, files: 2 }),
    author({ name: 'Cara', commits: 1, churn: null }),
  ],
  recent: [
    {
      hash: 'abcdef0123456789abcdef0123456789abcdef01',
      author: 'Ada Lovelace',
      timestamp: '2026-01-02T00:00:00.000Z',
      subject: 'feat: dashboard',
      files: ['src/a.ts', 'src/b.ts'],
      fileCount: 4,
      additions: 10,
      deletions: 2,
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
    { date: '2026-01-02', commits: 6, files: 2, additions: 80, deletions: 20 },
    { date: '2026-01-01', commits: 3, files: 1, additions: 10, deletions: 5 },
  ],
  scannedCommits: 10,
  truncated: false,
  scope: { branch: 'main', mergesIncluded: true, since: '2025-12-25T00:00:00.000Z', windowCommits: 500 },
  computedAt: '2026-01-02T00:00:00.000Z',
  cached: false,
}

/** One succeeded push attempt for the calendar's push metric. */
function pushAttempt(id: string, startedAt: string, state: OperationAttempt['state'] = 'succeeded'): OperationAttempt {
  return {
    schemaVersion: 1,
    id,
    repositoryId: 'git:demo',
    vcsType: 'git',
    operation: 'push',
    state,
    startedAt,
    actor: 'user-via-plugin',
    requestSummary: 'push main',
    correlationId: `corr-${id}`,
  }
}

/** Render the real panel for one hotspot dimension. */
function renderDimension(
  dimension: 'calendar' | 'files' | 'authors' | 'activity',
  options: {
    metric?: 'churn' | 'pushes'
    operations?: OperationAttempt[]
    report?: HotspotReport
    auditError?: boolean
  } = {},
): string {
  const base = createInitialState()
  const state: PanelState = {
    ...base,
    boot: 'ready',
    source: 'hotspots',
    repositories: [{ schemaVersion: 1, id: 'git:demo', vcsType: 'git', rootPath: '/demo', displayName: 'demo', currentBranch: 'main', remoteUrls: [], detectedAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z' }],
    selectedRepositoryId: 'git:demo',
    hotspots: {
      ...base.hotspots,
      data: options.report ?? report,
      dimension,
      ...(options.metric === undefined ? {} : { calendarMetric: options.metric }),
    },
    audit: {
      ...base.audit,
      operations: options.operations ?? [],
      error: options.auditError === true ? { code: 'operation-failed', message: 'audit read failed' } : null,
    },
  }
  const html = renderToStaticMarkup(createElement(renderPanelView, {
    state,
    deps: { api: {} as never, t, locale: 'zh', styles: STYLES },
    handlers: createNoopHandlers(),
  }))
  return html.replace(/<style[\s\S]*?<\/style>/g, '')
}

test('sqrt compression keeps ordering but lifts small values off the floor', () => {
  assert.equal(sqrtRatio(0, 100), 0)
  assert.equal(sqrtRatio(-5, 100), 0)
  assert.equal(sqrtRatio(100, 100), 1)
  assert.equal(sqrtRatio(25, 100), 0.5)
  assert.ok(sqrtRatio(4, 100_000) > 0.006, 'a tiny value still has a visible share')
  assert.ok(sqrtRatio(4, 100) > 4 / 100, 'sqrt always lifts values below the max')
  assert.equal(sqrtRatio(10, 0), 0)
  assert.equal(sqrtRatio(Number.NaN, 10), 0)
})

test('bar widths are percentages, with a nib for every non-zero value', () => {
  assert.equal(barWidth(null, 100), '0%')
  assert.equal(barWidth(0, 100), '0%')
  assert.equal(barWidth(100, 100), '100%')
  assert.equal(barWidth(2, 12), '40.8%')
  assert.match(barWidth(1, 1_000_000), /^2%$/)
})

test('calendar heat intensity uses sqrt compression and never lights unknown values', () => {
  assert.equal(heatLevel(0, 100), 0)
  assert.equal(heatLevel(null, 100), 0)
  assert.equal(heatLevel(Number.NaN, 100), 0)
  assert.equal(heatLevel(100, 100), 4)
  assert.equal(heatLevel(25, 100), 2)
  assert.equal(heatLevel(1, 100), 1)
  assert.equal(heatLevel(1, 1), 4)
})

test('audited push counts only count successful pushes per UTC day', () => {
  const counts = pushCountByDay([
    pushAttempt('a', '2026-01-02T10:00:00.000Z'),
    pushAttempt('b', '2026-01-02T23:30:00.000Z'),
    pushAttempt('c', '2026-01-01T10:00:00.000Z', 'failed'),
    { ...pushAttempt('d', '2026-01-01T10:00:00.000Z'), operation: 'commit' },
    pushAttempt('e', 'not-a-date'),
  ])
  assert.equal(counts.get('2026-01-02'), 2)
  assert.equal(counts.get('2026-01-01'), undefined)
  assert.equal(counts.size, 1)
})

test('the calendar grid is 26 weeks and flags unmeasured days', () => {
  const pushes = new Map([['2026-01-02', 3]])
  const days = calendarDays(report, new Date('2026-01-02T12:00:00.000Z'), pushes)
  assert.equal(days.length, CALENDAR_WEEKS * 7)
  assert.equal(days[0]?.date, '2025-07-07')
  assert.equal(days[days.length - 1]?.date, '2026-01-04')
  assert.deepEqual(days.find((day) => day.date === '2026-01-02'), {
    date: '2026-01-02',
    commits: 6,
    files: 2,
    additions: 80,
    deletions: 20,
    churn: 100,
    pushes: 3,
    inWindow: true,
    future: false,
  })
  // Window is 2025-12-25 .. 2026-01-02 inclusive; the rest of the columns were
  // never measured and must not be painted as "no activity".
  assert.equal(days.filter((day) => day.inWindow).length, 9)
  assert.deepEqual(days.filter((day) => day.future).map((day) => day.date), ['2026-01-03', '2026-01-04'])
  assert.equal(days[0]?.inWindow, false)
})

test('the calendar body renders the heatgrid and switches metric', () => {
  const churn = renderDimension('calendar')
  assert.ok(churn.includes('dvt-hs-cal-grid'))
  assert.ok(churn.includes('dvt-hs-heat-churn-4'))
  assert.equal((churn.match(/data-date="/g) ?? []).length, CALENDAR_WEEKS * 7)
  assert.ok(churn.includes(t('hotspot.calendar.total.churn', { count: 115 })))
  assert.ok(churn.includes(t('hotspot.calendar.activeDays', { count: 2 })))
  assert.ok(!churn.includes('dvt-hs-row-file'))
  assert.ok(!churn.includes('dvt-hs-row-author'))
  assert.ok(!churn.includes('dvt-hs-feed'))

  const pushes = renderDimension('calendar', {
    metric: 'pushes',
    operations: [
      pushAttempt('p1', '2026-01-02T09:00:00.000Z'),
      pushAttempt('p2', '2026-01-01T09:00:00.000Z', 'failed'),
    ],
  })
  assert.ok(pushes.includes('dvt-hs-heat-pushes-4'))
  assert.ok(pushes.includes(t('hotspot.calendar.total.pushes', { count: 1 })))
  assert.ok(pushes.includes(t('hotspot.calendar.pushSource', { count: 2 })))
})

test('an unmeasured window says so instead of painting a grid of zeros', () => {
  const empty = renderDimension('calendar', {
    report: { ...report, daily: [], scannedCommits: 0 },
  })
  assert.ok(empty.includes(t('hotspot.empty.title')))
  assert.ok(!empty.includes('dvt-hs-cal-grid'))

  const auditFailed = renderDimension('calendar', { metric: 'pushes', auditError: true })
  assert.ok(auditFailed.includes(t('hotspot.calendar.pushUnavailable')))
  assert.ok(auditFailed.includes(t('hotspot.calendar.pushEmpty')) === false)
})

test('contributor roles are derived from window commit share', () => {
  const lead = authorRoleKey(author({ name: 'Lead', commits: 9 }), 10)
  const core = authorRoleKey(author({ name: 'Core', commits: 3 }), 10)
  const active = authorRoleKey(author({ name: 'Active', commits: 1 }), 10)
  const guest = authorRoleKey(author({ name: 'Guest', commits: 1 }), 100)
  assert.equal(lead, 'hotspot.author.role.lead')
  assert.equal(core, 'hotspot.author.role.core')
  assert.equal(active, 'hotspot.author.role.active')
  assert.equal(guest, 'hotspot.author.role.guest')
  assert.equal(authorRoleKey(author({ name: 'Nobody', commits: 0 }), 0), 'hotspot.author.role.guest')
})

test('file ranking helpers still explain their numbers', () => {
  assert.deepEqual(sortHotspots(report.files, 'churn').map((file) => file.path), ['src/a.ts', 'src/b.ts', 'assets/logo.png'])
  assert.equal(metricValue(report.files[0]!, 'churn'), 12)
  assert.equal(metricValue(report.files[2]!, 'churn'), null)
})

test('each dimension renders a different body and only its own hooks', () => {
  const calendar = renderDimension('calendar')
  const files = renderDimension('files')
  const authors = renderDimension('authors')
  const activity = renderDimension('activity')

  for (const html of [calendar, files, authors, activity]) {
    assert.ok(html.includes(t('hotspot.dashboard.title')), 'dashboard title')
    assert.ok(html.includes(t('hotspot.dim.calendar')))
    assert.ok(html.includes(t('hotspot.dim.files')))
    assert.ok(html.includes(t('hotspot.dim.authors')))
    assert.ok(html.includes(t('hotspot.dim.activity')))
    assert.ok(html.includes('dvt-hs-seg'))
  }

  assert.ok(calendar.includes('dvt-hs-cal-grid'))
  assert.ok(calendar.includes('dvt-hs-cal-legend'))
  assert.ok(!calendar.includes('dvt-hs-row-file'))
  assert.ok(!calendar.includes('dvt-hs-row-author'))
  assert.ok(!calendar.includes('dvt-hs-feed'))

  assert.ok(files.includes('dvt-hs-row-file'))
  assert.ok(files.includes('dvt-hs-fill-blue'))
  assert.ok(!files.includes('dvt-hs-row-author'))
  assert.ok(!files.includes('dvt-hs-feed'))

  assert.ok(authors.includes('dvt-hs-row-author'))
  assert.ok(authors.includes('dvt-hs-fill-purple'))
  assert.ok(authors.includes('dvt-hs-avatar'))
  assert.ok(authors.includes(t('hotspot.author.role.lead')))
  assert.ok(!authors.includes('dvt-hs-row-file'))
  assert.ok(!authors.includes('dvt-hs-feed'))

  assert.ok(activity.includes('dvt-hs-feed'))
  assert.ok(activity.includes('dvt-hs-rail'))
  assert.ok(!activity.includes('dvt-hs-meter'), 'the activity feed has no bars')
  assert.ok(!activity.includes('dvt-hs-row-file'))
  assert.ok(!activity.includes('dvt-hs-row-author'))

  // Numeric values and paths use the mono hook; the feed keeps the hash.
  assert.ok(files.includes('dvt-hs-value dvt-mono'))
  assert.ok(authors.includes('dvt-hs-value dvt-mono'))
  assert.ok(activity.includes('dvt-hs-hash dvt-mono'))
  assert.ok(files.includes('src/a.ts'))
  // `splitRepoPath` already keeps the directory's trailing slash: the row must
  // not append a second one.
  assert.ok(!files.includes('src//'), 'no doubled slash in file paths')
  assert.ok(files.includes('src/a.ts'))
})

test('the stylesheet defines the hover indicator and sqrt-sized micro bars with tokens only', () => {
  assert.ok(STYLES.includes('.dvt-hs-row:hover'))
  // The host brand token is monochrome, so the data visualisations pin an
  // explicit blue; the hover line must use that palette, not the brand token.
  assert.ok(STYLES.includes('inset 3px 0 0 var(--dvt-data-blue)'), '3px blue hover line')
  assert.ok(STYLES.includes('--dvt-data-blue: hsl(217 82% 56%)'), 'explicit data blue')
  assert.ok(STYLES.includes('--dvt-data-purple: hsl(262 78% 62%)'), 'explicit data purple')
  assert.ok(!STYLES.includes('var(--dsw-alias-brand-primary) 82%'), 'heat is not mixed from the brand token')
  assert.ok(STYLES.includes('.dvt-hs-fill-blue'))
  assert.ok(STYLES.includes('.dvt-hs-fill-purple'))
  assert.ok(STYLES.includes('.dvt-hs-seg-btn[aria-selected="true"]'))
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(STYLES), 'no literal hex colors')
  assert.ok(!/\brgba?\(/.test(STYLES), 'no literal rgb()/rgba() colors')
})
