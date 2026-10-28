/**
 * Hotspot view: a chart first, files second.
 *
 * Two visualizations over the same bounded scan:
 *  - a calendar heatmap of commits per day (`HotspotReport.daily`), so "when was
 *    this repository hot" is read at a glance, and
 *  - a bar chart of the busiest files by the selected measured metric, so the
 *    ranking is visual instead of a table.
 *
 * Every number comes from the Host's report; the coverage badges state the
 * scanned window, truncation and cache hit, and a missing line count renders as
 * "not provided" instead of a fabricated zero. Sorting is a client-side
 * re-order of the rows the Host returned.
 * @module dsh-vcs-timeline/client/ui/hotspots
 */

import * as React from 'react'
import type { FileHotspot, HotspotReport } from '../../shared/contracts.ts'
import * as F from '../format.ts'
import type { HotspotSort, PanelDeps, PanelHandlers, PanelState } from '../types.ts'
import { IconClock, IconError, IconFlame, IconRefresh, IconWarning } from './icons.ts'
import {
  Banner,
  DotSep,
  EmptyState,
  IconButton,
  SkeletonRows,
  errorText,
} from './primitives.ts'
import { missingTool, selectedRepository } from './shared.ts'

const h = React.createElement

/** How many bars the file chart shows. */
const MAX_BARS = 12
/** How many calendar weeks the activity chart shows. */
const MAX_HEATMAP_WEEKS = 26
/** Intensity buckets of the calendar heatmap. */
const HEAT_LEVELS = 4

/** Sort a copy of the Host rows by the selected explainable dimension. */
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

/** The numeric value one bar length represents for the selected metric. */
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

/** One UTC day plus its commit count. */
export interface HeatDay {
  date: string
  commits: number
}

/**
 * Build the day list the calendar heatmap renders: `MAX_HEATMAP_WEEKS` weeks
 * ending today. Days outside the scanned window have no bucket (rendered
 * faint), never a fake zero that would claim the day was measured.
 */
export function heatmapDays(report: HotspotReport, now: Date = new Date()): HeatDay[] {
  const counts = new Map<string, number>()
  // An older Host build may not carry `daily` yet; the chart then renders its
  // honest empty state instead of crashing the panel.
  for (const day of Array.isArray(report.daily) ? report.daily : []) counts.set(day.date, day.commits)
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  // Anchor the chart on the newest bucket the Host actually reported, unless
  // that is in the future (clock skew); a 26-week window ending today would
  // render an old-but-real window as empty.
  const latest = [...counts.keys()].sort((a, b) => b.localeCompare(a))[0]
  const anchor = latest !== undefined && latest < today.toISOString().slice(0, 10)
    ? new Date(`${latest}T00:00:00.000Z`)
    : today
  const endWeekday = (anchor.getUTCDay() + 6) % 7
  const endOfWeek = new Date(anchor.getTime() + (6 - endWeekday) * 86_400_000)
  const start = new Date(endOfWeek.getTime() - (MAX_HEATMAP_WEEKS * 7 - 1) * 86_400_000)
  const days: HeatDay[] = []
  for (let cursor = start.getTime(); cursor <= endOfWeek.getTime(); cursor += 86_400_000) {
    days.push({ date: new Date(cursor).toISOString().slice(0, 10), commits: counts.get(new Date(cursor).toISOString().slice(0, 10)) ?? 0 })
  }
  return days
}

/** One intensity bucket (0 = no commit in this window bucket). */
function heatLevel(commits: number, max: number): number {
  if (commits <= 0) return 0
  if (max <= 1) return 1
  return Math.min(HEAT_LEVELS, Math.max(1, Math.ceil((commits / max) * HEAT_LEVELS)))
}

/** The calendar heatmap (weeks as columns, Monday..Sunday as rows). */
function ActivityChart(props: { report: HotspotReport; deps: PanelDeps }): React.ReactElement {
  const { report, deps } = props
  const { t } = deps
  const days = heatmapDays(report)
  const max = days.reduce((best, day) => Math.max(best, day.commits), 0)
  const weekdayLabels = [
    t('hotspot.chart.weekday.mon'),
    t('hotspot.chart.weekday.tue'),
    t('hotspot.chart.weekday.wed'),
    t('hotspot.chart.weekday.thu'),
    t('hotspot.chart.weekday.fri'),
    t('hotspot.chart.weekday.sat'),
    t('hotspot.chart.weekday.sun'),
  ]
  const active = days.filter((day) => day.commits > 0).length
  return h('div', { className: 'dvt-card dvt-hotspot-chart' },
    h('div', { className: 'dvt-card-head' },
      h('span', { className: 'dvt-card-title' }, t('hotspot.chart.title')),
      h('span', { className: 'dvt-faint dvt-hotspot-chart-meta' }, t('hotspot.chart.active', { count: active })),
    ),
    h('div', { className: 'dvt-card-hint' }, t('hotspot.chart.subtitle')),
    max === 0
      ? h('div', { className: 'dvt-card-hint' }, t('hotspot.chart.empty'))
      : h('div', { className: 'dvt-heatmap' },
        h('div', { className: 'dvt-heatmap-weekdays', 'aria-hidden': 'true' },
          weekdayLabels.map((label) => h('span', { key: label, className: 'dvt-heatmap-weekday' }, label)),
        ),
        h('div', {
          className: 'dvt-heatmap-grid',
          role: 'img',
          'aria-label': t('hotspot.chart.label', { count: report.scannedCommits }),
        },
        days.map((day) => h('span', {
          key: day.date,
          className: `dvt-heatmap-cell dvt-heat-${heatLevel(day.commits, max)}`,
          title: t('hotspot.chart.cell', { date: day.date, count: day.commits }),
          'data-date': day.date,
          'data-commits': day.commits,
        })),
        ),
      ),
    h('div', { className: 'dvt-heatmap-legend' },
      h('span', { className: 'dvt-faint' }, t('hotspot.chart.legend')),
      Array.from({ length: HEAT_LEVELS + 1 }, (_, level) => h('span', {
        key: `legend-${level}`,
        className: `dvt-heatmap-cell dvt-heat-${level}`,
        'aria-hidden': 'true',
      })),
    ),
  )
}

/** The file bar chart (visual ranking; labels are real paths). */
function FileBars(props: { report: HotspotReport; sort: HotspotSort; deps: PanelDeps; handlers: PanelHandlers }): React.ReactElement {
  const { report, sort, deps, handlers } = props
  const { t } = deps
  const rows = sortHotspots(report.files, sort).slice(0, MAX_BARS)
  const valueOf = (file: FileHotspot): number => {
    const value = metricValue(file, sort)
    return typeof value === 'number' ? value : 0
  }
  const max = rows.reduce((best, file) => Math.max(best, valueOf(file)), 0)
  return h('div', { className: 'dvt-card dvt-hotspot-bars' },
    h('div', { className: 'dvt-card-head' },
      h('span', { className: 'dvt-card-title' }, t('hotspot.bars.title')),
      h('span', { className: 'dvt-faint dvt-hotspot-chart-meta' }, t(`hotspot.metric.${sort}`)),
    ),
    h('div', { className: 'dvt-card-hint' }, t('hotspot.bars.subtitle')),
    h('ul', { className: 'dvt-bars', role: 'list' },
      rows.map((file) => {
        const value = metricValue(file, sort)
        const width = max <= 0 ? 0 : Math.max(2, Math.round((valueOf(file) / max) * 100))
        const { dir, name } = F.splitRepoPath(file.path)
        const display = typeof value === 'number'
          ? sort === 'recent'
            ? F.formatCompactTime(file.lastChangedAt, deps.locale)
            : String(value)
          : t('hotspot.bars.unknown')
        return h('li', { key: file.path, className: 'dvt-bar-item' },
          h('button', {
            type: 'button',
            className: 'dvt-bar-row',
            title: t('hotspot.open', { path: file.path }),
            'aria-label': t('aria.hotspotRow', { path: file.path }),
            onClick: () => handlers.onOpenHotspotFile(file.path),
          },
          h('span', { className: 'dvt-bar-track', 'aria-hidden': 'true' },
            h('span', { className: `dvt-bar-fill dvt-bar-${sort}`, style: { width: `${width}%` } }),
          ),
          h('span', { className: 'dvt-bar-label dvt-clip' },
            dir === '' ? null : h('span', { className: 'dvt-file-dir' }, dir),
            h('span', { className: 'dvt-bar-name' }, name),
          ),
          h('span', { className: 'dvt-bar-value dvt-mono' }, display),
          ),
        )
      }),
    ),
    report.files.length > MAX_BARS
      ? h('div', { className: 'dvt-card-hint' }, t('hotspot.bars.more', { count: MAX_BARS }))
      : null,
  )
}

/** The hotspot ranking body. */
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
  const sorts: HotspotSort[] = ['commits', 'churn', 'authors', 'recent']
  const metrics = h('div', { className: 'dvt-seg', role: 'group', 'aria-label': t('hotspot.metric.label') },
    sorts.map((sort) => h('button', {
      key: sort,
      type: 'button',
      className: 'dvt-seg-btn',
      'aria-pressed': hotspots.sort === sort,
      onClick: () => handlers.onSetHotspotSort(sort),
    }, t(`hotspot.metric.${sort}`))),
  )
  const head = h('div', { className: 'dvt-hotspot-head' },
    h('div', { className: 'dvt-hotspot-title-col' },
      h('div', { className: 'dvt-hotspot-title' }, t('hotspot.title')),
      h('div', { className: 'dvt-hotspot-subtitle' }, t('hotspot.subtitle')),
    ),
    h('div', { className: 'dvt-hotspot-controls' },
      metrics,
      h(IconButton, { label: t('hotspot.refresh'), icon: IconRefresh, onClick: handlers.onRefreshHotspots }),
    ),
  )
  const coverage = report === null
    ? null
    : h('div', { className: 'dvt-hotspot-coverage' },
      h(IconClock, { size: 10 }),
      h('span', null, t('hotspot.coverage', { count: report.scannedCommits })),
      report.truncated ? h(DotSep) : null,
      report.truncated ? h('span', { className: 'dvt-danger' }, t('hotspot.truncated')) : null,
      report.cached ? h(DotSep) : null,
      report.cached ? h('span', { className: 'dvt-faint' }, t('hotspot.cached')) : null,
      h(DotSep),
      h('span', { className: 'dvt-faint' }, t('hotspot.window', { count: report.scope.windowCommits })),
    )
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
  } else {
    body = h('div', { className: 'dvt-hotspot-charts' },
      h(ActivityChart, { report, deps }),
      report.files.length === 0
        ? h(EmptyState, { icon: IconFlame, title: t('hotspot.empty.title'), hint: t('hotspot.empty.hint') })
        : h(FileBars, { report, sort: hotspots.sort, deps, handlers }),
    )
  }
  return h('div', { className: 'dvt-col dvt-hotspots' },
    head,
    report !== null && report.warnings !== undefined && report.warnings.length > 0
      ? h(Banner, { kind: 'warn', text: t('hotspot.warning') })
      : null,
    coverage,
    body,
    report !== null && report.available === true
      ? h('div', { className: 'dvt-hotspot-foot' }, t('hotspot.foot', {
        files: report.files.length,
        commits: report.scannedCommits,
        branch: report.scope.branch ?? t('common.unknown'),
      }))
      : null,
  )
}
