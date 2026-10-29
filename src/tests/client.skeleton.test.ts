/**
 * Loading-skeleton tests: gray layout blocks, the white sweep, and the
 * skeleton → content cross-fade.
 *
 * `react-dom/server` renders the static states: `loading` must paint only the
 * skeleton (no text at all), `loading=false` must paint only the children. The
 * fade window itself is driven by {@link SkeletonSwap}'s effect and can only run
 * in a browser, so here we pin its contract (260ms window, grid stacking,
 * aria-busy/aria-hidden) and the stylesheet animation names instead.
 * @module dsh-vcs-timeline/tests/client.skeleton.test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Repository, VcsEvent } from '../shared/contracts.ts'
import type { VcsClient } from '../client/api.ts'
import { renderPanelView } from '../client/components.ts'
import { createTranslator } from '../client/i18n.ts'
import { STYLES } from '../client/styles.ts'
import { createInitialState, createNoopHandlers, type PanelState } from '../client/types.ts'
import {
  SKELETON_FADE_MS,
  SkeletonBlock,
  SkeletonCardList,
  SkeletonContent,
  SkeletonSwap,
  SkeletonTimelineList,
  SkeletonTree,
} from '../client/ui/skeleton.ts'
import { SkeletonRows } from '../client/ui/primitives.ts'

const h = React.createElement
const t = createTranslator('zh')

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
  parentHashes: [],
  branch: 'main',
  changedFiles: [{ path: 'src/panel.ts', status: 'modified' }],
}

/** Stub Host client: rendering never calls it. */
const api = new Proxy({}, {
  get() {
    return async () => ({ ok: true as const, value: null })
  },
}) as unknown as VcsClient

/** Render a bare component to markup. */
function render(node: React.ReactElement): string {
  return renderToStaticMarkup(node)
}

/** Visible text of one rendered fragment (attributes do not count). */
function textOf(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim()
}

/** Booted panel with a selected repository — the "data on screen" baseline. */
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

/** Render the whole panel and drop the inline stylesheets before assertions. */
function renderPanel(overrides: Partial<PanelState> = {}): string {
  return renderToStaticMarkup(renderPanelView({
    state: ready(overrides),
    deps: { api, t, locale: 'zh-CN', styles: STYLES },
    handlers: createNoopHandlers(),
  })).replace(/<style[\s\S]*?<\/style>/g, '')
}

/* --------------------------------------------------------------- skeleton */

test('SkeletonSwap paints only the skeleton while loading', () => {
  const html = render(h(SkeletonSwap, {
    loading: true,
    skeleton: h('div', { className: 'dvt-skeleton' }, h(SkeletonBlock, { width: 48, height: 12 })),
    children: h('div', { className: 'real-content' }, 'REAL-CONTENT'),
  }))

  assert.ok(html.includes('dvt-skeleton'))
  assert.ok(html.includes('dvt-skel-block'))
  assert.ok(!html.includes('real-content'), 'children stay unmounted while loading')
  assert.ok(!html.includes('REAL-CONTENT'), 'no content text leaks into the skeleton state')
  assert.ok(html.includes('aria-busy="true"'), 'the swap container reports busy')
  assert.ok(html.includes('aria-hidden="true"'), 'the skeleton layer is decorative')
})

test('SkeletonSwap paints only the children once loading is false', () => {
  const html = render(h(SkeletonSwap, {
    loading: false,
    skeleton: h(SkeletonBlock, { width: 48 }),
    children: h('div', { className: 'real-content' }, 'REAL-CONTENT'),
  }))

  assert.ok(html.includes('real-content'))
  assert.ok(html.includes('REAL-CONTENT'))
  assert.ok(!html.includes('dvt-skel-block'))
  assert.ok(!html.includes('aria-busy'), 'a finished swap is no longer busy')
  // Both states keep the stacking container so a later reload cannot jump.
  assert.ok(html.includes('dvt-swap'))
})

test('the fade window stays in the 240–280ms range', () => {
  assert.ok(SKELETON_FADE_MS >= 240 && SKELETON_FADE_MS <= 280, String(SKELETON_FADE_MS))
})

test('every skeleton layout is text-free and made of gray blocks', () => {
  for (const source of ['timeline', 'audit', 'pr', 'hotspots', 'pending'] as const) {
    const html = render(h(SkeletonContent, { source, boot: 'ready' }))
    assert.ok(html.includes('dvt-skel-block'), `${source} draws gray blocks`)
    assert.equal(textOf(html), '', `${source} skeleton must not contain text`)
  }
})

test('the cold boot skeleton matches the default timeline layout', () => {
  const html = render(h(SkeletonContent, { source: 'timeline', boot: 'loading' }))
  assert.ok(html.includes('dvt-skel-timeline'))
  assert.ok(html.includes('dvt-skel-tl-graph'), 'the swimlane gutter is kept from the first frame')
  assert.ok(html.includes('dvt-skel-block'))
  assert.equal(textOf(html), '')
})

test('the timeline and card skeletons keep the row structure of their pages', () => {
  const timeline = render(h(SkeletonTimelineList, { rows: 3 }))
  assert.ok(timeline.includes('dvt-skel-timeline'))
  assert.ok(timeline.includes('dvt-skel-tl-graph'), 'graph gutter placeholder')
  assert.ok(timeline.includes('dvt-skel-tl-top'), 'avatar + summary row')
  assert.ok(timeline.includes('dvt-skel-tl-stats'), 'right-hand line stats')
  assert.equal((timeline.match(/dvt-skel-tl-row/g) ?? []).length, 3)
  assert.equal(textOf(timeline), '')

  const cards = render(h(SkeletonCardList, { rows: 2, avatar: true, meta: true }))
  assert.ok(cards.includes('dvt-skel-card'))
  assert.ok(cards.includes('dvt-skel-avatar'))
  assert.equal((cards.match(/dvt-skel-card"/g) ?? []).length, 2)
  assert.equal(textOf(cards), '')
})

test('the file-tree skeleton keeps the sidebar shape and is busy', () => {
  const html = render(h(SkeletonTree, { rows: 5 }))
  assert.ok(html.includes('dvt-tree'))
  assert.ok(html.includes('dvt-skel-tree-head'))
  assert.ok(html.includes('dvt-skel-tree-search'))
  assert.ok(html.includes('dvt-skel-tree-row'))
  assert.ok(html.includes('aria-busy="true"'))
  assert.equal(textOf(html), '')
})

test('SkeletonRows keeps its export but draws the new gray blocks', () => {
  const html = render(h(SkeletonRows, { rows: 2 }))
  assert.ok(html.includes('dvt-skeleton'))
  assert.ok(html.includes('dvt-skel-row'))
  assert.ok(html.includes('dvt-skel-block'))
  assert.ok(html.includes('aria-busy="true"'))
  assert.equal(textOf(html), '')
})

/* ----------------------------------------------------------------- panel */

test('the cold boot paints the tree + content skeleton without chrome text', () => {
  const base = createInitialState()
  const state: PanelState = {
    ...base,
    boot: 'loading',
    // A cold boot also marks sync as refreshing; the skeleton screen must not
    // add the progress bar, the "正在更新…" capsule or the live-region text.
    sync: { ...base.sync, refreshing: true, reason: 'boot' },
  }
  const html = renderToStaticMarkup(renderPanelView({
    state,
    deps: { api, t, locale: 'zh-CN', styles: STYLES },
    handlers: createNoopHandlers(),
  })).replace(/<style[\s\S]*?<\/style>/g, '')

  assert.ok(html.includes('dvt-swap'))
  assert.ok(html.includes('dvt-skeleton'))
  assert.ok(html.includes('dvt-skel-block'))
  assert.ok(html.includes('aria-busy="true"'))
  assert.ok(html.includes('dvt-skel-tree'), 'the sidebar keeps its two-column shape')
  assert.ok(!html.includes('dvt-syncbar'), 'no progress bar over the skeleton')
  assert.ok(!html.includes('dvt-syncing'), 'no spinning control on a skeleton screen')
  assert.ok(!html.includes('dvt-sync-state-text'), 'the skeleton screen carries no sync text')
  assert.ok(!html.includes('>undefined<'))
})

test('a first source load shows the skeleton, cached data never does', () => {
  const base = createInitialState()
  const firstLoad = renderPanel({
    timeline: { ...base.timeline, loading: true, events: [] },
  })
  assert.ok(firstLoad.includes('dvt-skeleton'))
  assert.ok(firstLoad.includes('dvt-skel-timeline'), 'the timeline skeleton matches the source')
  assert.ok(firstLoad.includes('aria-busy="true"'))

  const cached = renderPanel({
    timeline: { ...base.timeline, loading: false, events: [event] },
  })
  assert.ok(!cached.includes('dvt-skeleton'), 'cached rows must never flash a skeleton')

  const refreshing = renderPanel({
    timeline: { ...base.timeline, loading: false, events: [event] },
    sync: { ...base.sync, refreshing: true, reason: 'background' },
  })
  assert.ok(!refreshing.includes('dvt-skeleton'), 'a quiet refresh keeps the real content')
  assert.ok(refreshing.includes('dvt-syncbar'), 'the quiet-refresh feedback is still there')
})

/* ---------------------------------------------------------------- styles */

test('the stylesheet defines the block sweep and the cross-fade keyframes', () => {
  for (const needle of [
    '.dvt-skel-block',
    '.dvt-skel-block::after',
    '@keyframes dvt-skel-sheen',
    'translateX(-100%)',
    'translateX(100%)',
    'color-mix(in srgb, white',
    '.dvt-swap',
    '.dvt-swap-layer',
    'grid-area: 1 / 1',
    '.dvt-skel-out',
    '.dvt-content-in',
    '@keyframes dvt-skel-out',
    '@keyframes dvt-content-in',
  ]) {
    assert.ok(STYLES.includes(needle), `stylesheet must define ${needle}`)
  }

  const reduced = STYLES.slice(STYLES.indexOf('@media (prefers-reduced-motion: reduce)'))
  assert.ok(reduced.includes('.dvt-skel-block::after'))
  assert.ok(reduced.includes('.dvt-skel-out'))
  assert.ok(reduced.includes('.dvt-content-in'))

  // The gray placeholder geometry: rounded gray blocks, no borders/text.
  assert.ok(/\.dvt-skel-block\s*\{[^}]*border-radius/.test(STYLES))
  assert.ok(/\.dvt-skel-block\s*\{[^}]*var\(--dsw-alias-bg-layer-2\)/.test(STYLES))
  // The retired pulse shimmer must be gone.
  assert.ok(!STYLES.includes('dvt-skel-dot'))
  assert.ok(!STYLES.includes('dvt-skel-line'))

  // Style isolation still holds.
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(STYLES), 'no literal hex colours')
  assert.ok(!/\brgba?\(/.test(STYLES), 'no literal rgb()/rgba() colours')
})
