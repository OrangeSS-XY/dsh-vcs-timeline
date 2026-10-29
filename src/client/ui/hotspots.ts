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
} from '../../shared/contracts.ts'
import * as F from '../format.ts'
import type {
  HotspotDimension,
  HotspotSort,
  PanelDeps,
  PanelHandlers,
  PanelState,
} from '../types.ts'
import { IconClock, IconError, IconFlame, IconRefresh, IconWarning } from './icons.ts'
import { Banner, EmptyState, IconButton, SkeletonRows, errorText } from './primitives.ts'
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

/** The three dashboard bodies, in display order. */
const DIMENSIONS: HotspotDimension[] = ['files', 'authors', 'activity']

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

/* ------------------------------------------------------------------- page */

/** The hotspot dashboard body. */
export function renderHotspots(state: PanelState, deps: PanelDeps, handlers: PanelHandlers): React.ReactElement {
  const { t } = deps
  const repository = selectedRepository(state)
  if (state.boot === 'loading') return h(SkeletonRows, { rows: 6 })
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
  let body: React.ReactElement
  if (hotspots.loading && report === null) body = h(SkeletonRows, { rows: 8 })
  else if (hotspots.error !== null) {
    body = h(EmptyState, {
      icon: IconError,
      tone: 'error',
      title: t('state.error.title'),
      hint: errorText(hotspots.error, t),
      actions: h('button', { type: 'button', className: 'dvt-btn dvt-btn-sm', onClick: handlers.onRefreshHotspots }, t('common.retry')),
    })
  } else if (report === null) body = h(SkeletonRows, { rows: 8 })
  else if (report.available !== true) {
    body = h(EmptyState, {
      icon: IconWarning,
      title: t('hotspot.unavailable'),
      hint: t('hotspot.unavailable.hint'),
      actions: h('button', { type: 'button', className: 'dvt-btn dvt-btn-sm', onClick: handlers.onRefreshHotspots }, t('common.retry')),
    })
  } else if (dimension === 'authors') body = h(AuthorRanking, { report, deps })
  else if (dimension === 'activity') body = h(ActivityFeed, { report, deps })
  else body = h(FileRanking, { report, deps, handlers })
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
