/**
 * dsh-vcs-timeline — data-driven multi-lane swimlane timeline.
 *
 * This module is deliberately self-contained (React only, no imports from the
 * rest of the plugin) so the exact same file can be dropped into any React
 * application as a runnable demo: {@link SwimlaneDemo} renders a complete page
 * — 260px file tree, header with the GIT badge / branch dropdown / pull-push
 * actions, toolbar tabs, and the swimlane history — from {@link MOCK_COMMITS}.
 *
 * The core is a real multi-track graph, not a decorated list:
 *
 *  - every commit owns a lane; lane X is `20 + lane * 40` inside a 140px canvas
 *  - the link into a row is a straight `<line>` when it keeps the lane, and a
 *    cubic Bézier `<path>` (`M prevX 0 C prevX H/4, x H/4, x H/2`) when a
 *    branch forks or merges across tracks
 *  - commit nodes are absolutely positioned DOM dots with a 4px ring in the
 *    card colour and a z-index above the SVG, so the lines read as broken at
 *    the node (the "cut" that makes a swimlane graph scannable)
 *  - merge commits draw a hollow double ring instead of a filled dot
 *
 * Colours come from DSH theme tokens when they exist (`--dsw-alias-*`) and from
 * `hsl()` fallbacks otherwise, so the plugin inherits light/dark themes while
 * the standalone demo stays self-sufficient. No literal hex or `rgb()` appears
 * in {@link SWIMLANE_STYLES}: the panel test suite enforces that.
 *
 * @module dsh-vcs-timeline/client/ui/swimlane
 */

import * as React from 'react'

const h = React.createElement

/* ------------------------------------------------------------------ types */

/** Branch family; drives the lane colour (main / feat / hotfix). */
export type BranchKind = 'main' | 'feat' | 'hotfix'

/**
 * One commit row, as specified by the product brief.
 *
 * The three optional fields are additive and never required: `dayKey` /
 * `dayLabel` let a caller supply real calendar grouping (the brief's `isToday`
 * alone can only separate "today" from "everything older"), and `hash` carries
 * a display hash when `id` is an opaque row id.
 */
export interface GitCommit {
  /** Commit hash (or a stable row id when `hash` supplies the display value). */
  id: string
  /** Lane / track index, 0-based. */
  lane: number
  /** Branch family, mapped to a lane colour. */
  type: BranchKind
  /** Commit message / summary. */
  msg: string
  /** Author display name. */
  author: string
  /** Pre-formatted relative time ("21 分钟前"), so the row needs no clock. */
  time: string
  /** Added lines, 0 when the host reported none. */
  add: number
  /** Deleted lines, 0 when the host reported none. */
  del: number
  /** Branch decoration shown in the branch pill. */
  branch: string
  /** Changed file count, 0 when the host reported none. */
  files: number
  /** Belongs to the "today" group (used when no `dayKey` is supplied). */
  isToday: boolean
  /** Merge commit: hollow double-ring node, merge pill. */
  isMerge?: boolean
  /** Calendar group key (`YYYY-MM-DD`); defaults to today/earlier. */
  dayKey?: string
  /** Pre-formatted group title ("今天" / "昨天" / "10月26日"). */
  dayLabel?: string
  /** Display hash when `id` is not the hash itself. */
  hash?: string
}

/** One changed file of the repository, aggregated for the demo tree. */
export interface SwimlaneFile {
  /** Repository-relative path, using `/`. */
  path: string
  /** Change letter shown in the status badge. */
  status: 'A' | 'M' | 'D' | 'R'
  /** Added lines across the loaded window. */
  add?: number
  /** Deleted lines across the loaded window. */
  del?: number
  /** How many loaded commits touched the file. */
  changes?: number
}

/** One occupied lane, for the legend. */
export interface SwimlaneLane {
  /** Lane index. */
  lane: number
  /** Representative branch name. */
  branch: string
  /** Branch family. */
  type: BranchKind
  /** Commits of that branch in the loaded window. */
  count: number
}

/** One calendar group of commits. */
export interface SwimlaneGroup {
  /** Stable group key. */
  key: string
  /** Pre-formatted title. */
  label: string
  /** Newest-first commits of the group. */
  commits: GitCommit[]
}

/** Every string the swimlane page renders, injected so the caller localizes it. */
export interface SwimlaneLabels {
  today: string
  yesterday: string
  earlier: string
  merge: string
  head: string
  filesPane: string
  search: string
  legend: string
  timelineTab: string
  pendingTab: string
  prTab: string
  empty: { title: string; hint: string }
  files: (count: number) => string
  commits: (count: number) => string
  additions: (count: number) => string
  deletions: (count: number) => string
  changes: (count: number) => string
  branchTitle: (branch: string) => string
  rowAria: (label: string) => string
  scope: { all: string; current: string }
  actions: { pull: string; push: string; refresh: string; more: string }
}

/* -------------------------------------------------------------- geometry */

/** Height of one timeline row, in px (the stylesheet reads the same value). */
export const ROW_HEIGHT = 64

/** Width of one lane track, in px. */
export const LANE_WIDTH = 40

/** X offset of lane 0, in px. */
export const LANE_ORIGIN = 20

/** Minimum width of the graph canvas, in px. */
export const MIN_CANVAS_WIDTH = 140

/** How many tracks the canvas will grow to before lanes are folded. */
const MAX_LANES = 8

/** Centre X of one lane: `20 + lane * 40`, exactly as specified. */
export function nodeX(lane: number): number {
  return LANE_ORIGIN + Math.max(0, lane) * LANE_WIDTH
}

/** Canvas width needed for a lane count; never narrower than 140px. */
export function laneTrackWidth(laneCount: number): number {
  const tracks = Math.min(MAX_LANES, Math.max(1, laneCount))
  return Math.max(MIN_CANVAS_WIDTH, nodeX(tracks - 1) + LANE_ORIGIN + 8)
}

/** SVG path of the link entering one row, and whether it is a straight line. */
export function rowLinkPath(prevLane: number, lane: number, height: number = ROW_HEIGHT): {
  straight: boolean
  d: string
} {
  const currentX = nodeX(lane)
  const half = height / 2
  if (prevLane === lane) {
    return { straight: true, d: `M ${currentX} 0 L ${currentX} ${half}` }
  }
  const previousX = nodeX(prevLane)
  // The brief's exact curve: leave the previous node vertically, bend through
  // the quarter lines, and land on the new node.
  return {
    straight: false,
    d: `M ${previousX} 0 C ${previousX} ${height / 4}, ${currentX} ${height / 4}, ${currentX} ${half}`,
  }
}

/* -------------------------------------------------------------- lane math */

/** Branch family of one decoration. */
export function branchKindOf(branch: string | undefined | null): BranchKind {
  const name = (branch ?? '').trim().toLowerCase()
  if (name === '' || /^(main|master|trunk|develop|dev)$/.test(name)) return 'main'
  if (/hotfix|bugfix|^fix[\/-]/.test(name)) return 'hotfix'
  return 'feat'
}

/** Sort weight: main first, then feature branches, then hotfixes. */
function kindWeight(kind: BranchKind): number {
  if (kind === 'main') return 0
  if (kind === 'feat') return 1
  return 2
}

/**
 * Assign lanes to a newest-first commit list and derive the legend.
 *
 * The assignment is deterministic and branch-driven (not parent-driven): lane 0
 * is the trunk, feature branches follow in order of first appearance, hotfix
 * tracks come last. That keeps one branch on one visual track for the whole
 * page, which is what makes a swimlane readable; parent hashes are still the
 * caller's business for merge markers.
 */
export function assignLanes(commits: readonly GitCommit[]): { commits: GitCommit[]; lanes: SwimlaneLane[] } {
  interface BranchOrder {
    branch: string
    kind: BranchKind
    first: number
    count: number
  }
  const order = new Map<string, BranchOrder>()
  commits.forEach((commit, index) => {
    const branch = commit.branch === '' ? 'main' : commit.branch
    const known = order.get(branch)
    if (known === undefined) {
      order.set(branch, { branch, kind: branchKindOf(branch), first: index, count: 1 })
      return
    }
    known.count += 1
  })
  const ordered = [...order.values()].sort((left, right) => {
    const weight = kindWeight(left.kind) - kindWeight(right.kind)
    if (weight !== 0) return weight
    return left.first - right.first
  })
  const laneOf = new Map<string, number>()
  const lanes: SwimlaneLane[] = ordered.slice(0, MAX_LANES).map((entry, lane) => {
    laneOf.set(entry.branch, lane)
    return { lane, branch: entry.branch, type: entry.kind, count: entry.count }
  })
  const lastLane = Math.max(0, lanes.length - 1)
  const mapped = commits.map((commit) => {
    const branch = commit.branch === '' ? 'main' : commit.branch
    const lane = Math.min(laneOf.get(branch) ?? lastLane, lastLane)
    return { ...commit, lane, type: branchKindOf(branch) }
  })
  return { commits: mapped, lanes }
}

/** Lane colour token name, resolved by the stylesheet. */
function laneColorVar(type: BranchKind): string {
  if (type === 'main') return 'var(--swl-main)'
  if (type === 'hotfix') return 'var(--swl-hotfix)'
  return 'var(--swl-feat)'
}

/** Lane of a commit, falling back to lane 0. */
function laneValue(commit: GitCommit): number {
  return Number.isFinite(commit.lane) ? Math.max(0, Math.trunc(commit.lane)) : 0
}

/**
 * Group a newest-first list by calendar day.
 *
 * Order is preserved: groups appear in the order their first commit appears,
 * and every commit stays in exactly one group.
 */
export function groupCommits(commits: readonly GitCommit[], labels: SwimlaneLabels): SwimlaneGroup[] {
  const groups: SwimlaneGroup[] = []
  let current: SwimlaneGroup | null = null
  for (const commit of commits) {
    const key = commit.dayKey ?? (commit.isToday ? 'today' : 'earlier')
    const label = commit.dayLabel ?? (commit.isToday ? labels.today : labels.earlier)
    if (current === null || current.key !== key) {
      current = { key, label, commits: [] }
      groups.push(current)
    }
    current.commits.push(commit)
  }
  return groups
}

/* ------------------------------------------------------------- formatting */

/** Display hash: `hash` when supplied, else the id with any prefix stripped. */
export function displayHash(commit: GitCommit): string {
  const raw = commit.hash ?? commit.id
  const value = raw.includes(':') ? raw.slice(raw.lastIndexOf(':') + 1) : raw
  return value.length > 7 ? value.slice(0, 7) : value
}

/** Up to two initials for the author avatar. */
export function authorInitials(author: string): string {
  const parts = author.trim().split(/\s+/).filter((part) => part !== '')
  const first = parts[0]
  if (first === undefined) return '?'
  if (parts.length === 1) return first.slice(0, 2).toUpperCase()
  const last = parts[parts.length - 1] ?? first
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase()
}

/** Stable hue for one author, so avatars keep their colour across renders. */
export function authorHue(author: string): number {
  let hash = 0
  for (const character of author) hash = (hash * 31 + character.charCodeAt(0)) % 360
  return hash
}

/** Shorten a label without cutting a surrogate pair. */
function clip(text: string, max: number): string {
  const value = Array.from(text)
  if (value.length <= max) return text
  return `${value.slice(0, Math.max(1, max - 1)).join('')}…`
}

/* ------------------------------------------------------------------ icons */

type IconName =
  | 'repo' | 'branch' | 'chevron' | 'search' | 'file' | 'folder' | 'folderOpen'
  | 'commit' | 'merge' | 'refresh' | 'pull' | 'push' | 'more' | 'timeline'
  | 'checklist' | 'pr' | 'sidebar' | 'close'

type IconShape = [tag: 'path' | 'line' | 'circle' | 'polyline', attrs: Record<string, string | number>]

/** Minimal inline SVG registry: no dependency, no global stylesheet. */
const ICON_SHAPES: Record<IconName, IconShape[]> = {
  repo: [
    ['path', { d: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20' }],
    ['path', { d: 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z' }],
  ],
  branch: [
    ['line', { x1: 6, y1: 3, x2: 6, y2: 15 }],
    ['circle', { cx: 18, cy: 6, r: 3 }],
    ['circle', { cx: 6, cy: 18, r: 3 }],
    ['path', { d: 'M18 9a9 9 0 0 1-9 9' }],
  ],
  chevron: [['path', { d: 'm6 9 6 6 6-6' }]],
  search: [
    ['circle', { cx: 11, cy: 11, r: 7 }],
    ['line', { x1: 16.5, y1: 16.5, x2: 21, y2: 21 }],
  ],
  file: [
    ['path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }],
    ['path', { d: 'M14 2v6h6' }],
  ],
  folder: [['path', { d: 'M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' }]],
  folderOpen: [
    ['path', { d: 'M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3z' }],
    ['path', { d: 'm3 11 1.7 7a2 2 0 0 0 2 1.6H19a2 2 0 0 0 2-1.8L22 11H3z' }],
  ],
  commit: [
    ['circle', { cx: 12, cy: 12, r: 3.2 }],
    ['line', { x1: 12, y1: 3, x2: 12, y2: 8.8 }],
    ['line', { x1: 12, y1: 15.2, x2: 12, y2: 21 }],
  ],
  merge: [
    ['circle', { cx: 6, cy: 6, r: 2.6 }],
    ['circle', { cx: 18, cy: 6, r: 2.6 }],
    ['circle', { cx: 12, cy: 18, r: 2.6 }],
    ['path', { d: 'M6 8.6V12a4 4 0 0 0 4 4h2' }],
    ['path', { d: 'M18 8.6V12' }],
  ],
  refresh: [
    ['path', { d: 'M21 12a9 9 0 1 1-2.6-6.4' }],
    ['path', { d: 'M21 3v6h-6' }],
  ],
  pull: [
    ['line', { x1: 12, y1: 3, x2: 12, y2: 15 }],
    ['polyline', { points: '7 10 12 15 17 10' }],
    ['line', { x1: 5, y1: 21, x2: 19, y2: 21 }],
  ],
  push: [
    ['line', { x1: 12, y1: 21, x2: 12, y2: 9 }],
    ['polyline', { points: '7 14 12 9 17 14' }],
    ['line', { x1: 5, y1: 3, x2: 19, y2: 3 }],
  ],
  more: [
    ['circle', { cx: 5, cy: 12, r: 1.6, fill: 'currentColor', stroke: 'none' }],
    ['circle', { cx: 12, cy: 12, r: 1.6, fill: 'currentColor', stroke: 'none' }],
    ['circle', { cx: 19, cy: 12, r: 1.6, fill: 'currentColor', stroke: 'none' }],
  ],
  timeline: [
    ['line', { x1: 6, y1: 3, x2: 6, y2: 21 }],
    ['circle', { cx: 6, cy: 7, r: 2 }],
    ['circle', { cx: 6, cy: 17, r: 2 }],
    ['line', { x1: 11, y1: 7, x2: 20, y2: 7 }],
    ['line', { x1: 11, y1: 17, x2: 20, y2: 17 }],
  ],
  checklist: [
    ['path', { d: 'M9 6h11' }],
    ['path', { d: 'M9 12h11' }],
    ['path', { d: 'M9 18h11' }],
    ['path', { d: 'm3 6 1.6 1.6L7.4 4.8' }],
    ['path', { d: 'm3 12 1.6 1.6L7.4 10.8' }],
  ],
  pr: [
    ['circle', { cx: 6, cy: 6, r: 2.6 }],
    ['circle', { cx: 6, cy: 18, r: 2.6 }],
    ['circle', { cx: 18, cy: 18, r: 2.6 }],
    ['path', { d: 'M6 8.6v6.8' }],
    ['path', { d: 'M18 15.4V12a4 4 0 0 0-4-4h-2' }],
  ],
  sidebar: [
    ['path', { d: 'M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z' }],
    ['line', { x1: 9, y1: 4, x2: 9, y2: 20 }],
  ],
  close: [['path', { d: 'm6 6 12 12M18 6 6 18' }]],
}

/** One inline icon. */
function Icon(props: { name: IconName; size?: number }): React.ReactElement {
  const size = props.size ?? 14
  const shapes = ICON_SHAPES[props.name]
  return h('svg', {
    className: 'swl-icon',
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  }, shapes.map((shape, index) => h(shape[0], { key: index, ...shape[1] })))
}

/* -------------------------------------------------------------- small bits */

/** A coloured capsule badge. */
function Pill(props: {
  className: string
  title?: string
  /** Inline lane/status colour as a CSS custom property. */
  color?: string
  children: React.ReactNode
}): React.ReactElement {
  const style = props.color === undefined
    ? undefined
    : ({ '--swl-pill-color': props.color } as unknown as React.CSSProperties)
  return h('span', {
    className: `swl-pill ${props.className}`,
    ...(props.title === undefined ? {} : { title: props.title }),
    ...(style === undefined ? {} : { style }),
  }, props.children)
}

/** Author avatar with a stable hue. */
function Avatar(props: { author: string }): React.ReactElement {
  const hue = authorHue(props.author)
  return h('span', {
    className: 'swl-avatar dvt-tl-avatar',
    'aria-hidden': 'true',
    style: { '--swl-avatar-hue': String(hue) } as unknown as React.CSSProperties,
  }, authorInitials(props.author))
}

/** One lane legend chip. */
function LaneChip(props: { lane: SwimlaneLane; labels: SwimlaneLabels }): React.ReactElement {
  return h('span', {
    className: 'swl-lane-chip',
    title: props.labels.branchTitle(props.lane.branch),
    style: { '--swl-pill-color': laneColorVar(props.lane.type) } as unknown as React.CSSProperties,
  },
  h('span', { className: 'swl-lane-dot', 'aria-hidden': 'true' }),
  h('span', { className: 'swl-lane-name' }, clip(props.lane.branch, 24)),
  h('span', { className: 'swl-lane-count' }, String(props.lane.count)),
  )
}

/* ------------------------------------------------------------- timeline */

/** Props of the swimlane list. */
export interface SwimlaneTimelineProps {
  /** Newest-first commits; lanes are read from each commit. */
  commits: readonly GitCommit[]
  /** Occupied lanes, for the legend and track colours. */
  lanes: readonly SwimlaneLane[]
  /** Localized strings. */
  labels: SwimlaneLabels
  /** Commit id that should render the HEAD badge. */
  headId?: string
  /** Currently opened commit id. */
  selectedId?: string | null
  /** Open one commit's detail. */
  onOpenCommit?: (id: string) => void
  /** Narrow the history to one branch. */
  onSelectBranch?: (branch: string) => void
}

/** One SVG canvas + absolutely positioned node for a row. */
function RowGraph(props: {
  commit: GitCommit
  previousLane: number | null
  laneCount: number
  canvasWidth: number
  isLastOfGroup: boolean
  laneColors: ReadonlyArray<string>
}): React.ReactElement {
  const { commit, previousLane, laneCount, canvasWidth, isLastOfGroup, laneColors } = props
  const lane = laneValue(commit)
  const color = laneColors[lane] ?? laneColorVar(commit.type)
  const half = ROW_HEIGHT / 2
  const children: React.ReactNode[] = []

  // Faint tracks: every occupied lane keeps a vertical guide through the row,
  // which is what turns a chain of curves into readable swimlanes.
  if (laneCount > 1) {
    for (let column = 0; column < laneCount; column += 1) {
      children.push(h('line', {
        key: `track-${column}`,
        x1: nodeX(column),
        y1: 0,
        x2: nodeX(column),
        y2: ROW_HEIGHT,
        stroke: laneColors[column] ?? color,
        strokeWidth: 1.5,
        strokeOpacity: 0.1,
      }))
    }
  }

  if (previousLane !== null) {
    const link = rowLinkPath(previousLane, lane)
    if (link.straight) {
      children.push(h('line', {
        key: 'link',
        x1: nodeX(lane),
        y1: 0,
        x2: nodeX(lane),
        y2: half,
        stroke: color,
        strokeWidth: 2.4,
        strokeOpacity: 0.5,
        strokeLinecap: 'round',
      }))
    } else {
      children.push(h('path', {
        key: 'link',
        d: link.d,
        fill: 'none',
        stroke: color,
        strokeWidth: 2.4,
        strokeOpacity: 0.5,
        strokeLinecap: 'round',
      }))
    }
  }

  // Continue the track below the node so the next row's link connects without
  // a one-row gap (day headers are the only intended break).
  if (!isLastOfGroup) {
    children.push(h('line', {
      key: 'tail',
      x1: nodeX(lane),
      y1: half,
      x2: nodeX(lane),
      y2: ROW_HEIGHT,
      stroke: color,
      strokeWidth: 2.4,
      strokeOpacity: 0.5,
      strokeLinecap: 'round',
    }))
  }

  return h('div', {
    className: 'swl-canvas dvt-tl-graph',
    style: { width: `${canvasWidth}px` },
    'aria-hidden': 'true',
  },
  h('svg', { className: 'swl-svg', width: canvasWidth, height: ROW_HEIGHT, viewBox: `0 0 ${canvasWidth} ${ROW_HEIGHT}` }, children),
  h('span', {
    className: 'swl-node dvt-tl-graph-node',
    'data-merge': commit.isMerge === true ? 'true' : 'false',
    style: {
      left: `${nodeX(lane)}px`,
      top: `${half}px`,
      '--swl-lane-color': color,
    } as unknown as React.CSSProperties,
  }),
  )
}

/** One commit row: graph canvas + card with summary, pills and metadata. */
function SwimlaneRow(props: {
  commit: GitCommit
  previousLane: number | null
  laneCount: number
  canvasWidth: number
  laneColors: ReadonlyArray<string>
  isLastOfGroup: boolean
  labels: SwimlaneLabels
  head: boolean
  selected: boolean
  onOpenCommit?: (id: string) => void
  onSelectBranch?: (branch: string) => void
}): React.ReactElement {
  const { commit, labels } = props
  const hash = displayHash(commit)
  const merge = commit.isMerge === true
  const branch = commit.branch === '' ? labels.earlier : commit.branch
  const aria = labels.rowAria(`${hash} ${clip(commit.msg, 80)}`)
  const open = (): void => { props.onOpenCommit?.(commit.id) }
  return h('li', {
    className: 'swl-row dvt-tl-row',
    'data-selected': props.selected ? 'true' : 'false',
    'data-merge': merge ? 'true' : 'false',
  },
  h(RowGraph, {
    commit,
    previousLane: props.previousLane,
    laneCount: props.laneCount,
    canvasWidth: props.canvasWidth,
    isLastOfGroup: props.isLastOfGroup,
    laneColors: props.laneColors,
  }),
  h('button', {
    type: 'button',
    className: 'swl-rowbody dvt-tl-card',
    'aria-label': aria,
    title: `${commit.msg}\n${labels.branchTitle(branch)} · ${hash}`,
    onClick: open,
  },
  h('span', { className: 'swl-rowtop' },
    h('span', { className: 'swl-msg' }, commit.msg === '' ? '—' : clip(commit.msg, 200)),
    h('span', { className: 'swl-pills' },
      h(Pill, {
        className: 'swl-pill-branch dvt-branch-btn',
        title: labels.branchTitle(branch),
        color: laneColorVar(commit.type),
      },
      h(Icon, { name: 'branch', size: 10 }),
      h('span', null, clip(branch, 22)),
      ),
      merge
        ? h(Pill, { className: 'swl-pill-merge', title: labels.merge }, h(Icon, { name: 'merge', size: 10 }), h('span', null, labels.merge))
        : null,
      props.head
        ? h(Pill, { className: 'swl-pill-head dvt-tl-head', title: labels.head }, labels.head)
        : null,
    ),
  ),
  h('span', { className: 'swl-rowmeta' },
    h(Avatar, { author: commit.author }),
    h('span', { className: 'swl-author' }, commit.author),
    h('span', { className: 'swl-dot', 'aria-hidden': 'true' }, '·'),
    h('span', { className: 'swl-when' }, commit.time),
    h('span', { className: 'swl-dot', 'aria-hidden': 'true' }, '·'),
    h('span', { className: 'swl-hash dvt-tl-hash swl-mono' }, hash),
    h('span', { className: 'swl-stats' },
      commit.add > 0 ? h(Pill, { className: 'swl-pill-add dvt-stat-add', title: labels.additions(commit.add), color: 'var(--swl-ok)' }, `+${commit.add}`) : null,
      commit.del > 0 ? h(Pill, { className: 'swl-pill-del dvt-stat-del', title: labels.deletions(commit.del), color: 'var(--swl-bad)' }, `−${commit.del}`) : null,
      commit.files > 0
        ? h(Pill, { className: 'swl-pill-files dvt-stat-files', title: labels.files(commit.files) }, labels.files(commit.files))
        : null,
    ),
  ),
  ),
  )
}

/** The swimlane history: lane legend, sticky day groups, rows. */
export function SwimlaneTimeline(props: SwimlaneTimelineProps): React.ReactElement {
  const { commits, lanes, labels } = props
  const laneCount = Math.max(1, Math.min(MAX_LANES, lanes.length, ...commits.map((commit) => laneValue(commit) + 1)))
  const canvasWidth = laneTrackWidth(laneCount)
  const laneColors: string[] = []
  for (let column = 0; column < laneCount; column += 1) {
    const lane = lanes.find((entry) => entry.lane === column)
    laneColors.push(lane === undefined ? 'var(--swl-accent)' : laneColorVar(lane.type))
  }
  const groups = groupCommits(commits, labels)
  if (commits.length === 0) {
    return h('div', { className: 'swl-timeline' },
      h('div', { className: 'swl-empty' },
        h('span', { className: 'swl-empty-icon' }, h(Icon, { name: 'timeline', size: 22 })),
        h('span', { className: 'swl-empty-title' }, labels.empty.title),
        h('span', { className: 'swl-empty-hint' }, labels.empty.hint),
      ),
    )
  }
  return h('div', {
    className: 'swl-timeline',
    role: 'list',
    'aria-label': labels.timelineTab,
    style: { '--swl-canvas-w': `${canvasWidth}px` } as unknown as React.CSSProperties,
  },
  lanes.length === 0
    ? null
    : h('div', { className: 'swl-legend', role: 'group', 'aria-label': labels.legend },
      h('span', { className: 'swl-legend-label' }, labels.legend),
      lanes.map((lane) => h(LaneChip, { key: lane.lane, lane, labels })),
    ),
  groups.map((group) => h('section', { key: group.key, className: 'swl-group dvt-tl-group' },
    h('div', { className: 'swl-group-head dvt-tl-day' },
      h('span', { className: 'swl-group-label dvt-tl-day-label' }, group.label),
      h('span', { className: 'swl-group-count' }, labels.commits(group.commits.length)),
      group.commits.length > 1
        ? h('span', { className: 'swl-group-track' }, '')
        : null,
    ),
    h('ul', { className: 'swl-list dvt-tl-list', role: 'list' },
      group.commits.map((commit, index) => {
        const previous = index === 0 ? null : group.commits[index - 1]
        return h(SwimlaneRow, {
          key: commit.id,
          commit,
          previousLane: previous === undefined || previous === null ? null : laneValue(previous),
          laneCount,
          canvasWidth,
          laneColors,
          isLastOfGroup: index === group.commits.length - 1,
          labels,
          head: props.headId !== undefined && props.headId !== '' && (commit.id === props.headId || commit.hash === props.headId),
          selected: props.selectedId === commit.id,
          ...(props.onOpenCommit === undefined ? {} : { onOpenCommit: props.onOpenCommit }),
          ...(props.onSelectBranch === undefined ? {} : { onSelectBranch: props.onSelectBranch }),
        })
      }),
    ),
  )),
  )
}

/* --------------------------------------------------------------- header */

/** Props of the page header (repository identity + write actions). */
export interface SwimlaneHeaderProps {
  repository: {
    name: string
    /** `Git` / `SVN`, shown as the badge next to the name. */
    vcs: string
    branch?: string
    rootPath?: string
  }
  repositories?: ReadonlyArray<{ id: string; name: string }>
  /** Branches offered by the branch dropdown. */
  branches?: readonly string[]
  labels: SwimlaneLabels
  /** Disables the write buttons while an operation dialog is open. */
  busy?: boolean
  onSelectRepository?: (id: string) => void
  onSelectBranch?: (branch: string) => void
  onRefresh?: () => void
  onPull?: () => void
  onPush?: () => void
  onMore?: () => void
}

/** Page header: GIT badge, repository switcher, branch dropdown, pull/push. */
export function SwimlaneHeader(props: SwimlaneHeaderProps): React.ReactElement {
  const { repository, labels } = props
  const branches = props.branches ?? []
  const current = repository.branch ?? ''
  return h('header', { className: 'swl-header dvt-toolbar' },
    h('div', {
      className: 'swl-title dvt-repo',
      title: repository.rootPath ?? repository.name,
    },
    h('span', { className: 'swl-title-icon dvt-repo-icon' }, h(Icon, { name: 'repo', size: 15 })),
    h('span', { className: 'swl-repo-name dvt-repo-name' }, repository.name),
    h('span', { className: 'swl-vcs dvt-repo-vcs' }, repository.vcs),
    h('span', { className: 'swl-title-caret dvt-repo-caret' }, h(Icon, { name: 'chevron', size: 12 })),
    (props.repositories ?? []).length <= 1
      ? null
      : h('select', {
        className: 'swl-native dvt-repo-native',
        'aria-label': repository.name,
        value: props.repositories?.[0]?.id ?? '',
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) => props.onSelectRepository?.(event.currentTarget.value),
      }, (props.repositories ?? []).map((entry) => h('option', { key: entry.id, value: entry.id }, entry.name))),
    ),
    h('label', {
      className: 'swl-branch dvt-branch',
      title: labels.branchTitle(current),
    },
    h(Icon, { name: 'branch', size: 11 }),
    h('select', {
      className: 'swl-branch-select',
      'aria-label': labels.branchTitle(current),
      value: current,
      onChange: (event: React.ChangeEvent<HTMLSelectElement>) => props.onSelectBranch?.(event.currentTarget.value),
    },
    current === ''
      ? h('option', { value: '' }, labels.earlier)
      : null,
    branches.map((branch) => h('option', { key: branch, value: branch }, branch)),
    ),
    h('span', { className: 'swl-branch-caret', 'aria-hidden': 'true' }, h(Icon, { name: 'chevron', size: 11 })),
    ),
    h('span', { className: 'swl-actions dvt-toolbar-actions' },
      h('button', {
        type: 'button',
        className: 'swl-iconbtn dvt-iconbtn',
        title: labels.actions.refresh,
        'aria-label': labels.actions.refresh,
        onClick: props.onRefresh,
      }, h(Icon, { name: 'refresh', size: 14 })),
      h('button', {
        type: 'button',
        className: 'swl-btn swl-btn-outline',
        disabled: props.busy === true,
        onClick: props.onPull,
      }, h(Icon, { name: 'pull', size: 13 }), h('span', null, labels.actions.pull)),
      h('button', {
        type: 'button',
        className: 'swl-btn swl-btn-primary',
        disabled: props.busy === true,
        onClick: props.onPush,
      }, h(Icon, { name: 'push', size: 13 }), h('span', null, labels.actions.push)),
      h('button', {
        type: 'button',
        className: 'swl-iconbtn dvt-iconbtn',
        title: labels.actions.more,
        'aria-label': labels.actions.more,
        onClick: props.onMore,
      }, h(Icon, { name: 'more', size: 15 })),
    ),
  )
}

/* -------------------------------------------------------------- toolbar */

/** Props of the tab/scope toolbar. */
export interface SwimlaneToolbarProps {
  tabs: ReadonlyArray<{ key: string; label: string; count?: number }>
  active: string
  onSelectTab: (key: string) => void
  scope: 'all' | 'current'
  onScope: (scope: 'all' | 'current') => void
  query: string
  onQuery: (value: string) => void
  labels: SwimlaneLabels
}

/** Toolbar: source tabs on the left, search + scope capsule on the right. */
export function SwimlaneToolbar(props: SwimlaneToolbarProps): React.ReactElement {
  const { labels } = props
  return h('div', { className: 'swl-toolbar dvt-filterbar' },
    h('div', { className: 'swl-tabs', role: 'tablist', 'aria-label': labels.timelineTab },
      props.tabs.map((tab) => h('button', {
        key: tab.key,
        type: 'button',
        role: 'tab',
        className: 'swl-tab dvt-tab',
        'aria-selected': props.active === tab.key,
        onClick: () => props.onSelectTab(tab.key),
      },
      h('span', null, tab.label),
      tab.count === undefined || tab.count === 0
        ? null
        : h('span', { className: 'swl-tab-count' }, String(tab.count)),
      )),
    ),
    h('span', { className: 'swl-toolbar-right' },
      h('label', { className: 'swl-search' },
        h(Icon, { name: 'search', size: 12 }),
        h('input', {
          className: 'swl-search-input dvt-search-input',
          type: 'search',
          value: props.query,
          placeholder: labels.search,
          'aria-label': labels.search,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => props.onQuery(event.currentTarget.value),
        }),
      ),
      h('div', { className: 'swl-seg dvt-seg', role: 'group' },
        h('button', {
          type: 'button',
          className: 'swl-seg-btn dvt-seg-btn',
          'aria-pressed': props.scope === 'all',
          onClick: () => props.onScope('all'),
        }, labels.scope.all),
        h('button', {
          type: 'button',
          className: 'swl-seg-btn dvt-seg-btn',
          'aria-pressed': props.scope === 'current',
          onClick: () => props.onScope('current'),
        }, labels.scope.current),
      ),
    ),
  )
}

/* ------------------------------------------------------------- sidebar */

interface DemoTreeNode {
  kind: 'dir' | 'file'
  name: string
  path: string
  count: number
  file?: SwimlaneFile
  children: DemoTreeNode[]
}

/** Build the demo tree from flat paths (directories always open). */
function buildDemoTree(files: readonly SwimlaneFile[]): DemoTreeNode[] {
  const root: DemoTreeNode = { kind: 'dir', name: '', path: '', count: 0, children: [] }
  for (const file of files) {
    const segments = file.path.split('/').filter((segment) => segment !== '')
    let node = root
    segments.forEach((segment, index) => {
      const last = index === segments.length - 1
      const path = segments.slice(0, index + 1).join('/')
      let child = node.children.find((entry) => entry.name === segment && entry.kind === (last ? 'file' : 'dir'))
      if (child === undefined) {
        child = last
          ? { kind: 'file', name: segment, path, count: 1, file, children: [] }
          : { kind: 'dir', name: segment, path, count: 0, children: [] }
        node.children.push(child)
      }
      if (last) child.file = file
      node = child
    })
  }
  const countUp = (node: DemoTreeNode): number => {
    if (node.kind === 'file') return 1
    node.count = node.children.reduce((sum, child) => sum + countUp(child), 0)
    return node.count
  }
  countUp(root)
  return root.children
}

/** One demo tree row. */
function DemoTreeRow(props: { node: DemoTreeNode; depth: number }): React.ReactElement {
  const { node, depth } = props
  const indent = 8 + depth * 13
  if (node.kind === 'dir') {
    return h('li', { className: 'swl-tree-item' },
      h('div', { className: 'swl-tree-row swl-tree-dir', style: { paddingLeft: `${indent}px` } },
        h('span', { className: 'swl-tree-caret' }, h(Icon, { name: 'chevron', size: 11 })),
        h('span', { className: 'swl-tree-icon' }, h(Icon, { name: 'folderOpen', size: 13 })),
        h('span', { className: 'swl-tree-name' }, node.name),
        h('span', { className: 'swl-tree-badge' }, String(node.count)),
      ),
      h('ul', { className: 'swl-tree-list' }, node.children.map((child) => h(DemoTreeRow, { key: child.path, node: child, depth: depth + 1 }))),
    )
  }
  const file = node.file
  return h('li', { className: 'swl-tree-item' },
    h('div', { className: 'swl-tree-row swl-tree-file', style: { paddingLeft: `${indent}px` } },
      h('span', { className: 'swl-tree-icon' }, h(Icon, { name: 'file', size: 12 })),
      h('span', { className: 'swl-tree-name' }, node.name),
      file !== undefined && file.add !== undefined && file.add > 0
        ? h('span', { className: 'swl-tree-add swl-mono' }, `+${file.add}`)
        : null,
      h('span', {
        className: `swl-status swl-status-${file === undefined ? 'M' : file.status}`,
        title: `${file === undefined ? 'M' : file.status}`,
        'aria-hidden': 'true',
      }, file === undefined ? 'M' : file.status),
    ),
  )
}

/** Props of the demo sidebar tree. */
export interface SwimlaneFileTreeProps {
  files: readonly SwimlaneFile[]
  labels: SwimlaneLabels
  query?: string
  onQuery?: (value: string) => void
}

/** The 260px change tree used by the standalone demo page. */
export function SwimlaneFileTree(props: SwimlaneFileTreeProps): React.ReactElement {
  const { files, labels } = props
  const tree = buildDemoTree(files)
  const added = files.reduce((sum, file) => sum + (file.add ?? 0), 0)
  const removed = files.reduce((sum, file) => sum + (file.del ?? 0), 0)
  const byStatus = (status: SwimlaneFile['status']): number => files.filter((file) => file.status === status).length
  return h('div', { className: 'swl-tree' },
    h('div', { className: 'swl-tree-head' },
      h('span', { className: 'swl-tree-title' }, labels.filesPane),
      h('span', { className: 'swl-tree-total' }, String(files.length)),
    ),
    h('label', { className: 'swl-tree-search' },
      h(Icon, { name: 'search', size: 12 }),
      h('input', {
        className: 'swl-tree-input',
        type: 'search',
        value: props.query ?? '',
        placeholder: labels.search,
        'aria-label': labels.search,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => props.onQuery?.(event.currentTarget.value),
      }),
    ),
    h('div', { className: 'swl-tree-stats' },
      h(Pill, { className: 'swl-pill-add', color: 'var(--swl-ok)' }, `+${added}`),
      h(Pill, { className: 'swl-pill-del', color: 'var(--swl-bad)' }, `−${removed}`),
      h(Pill, { className: 'swl-pill-files' }, labels.changes(files.length)),
    ),
    h('div', { className: 'swl-tree-filter' },
      h('span', { className: 'swl-tree-chip' }, '全部'),
      h('span', { className: 'swl-tree-chip' }, `M ${byStatus('M')}`),
      h('span', { className: 'swl-tree-chip' }, `A ${byStatus('A')}`),
      h('span', { className: 'swl-tree-chip' }, `D ${byStatus('D')}`),
      h('span', { className: 'swl-tree-chip' }, `R ${byStatus('R')}`),
    ),
    h('ul', { className: 'swl-tree-list swl-tree-scroll' }, tree.map((node) => h(DemoTreeRow, { key: node.path, node, depth: 0 }))),
  )
}

/* --------------------------------------------------------------- shell */

/** Props of the page shell (layout only). */
export interface SwimlaneShellProps {
  /** Left column; omitted sources render the right column full width. */
  sidebar?: React.ReactNode
  /** File count shown in the narrow-layout drawer toggle. */
  sidebarCount?: number
  /** Header + toolbar, already composed by the caller. */
  chrome: React.ReactNode
  /** The scrollable main surface (timeline list / pending workbench / …). */
  children: React.ReactNode
  labels?: SwimlaneLabels
}

/**
 * Page shell: light-gray page layer, white rounded cards, no hard borders.
 *
 * The shell is the only place {@link SWIMLANE_STYLES} is mounted, so both the
 * plugin panel and the demo page get one stylesheet instance. At container
 * widths under 860px the sidebar becomes an overlay drawer with its own toggle,
 * which keeps the right sidebar usable while preserving the wide layout.
 */
export function SwimlaneShell(props: SwimlaneShellProps): React.ReactElement {
  const labels = props.labels ?? DEFAULT_LABELS
  const [open, setOpen] = React.useState(false)
  const hasSidebar = props.sidebar !== undefined && props.sidebar !== null
  return h('div', {
    className: 'swl-page dvt-split',
    'data-swimlane': 'v1',
    'data-sidebar': open ? 'open' : 'closed',
  },
  h('style', { key: 'swl-styles' }, SWIMLANE_STYLES),
  h('div', { className: 'swl-frame' },
    hasSidebar
      ? h('aside', { key: 'sidebar', className: 'swl-sidebar', 'aria-label': labels.filesPane }, props.sidebar)
      : null,
    h('section', { key: 'main', className: 'swl-main' },
      hasSidebar
        ? h('div', { className: 'swl-mobilebar' },
          h('button', {
            type: 'button',
            className: 'swl-mobilebtn',
            'aria-expanded': open,
            onClick: () => setOpen(!open),
          },
          h(Icon, { name: 'sidebar', size: 13 }),
          h('span', null, labels.filesPane),
          props.sidebarCount === undefined
            ? null
            : h('span', { className: 'swl-mobilecount' }, String(props.sidebarCount)),
          ),
        )
        : null,
      h('div', { key: 'chrome', className: 'swl-chrome' }, props.chrome),
      h('div', { key: 'content', className: 'swl-content' }, props.children),
    ),
    open ? h('div', { key: 'scrim', className: 'swl-scrim', onClick: () => setOpen(false), 'aria-hidden': 'true' }) : null,
  ),
  )
}

/* ----------------------------------------------------------- default copy */

/** Chinese defaults so the demo page is usable with no props at all. */
export const DEFAULT_LABELS: SwimlaneLabels = {
  today: '今天',
  yesterday: '昨天',
  earlier: '更早',
  merge: '合并',
  head: 'HEAD',
  filesPane: '文件',
  search: '搜索提交说明或作者',
  legend: '分支轨道',
  timelineTab: '时间线',
  pendingTab: '待处理',
  prTab: '拉取请求',
  empty: { title: '暂无提交记录', hint: '切换仓库或清除筛选后重试。' },
  files: (count) => `${count} 个文件`,
  commits: (count) => `${count} 次提交`,
  additions: (count) => `新增 ${count} 行`,
  deletions: (count) => `删除 ${count} 行`,
  changes: (count) => `${count} 个变更`,
  branchTitle: (branch) => `分支 ${branch}`,
  rowAria: (label) => `查看提交 ${label}`,
  scope: { all: '全部', current: '当前分支' },
  actions: { pull: '拉取', push: '推送', refresh: '刷新', more: '更多操作' },
}

/* ------------------------------------------------------------- mock data */

/** Mock repository shown by {@link SwimlaneDemo}. */
export const MOCK_REPOSITORY = {
  name: 'web-console',
  vcs: 'GIT',
  branch: 'feature/demo1',
  rootPath: 'D:/workspace/web-console',
}

/** Mock changed files: paths, A/M/D/R status and line counts. */
export const MOCK_FILES: SwimlaneFile[] = [
  { path: 'src/client/ui/swimlane.tsx', status: 'A', add: 7348, del: 0, changes: 3 },
  { path: 'src/client/styles.ts', status: 'M', add: 412, del: 96, changes: 5 },
  { path: 'src/client/components.ts', status: 'M', add: 88, del: 41, changes: 4 },
  { path: 'src/client/ui/toolbar.ts', status: 'M', add: 126, del: 33, changes: 3 },
  { path: 'src/client/ui/filetree.ts', status: 'M', add: 64, del: 12, changes: 2 },
  { path: 'src/client/ui/history.ts', status: 'M', add: 210, del: 380, changes: 3 },
  { path: 'src/client/ui/detail.ts', status: 'M', add: 18, del: 6, changes: 1 },
  { path: 'src/client/graph.ts', status: 'M', add: 96, del: 24, changes: 2 },
  { path: 'src/shared/contracts.ts', status: 'M', add: 22, del: 4, changes: 1 },
  { path: 'src/host/routes.ts', status: 'M', add: 46, del: 18, changes: 2 },
  { path: 'docs/ARCHITECTURE.md', status: 'M', add: 120, del: 64, changes: 2 },
  { path: 'docs/UI-GUIDELINES.md', status: 'A', add: 486, del: 0, changes: 1 },
  { path: 'src/tests/swimlane.test.ts', status: 'A', add: 232, del: 0, changes: 1 },
  { path: 'src/client/ui/pending-table.ts', status: 'D', add: 0, del: 210, changes: 1 },
  { path: 'src/legacy/timeline-rail.ts', status: 'D', add: 0, del: 168, changes: 1 },
  { path: 'src/host/adapters/git/adapter.ts', status: 'M', add: 74, del: 36, changes: 2 },
  { path: 'src/host/adapters/svn/adapter.ts', status: 'M', add: 12, del: 8, changes: 1 },
  { path: 'scripts/build.mjs', status: 'M', add: 8, del: 2, changes: 1 },
  { path: 'package.json', status: 'M', add: 4, del: 2, changes: 1 },
  { path: 'README.md', status: 'M', add: 56, del: 12, changes: 2 },
  { path: 'src/client/ui/old-graph.ts', status: 'R', add: 12, del: 34, changes: 1 },
]

/**
 * Mock history: three calendar days, three branches (main / feature/demo1 /
 * hotfix/payment) and two merge commits, so every lane rule is exercised.
 */
export const MOCK_COMMITS: GitCommit[] = [
  {
    id: '7272dfe', lane: 1, type: 'feat', branch: 'feature/demo1',
    msg: 'feat: 多轨道泳道时间线与贝塞尔连线', author: 'Lin Wei', time: '21 分钟前',
    add: 7348, del: 126, files: 7, isToday: true, dayKey: 'today', dayLabel: '今天',
  },
  {
    id: 'b56850a', lane: 1, type: 'feat', branch: 'feature/demo1',
    msg: 'feat: 文件树变更统计胶囊与 A/M/D 状态徽标', author: 'Chen Yu', time: '42 分钟前',
    add: 214, del: 36, files: 4, isToday: true, dayKey: 'today', dayLabel: '今天',
  },
  {
    id: 'de72be4', lane: 0, type: 'main', branch: 'main', isMerge: true,
    msg: "Merge branch 'feature/demo1' into main", author: 'Chen Yu', time: '1 小时前',
    add: 0, del: 0, files: 7, isToday: true, dayKey: 'today', dayLabel: '今天',
  },
  {
    id: '66826a8', lane: 0, type: 'main', branch: 'main',
    msg: 'chore: 版本号提升到 0.1.2 并更新兼容性矩阵', author: 'Zhao Min', time: '2 小时前',
    add: 18, del: 6, files: 2, isToday: true, dayKey: 'today', dayLabel: '今天',
  },
  {
    id: '4e1c7f2', lane: 2, type: 'hotfix', branch: 'hotfix/payment',
    msg: 'fix: 修复窄屏下工具栏与胶囊徽标溢出', author: 'Zhao Min', time: '3 小时前',
    add: 22, del: 9, files: 2, isToday: true, dayKey: 'today', dayLabel: '今天',
  },
  {
    id: '41ee7fc', lane: 2, type: 'hotfix', branch: 'hotfix/payment',
    msg: 'fix: 提交详情中的重命名路径显示旧文件名', author: 'Zhao Min', time: '4 小时前',
    add: 12, del: 4, files: 1, isToday: true, dayKey: 'today', dayLabel: '今天',
  },
  {
    id: '73ac90f', lane: 0, type: 'main', branch: 'main', isMerge: true,
    msg: "Merge branch 'hotfix/payment' into main", author: 'Lin Wei', time: '5 小时前',
    add: 0, del: 0, files: 3, isToday: true, dayKey: 'today', dayLabel: '今天',
  },
  {
    id: 'a1f30d4', lane: 0, type: 'main', branch: 'main',
    msg: 'docs: 补充泳道时间线的交互与快捷键说明', author: 'Lin Wei', time: '昨天 18:20',
    add: 64, del: 8, files: 1, isToday: false, dayKey: '2026-10-27', dayLabel: '昨天',
  },
  {
    id: '2cf81b9', lane: 1, type: 'feat', branch: 'feature/demo1',
    msg: 'feat: 分支下拉、拉取/推送按钮与提交搜索', author: 'Chen Yu', time: '昨天 16:04',
    add: 186, del: 42, files: 3, isToday: false, dayKey: '2026-10-27', dayLabel: '昨天',
  },
  {
    id: '0c58b3d', lane: 0, type: 'main', branch: 'main',
    msg: 'refactor: 收敛主题变量到 --swl-* 并移除硬编码色值', author: 'Lin Wei', time: '昨天 11:36',
    add: 96, del: 158, files: 5, isToday: false, dayKey: '2026-10-27', dayLabel: '昨天',
  },
  {
    id: '5d27e10', lane: 2, type: 'hotfix', branch: 'hotfix/payment',
    msg: 'fix: 深色主题下节点白边与轨道对比度', author: 'Zhao Min', time: '昨天 09:12',
    add: 28, del: 12, files: 2, isToday: false, dayKey: '2026-10-27', dayLabel: '昨天',
  },
  {
    id: 'f1c0a9e', lane: 0, type: 'main', branch: 'main', isMerge: true,
    msg: "Merge branch 'feature/demo1' into main", author: 'Chen Yu', time: '10月26日 17:40',
    add: 0, del: 0, files: 6, isToday: false, dayKey: '2026-10-26', dayLabel: '10月26日',
  },
  {
    id: '7b26e14', lane: 0, type: 'main', branch: 'main',
    msg: 'init: 初始化 VCS 时间线插件骨架', author: 'Lin Wei', time: '10月26日 15:22',
    add: 486, del: 0, files: 9, isToday: false, dayKey: '2026-10-26', dayLabel: '10月26日',
  },
  {
    id: 'e9a4417', lane: 1, type: 'feat', branch: 'feature/demo1',
    msg: 'feat: 提交图轨道路由与合并父节点', author: 'Chen Yu', time: '10月26日 11:08',
    add: 132, del: 18, files: 3, isToday: false, dayKey: '2026-10-26', dayLabel: '10月26日',
  },
]

/* ------------------------------------------------------------------ demo */

/**
 * Complete standalone page with mock data.
 *
 * Drop this component into any React 18 application (no Tailwind, no CSS file,
 * React is the only peer) and it renders the full requested screen.
 */
export function SwimlaneDemo(): React.ReactElement {
  const labels = DEFAULT_LABELS
  const { commits, lanes } = assignLanes(MOCK_COMMITS)
  const [active, setActive] = React.useState<'timeline' | 'pending' | 'pr'>('timeline')
  const [scope, setScope] = React.useState<'all' | 'current'>('all')
  const [query, setQuery] = React.useState('')
  const [branch, setBranch] = React.useState<string>(MOCK_REPOSITORY.branch)
  const filtered = query === ''
    ? commits
    : commits.filter((commit) => `${commit.msg} ${commit.author}`.toLowerCase().includes(query.toLowerCase()))
  const visible = scope === 'current' && branch !== ''
    ? filtered.filter((commit) => commit.branch === branch)
    : filtered
  return h('div', { className: 'swl-demo' },
    h(SwimlaneShell, {
      sidebar: h(SwimlaneFileTree, { files: MOCK_FILES, labels }),
      sidebarCount: MOCK_FILES.length,
      labels,
      chrome: [
        h(SwimlaneHeader, {
          key: 'header',
          repository: { ...MOCK_REPOSITORY, branch },
          repositories: [{ id: 'demo', name: MOCK_REPOSITORY.name }],
          branches: lanes.map((lane) => lane.branch),
          labels,
          onSelectBranch: (next) => setBranch(next),
        }),
        h(SwimlaneToolbar, {
          key: 'toolbar',
          tabs: [
            { key: 'timeline', label: labels.timelineTab, count: commits.length },
            { key: 'pending', label: labels.pendingTab, count: 3 },
            { key: 'pr', label: labels.prTab, count: 2 },
          ],
          active,
          onSelectTab: (key) => setActive(key === 'pending' ? 'pending' : key === 'pr' ? 'pr' : 'timeline'),
          scope,
          onScope: setScope,
          query,
          onQuery: setQuery,
          labels,
        }),
      ],
    },
    h('div', { className: 'swl-timeline-scroll' },
      h(SwimlaneTimeline, {
        commits: visible,
        lanes,
        labels,
        headId: commits[0]?.id,
        onOpenCommit: () => {},
        onSelectBranch: (next) => setBranch(next),
      }),
    ),
    ),
  )
}

/* ----------------------------------------------------------------- styles */

/**
 * The swimlane stylesheet, scoped under `.swl-` with DSH-token fallbacks.
 *
 * Mounted once by {@link SwimlaneShell}. No literal hex or `rgb()`: colours are
 * theme tokens or `hsl()` so both themes stay legible.
 */
export const SWIMLANE_STYLES = `
.swl-page {
  --swl-bg: var(--dsw-alias-bg-layer-1, hsl(210 24% 98%));
  --swl-card: var(--dsw-alias-bg-base, hsl(0 0% 100%));
  --swl-ink: var(--dsw-alias-label-primary, hsl(222 47% 11%));
  --swl-ink-2: var(--dsw-alias-label-secondary, hsl(215 16% 38%));
  --swl-ink-3: var(--dsw-alias-label-tertiary, hsl(215 14% 55%));
  --swl-line: var(--dsw-alias-border-l1, hsl(214 22% 91%));
  --swl-line-2: var(--dsw-alias-border-l2, hsl(214 18% 84%));
  --swl-accent: var(--dsw-alias-brand-primary, hsl(217 82% 56%));
  --swl-ok: var(--dsw-alias-state-success-primary, hsl(152 58% 36%));
  --swl-bad: var(--dsw-alias-state-error-primary, hsl(347 74% 50%));
  --swl-warn: var(--dsw-alias-state-warn-primary, hsl(38 92% 38%));
  --swl-hover: var(--dsw-alias-interactive-hover, hsl(215 22% 96%));
  --swl-sel: var(--dsw-alias-interactive-selected, hsl(217 82% 56% / .09));
  --swl-main: hsl(217 82% 56%);
  --swl-feat: hsl(262 83% 62%);
  --swl-hotfix: hsl(347 77% 58%);
  --swl-shadow: 0 1px 2px hsl(220 43% 16% / .05), 0 10px 30px -18px hsl(220 43% 16% / .28);
  --swl-shadow-lift: 0 2px 4px hsl(220 43% 16% / .06), 0 16px 32px -20px hsl(220 43% 16% / .38);
  --swl-row-h: 64px;
  --swl-canvas-w: 140px;
  --swl-radius: 14px;
  position: relative;
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  height: 100%;
  padding: 12px;
  gap: 12px;
  box-sizing: border-box;
  background: var(--swl-bg);
  color: var(--swl-ink);
  font-family: Inter, "Inter var", "SF Pro Text", -apple-system, "Segoe UI Variable",
    "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  font-size: 12.5px;
  line-height: 1.4;
  font-variant-numeric: tabular-nums;
  -webkit-font-smoothing: antialiased;
  container-type: inline-size;
  container-name: swl;
}
.swl-page *, .swl-page *::before, .swl-page *::after { box-sizing: border-box; }
.swl-page button, .swl-page input, .swl-page select { font: inherit; color: inherit; }
.swl-page :focus-visible {
  outline: 2px solid color-mix(in srgb, var(--swl-accent) 60%, transparent);
  outline-offset: 1px;
  border-radius: 8px;
}
.swl-icon { flex: 0 0 auto; display: block; }
.swl-mono {
  font-family: "JetBrains Mono", "SF Mono", "Cascadia Code", ui-monospace, Consolas, monospace;
  font-variant-ligatures: none;
}

/* ---------- frame ---------- */
.swl-frame { display: flex; flex: 1 1 auto; min-width: 0; min-height: 0; gap: 12px; position: relative; }
.swl-sidebar {
  flex: 0 0 260px;
  width: 260px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--swl-card);
  border-radius: var(--swl-radius);
  box-shadow: var(--swl-shadow);
  overflow: hidden;
}
.swl-main {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--swl-card);
  border-radius: var(--swl-radius);
  box-shadow: var(--swl-shadow);
  overflow: hidden;
}
.swl-chrome { flex: 0 0 auto; display: flex; flex-direction: column; }
.swl-content { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.swl-mobilebar { display: none; }
.swl-scrim { display: none; }
.swl-timeline-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; }

/* ---------- header ---------- */
.swl-header {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 58px;
  padding: 0 14px;
  flex: 0 0 auto;
}
.swl-title {
  position: relative;
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  height: 34px;
  padding: 0 8px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 140ms ease;
}
.swl-title:hover { background: var(--swl-hover); }
.swl-title-icon { display: inline-flex; color: var(--swl-ink-3); }
.swl-repo-name {
  min-width: 0;
  font-size: 15px;
  font-weight: 650;
  letter-spacing: -.012em;
  color: var(--swl-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.swl-vcs {
  flex: 0 0 auto;
  height: 17px;
  padding: 0 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--swl-accent) 11%, transparent);
  color: color-mix(in srgb, var(--swl-accent) 78%, var(--swl-ink));
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: .06em;
  line-height: 17px;
  text-transform: uppercase;
}
.swl-title-caret { display: inline-flex; color: var(--swl-ink-3); }
.swl-native { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; border: 0; }
.swl-branch {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 210px;
  height: 28px;
  padding: 0 8px;
  border-radius: 999px;
  background: var(--swl-bg);
  color: var(--swl-ink-2);
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;
}
.swl-branch:hover { background: color-mix(in srgb, var(--swl-accent) 8%, var(--swl-bg)); color: var(--swl-ink); }
.swl-branch-select {
  appearance: none;
  max-width: 160px;
  border: 0;
  background: transparent;
  color: inherit;
  font-family: "JetBrains Mono", "SF Mono", ui-monospace, Consolas, monospace;
  font-size: 11px;
  cursor: pointer;
  outline: none;
}
.swl-branch-caret { display: inline-flex; color: var(--swl-ink-3); }
.swl-actions { display: flex; align-items: center; gap: 6px; margin-left: auto; flex: 0 0 auto; }
.swl-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: 9px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: transform 120ms ease, background 140ms ease, box-shadow 140ms ease;
}
.swl-btn:hover { transform: translateY(-1px); }
.swl-btn:active { transform: translateY(0); }
.swl-btn:disabled { cursor: not-allowed; opacity: .5; transform: none; }
.swl-btn-outline {
  background: var(--swl-card);
  border-color: var(--swl-line-2);
  color: var(--swl-ink);
  box-shadow: 0 1px 1px hsl(220 43% 16% / .03);
}
.swl-btn-outline:hover { background: var(--swl-hover); }
.swl-btn-primary {
  background: var(--swl-accent);
  color: hsl(0 0% 100%);
  box-shadow: 0 6px 14px -8px color-mix(in srgb, var(--swl-accent) 85%, transparent);
}
.swl-btn-primary:hover { background: color-mix(in srgb, var(--swl-accent) 88%, hsl(0 0% 0%)); }
.swl-iconbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--swl-ink-3);
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;
}
.swl-iconbtn:hover { background: var(--swl-hover); color: var(--swl-ink); }

/* ---------- toolbar ---------- */
.swl-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 44px;
  padding: 0 12px;
  flex: 0 0 auto;
  border-top: 1px solid color-mix(in srgb, var(--swl-line) 55%, transparent);
}
.swl-tabs { display: flex; align-items: center; gap: 2px; min-width: 0; }
.swl-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--swl-ink-2);
  font-size: 12px;
  font-weight: 550;
  white-space: nowrap;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;
}
.swl-tab:hover { background: var(--swl-hover); color: var(--swl-ink); }
.swl-tab[aria-selected="true"] {
  background: var(--swl-sel);
  color: color-mix(in srgb, var(--swl-accent) 82%, var(--swl-ink));
  font-weight: 650;
}
.swl-tab-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--swl-ink) 8%, transparent);
  color: var(--swl-ink-3);
  font-size: 9.5px;
  font-weight: 700;
}
.swl-tab[aria-selected="true"] .swl-tab-count {
  background: color-mix(in srgb, var(--swl-accent) 16%, transparent);
  color: color-mix(in srgb, var(--swl-accent) 82%, var(--swl-ink));
}
.swl-toolbar-right { display: flex; align-items: center; gap: 8px; margin-left: auto; min-width: 0; }
.swl-search {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px;
  min-width: 150px;
  border-radius: 9px;
  background: var(--swl-bg);
  color: var(--swl-ink-3);
  transition: box-shadow 140ms ease, background 140ms ease;
}
.swl-search:focus-within {
  background: var(--swl-card);
  box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--swl-accent) 45%, transparent);
}
.swl-search-input {
  width: 100%;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--swl-ink);
  font-size: 12px;
  outline: none;
}
.swl-search-input::placeholder { color: var(--swl-ink-3); }
.swl-seg {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 999px;
  background: var(--swl-bg);
  flex: 0 0 auto;
}
.swl-seg-btn {
  height: 26px;
  padding: 0 11px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--swl-ink-2);
  font-size: 11.5px;
  font-weight: 550;
  white-space: nowrap;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease, box-shadow 140ms ease;
}
.swl-seg-btn:hover { color: var(--swl-ink); }
.swl-seg-btn[aria-pressed="true"] {
  background: var(--swl-card);
  color: var(--swl-ink);
  font-weight: 650;
  box-shadow: 0 1px 2px hsl(220 43% 16% / .08), 0 4px 10px -6px hsl(220 43% 16% / .2);
}

/* ---------- pills / badges ---------- */
.swl-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 19px;
  padding: 0 7px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 600;
  white-space: nowrap;
  background: color-mix(in srgb, var(--swl-pill-color, var(--swl-ink)) 9%, transparent);
  color: color-mix(in srgb, var(--swl-pill-color, var(--swl-ink)) 68%, var(--swl-ink));
}
.swl-pill-branch {
  font-family: "JetBrains Mono", "SF Mono", ui-monospace, Consolas, monospace;
  font-size: 10px;
  letter-spacing: -.01em;
  cursor: pointer;
  transition: background 140ms ease;
}
.swl-pill-branch:hover { background: color-mix(in srgb, var(--swl-pill-color, var(--swl-accent)) 16%, transparent); }
.swl-pill-merge { --swl-pill-color: var(--swl-feat); background: color-mix(in srgb, var(--swl-feat) 12%, transparent); color: color-mix(in srgb, var(--swl-feat) 72%, var(--swl-ink)); }
.swl-pill-head {
  --swl-pill-color: var(--swl-ok);
  background: color-mix(in srgb, var(--swl-ok) 13%, transparent);
  color: color-mix(in srgb, var(--swl-ok) 78%, var(--swl-ink));
  font-family: "JetBrains Mono", "SF Mono", ui-monospace, Consolas, monospace;
  letter-spacing: .02em;
}
.swl-pill-add {
  background: color-mix(in srgb, var(--swl-ok) 11%, transparent);
  color: color-mix(in srgb, var(--swl-ok) 80%, var(--swl-ink));
  font-family: "JetBrains Mono", "SF Mono", ui-monospace, Consolas, monospace;
}
.swl-pill-del {
  background: color-mix(in srgb, var(--swl-bad) 11%, transparent);
  color: color-mix(in srgb, var(--swl-bad) 80%, var(--swl-ink));
  font-family: "JetBrains Mono", "SF Mono", ui-monospace, Consolas, monospace;
}
.swl-pill-files { background: color-mix(in srgb, var(--swl-ink) 6%, transparent); color: var(--swl-ink-3); font-weight: 550; }

/* ---------- legend ---------- */
.swl-legend {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 10px 14px 6px calc(var(--swl-canvas-w) + 12px);
}
.swl-legend-label {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--swl-ink-3);
}
.swl-lane-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 9px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--swl-pill-color) 10%, transparent);
  color: color-mix(in srgb, var(--swl-pill-color) 70%, var(--swl-ink));
  font-size: 10.5px;
  font-weight: 600;
  white-space: nowrap;
}
.swl-lane-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--swl-pill-color); }
.swl-lane-name { font-family: "JetBrains Mono", "SF Mono", ui-monospace, Consolas, monospace; }
.swl-lane-count { opacity: .68; font-size: 9.5px; }

/* ---------- groups ---------- */
.swl-timeline { display: flex; flex-direction: column; min-height: 0; }
.swl-group { display: flex; flex-direction: column; }
.swl-group-head {
  position: sticky;
  top: 0;
  z-index: 6;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 14px 0 calc(var(--swl-canvas-w) + 12px);
  background: color-mix(in srgb, var(--swl-card) 76%, transparent);
  backdrop-filter: blur(14px) saturate(1.5);
  -webkit-backdrop-filter: blur(14px) saturate(1.5);
  border-bottom: 1px solid color-mix(in srgb, var(--swl-line) 45%, transparent);
}
.swl-group-label {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: -.005em;
  color: var(--swl-ink);
}
.swl-group-count { font-size: 10.5px; color: var(--swl-ink-3); }
.swl-group-track {
  margin-left: auto;
  width: 34px;
  height: 1px;
  background: linear-gradient(to right, transparent, color-mix(in srgb, var(--swl-ink) 14%, transparent));
}
.swl-list { list-style: none; margin: 0; padding: 0 6px 8px; }

/* ---------- rows ---------- */
.swl-row {
  position: relative;
  display: flex;
  align-items: stretch;
  min-height: var(--swl-row-h);
  border-radius: 12px;
  transition: background 150ms ease, box-shadow 150ms ease;
}
.swl-row:hover { background: color-mix(in srgb, var(--swl-accent) 5%, transparent); }
.swl-row[data-selected="true"] {
  background: color-mix(in srgb, var(--swl-accent) 8%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--swl-accent) 24%, transparent);
}
.swl-canvas { position: relative; flex: 0 0 auto; width: var(--swl-canvas-w); }
.swl-svg { position: absolute; inset: 0; display: block; overflow: visible; pointer-events: none; }
.swl-node {
  position: absolute;
  z-index: 2;
  width: 13px;
  height: 13px;
  border-radius: 999px;
  background: var(--swl-lane-color, var(--swl-accent));
  /* The thick card-coloured ring is what breaks the line at the node. */
  box-shadow: 0 0 0 4px var(--swl-card);
  transform: translate(-50%, -50%);
  transition: transform 150ms ease, box-shadow 150ms ease;
}
.swl-row:hover .swl-node {
  transform: translate(-50%, -50%) scale(1.18);
  box-shadow: 0 0 0 4px var(--swl-card), 0 0 0 6px color-mix(in srgb, var(--swl-lane-color) 20%, transparent);
}
.swl-node[data-merge="true"] {
  background: var(--swl-card);
  border: 2.5px solid var(--swl-lane-color);
}
.swl-node[data-merge="true"]::after {
  content: "";
  position: absolute;
  inset: 2px;
  border-radius: 999px;
  background: var(--swl-lane-color);
}
.swl-rowbody {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 5px;
  padding: 11px 12px 11px 2px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.swl-rowbody:focus-visible { outline-offset: -2px; }
.swl-rowtop { display: flex; align-items: center; gap: 10px; min-width: 0; }
.swl-msg {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  font-weight: 560;
  letter-spacing: -.006em;
  color: var(--swl-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.swl-pills { display: inline-flex; align-items: center; gap: 5px; flex: 0 0 auto; }
.swl-rowmeta { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 11.5px; color: var(--swl-ink-3); }
.swl-avatar {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 8.5px;
  font-weight: 700;
  letter-spacing: .01em;
  background: hsl(var(--swl-avatar-hue, 220) 72% 92%);
  color: hsl(var(--swl-avatar-hue, 220) 62% 34%);
}
.swl-author {
  flex: 0 0 auto;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--swl-ink-2);
  font-weight: 500;
}
.swl-dot { color: var(--swl-line-2); }
.swl-when { flex: 0 0 auto; white-space: nowrap; }
.swl-hash {
  flex: 0 0 auto;
  padding: 1px 5px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--swl-ink) 5%, transparent);
  color: var(--swl-ink-2);
  font-size: 10.5px;
}
.swl-stats { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; flex: 0 0 auto; }

/* ---------- empty ---------- */
.swl-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 64px 24px;
  color: var(--swl-ink-3);
  text-align: center;
}
.swl-empty-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  margin-bottom: 2px;
  border-radius: 14px;
  background: var(--swl-bg);
  color: var(--swl-ink-3);
}
.swl-empty-title { font-size: 13px; font-weight: 600; color: var(--swl-ink); }
.swl-empty-hint { font-size: 11.5px; }

/* ---------- demo sidebar tree ---------- */
.swl-tree { display: flex; flex-direction: column; min-height: 0; flex: 1 1 auto; }
.swl-tree-head { display: flex; align-items: center; gap: 8px; padding: 14px 14px 10px; }
.swl-tree-title { font-size: 12.5px; font-weight: 650; letter-spacing: -.006em; }
.swl-tree-total {
  display: inline-flex;
  align-items: center;
  height: 17px;
  padding: 0 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--swl-ink) 6%, transparent);
  color: var(--swl-ink-3);
  font-size: 9.5px;
  font-weight: 700;
}
.swl-tree-search {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  margin: 0 12px 8px;
  padding: 0 10px;
  border-radius: 9px;
  background: var(--swl-bg);
  color: var(--swl-ink-3);
  transition: box-shadow 140ms ease, background 140ms ease;
}
.swl-tree-search:focus-within {
  background: var(--swl-card);
  box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--swl-accent) 45%, transparent);
}
.swl-tree-input {
  width: 100%;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--swl-ink);
  font-size: 11.5px;
  outline: none;
}
.swl-tree-input::placeholder { color: var(--swl-ink-3); }
.swl-tree-stats { display: flex; align-items: center; gap: 5px; padding: 0 14px 8px; flex-wrap: wrap; }
.swl-tree-filter { display: flex; align-items: center; gap: 4px; padding: 0 12px 8px; overflow: hidden; }
.swl-tree-chip {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 7px;
  border-radius: 999px;
  background: transparent;
  color: var(--swl-ink-3);
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
}
.swl-tree-chip:first-child {
  background: var(--swl-sel);
  color: color-mix(in srgb, var(--swl-accent) 80%, var(--swl-ink));
}
.swl-tree-list { list-style: none; margin: 0; padding: 0 6px 10px; }
.swl-tree-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.swl-tree-item { margin: 0; padding: 0; }
.swl-tree-row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 25px;
  padding: 0 8px;
  border-radius: 7px;
  color: var(--swl-ink-2);
  font-size: 11.5px;
  white-space: nowrap;
  transition: background 120ms ease, color 120ms ease;
}
.swl-tree-row:hover { background: var(--swl-hover); color: var(--swl-ink); }
.swl-tree-caret { display: inline-flex; color: var(--swl-ink-3); transform: rotate(90deg); }
.swl-tree-icon { display: inline-flex; color: var(--swl-ink-3); }
.swl-tree-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.swl-tree-dir > .swl-tree-name { font-weight: 550; }
.swl-tree-badge { flex: 0 0 auto; font-size: 9.5px; color: var(--swl-ink-3); }
.swl-tree-add { flex: 0 0 auto; font-size: 9.5px; color: color-mix(in srgb, var(--swl-ok) 80%, var(--swl-ink)); }
.swl-status {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border-radius: 5px;
  font-size: 9px;
  font-weight: 700;
}
.swl-status-A { background: color-mix(in srgb, var(--swl-ok) 12%, transparent); color: color-mix(in srgb, var(--swl-ok) 82%, var(--swl-ink)); }
.swl-status-M { background: color-mix(in srgb, var(--swl-warn) 14%, transparent); color: color-mix(in srgb, var(--swl-warn) 85%, var(--swl-ink)); }
.swl-status-D { background: color-mix(in srgb, var(--swl-bad) 12%, transparent); color: color-mix(in srgb, var(--swl-bad) 82%, var(--swl-ink)); }
.swl-status-R { background: color-mix(in srgb, var(--swl-feat) 12%, transparent); color: color-mix(in srgb, var(--swl-feat) 78%, var(--swl-ink)); }

/* ---------- demo frame ---------- */
.swl-demo { display: flex; width: 100%; height: 100vh; min-height: 0; background: var(--dsw-alias-bg-layer-1, hsl(210 24% 98%)); }
.swl-demo > .swl-page { flex: 1 1 auto; height: auto; }

/* ---------- plugin chrome overrides (relocated into the shell) ---------- */
.swl-main .dvt-chrome { background: transparent; }
.swl-main .dvt-toolbar { height: 58px; padding: 0 14px; gap: 8px; }
.swl-main .dvt-repo { height: 34px; padding: 0 8px; border-radius: 10px; flex: 0 1 auto; }
.swl-main .dvt-repo-name { font-size: 15px; font-weight: 650; letter-spacing: -.012em; }
.swl-main .dvt-repo-vcs {
  height: 17px;
  padding: 0 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--swl-accent) 11%, transparent);
  color: color-mix(in srgb, var(--swl-accent) 78%, var(--swl-ink));
  font-size: 9.5px;
  letter-spacing: .06em;
  line-height: 17px;
}
.swl-main .dvt-branch {
  max-width: 220px;
  height: 28px;
  padding: 0 9px;
  border-radius: 999px;
  background: var(--swl-bg);
  font-size: 11px;
}
.swl-main .dvt-toolbar-actions { gap: 6px; }
.swl-main .dvt-toolbar-actions .dvt-iconbtn { width: 30px; height: 30px; border-radius: 9px; }
.swl-main .dvt-tabstrip {
  height: 44px;
  padding: 0 12px;
  gap: 2px;
  border-top: 1px solid color-mix(in srgb, var(--swl-line) 55%, transparent);
  border-bottom: 0;
}
.swl-main .dvt-tab {
  height: 30px;
  padding: 0 12px;
  border: 0;
  border-radius: 9px;
  color: var(--swl-ink-2);
  font-size: 12px;
  font-weight: 550;
  transition: background 140ms ease, color 140ms ease;
}
.swl-main .dvt-tab:hover { background: var(--swl-hover); color: var(--swl-ink); }
.swl-main .dvt-tab[aria-selected="true"] {
  background: var(--swl-sel);
  border-bottom-color: transparent;
  color: color-mix(in srgb, var(--swl-accent) 82%, var(--swl-ink));
  font-weight: 650;
}
.swl-main .dvt-tab-count { background: color-mix(in srgb, var(--swl-ink) 8%, transparent); }
.swl-main .dvt-filterbar {
  height: 46px;
  padding: 0 12px;
  gap: 8px;
  border-bottom: 1px solid color-mix(in srgb, var(--swl-line) 45%, transparent);
}
.swl-main .dvt-search { min-width: 150px; }
.swl-main .dvt-search-input {
  height: 30px;
  padding: 0 22px 0 26px;
  border: 0;
  border-radius: 9px;
  background: var(--swl-bg);
  font-size: 12px;
}
.swl-main .dvt-search > svg { left: 9px; }
.swl-main .dvt-search-input:focus-visible { box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--swl-accent) 45%, transparent); }
.swl-main .dvt-chip {
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  color: var(--swl-ink-2);
  font-size: 11.5px;
}
.swl-main .dvt-chip[aria-pressed="true"] {
  background: var(--swl-sel);
  box-shadow: none;
  color: color-mix(in srgb, var(--swl-accent) 82%, var(--swl-ink));
}
.swl-main .dvt-time {
  height: 30px;
  padding: 0 8px;
  border-radius: 9px;
  background: var(--swl-bg);
  color: var(--swl-ink-2);
}
.swl-main .dvt-time-select { border: 0; background: transparent; font-size: 11.5px; outline: none; }
.swl-main .dvt-seg {
  gap: 2px;
  padding: 2px;
  border-radius: 999px;
  background: var(--swl-bg);
}
.swl-main .dvt-seg-btn {
  height: 26px;
  padding: 0 11px;
  border: 0;
  border-radius: 999px;
  color: var(--swl-ink-2);
  font-size: 11.5px;
  transition: background 140ms ease, color 140ms ease, box-shadow 140ms ease;
}
.swl-main .dvt-seg-btn[aria-pressed="true"] {
  background: var(--swl-card);
  color: var(--swl-ink);
  font-weight: 650;
  box-shadow: 0 1px 2px hsl(220 43% 16% / .08), 0 4px 10px -6px hsl(220 43% 16% / .2);
}
.swl-main .dvt-iconbtn { border-radius: 9px; }
.swl-main .dvt-pane { background: transparent; }
.swl-main .dvt-scroll { scrollbar-gutter: stable; }

/* ---------- plugin file tree card ---------- */
.swl-sidebar .dvt-tree {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  background: transparent;
  border: 0;
}
.swl-sidebar .dvt-tree-head { padding: 14px 14px 8px; height: auto; }
.swl-sidebar .dvt-tree-title { font-size: 12.5px; font-weight: 650; letter-spacing: -.006em; }
.swl-sidebar .dvt-tree-total {
  height: 17px;
  padding: 0 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--swl-ink) 6%, transparent);
  color: var(--swl-ink-3);
  font-size: 9.5px;
  font-weight: 700;
}
.swl-sidebar .dvt-tree-search { margin: 0 12px 8px; }
.swl-sidebar .dvt-tree-input {
  height: 30px;
  border: 0;
  border-radius: 9px;
  background: var(--swl-bg);
  padding: 0 10px 0 26px;
  font-size: 11.5px;
}
.swl-sidebar .dvt-tree-search > svg { left: 10px; }
.swl-sidebar .dvt-tree-chips { padding: 0 12px 8px; gap: 4px; }
.swl-sidebar .dvt-tree-chip {
  height: 20px;
  padding: 0 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
}
.swl-sidebar .dvt-tree-chip[aria-pressed="true"] {
  background: var(--swl-sel);
  color: color-mix(in srgb, var(--swl-accent) 80%, var(--swl-ink));
}
.swl-sidebar .dvt-tree-scroll { padding: 0 6px 10px; }
.swl-sidebar .dvt-tree-all { border-radius: 8px; height: 28px; }
.swl-sidebar .dvt-tree-row { height: 25px; border-radius: 7px; }
.swl-sidebar .dvt-tree-badge, .swl-sidebar .dvt-tree-changes { font-size: 9.5px; }
.swl-sidebar .dvt-tree .dvt-file-status { width: 15px; height: 15px; border-radius: 5px; font-size: 9px; }
.swl-sidebar .dvt-stat-row,
.swl-sidebar .dvt-tree-stats { display: flex; align-items: center; gap: 5px; padding: 0 14px 8px; flex-wrap: wrap; }
.swl-pill-row { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }

/* ---------- responsive: sidebar becomes a drawer ---------- */
@container swl (max-width: 860px) {
  .swl-page { padding: 0; gap: 0; }
  .swl-frame { gap: 0; }
  .swl-main { border-radius: 0; box-shadow: none; }
  .swl-sidebar {
    position: absolute;
    z-index: 30;
    top: 8px;
    bottom: 8px;
    left: 8px;
    width: min(300px, 86%);
    display: none;
    box-shadow: 0 24px 60px -24px hsl(220 43% 16% / .45);
  }
  .swl-page[data-sidebar="open"] .swl-sidebar { display: flex; }
  .swl-page[data-sidebar="open"] .swl-scrim {
    display: block;
    position: absolute;
    inset: 0;
    z-index: 20;
    background: color-mix(in srgb, var(--swl-ink) 18%, transparent);
  }
  .swl-mobilebar {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 40px;
    padding: 0 12px;
    flex: 0 0 auto;
    border-bottom: 1px solid color-mix(in srgb, var(--swl-line) 45%, transparent);
  }
  .swl-mobilebtn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 28px;
    padding: 0 10px;
    border: 0;
    border-radius: 999px;
    background: var(--swl-bg);
    color: var(--swl-ink-2);
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
  }
  .swl-mobilecount {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    height: 16px;
    padding: 0 5px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--swl-ink) 8%, transparent);
    color: var(--swl-ink-3);
    font-size: 9.5px;
    font-weight: 700;
  }
  .swl-header { height: 52px; padding: 0 10px; gap: 6px; }
  .swl-repo-name { font-size: 13.5px; }
  .swl-toolbar { height: 42px; padding: 0 8px; gap: 6px; overflow: hidden; }
  .swl-search { min-width: 0; flex: 1 1 auto; }
  .swl-legend { padding-left: 12px; }
  .swl-group-head { padding-left: 12px; height: 34px; }
  .swl-msg { font-size: 12.5px; }
  .swl-author { max-width: 88px; }
  .swl-main .dvt-toolbar { height: 52px; padding: 0 10px; }
  .swl-main .dvt-repo-name { font-size: 13.5px; }
  .swl-main .dvt-tabstrip { height: 42px; padding: 0 8px; overflow-x: auto; }
  .swl-main .dvt-filterbar { height: 44px; padding: 0 8px; gap: 6px; }
  .swl-main .dvt-search { min-width: 0; flex: 1 1 auto; }
  .swl-main .dvt-seg { display: none; }
}
@container swl (max-width: 560px) {
  .swl-pill-branch, .swl-pill-files { display: none; }
  .swl-search { display: none; }
  .swl-toolbar-right { gap: 0; }
  .swl-seg { margin-left: auto; }
  .swl-when { display: none; }
  .swl-legend-label { display: none; }
}

/* ---------- reduced motion ---------- */
@media (prefers-reduced-motion: reduce) {
  .swl-page *, .swl-page *::before, .swl-page *::after {
    transition-duration: 1ms !important;
    animation-duration: 1ms !important;
  }
}
`
