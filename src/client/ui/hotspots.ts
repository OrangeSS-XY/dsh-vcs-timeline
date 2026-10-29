/**
 * Hotspot view — a multi-dimensional Git dashboard.
 *
 * One scanned commit window feeds three different bodies behind one segmented
 * control, and no tab ever borrows another tab's shape:
 *
 *  - `files`    churn ranking of the most-changed paths (blue micro bar),
 *  - `authors`  contributor ranking of the same window (purple micro bar,
 *               dark initial avatar, role derived from commit share),
 *  - `activity` a GitHub-style timeline feed of the newest commits: who, what,
 *               which files, and when. No bars there by design.
 *
 * Bar lengths are `Math.sqrt(value) / Math.sqrt(max)`, which keeps a 10-line
 * file visible next to a 17 000-line one instead of collapsing it to zero.
 * Every number comes from the Host report; a file without line statistics says
 * "not provided" rather than printing a fabricated zero.
 * @module dsh-vcs-timeline/client/ui/hotspots
 */

import * as React from 'react'
import type {
  FileHotspot,
  HotspotAuthor,
  HotspotCommit,
  HotspotReport,
  OperationAttempt,
} from '../../shared/contracts.ts'
import * as F from '../format.ts'
import type {
  HotspotCalendarMetric,
  HotspotDimension,
  HotspotSort,
  PanelDeps,
  PanelHandlers,
  PanelState,
} from '../types.ts'
import { IconClock, IconError, IconFlame, IconRefresh, IconWarning } from './icons.ts'
import { Banner, EmptyState, IconButton, errorText } from './primitives.ts'
import { missingTool, selectedRepository } from './shared.ts'

const h = React.createElement

/** File rows the churn ranking shows before it stops. */
const MAX_FILE_ROWS = 18
/** Contributor rows the ranking shows. */
const MAX_AUTHOR_ROWS = 12
/** Activity entries the feed shows. */
const MAX_ACTIVITY_ROWS = 18
/** File chips one activity entry shows before it folds the rest into +N. */
const MAX_ACTIVITY_FILES = 3
/** Weeks the calendar heatmap covers (GitHub-style 26 columns). */
export const CALENDAR_WEEKS = 26
/** Intensity buckets above "no activity". */
const HEAT_LEVELS = 4

/** The four dashboard bodies, in display order. */
const DIMENSIONS: HotspotDimension[] = ['calendar', 'files', 'authors', 'activity']

/* --------------------------------------------------------------- helpers */

/**
 * Compressed share `sqrt(value) / sqrt(max)` clamped to 0..1.
 *
 * Long-tail churn is the norm in a real repository, so a linear bar would make
 * every row but the first invisible. The square root keeps ordering intact
 * while giving small values a readable length.
 */
export function sqrtRatio(value: number | null | undefined, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0
  if (!(max > 0) || !Number.isFinite(max)) return 0
  return Math.min(1, Math.sqrt(value) / Math.sqrt(max))
}

/** CSS width of one micro bar; 0 becomes 0%, any positive value keeps a nib. */
export function barWidth(value: number | null | undefined, max: number): string {
  const ratio = sqrtRatio(value, max)
  if (ratio <= 0) return '0%'
  return `${Math.max(2, Math.round(ratio * 1000) / 10)}%`
}

/** One calendar cell: a real UTC day of the 26-week grid. */
export interface CalendarDay {
  /** UTC calendar day, `YYYY-MM-DD` (matches `HotspotDay.date`). */
  date: string
  commits: number
  files: number
  additions: number
  deletions: number
  /** additions + deletions, or null when the day reported no line stats. */
  churn: number | null
  /** Successful pushes audited by this plugin on that day. */
  pushes: number
  /** False when the day lies outside the scanned history window. */
  inWindow: boolean
  /** True for days after today (grid padding, never measured). */
  future: boolean
}

/**
 * Intensity bucket of one day.
 *
 * The square root keeps a 20-line day visible next to a 17 000-line day, and a
 * zero / unknown value is always bucket 0 (an empty cell, never a fake 1).
 */
export function heatLevel(value: number | null | undefined, max: number): number {
  const ratio = sqrtRatio(value, max)
  if (ratio <= 0) return 0
  return Math.min(HEAT_LEVELS, Math.max(1, Math.ceil(ratio * HEAT_LEVELS)))
}

/**
 * Successful pushes per UTC day, counted from the plugin's own audit records.
 *
 * Git keeps no push log, so this is the only honest source: operations this
 * plugin actually executed and recorded. Failed/started pushes never count.
 */
export function pushCountByDay(operations: readonly OperationAttempt[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const operation of operations) {
    if (operation.operation !== 'push' || operation.state !== 'succeeded') continue
    const parsed = Date.parse(operation.startedAt)
    if (!Number.isFinite(parsed)) continue
    const key = new Date(parsed).toISOString().slice(0, 10)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/**
 * Build the 26-week grid ending on the newest measured week.
 *
 * The grid is anchored on the newest day the Host actually reported (falling
 * back to today), so an old-but-real window is not rendered as empty. Days
 * before the scan window are flagged `inWindow: false` and painted faint: the
 * heatmap must not claim "no activity" for a day it never measured.
 */
export function calendarDays(
  report: HotspotReport,
  now: Date,
  pushes: ReadonlyMap<string, number>,
): CalendarDay[] {
  const byDate = new Map<string, { commits: number; files: number; additions?: number; deletions?: number }>()
  for (const day of report.daily) {
    const key = day.date.slice(0, 10)
    if (key !== '') byDate.set(key, day)
  }
  const todayKey = now.toISOString().slice(0, 10)
  const latest = [...byDate.keys()].sort((left, right) => right.localeCompare(left))[0]
  const anchorKey = latest !== undefined && latest < todayKey ? latest : todayKey
  const anchor = new Date(`${anchorKey}T00:00:00.000Z`)
  const endWeekday = (anchor.getUTCDay() + 6) % 7
  const end = new Date(anchor.getTime() + (6 - endWeekday) * 86_400_000)
  const start = new Date(end.getTime() - (CALENDAR_WEEKS * 7 - 1) * 86_400_000)
  const oldest = [...byDate.keys()].sort((left, right) => left.localeCompare(right))[0]
  const sinceKey = report.scope.since === undefined || report.scope.since === ''
    ? oldest
    : report.scope.since.slice(0, 10)
  const days: CalendarDay[] = []
  for (let cursor = start.getTime(); cursor <= end.getTime(); cursor += 86_400_000) {
    const date = new Date(cursor).toISOString().slice(0, 10)
    const day = byDate.get(date)
    const additions = typeof day?.additions === 'number' ? day.additions : 0
    const deletions = typeof day?.deletions === 'number' ? day.deletions : 0
    const lineStats = typeof day?.additions === 'number' && typeof day?.deletions === 'number'
    days.push({
      date,
      commits: day?.commits ?? 0,
      files: day?.files ?? 0,
      additions,
      deletions,
      churn: lineStats ? additions + deletions : null,
      pushes: pushes.get(date) ?? 0,
      inWindow: sinceKey !== undefined && date >= sinceKey && date <= anchorKey,
      future: date > todayKey,
    })
  }
  return days
}

/** Sort a copy of the Host rows by the selected explainable metric. */
export function sortHotspots(files: readonly FileHotspot[], sort: HotspotSort): FileHotspot[] {
  const rows = [...files]
  const numeric = (value: number | null | undefined): number => (typeof value === 'number' ? value : -1)
  rows.sort((a, b) => {
    if (sort === 'commits') return b.commits - a.commits || a.path.localeCompare(b.path)
    if (sort === 'authors') return b.authorCount - a.authorCount || b.commits - a.commits || a.path.localeCompare(b.path)
    if (sort === 'recent') {
      const left = a.lastChangedAt === undefined ? 0 : Date.parse(a.lastChangedAt)
      const right = b.lastChangedAt === undefined ? 0 : Date.parse(b.lastChangedAt)
      return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0) || a.path.localeCompare(b.path)
    }
    return numeric(b.churn) - numeric(a.churn) || b.commits - a.commits || a.path.localeCompare(b.path)
  })
  return rows
}

/** The numeric value one row's bar represents. */
export function metricValue(file: FileHotspot, sort: HotspotSort): number | null {
  if (sort === 'commits') return file.commits
  if (sort === 'authors') return file.authorCount
  if (sort === 'recent') {
    if (file.lastChangedAt === undefined) return null
    const parsed = Date.parse(file.lastChangedAt)
    return Number.isFinite(parsed) ? parsed : null
  }
  return file.churn
}

/** Largest reported value of one list, so bars share a single scale. */
function maxOf(values: readonly (number | null | undefined)[]): number {
  let max = 0
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > max) max = value
  }
  return max
}

/** Grouped integer for the mono values; `—` for a value the Host never reported. */
function countLabel(value: number | null | undefined, deps: PanelDeps): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return deps.t('hotspot.churn.unavailable')
  try {
    return new Intl.NumberFormat(deps.locale ?? 'zh').format(value)
  } catch {
    return String(value)
  }
}

/** Relative "when" label for the activity feed, with a compact fallback. */
function whenLabel(iso: string | undefined, deps: PanelDeps, now: number): string {
  const { t } = deps
  if (iso === undefined || iso === '') return t('common.unknown')
  const relative = F.relativeTime(iso, now)
  if (relative === null) return F.formatCompactTime(iso, deps.locale)
  switch (relative.unit) {
    case 'justNow': return t('rel.justNow')
    case 'minutes': return t('rel.minutesAgo', { count: relative.count })
    case 'hours': return t('rel.hoursAgo', { count: relative.count })
    default: return t('rel.daysAgo', { count: relative.count })
  }
}

/**
 * Role of one contributor, derived from their share of window commits.
 *
 * The Host reports commits and churn only; a stored role would be a second,
 * drift-prone source of truth. Thresholds are presentation, and the tooltip
 * says so.
 */
export function authorRoleKey(author: HotspotAuthor, totalCommits: number): string {
  if (!(totalCommits > 0)) return 'hotspot.author.role.guest'
  const share = author.commits / totalCommits
  if (share >= 0.4) return 'hotspot.author.role.lead'
  if (share >= 0.2) return 'hotspot.author.role.core'
  if (share >= 0.08) return 'hotspot.author.role.active'
  return 'hotspot.author.role.guest'
}

/** Dark circular initial avatar with a stable hue per name. */
function Avatar(props: { name: string; size?: 'sm' | 'md' }): React.ReactElement {
  const hue = F.authorHue(props.name)
  return h('span', {
    className: `dvt-hs-avatar${props.size === 'sm' ? ' dvt-hs-avatar-sm' : ''}`,
    'aria-hidden': 'true',
    style: { '--dvt-hs-hue': String(hue) } as unknown as React.CSSProperties,
  }, F.authorInitials(props.name))
}

/** One micro bar: a track plus the sqrt-compressed fill (none when the value is unknown). */
function MicroBar(props: { value: number | null | undefined; max: number; tone: 'blue' | 'purple' }): React.ReactElement {
  return h('span', { className: 'dvt-hs-meter', 'aria-hidden': 'true' },
    h('span', { className: 'dvt-hs-track' },
      sqrtRatio(props.value, props.max) <= 0
        ? null
        : h('span', {
          className: `dvt-hs-fill dvt-hs-fill-${props.tone}`,
          style: { width: barWidth(props.value, props.max) },
        }),
    ),
  )
}

/* --------------------------------------------------------------- controls */

/** The segmented control: one tab per dimension, with the row counts. */
function DimensionSwitch(props: {
  active: HotspotDimension
  counts: Record<HotspotDimension, number | null>
  deps: PanelDeps
  handlers: PanelHandlers
}): React.ReactElement {
  const { deps, handlers, active, counts } = props
  const { t } = deps
  return h('div', {
    className: 'dvt-hs-seg',
    role: 'tablist',
    'aria-label': t('hotspot.dim.label'),
  },
  DIMENSIONS.map((dimension) => {
    const count = counts[dimension]
    return h('button', {
      key: dimension,
      type: 'button',
      role: 'tab',
      className: 'dvt-hs-seg-btn',
      'aria-selected': active === dimension,
      'data-dimension': dimension,
      onClick: () => handlers.onSetHotspotDimension(dimension),
    },
    h('span', null, t(`hotspot.dim.${dimension}`)),
    count === null
      ? null
      : h('span', { className: 'dvt-hs-seg-count' }, String(count)),
    )
  }),
  )
}

/* ----------------------------------------------------------------- files */

/** Churn ranking: mono path, blue sqrt bar, mono value. */
function FileRanking(props: {
  report: HotspotReport
  deps: PanelDeps
  handlers: PanelHandlers
}): React.ReactElement {
  const { report, deps, handlers } = props
  const { t } = deps
  const rows = sortHotspots(report.files, 'churn').slice(0, MAX_FILE_ROWS)
  if (rows.length === 0) {
    return h(EmptyState, { icon: IconFlame, title: t('hotspot.empty.title'), hint: t('hotspot.empty.hint') })
  }
  const max = maxOf(rows.map((file) => file.churn))
  return h('div', { className: 'dvt-hs-body', role: 'tabpanel', 'aria-label': t('hotspot.dim.files') },
    h('p', { className: 'dvt-hs-hint' }, t('hotspot.files.hint')),
    h('ul', { className: 'dvt-hs-list', role: 'list' },
      rows.map((file) => {
        const split = F.splitRepoPath(file.path)
        const churn = file.churn
        return h('li', { key: file.path, className: 'dvt-hs-item' },
          h('button', {
            type: 'button',
            className: 'dvt-hs-row dvt-hs-row-file',
            title: t('hotspot.open', { path: file.path }),
            'aria-label': t('aria.hotspotRow', { path: file.path }),
            onClick: () => handlers.onOpenHotspotFile(file.path),
          },
          h('span', { className: 'dvt-hs-path' },
            h('span', { className: 'dvt-hs-pathline dvt-mono' },
              // `splitRepoPath` keeps the trailing slash on the directory part;
              // appending another one would render "src/client//file.ts".
              split.dir === '' ? null : h('span', { className: 'dvt-hs-dir' }, split.dir),
              h('span', { className: 'dvt-hs-name' }, split.name),
            ),
            h('span', { className: 'dvt-hs-sub' }, t('hotspot.file.meta', {
              commits: file.commits,
              authors: file.authorCount,
            })),
          ),
          h(MicroBar, {
            value: typeof churn === 'number' ? churn : 0,
            max,
            tone: 'blue',
          }),
          h('span', {
            className: `dvt-hs-value dvt-mono${typeof churn === 'number' ? '' : ' dvt-hs-value-muted'}`,
            title: typeof churn === 'number' ? t('hotspot.file.churnTitle', { count: churn }) : undefined,
          }, countLabel(churn, deps)),
          ),
        )
      }),
    ),
    report.files.length > MAX_FILE_ROWS
      ? h('p', { className: 'dvt-hs-hint' }, t('hotspot.files.more', { count: MAX_FILE_ROWS }))
      : null,
  )
}

/* --------------------------------------------------------------- authors */

/** Contributor ranking: avatar, role, purple sqrt bar, mono churn. */
function AuthorRanking(props: { report: HotspotReport; deps: PanelDeps }): React.ReactElement {
  const { report, deps } = props
  const { t } = deps
  const rows = report.authors.slice(0, MAX_AUTHOR_ROWS)
  if (rows.length === 0) {
    return h(EmptyState, {
      icon: IconFlame,
      title: t('hotspot.authors.empty'),
      hint: t('hotspot.authors.emptyHint'),
    })
  }
  const totalCommits = report.authors.reduce((sum, author) => sum + author.commits, 0)
  const max = maxOf(rows.map((author) => author.churn))
  return h('div', { className: 'dvt-hs-body', role: 'tabpanel', 'aria-label': t('hotspot.dim.authors') },
    h('p', { className: 'dvt-hs-hint' }, t('hotspot.authors.hint')),
    h('ul', { className: 'dvt-hs-list', role: 'list' },
      rows.map((author) => {
        const churn = author.churn
        return h('li', { key: author.name, className: 'dvt-hs-item' },
          h('div', {
            className: 'dvt-hs-row dvt-hs-row-author',
            title: t('hotspot.author.churnTitle', {
              count: typeof churn === 'number' ? churn : 0,
            }),
          },
          h(Avatar, { name: author.name }),
          h('span', { className: 'dvt-hs-person' },
            h('span', { className: 'dvt-hs-personline' },
              h('span', { className: 'dvt-hs-name' }, author.name),
              h('span', {
                className: 'dvt-hs-role',
                title: t('hotspot.author.roleTitle'),
              }, t(authorRoleKey(author, totalCommits))),
            ),
            h('span', { className: 'dvt-hs-sub' }, t('hotspot.author.meta', {
              commits: author.commits,
              files: author.files,
            })),
          ),
          h(MicroBar, {
            value: typeof churn === 'number' ? churn : 0,
            max,
            tone: 'purple',
          }),
          h('span', {
            className: `dvt-hs-value dvt-mono${typeof churn === 'number' ? '' : ' dvt-hs-value-muted'}`,
          }, countLabel(churn, deps)),
          ),
        )
      }),
    ),
    report.authors.length > MAX_AUTHOR_ROWS
      ? h('p', { className: 'dvt-hs-hint' }, t('hotspot.authors.more', { count: MAX_AUTHOR_ROWS }))
      : null,
  )
}

/* -------------------------------------------------------------- activity */

/** One activity entry's action sentence. */
function actionLabel(commit: HotspotCommit, branch: string, t: PanelDeps['t']): string {
  const key = commit.merge ? 'hotspot.activity.merge' : 'hotspot.activity.commit'
  return t(key, { branch })
}

/** GitHub-style timeline feed: no bars, just events. */
function ActivityFeed(props: { report: HotspotReport; deps: PanelDeps }): React.ReactElement {
  const { report, deps } = props
  const { t } = deps
  const now = deps.now?.() ?? Date.now()
  const rows = report.recent.slice(0, MAX_ACTIVITY_ROWS)
  if (rows.length === 0) {
    return h(EmptyState, {
      icon: IconClock,
      title: t('hotspot.activity.empty'),
      hint: t('hotspot.activity.emptyHint'),
    })
  }
  const branch = report.scope.branch === null || report.scope.branch === ''
    ? t('hotspot.activity.branchUnknown')
    : report.scope.branch
  return h('div', { className: 'dvt-hs-body', role: 'tabpanel', 'aria-label': t('hotspot.dim.activity') },
    h('p', { className: 'dvt-hs-hint' }, t('hotspot.activity.hint')),
    h('ol', { className: 'dvt-hs-feed', role: 'list' },
      rows.map((commit) => {
        const extraFiles = commit.fileCount - commit.files.length
        return h('li', { key: commit.hash, className: 'dvt-hs-event' },
          h('span', { className: 'dvt-hs-rail', 'aria-hidden': 'true' }),
          h(Avatar, { name: commit.author === '' ? t('common.unknown') : commit.author, size: 'sm' }),
          h('div', { className: 'dvt-hs-event-body' },
            h('div', { className: 'dvt-hs-action' },
              h('strong', null, commit.author === '' ? t('common.unknown') : commit.author),
              h('span', null, actionLabel(commit, branch, t)),
              h('span', { className: 'dvt-hs-when' }, whenLabel(commit.timestamp, deps, now)),
            ),
            commit.subject === ''
              ? null
              : h('div', { className: 'dvt-hs-subject' }, commit.subject),
            h('div', { className: 'dvt-hs-files' },
              commit.files.slice(0, MAX_ACTIVITY_FILES).map((path) => h('span', {
                key: `${commit.hash}:${path}`,
                className: 'dvt-hs-file dvt-mono',
                title: path,
              }, path)),
              extraFiles > 0
                ? h('span', { className: 'dvt-hs-filemore' }, t('hotspot.activity.moreFiles', { count: extraFiles }))
                : null,
            ),
            h('div', { className: 'dvt-hs-eventmeta' },
              commit.timestamp === undefined
                ? null
                : h('span', { title: F.formatTime(commit.timestamp, deps.locale) }, F.formatCompactTime(commit.timestamp, deps.locale)),
              h('span', { className: 'dvt-hs-hash dvt-mono' }, F.shortHash(commit.hash, 7)),
              commit.additions === undefined && commit.deletions === undefined
                ? null
                : h('span', { className: 'dvt-hs-lines dvt-mono' }, t('hotspot.activity.lines', {
                  add: commit.additions ?? 0,
                  del: commit.deletions ?? 0,
                })),
              commit.merge ? h('span', { className: 'dvt-hs-merge' }, t('hotspot.activity.mergeTag')) : null,
            ),
          ),
        )
      }),
    ),
  )
}

/* -------------------------------------------------------------- calendar */

/** Short month label for the heatmap header (UTC, like the host buckets). */
function monthLabel(date: string, deps: PanelDeps): string {
  try {
    return new Intl.DateTimeFormat(deps.locale ?? 'zh', { month: 'short', timeZone: 'UTC' })
      .format(new Date(`${date}T00:00:00.000Z`))
  } catch {
    return date.slice(5, 7)
  }
}

/** One day of the grid: both daily metrics live in its tooltip. */
function CalendarCell(props: {
  day: CalendarDay
  metric: HotspotCalendarMetric
  max: number
  deps: PanelDeps
}): React.ReactElement {
  const { day, metric, max, deps } = props
  const { t } = deps
  const value = metric === 'pushes' ? day.pushes : day.churn
  // Outside the scan window a churn cell was never measured; the push metric
  // comes from the audit log instead, so only truly future days are blank.
  const outside = day.future || (metric === 'churn' && !day.inWindow)
  const level = outside ? 0 : heatLevel(value, max)
  const label = day.future
    ? t('hotspot.calendar.cell.future', { date: day.date })
    : typeof day.churn === 'number'
      ? t('hotspot.calendar.cell.full', {
        date: day.date,
        add: day.additions,
        del: day.deletions,
        commits: day.commits,
        pushes: day.pushes,
      })
      : t('hotspot.calendar.cell.noStats', {
        date: day.date,
        commits: day.commits,
        pushes: day.pushes,
      })
  const classes = ['dvt-hs-cal-cell', `dvt-hs-heat-${metric}-${level}`]
  if (outside) classes.push('dvt-hs-cal-out')
  if (day.future) classes.push('dvt-hs-cal-future')
  return h('span', {
    className: classes.join(' '),
    role: 'gridcell',
    title: label,
    'aria-label': label,
    'data-date': day.date,
    'data-value': value === null ? '' : String(value),
    'data-level': String(level),
    'data-churn': day.churn === null ? '' : String(day.churn),
    'data-pushes': String(day.pushes),
    'data-window': day.inWindow ? '1' : '0',
  })
}

/**
 * The calendar heatmap body: 26 weeks × 7 days, one metric at a time.
 *
 * Churn comes from the Host's scanned window (additions + deletions); pushes
 * come from this plugin's own audit log, because git stores no push history.
 * The metric switch only recolours the same grid — the tooltip always states
 * both numbers, so a cell can never be misread as the wrong metric.
 */
function CalendarHeatmap(props: {
  report: HotspotReport
  deps: PanelDeps
  handlers: PanelHandlers
  operations: readonly OperationAttempt[]
  auditHasMore: boolean
  auditFailed: boolean
  metric: HotspotCalendarMetric
}): React.ReactElement {
  const { report, deps, handlers, operations, auditHasMore, auditFailed, metric } = props
  const { t } = deps
  // Keep the newest weeks visible: in a narrow pane the 26-week grid scrolls
  // horizontally, and its left half can be entirely outside the scan window
  // (blank cells), so opening on scrollLeft=0 would show an empty calendar.
  const scrollerRef = React.useRef<HTMLDivElement | null>(null)
  React.useEffect(() => {
    const node = scrollerRef.current
    if (node === null) return
    node.scrollLeft = node.scrollWidth
  }, [metric])
  const pushes = pushCountByDay(operations)
  const days = calendarDays(report, new Date(deps.now?.() ?? Date.now()), pushes)
  const max = maxOf(days.map((day) => (metric === 'pushes' ? day.pushes : day.inWindow ? day.churn : null)))
  const churnTotal = days.reduce((sum, day) => (
    sum + (day.inWindow && typeof day.churn === 'number' ? day.churn : 0)
  ), 0)
  const pushTotal = days.reduce((sum, day) => sum + day.pushes, 0)
  // Nothing measured at all: say so instead of painting a grid of zeros.
  if (report.scannedCommits === 0 && pushTotal === 0) {
    return h(EmptyState, { icon: IconFlame, title: t('hotspot.empty.title'), hint: t('hotspot.empty.hint') })
  }
  const activeDays = days.filter((day) => day.inWindow && day.commits > 0).length
  const pushDays = days.filter((day) => day.pushes > 0).length
  const weeks: CalendarDay[][] = []
  for (let index = 0; index < days.length; index += 7) weeks.push(days.slice(index, index + 7))
  const segments: Array<{ label: string; span: number }> = []
  for (const week of weeks) {
    const first = week[0]
    if (first === undefined) continue
    const label = monthLabel(first.date, deps)
    const last = segments[segments.length - 1]
    if (last !== undefined && last.label === label) last.span += 1
    else segments.push({ label, span: 1 })
  }
  const weekdays = [
    t('hotspot.chart.weekday.mon'),
    t('hotspot.chart.weekday.tue'),
    t('hotspot.chart.weekday.wed'),
    t('hotspot.chart.weekday.thu'),
    t('hotspot.chart.weekday.fri'),
    t('hotspot.chart.weekday.sat'),
    t('hotspot.chart.weekday.sun'),
  ]
  const metricButton = (value: HotspotCalendarMetric, label: string, hint: string): React.ReactElement => h('button', {
    type: 'button',
    className: 'dvt-hs-metric-btn',
    'aria-pressed': metric === value,
    title: hint,
    onClick: () => handlers.onSetHotspotCalendarMetric(value),
  }, label)
  const peakDay = days.reduce<CalendarDay | null>((best, day) => {
    const value = metric === 'pushes' ? day.pushes : day.inWindow ? day.churn : null
    const bestValue = best === null ? null : metric === 'pushes' ? best.pushes : best.churn
    if (typeof value !== 'number' || value <= 0) return best
    if (typeof bestValue !== 'number' || value > bestValue) return day
    return best
  }, null)
  const peakValue = peakDay === null ? null : metric === 'pushes' ? peakDay.pushes : peakDay.churn
  const topFiles = sortHotspots(report.files, 'churn').slice(0, 3)
  const statRow = (label: string, value: string): React.ReactElement => h('div', { className: 'dvt-hs-cal-stat' },
    h('span', { className: 'dvt-hs-cal-stat-label' }, label),
    h('span', { className: 'dvt-hs-cal-stat-value dvt-mono' }, value),
  )
  const summary = metric === 'pushes'
    ? [t('hotspot.calendar.total.pushes', { count: pushTotal }), t('hotspot.calendar.pushDays', { count: pushDays })]
    : [t('hotspot.calendar.total.churn', { count: churnTotal }), t('hotspot.calendar.activeDays', { count: activeDays })]
  return h('div', { className: 'dvt-hs-body dvt-hs-cal-body-root', role: 'tabpanel', 'aria-label': t('hotspot.dim.calendar') },
    h('p', { className: 'dvt-hs-hint' }, t('hotspot.calendar.hint')),
    h('div', { className: 'dvt-hs-cal-controls' },
      h('div', { className: 'dvt-hs-metric', role: 'group', 'aria-label': t('hotspot.calendar.metric.label') },
        metricButton('churn', t('hotspot.calendar.metric.churn'), t('hotspot.calendar.metric.churnHint')),
        metricButton('pushes', t('hotspot.calendar.metric.pushes'), t('hotspot.calendar.metric.pushesHint')),
      ),
      h('div', { className: 'dvt-hs-cal-legend' },
        h('span', { className: 'dvt-hs-cal-legend-label' }, t('hotspot.calendar.legend')),
        [0, 1, 2, 3, 4].map((level) => h('span', {
          key: `legend-${level}`,
          className: `dvt-hs-cal-swatch dvt-hs-heat-${metric}-${level}`,
          'aria-hidden': 'true',
        })),
      ),
    ),
    h('div', { className: 'dvt-hs-cal-layout' },
      h('div', { className: 'dvt-hs-cal' },
        h('div', { className: 'dvt-hs-cal-weekdays', 'aria-hidden': 'true' },
          weekdays.map((label, index) => h('span', {
            key: label,
            className: 'dvt-hs-cal-weekday',
            'data-index': String(index),
          }, index % 2 === 0 ? label : '')),
        ),
        h('div', { className: 'dvt-hs-cal-scroll', ref: scrollerRef },
          h('div', { className: 'dvt-hs-cal-months', 'aria-hidden': 'true' },
            segments.map((segment) => h('span', {
              key: `${segment.label}-${segment.span}`,
              className: 'dvt-hs-cal-month',
              // Each segment covers its weeks in the same 26-column grid.
              style: { gridColumn: `span ${segment.span}` },
            }, segment.label)),
          ),
          h('div', {
            className: 'dvt-hs-cal-grid',
            role: 'grid',
            'aria-label': t('hotspot.calendar.aria'),
          },
          days.map((day) => h(CalendarCell, { key: day.date, day, metric, max, deps })),
          ),
        ),
      ),
      h('aside', { className: 'dvt-hs-cal-side' },
        h('div', { className: 'dvt-hs-cal-card' },
          h('div', { className: 'dvt-hs-cal-card-title' }, t('hotspot.calendar.side.summary')),
          statRow(t('hotspot.calendar.metric.churn'), countLabel(churnTotal, deps)),
          statRow(t('hotspot.calendar.metric.pushes'), String(pushTotal)),
          statRow(t('hotspot.calendar.side.active'), String(activeDays)),
          peakDay === null || peakValue === null
            ? null
            : statRow(
              t('hotspot.calendar.side.peak'),
              t('hotspot.calendar.peakValue', { date: peakDay.date, value: peakValue }),
            ),
        ),
        topFiles.length === 0
          ? null
          : h('div', { className: 'dvt-hs-cal-card' },
            h('div', { className: 'dvt-hs-cal-card-title' }, t('hotspot.calendar.side.topFiles')),
            h('ul', { className: 'dvt-hs-cal-files', role: 'list' },
              topFiles.map((file) => {
                const split = F.splitRepoPath(file.path)
                return h('li', { key: file.path, className: 'dvt-hs-cal-file' },
                  h('span', {
                    className: 'dvt-hs-cal-file-name dvt-mono dvt-clip',
                    title: file.path,
                  }, `${split.dir}${split.name}`),
                  h('span', { className: 'dvt-hs-cal-file-value dvt-mono' }, countLabel(file.churn, deps)),
                )
              }),
            ),
          ),
      ),
    ),
    h('p', { className: 'dvt-hs-hint dvt-hs-cal-summary dvt-mono' }, summary.join(' · ')),
    metric === 'pushes'
      ? h('p', { className: 'dvt-hs-hint dvt-hs-cal-note' }, pushTotal === 0
        ? (auditFailed ? t('hotspot.calendar.pushUnavailable') : t('hotspot.calendar.pushEmpty'))
        : t(auditHasMore ? 'hotspot.calendar.pushSourceMore' : 'hotspot.calendar.pushSource', {
          count: operations.length,
        }))
      : null,
  )
}

/* ------------------------------------------------------------------- page */

/** The hotspot dashboard body. */
export function renderHotspots(state: PanelState, deps: PanelDeps, handlers: PanelHandlers): React.ReactElement | null {
  const { t } = deps
  const repository = selectedRepository(state)
  // First load of this source: the composition root's SkeletonSwap paints the
  // dashboard-shaped skeleton, so the view itself renders nothing.
  if (state.boot === 'loading') return null
  if (repository === null) {
    return h(EmptyState, {
      icon: IconFlame,
      title: state.noWorkspace ? t('state.noWorkspace.title') : t('state.noRepositories.title'),
      hint: state.noWorkspace ? t('state.noWorkspace.hint') : t('state.noRepositories.hint'),
    })
  }
  const tool = missingTool(state, repository)
  if (tool !== null) {
    return h(EmptyState, {
      icon: IconError,
      tone: 'error',
      title: t('state.missingTool', { vcs: tool === 'git' ? 'Git' : 'SVN', tool: tool === 'git' ? 'Git' : 'SVN' }),
      hint: tool === 'svn' ? t('addRepo.svnHint') : t('error.vcs-not-installed'),
    })
  }
  const hotspots = state.hotspots
  const report: HotspotReport | null = hotspots.data
  const dimension = hotspots.dimension
  const counts: Record<HotspotDimension, number | null> = {
    calendar: report === null ? null : report.daily.filter((day) => day.commits > 0).length,
    files: report === null ? null : report.files.length,
    authors: report === null ? null : report.authors.length,
    activity: report === null ? null : report.recent.length,
  }
  const coverage = report === null
    ? null
    : [
      t('hotspot.coverage', { count: report.scannedCommits }),
      t('hotspot.window', { count: report.scope.windowCommits }),
      ...(report.daily.some((day) => day.commits > 0)
        ? [t('hotspot.activeDays', { count: report.daily.filter((day) => day.commits > 0).length })]
        : []),
      ...(report.truncated ? [t('hotspot.truncated')] : []),
      ...(report.cached ? [t('hotspot.cached')] : []),
    ].join(' · ')
  let body: React.ReactElement | null
  if (hotspots.loading && report === null) body = null
  else if (hotspots.error !== null) {
    body = h(EmptyState, {
      icon: IconError,
      tone: 'error',
      title: t('state.error.title'),
      hint: errorText(hotspots.error, t),
      actions: h('button', { type: 'button', className: 'dvt-btn dvt-btn-sm', onClick: handlers.onRefreshHotspots }, t('common.retry')),
    })
  } else if (report === null) body = null
  else if (report.available !== true) {
    body = h(EmptyState, {
      icon: IconWarning,
      title: t('hotspot.unavailable'),
      hint: t('hotspot.unavailable.hint'),
      actions: h('button', { type: 'button', className: 'dvt-btn dvt-btn-sm', onClick: handlers.onRefreshHotspots }, t('common.retry')),
    })
  } else if (dimension === 'authors') body = h(AuthorRanking, { report, deps })
  else if (dimension === 'activity') body = h(ActivityFeed, { report, deps })
  else if (dimension === 'files') body = h(FileRanking, { report, deps, handlers })
  else {
    body = h(CalendarHeatmap, {
      report,
      deps,
      handlers,
      operations: state.audit.operations,
      auditHasMore: state.audit.hasMore,
      auditFailed: state.audit.error !== null,
      metric: hotspots.calendarMetric,
    })
  }
  return h('div', { className: 'dvt-hs', 'data-dimension': dimension },
    h('div', { className: 'dvt-hs-head' },
      h('div', { className: 'dvt-hs-title-col' },
        h('div', { className: 'dvt-hs-title' }, t('hotspot.dashboard.title')),
        h('div', { className: 'dvt-hs-subtitle' }, t('hotspot.dashboard.subtitle')),
        coverage === null ? null : h('div', { className: 'dvt-hs-coverage', title: coverage },
          h(IconClock, { size: 10 }),
          h('span', { className: 'dvt-clip' }, coverage),
        ),
      ),
      h('div', { className: 'dvt-hs-head-actions' },
        h(IconButton, { label: t('hotspot.refresh'), icon: IconRefresh, onClick: handlers.onRefreshHotspots }),
      ),
    ),
    h(DimensionSwitch, { active: dimension, counts, deps, handlers }),
    report !== null && report.warnings !== undefined && report.warnings.length > 0
      ? h(Banner, { kind: 'warn', text: t('hotspot.warning') })
      : null,
    body,
    report !== null && report.available === true
      ? h('div', { className: 'dvt-hs-foot' }, t('hotspot.foot', {
        files: report.files.length,
        commits: report.scannedCommits,
        branch: report.scope.branch ?? t('common.unknown'),
      }))
      : null,
  )
}
