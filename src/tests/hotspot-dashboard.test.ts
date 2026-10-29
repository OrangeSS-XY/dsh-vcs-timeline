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
import type { HotspotAuthor, HotspotReport } from '../shared/contracts.ts'
import { createInitialState, createNoopHandlers, type PanelState } from '../client/types.ts'
import { renderPanelView } from '../client/components.ts'
import { createTranslator } from '../client/i18n.ts'
import {
  authorRoleKey,
  barWidth,
  metricValue,
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
  daily: [],
  scannedCommits: 10,
  truncated: false,
  scope: { branch: 'main', mergesIncluded: true, windowCommits: 500 },
  computedAt: '2026-01-02T00:00:00.000Z',
  cached: false,
}

/** Render the real panel for one hotspot dimension. */
function renderDimension(dimension: 'files' | 'authors' | 'activity'): string {
  const base = createInitialState()
  const state: PanelState = {
    ...base,
    boot: 'ready',
    source: 'hotspots',
    repositories: [{ schemaVersion: 1, id: 'git:demo', vcsType: 'git', rootPath: '/demo', displayName: 'demo', currentBranch: 'main', remoteUrls: [], detectedAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z' }],
    selectedRepositoryId: 'git:demo',
    hotspots: { ...base.hotspots, data: report, dimension },
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
  const files = renderDimension('files')
  const authors = renderDimension('authors')
  const activity = renderDimension('activity')

  for (const html of [files, authors, activity]) {
    assert.ok(html.includes(t('hotspot.dashboard.title')), 'dashboard title')
    assert.ok(html.includes(t('hotspot.dim.files')))
    assert.ok(html.includes(t('hotspot.dim.authors')))
    assert.ok(html.includes(t('hotspot.dim.activity')))
    assert.ok(html.includes('dvt-hs-seg'))
  }

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
  assert.ok(STYLES.includes('inset 3px 0 0 var(--dsw-alias-brand-primary)'), '3px brand hover line')
  assert.ok(STYLES.includes('.dvt-hs-fill-blue'))
  assert.ok(STYLES.includes('.dvt-hs-fill-purple'))
  assert.ok(STYLES.includes('.dvt-hs-seg-btn[aria-selected="true"]'))
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(STYLES), 'no literal hex colors')
  assert.ok(!/\brgba?\(/.test(STYLES), 'no literal rgb()/rgba() colors')
})
