/**
 * Swimlane timeline unit tests.
 *
 * The module is pure geometry + pure list math + a presentational component, so
 * everything here is asserted without a browser: lane X math, the straight vs
 * Bézier link into a row, deterministic lane assignment, the 140px canvas
 * floor, the hollow merge node, the grouped markup and the token-only
 * stylesheet. `react-dom/server` renders the component itself, which is what
 * catches a broken row/legend/empty branch.
 * @module dsh-vcs-timeline/tests/swimlane.test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { GitCommit, SwimlaneLabels, SwimlaneTimelineProps } from '../client/ui/swimlane.ts'
import {
  DEFAULT_LABELS,
  LANE_ORIGIN,
  LANE_WIDTH,
  MIN_CANVAS_WIDTH,
  MOCK_COMMITS,
  ROW_HEIGHT,
  SWIMLANE_STYLES,
  SwimlaneTimeline,
  assignLanes,
  authorInitials,
  branchKindOf,
  displayHash,
  groupCommits,
  laneTrackWidth,
  nodeX,
  rowLinkPath,
} from '../client/ui/swimlane.ts'

/** The demo dictionary; a couple of tests override one entry to prove injection. */
const labels: SwimlaneLabels = { ...DEFAULT_LABELS }

/** One commit row with deterministic defaults, so each test states only its delta. */
function commit(overrides: Partial<GitCommit> = {}): GitCommit {
  return {
    id: 'commit:c1',
    lane: 0,
    type: 'main',
    msg: 'feat: add the timeline',
    author: 'Alice Chen',
    time: '1 小时前',
    add: 12,
    del: 4,
    branch: 'main',
    files: 3,
    isToday: true,
    ...overrides,
  }
}

/** Render the timeline with lanes already assigned, like the panel does. */
function renderTimeline(commits: readonly GitCommit[], props: Partial<SwimlaneTimelineProps> = {}): string {
  const assigned = assignLanes(commits)
  return renderToStaticMarkup(React.createElement(SwimlaneTimeline, {
    commits: assigned.commits,
    lanes: assigned.lanes,
    labels,
    ...props,
  }))
}

/** Count non-overlapping occurrences of one literal fragment in rendered markup. */
function countOf(html: string, fragment: string): number {
  return html.split(fragment).length - 1
}

/* ------------------------------------------------------------------ geometry */

test('nodeX places lane centres on a 40px grid that starts at 20px', () => {
  assert.equal(LANE_ORIGIN, 20)
  assert.equal(LANE_WIDTH, 40)
  assert.equal(nodeX(0), 20)
  assert.equal(nodeX(1), 60)
  assert.equal(nodeX(2), 100)
  assert.equal(nodeX(3), 140)
  assert.equal(nodeX(5), 220)
  // Every lane is `20 + lane * 40`, exactly as the brief specifies.
  for (let lane = 0; lane < 8; lane += 1) assert.equal(nodeX(lane), 20 + lane * 40)
  // A negative/NaN lane never draws outside the canvas.
  assert.equal(nodeX(-3), LANE_ORIGIN)
})

test('rowLinkPath draws a vertical line inside one lane and a cubic bezier across lanes', () => {
  const height = ROW_HEIGHT
  assert.equal(height, 64)

  const sameLane = rowLinkPath(1, 1)
  assert.equal(sameLane.straight, true)
  assert.equal(sameLane.d, 'M 60 0 L 60 32')

  // The cross-lane link is the brief's exact curve: leave the previous node
  // vertically, bend through the quarter lines, land on the new node.
  const crossLane = rowLinkPath(0, 2)
  assert.equal(crossLane.straight, false)
  assert.equal(crossLane.d, 'M 20 0 C 20 16, 100 16, 100 32')

  const backward = rowLinkPath(2, 0)
  assert.equal(backward.straight, false)
  assert.equal(backward.d, 'M 100 0 C 100 16, 20 16, 20 32')
  assert.ok(crossLane.d.includes('C '), 'cross-lane links are bezier paths, not lines')
  assert.ok(!sameLane.d.includes('C '), 'a same-lane link stays a line')

  // A caller-supplied height halves into the quarter control points.
  const custom = rowLinkPath(1, 0, 40)
  assert.equal(custom.d, 'M 60 0 C 60 10, 20 10, 20 20')
})

test('laneTrackWidth always reserves the 140px canvas and grows with lanes', () => {
  assert.equal(MIN_CANVAS_WIDTH, 140)
  assert.equal(laneTrackWidth(0), 140)
  assert.equal(laneTrackWidth(1), 140)
  assert.equal(laneTrackWidth(2), 140)
  assert.equal(laneTrackWidth(3), 140)
  // Four lanes no longer fit: the canvas grows past its floor.
  assert.ok(laneTrackWidth(4) > MIN_CANVAS_WIDTH)
  assert.equal(laneTrackWidth(4), nodeX(3) + LANE_ORIGIN + 8)
  for (let lane = 0; lane <= 8; lane += 1) {
    assert.ok(laneTrackWidth(lane) >= MIN_CANVAS_WIDTH, `lane count ${lane} keeps the floor`)
    assert.ok(laneTrackWidth(lane) >= nodeX(Math.max(0, lane - 1)) + LANE_ORIGIN, 'the last node fits')
  }
  // Beyond the cap the canvas stops growing (extra ancestors are folded).
  assert.equal(laneTrackWidth(99), laneTrackWidth(8))
})

/* ---------------------------------------------------------------- lane math */

test('assignLanes puts main on lane 0, features next and hotfixes last', () => {
  const input: GitCommit[] = [
    commit({ id: 'f1', branch: 'feature/demo1', lane: 7 }),
    commit({ id: 'm1', branch: 'main' }),
    commit({ id: 'h1', branch: 'hotfix/payment' }),
    commit({ id: 'm2', branch: 'main' }),
    commit({ id: 'f2', branch: 'feature/demo1' }),
    commit({ id: 'h2', branch: 'hotfix/payment' }),
  ]
  const { commits, lanes } = assignLanes(input)

  assert.deepEqual(
    lanes.map((lane) => [lane.lane, lane.branch, lane.type, lane.count]),
    [
      [0, 'main', 'main', 2],
      [1, 'feature/demo1', 'feat', 2],
      [2, 'hotfix/payment', 'hotfix', 2],
    ],
  )
  assert.deepEqual(commits.map((entry) => entry.id), ['f1', 'm1', 'h1', 'm2', 'f2', 'h2'])
  assert.deepEqual(commits.map((entry) => entry.lane), [1, 0, 2, 0, 1, 2])
  assert.deepEqual(commits.map((entry) => entry.type), ['feat', 'main', 'hotfix', 'main', 'feat', 'hotfix'])
  // Assignment is a pure mapping: the caller's rows are not mutated.
  assert.equal(input[0]?.lane, 7)
})

test('assignLanes keeps one stable track per branch regardless of first appearance', () => {
  // A hotfix appears first, but main still owns lane 0 and hotfix still trails.
  const { commits, lanes } = assignLanes([
    commit({ id: 'h', branch: 'hotfix/payment' }),
    commit({ id: 'f', branch: 'feature/x' }),
    commit({ id: 'm', branch: 'main' }),
  ])
  assert.deepEqual(lanes.map((lane) => lane.branch), ['main', 'feature/x', 'hotfix/payment'])
  assert.deepEqual(lanes.map((lane) => lane.type), ['main', 'feat', 'hotfix'])
  assert.deepEqual(commits.map((entry) => entry.lane), [2, 1, 0])
  assert.deepEqual(assignLanes([]), { commits: [], lanes: [] })
})

test('branchKindOf classifies the trunk, known feature prefixes and empty decorations', () => {
  assert.equal(branchKindOf('main'), 'main')
  assert.equal(branchKindOf('master'), 'main')
  assert.equal(branchKindOf('develop'), 'main')
  assert.equal(branchKindOf(''), 'main')
  assert.equal(branchKindOf(undefined), 'main')
  assert.equal(branchKindOf('feature/demo1'), 'feat')
  assert.equal(branchKindOf('feat/ui'), 'feat')
  assert.equal(branchKindOf('hotfix/payment'), 'hotfix')
  assert.equal(branchKindOf('fix/overflow'), 'hotfix')
  assert.equal(branchKindOf('bugfix/crash'), 'hotfix')
})

test('an empty branch decoration joins the main lane instead of inventing one', () => {
  const { commits, lanes } = assignLanes([commit({ id: 's', branch: '' })])
  assert.equal(lanes.length, 1)
  assert.equal(lanes[0]?.branch, 'main')
  assert.equal(commits[0]?.lane, 0)
  assert.equal(commits[0]?.type, 'main')
})

/* ------------------------------------------------------------- list helpers */

test('groupCommits preserves order and groups by dayKey/dayLabel', () => {
  const groups = groupCommits([
    commit({ id: 'a', dayKey: '2026-10-28', dayLabel: '今天' }),
    commit({ id: 'b', dayKey: '2026-10-28', dayLabel: '今天' }),
    commit({ id: 'c', dayKey: '2026-10-27', dayLabel: '昨天' }),
  ], labels)
  assert.deepEqual(groups.map((group) => group.key), ['2026-10-28', '2026-10-27'])
  assert.deepEqual(groups.map((group) => group.label), ['今天', '昨天'])
  assert.deepEqual(groups.map((group) => group.commits.length), [2, 1])
  assert.deepEqual(groups[0]?.commits.map((entry) => entry.id), ['a', 'b'])

  // Without a supplied day, isToday picks the localized today/earlier label.
  const fallback = groupCommits([
    commit({ id: 'today', isToday: true }),
    commit({ id: 'older', isToday: false }),
  ], labels)
  assert.deepEqual(fallback.map((group) => group.key), ['today', 'earlier'])
  assert.deepEqual(fallback.map((group) => group.label), [labels.today, labels.earlier])
})

test('displayHash strips an opaque id prefix and clips to seven characters', () => {
  assert.equal(displayHash(commit({ id: 'commit:abcdef0123456789' })), 'abcdef0')
  assert.equal(displayHash(commit({ id: 'commit:abc' })), 'abc')
  assert.equal(displayHash(commit({ id: 'abc1234' })), 'abc1234')
  assert.equal(displayHash(commit({ id: 'row-1', hash: 'fedcba9876543210' })), 'fedcba9')
  assert.equal(displayHash(commit({ id: 'row-2', hash: 'r42' })), 'r42')
})

test('authorInitials keeps at most two letters and never renders nothing', () => {
  assert.equal(authorInitials('Alice Chen'), 'AC')
  assert.equal(authorInitials('Lin Wei'), 'LW')
  assert.equal(authorInitials('alice'), 'AL')
  assert.equal(authorInitials('  '), '?')
})

/* ------------------------------------------------------------------- render */

test('a merge commit renders the hollow double-ring node, a plain commit does not', () => {
  const html = renderTimeline([
    commit({ id: 'merge', msg: 'Merge branch feature', isMerge: true }),
    commit({ id: 'plain', msg: 'fix: spacing' }),
  ])
  const mergeNode = 'class="swl-node dvt-tl-graph-node" data-merge="true"'
  const plainNode = 'class="swl-node dvt-tl-graph-node" data-merge="false"'
  assert.equal(countOf(html, mergeNode), 1, 'exactly one merge node')
  assert.equal(countOf(html, plainNode), 1, 'plain nodes are filled dots')
  assert.ok(html.includes('dvt-tl-graph-node'), 'node hook')
  assert.ok(html.includes(labels.merge), 'merge pill text')

  // The double ring itself is CSS on the merge node + its ::after overlay.
  assert.ok(SWIMLANE_STYLES.includes('.swl-node[data-merge="true"]'), 'hollow node rule')
  assert.ok(SWIMLANE_STYLES.includes('.swl-node[data-merge="true"]::after'), 'inner ring rule')
  assert.ok(SWIMLANE_STYLES.includes('0 0 0 4px var(--swl-card)'), 'ring masks the connecting line')
})

test('a rendered row keeps the panel compatibility hooks and the real values', () => {
  const html = renderTimeline([commit({ id: 'commit:abcdef0123456789', hash: 'abcdef0' })], { headId: 'commit:abcdef0123456789' })
  for (const hook of [
    'dvt-tl-row',
    'dvt-tl-graph',
    'dvt-tl-graph-node',
    'dvt-tl-group',
    'dvt-tl-day-label',
    'dvt-tl-avatar',
    'dvt-tl-head',
    'dvt-tl-hash',
    'dvt-branch-btn',
    'dvt-stat-add',
    'dvt-stat-del',
    'dvt-stat-files',
  ]) {
    assert.ok(html.includes(hook), `row keeps the ${hook} hook`)
  }
  assert.ok(html.includes('feat: add the timeline'), 'summary')
  assert.ok(html.includes('Alice Chen'), 'author name')
  assert.ok(html.includes('AC'), 'author initials')
  assert.ok(html.includes('abcdef0'), 'short hash')
  assert.ok(html.includes('+12'), 'added lines')
  assert.ok(html.includes('−4'), 'deleted lines use U+2212')
  assert.ok(html.includes(labels.files(3)), 'reported file count')
  assert.ok(html.includes(labels.head), 'HEAD badge on the head row')
  assert.ok(html.includes('data-selected="false"'))
})

test('a commit with nothing reported renders no zero pills', () => {
  const html = renderTimeline([commit({ id: 'bare', add: 0, del: 0, files: 0 })])
  assert.ok(!html.includes('+0'), 'no +0')
  assert.ok(!html.includes('−0'), 'no −0')
  assert.ok(!html.includes('dvt-stat-files'), 'no file pill without a reported count')
  assert.ok(html.includes('dvt-tl-row'))
})

test('the selected commit and the injected labels are honoured', () => {
  const english: SwimlaneLabels = { ...labels, today: 'TODAY', files: (count) => `${count} files` }
  const html = renderToStaticMarkup(React.createElement(SwimlaneTimeline, {
    commits: assignLanes([commit({ id: 'a', dayKey: 'd', dayLabel: undefined, isToday: true })]).commits,
    lanes: assignLanes([commit({ id: 'a' })]).lanes,
    labels: english,
    selectedId: 'a',
    headId: 'a',
  }))
  assert.ok(html.includes('data-selected="true"'), 'selected row is marked')
  assert.ok(html.includes('TODAY'), 'group label comes from the injected dictionary')
  assert.ok(html.includes('3 files'), 'file label comes from the injected formatter')
  assert.ok(html.includes(labels.head), 'head badge')
})

test('an empty commit list renders the localized empty state, not a fake row', () => {
  const html = renderTimeline([])
  assert.ok(html.includes(labels.empty.title))
  assert.ok(html.includes(labels.empty.hint))
  assert.ok(!html.includes('dvt-tl-row'))
})

/* ------------------------------------------------------------------ mock data */

test('the mock history renders every group, lane and commit row', () => {
  const assigned = assignLanes(MOCK_COMMITS)
  assert.deepEqual(assigned.lanes.map((lane) => lane.branch), ['main', 'feature/demo1', 'hotfix/payment'])
  assert.deepEqual(assigned.lanes.map((lane) => lane.type), ['main', 'feat', 'hotfix'])

  const html = renderToStaticMarkup(React.createElement(SwimlaneTimeline, {
    commits: assigned.commits,
    lanes: assigned.lanes,
    labels,
    headId: MOCK_COMMITS[0]?.id ?? '',
    onOpenCommit: () => {},
    onSelectBranch: () => {},
  }))

  assert.equal(countOf(html, 'class="swl-row dvt-tl-row"'), MOCK_COMMITS.length, 'one row per mock commit')
  assert.equal(countOf(html, 'dvt-tl-day-label'), 3, 'today / yesterday / an older date')
  for (const group of ['今天', '昨天', '10月26日']) assert.ok(html.includes(group), `group ${group}`)
  assert.ok(html.includes('分支轨道'), 'lane legend')
  for (const lane of assigned.lanes) assert.ok(html.includes(lane.branch), `lane ${lane.branch}`)
  assert.equal(
    countOf(html, 'class="swl-node dvt-tl-graph-node" data-merge="true"'),
    MOCK_COMMITS.filter((entry) => entry.isMerge === true).length,
    'every merge keeps its hollow node',
  )
  assert.equal(countOf(html, 'dvt-tl-head'), 1, 'exactly one HEAD row')
  assert.ok(html.includes('+7348'), 'largest addition count')
  assert.ok(html.includes('−126'), 'largest deletion count')
  assert.ok(html.includes(labels.files(7)), 'reported file count on a row')
  for (const initials of ['LW', 'CY', 'ZM']) assert.ok(html.includes(initials), `avatar ${initials}`)
})

/* -------------------------------------------------------------------- styles */

test('SWIMLANE_STYLES is theme-token only, scoped, and free of literal colours', () => {
  assert.ok(SWIMLANE_STYLES.length > 3_000)
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(SWIMLANE_STYLES), 'no literal hex colours')
  assert.ok(!/\brgba?\(/.test(SWIMLANE_STYLES), 'no literal rgb()/rgba() colours')
  assert.ok(!/(^|[}\s,])(body|html|:root)\s*[,{]/.test(SWIMLANE_STYLES), 'no bare document selectors')
  assert.ok(SWIMLANE_STYLES.includes('--dsw-alias-'), 'DSH theme tokens are used')
  assert.ok(SWIMLANE_STYLES.includes('hsl('), 'hsl() fallbacks for the standalone demo')
  for (const scope of ['.swl-page', '.swl-row', '.swl-canvas', '.swl-node', '.swl-timeline', '.swl-pill']) {
    assert.ok(SWIMLANE_STYLES.includes(scope), `stylesheet scopes ${scope}`)
  }
  // 64px rows and 140px canvases stay in sync with the geometry constants.
  assert.ok(SWIMLANE_STYLES.includes('--swl-row-h: 64px'))
  assert.ok(SWIMLANE_STYLES.includes('--swl-canvas-w: 140px'))
  assert.ok(SWIMLANE_STYLES.includes('@media (prefers-reduced-motion: reduce)'))
})
