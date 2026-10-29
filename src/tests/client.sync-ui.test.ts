/**
 * Client tests for the "quiet refresh" loading feedback.
 *
 * The dynamic-loading design keeps cached data on screen while the Host is
 * re-read, so the only visible feedback is chrome-level: a 3px indeterminate
 * bar, a spinning refresh control, a polite live region, and — when the quiet
 * refresh fails — a stale-data banner with a retry action. Skeleton rows are
 * reserved for the first load, when there is no cached data to paint.
 *
 * `react-dom/server` is used the same way as `client.render.test.ts`: the view
 * layer is pure, so the DOM shape can be asserted without a browser.
 * @module dsh-vcs-timeline/tests/client.sync-ui.test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Repository } from '../shared/contracts.ts'
import type { VcsClient } from '../client/api.ts'
import { renderPanelView } from '../client/components.ts'
import { createTranslator, dictionaries } from '../client/i18n.ts'
import { STYLES } from '../client/styles.ts'
import { createInitialState, createNoopHandlers, type PanelState, type SyncState } from '../client/types.ts'

const t = createTranslator('zh')

const repository: Repository = {
  schemaVersion: 1,
  id: 'git:c:/fake/repo',
  vcsType: 'git',
  rootPath: 'C:/fake/repo',
  displayName: 'demo-repo',
  currentBranch: 'main',
  currentRevision: 'abcdef0123456789abcdef0123456789abcdef01',
  remoteUrls: ['https://example.com/org/repo.git'],
  detectedAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
}

/** A stub Host client: rendering never calls it. */
const api = new Proxy({}, {
  get() {
    return async () => ({ ok: true as const, value: null })
  },
}) as unknown as VcsClient

/** One complete sync slice, so tests only state the fields they care about. */
function sync(overrides: Partial<SyncState> = {}): SyncState {
  return { ...createInitialState().sync, ...overrides }
}

/** A booted panel with a selected repository — the "cached data on screen" case. */
function ready(overrides: Partial<PanelState> = {}): PanelState {
  const base = createInitialState()
  return {
    ...base,
    boot: 'ready',
    repositories: [repository],
    selectedRepositoryId: repository.id,
    ...overrides,
  }
}

/** Render the panel and drop the inline stylesheets before DOM assertions. */
function render(overrides: Partial<PanelState> = {}): string {
  return renderToStaticMarkup(renderPanelView({
    state: ready(overrides),
    deps: { api, t, locale: 'zh-CN', styles: STYLES },
    handlers: createNoopHandlers(),
  })).replace(/<style[\s\S]*?<\/style>/g, '')
}

/** Count non-overlapping occurrences of one literal substring. */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

test('an idle panel renders no sync bar, no spinner and an empty live region', () => {
  const html = render()
  assert.ok(!html.includes('dvt-syncbar'), 'no progress bar while idle')
  assert.ok(!html.includes('dvt-syncing'), 'refresh control is not spinning while idle')
  assert.ok(!html.includes('role="progressbar"'))
  assert.ok(!html.includes(t('sync.refreshing')), 'idle region must stay silent')
  // The live region itself stays mounted (so inserting text is announced).
  assert.match(html, /<span class="dvt-sync-state" role="status" aria-live="polite"><\/span>/)
})

test('a quiet refresh shows the indeterminate bar above the toolbar and spins the refresh control', () => {
  const html = render({ sync: sync({ refreshing: true, reason: 'background', lastSyncedAt: 1_000 }) })

  // The 3px bar (and its sweep element) is the first thing in the chrome.
  assert.ok(html.includes('dvt-syncslot'))
  assert.ok(html.includes('dvt-syncbar'))
  assert.ok(html.includes('dvt-syncbar-fill'))
  assert.ok(html.includes('role="progressbar"'))
  assert.ok(html.includes(`aria-label="${t('aria.syncProgress')}"`))
  assert.ok(html.includes(`aria-valuetext="${t('sync.refreshing')}"`))
  assert.ok(html.indexOf('dvt-syncslot') < html.indexOf('dvt-toolbar'), 'bar sits above the toolbar')

  // The refresh control keeps turning but stays usable (only boot disables it).
  const button = /<button[^>]*class="dvt-iconbtn dvt-syncing"[^>]*>/.exec(html)
  assert.ok(button !== null, 'refresh IconButton carries the spinning class')
  assert.ok(!button[0].includes('disabled'), 'a manual refresh stays available during a quiet refresh')

  // Cached data keeps the body rendered; no skeleton flash.
  assert.ok(!html.includes('dvt-skeleton'))
})

test('the live region carries the refreshing sentence exactly once when busy', () => {
  const busy = render({ sync: sync({ refreshing: true }) })
  assert.ok(busy.includes('class="dvt-sync-state-text"'))
  assert.equal(count(busy, t('sync.refreshing')), 2, 'one aria-valuetext plus one visible label')

  // Back to idle: the region empties, so nothing is re-announced.
  const idle = render({ sync: sync({ refreshing: false, lastSyncedAt: 2_000 }) })
  assert.ok(!idle.includes('class="dvt-sync-state-text"'))
  assert.ok(!idle.includes('dvt-sync-state-dot'))
})

test('a failed quiet refresh shows a stale-data banner with a retry action', () => {
  const stale = render({
    sync: sync({ refreshing: false, lastSyncedAt: 5_000, lastError: { code: 'timeout', message: 'host timed out' } }),
  })
  assert.ok(stale.includes('dvt-banner-warn'))
  assert.ok(stale.includes(t('sync.staleWarning')))
  assert.ok(stale.includes(t('common.retry')))
  assert.ok(!stale.includes(t('sync.refreshing')), 'a stale banner never doubles as a busy indicator')

  // While a retry is in flight the stale banner gives way to the progress bar.
  const retrying = render({
    sync: sync({ refreshing: true, lastError: { code: 'timeout', message: 'host timed out' } }),
  })
  assert.ok(!retrying.includes(t('sync.staleWarning')))

  // Without any loaded repository there is no old data to warn about.
  const noData = render({
    repositories: [],
    selectedRepositoryId: null,
    sync: sync({ lastError: { code: 'timeout', message: 'host timed out' } }),
  })
  assert.ok(!noData.includes(t('sync.staleWarning')))
})

test('the stylesheet ships the sync animations and their reduced-motion opt-out', () => {
  for (const needle of [
    '.dvt-syncbar',
    '.dvt-syncbar-fill',
    '@keyframes dvt-sync-slide',
    'translateX(-100%)',
    'translateX(100%)',
    '.dvt-syncing > svg',
    '.dvt-sync-state',
    '--dvt-data-blue',
    '--dsw-alias-bg-layer-2',
  ]) {
    assert.ok(STYLES.includes(needle), `stylesheet must define ${needle}`)
  }

  const reduced = STYLES.slice(STYLES.indexOf('@media (prefers-reduced-motion: reduce)'))
  assert.ok(reduced.length > 0, 'a reduced-motion block exists')
  assert.ok(reduced.includes('.dvt-syncbar-fill'))
  assert.ok(reduced.includes('width: 40%'), 'the static reduced-motion bar is 40% wide')
  assert.ok(reduced.includes('.dvt-syncing > svg'))
  assert.ok(reduced.includes('.dvt-skel-block::after'))

  // The sheet stays theme-token only and scoped under the dvt- prefix.
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(STYLES), 'no literal hex colours')
  assert.ok(!/\brgba?\(/.test(STYLES), 'no literal rgb()/rgba() colours')
})

test('both locales carry the sync copy used by the chrome', () => {
  const keys = ['sync.refreshing', 'sync.staleWarning', 'sync.updated', 'sync.updatedJustNow', 'aria.syncProgress']
  for (const key of keys) {
    assert.ok(String(dictionaries.zh[key] ?? '').trim() !== '', `zh has ${key}`)
    assert.ok(String(dictionaries.en[key] ?? '').trim() !== '', `en has ${key}`)
  }
  assert.equal(createTranslator('zh')('sync.refreshing'), '正在更新…')
  assert.equal(createTranslator('en')('sync.refreshing'), 'Updating…')
  assert.equal(createTranslator('zh')('sync.updated', { time: '10:00' }), '已更新于 10:00')
  assert.equal(createTranslator('en')('sync.updated', { time: '10:00' }), 'Updated 10:00')
})
