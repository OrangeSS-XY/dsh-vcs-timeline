/**
 * dsh-vcs-timeline — IDEA-style change timeline (right column).
 *
 * The list reads as a vertical timeline: one continuous rail with a node per
 * commit, sticky day headers, and rows that answer "who did what, and when" —
 * author avatar + name, summary, relative time (exact time on hover), revision,
 * line stats and, when one file is selected, that file's per-commit status and
 * line counts. Filters are the same state as the file tree, so a directory
 * count and these rows can never disagree.
 * @module dsh-vcs-timeline/client/ui/history
 */

import * as React from 'react'
import type { FileChangeStatus, VcsEvent } from '../../shared/contracts.ts'
import * as F from '../format.ts'
import type { DayGroup, TimelineView } from '../file-index.ts'
import { groupEventsByDay } from '../file-index.ts'
import type { PanelDeps, PanelHandlers, PanelState } from '../types.ts'
import { IconBranch, IconClock, IconClose, IconError, IconFile, IconRepo, IconTimeline } from './icons.ts'
import {
  Banner,
  DotSep,
  EmptyState,
  fileCountLabel,
  IconButton,
  LineStats,
  SkeletonRows,
} from './primitives.ts'
import {
  hasActiveFilters,
  isUninitializedHistory,
  missingTool,
  selectedRepository,
} from './shared.ts'

const h = React.createElement

/** Revision label: Git hash shortened, SVN revision prefixed with `r`. */
function revisionLabel(event: VcsEvent): string {
  if (event.revision !== undefined && event.revision !== '') return `r${event.revision}`
  return F.shortHash(event.commitHash, 7)
}

/** The file this row is about, when the pane is narrowed to one path. */
function selectedFileOf(
  event: VcsEvent,
  path: string,
): { additions: number | null; deletions: number | null; status: FileChangeStatus; letter: string; binary: boolean } {
  const files = Array.isArray(event.changedFiles) ? event.changedFiles : []
  const file = files.find((entry) => entry.path === path)
  if (file === undefined) return { additions: null, deletions: null, status: 'unknown', letter: '?', binary: false }
  const stats = F.fileStats(file)
  return {
    ...stats,
    status: file.status,
    letter: F.statusLetter(file.status),
    binary: file.binary === true,
  }
}

/** "When" label: relative for the last week, a compact date older than that. */
function whenLabel(iso: string, deps: PanelDeps, now: number): string {
  const relative = F.relativeTime(iso, now)
  if (relative === null) return F.formatCompactTime(iso, deps.locale)
  const { t } = deps
  switch (relative.unit) {
    case 'justNow': return t('rel.justNow')
    case 'minutes': return t('rel.minutesAgo', { count: relative.count })
    case 'hours': return t('rel.hoursAgo', { count: relative.count })
    default: return t('rel.daysAgo', { count: relative.count })
  }
}

/** Decorative author avatar: deterministic hue per name, initials in the middle. */
function AuthorAvatar(props: { actor: string | undefined; deps: PanelDeps }): React.ReactElement {
  const { actor } = props
  const hue = F.authorHue(actor)
  return h('span', {
    className: 'dvt-tl-avatar',
    'aria-hidden': 'true',
    style: {
      background: `hsl(${hue} 58% 52%)`,
      color: 'var(--dsw-alias-bg-base)',
    },
  }, F.authorInitials(actor))
}

/** Sticky day header of the timeline. */
function DayHeader(props: { group: DayGroup; deps: PanelDeps; now: number }): React.ReactElement {
  const { group, deps, now } = props
  const label = F.dayLabel(group.timestamp, deps.locale, new Date(now))
  const text = label.kind === 'today'
    ? deps.t('group.today')
    : label.kind === 'yesterday'
      ? deps.t('group.yesterday')
      : label.text
  return h('div', { className: 'dvt-tl-day' },
    h('span', { className: 'dvt-tl-day-label' }, text),
    h('span', { className: 'dvt-tl-day-count' }, deps.t('timeline.count.label', { count: group.events.length })),
  )
}

/** Whether this event is the repository's current HEAD revision. */
function isHeadEvent(event: VcsEvent, headRevision: string | undefined): boolean {
  if (headRevision === undefined || headRevision === '') return false
  if (event.commitHash !== undefined && event.commitHash === headRevision) return true
  return event.revision !== undefined && event.revision === headRevision
}

/** One timeline row: rail node + who/what/when. */
function TimelineRow(props: {
  event: VcsEvent
  deps: PanelDeps
  handlers: PanelHandlers
  selectedPath: string | null
  /** Visible file paths when a client-side file filter is active. */
  visiblePaths: ReadonlySet<string> | null
  /** The repository's current HEAD/revision, for the HEAD marker. */
  headRevision: string | undefined
  now: number
}): React.ReactElement {
  const { event, deps, handlers, selectedPath, visiblePaths, headRevision, now } = props
  const { t } = deps
  const merge = F.isMergeCommit(event)
  const head = isHeadEvent(event, headRevision)
  const hash = F.shortHash(event.commitHash, 7)
  const revision = revisionLabel(event)
  const stats = F.eventStats(event)
  const narrow = selectedPath === null ? null : selectedFileOf(event, selectedPath)
  const matched = selectedPath !== null || visiblePaths === null
    ? null
    : (Array.isArray(event.changedFiles) ? event.changedFiles : []).filter((file) => visiblePaths.has(file.path)).length
  const when = whenLabel(event.timestamp, deps, now)
  const exact = F.formatTime(event.timestamp, deps.locale)
  const aria = t('aria.timelineRow', {
    label: `${revision === '' ? event.id : revision} ${F.truncate(event.summary, 80)}`,
  })
  return h('li', { className: 'dvt-tl-row' },
    h('span', { className: 'dvt-tl-rail', 'aria-hidden': 'true' },
      h('span', { className: `dvt-tl-node${merge ? ' dvt-tl-node-merge' : ''}` }),
    ),
    h('button', {
      type: 'button',
      className: 'dvt-tl-card',
      'aria-label': aria,
      title: `${event.summary}\n${exact}`,
      onClick: () => handlers.onOpenEvent(event),
    },
    h('span', { className: 'dvt-tl-top' },
      h(AuthorAvatar, { actor: event.actor, deps }),
      h('span', { className: 'dvt-tl-author' },
        event.actor === undefined || event.actor === '' ? t('common.unknown') : event.actor,
      ),
      h('span', { className: 'dvt-tl-summary' },
        F.truncate(event.summary, 200) === '' ? t('timeline.noRevision') : F.truncate(event.summary, 200),
      ),
      h('span', { className: 'dvt-tl-stats' },
        narrow === null
          ? h(LineStats, {
            ...(stats.additions === undefined ? {} : { additions: stats.additions }),
            ...(stats.deletions === undefined ? {} : { deletions: stats.deletions }),
            t,
          })
          : h(LineStats, {
            ...(narrow.additions === null ? {} : { additions: narrow.additions }),
            ...(narrow.deletions === null ? {} : { deletions: narrow.deletions }),
            t,
          }),
      ),
    ),
    h('span', { className: 'dvt-tl-meta' },
      h('span', { className: 'dvt-tl-when', title: exact },
        h(IconClock, { size: 10 }),
        h('span', null, when),
      ),
      hash === '' ? null : h(DotSep),
      hash === '' ? null : h('span', { className: 'dvt-tl-hash dvt-mono' }, hash),
      head ? h('span', { className: 'dvt-tag dvt-tl-head', title: t('timeline.head') }, 'HEAD') : null,
      merge ? h('span', { className: 'dvt-tag dvt-tag-merge', title: t('timeline.merge') }, t('timeline.merge')) : null,
      event.branch === undefined || event.branch === ''
        ? null
        : h('span', { className: 'dvt-tag dvt-tl-branch', title: event.branch },
          h(IconBranch, { size: 9 }),
          h('span', null, F.truncate(event.branch, 22)),
        ),
      narrow === null
        ? null
        : h('span', {
          className: `dvt-file-status dvt-status-${narrow.status}`,
          title: t('aria.fileStatus'),
        }, narrow.letter),
      narrow !== null && narrow.binary
        ? h('span', { className: 'dvt-bin', title: t('diff.binary') }, 'BIN')
        : null,
      matched === null || matched === 0
        ? null
        : h('span', { className: 'dvt-tl-files', title: t('aria.stats') }, t('timeline.matchedFiles', { count: matched })),
      narrow === null && stats.files !== undefined && visiblePaths === null
        ? h('span', { className: 'dvt-tl-files', title: t('aria.stats') }, fileCountLabel(stats.files, t))
        : null,
      h('span', { className: 'dvt-tl-go', 'aria-hidden': 'true' }, '›'),
    ),
    ),
  )
}

/** 26px bar naming the file the right pane is narrowed to. */
function SelectionHeader(props: {
  path: string
  status: FileChangeStatus
  count: number
  deps: PanelDeps
  handlers: PanelHandlers
}): React.ReactElement {
  const { path, status, count, deps, handlers } = props
  const { t } = deps
  const { dir, name } = F.splitRepoPath(path)
  return h('div', { className: 'dvt-selection' },
    h('span', { className: `dvt-file-status dvt-status-${status}`, 'aria-hidden': 'true' },
      F.statusLetter(status)),
    h('span', { className: 'dvt-selection-path dvt-mono', title: path },
      dir === '' ? null : h('span', { className: 'dvt-file-dir' }, dir),
      h('span', { className: 'dvt-selection-name' }, name),
    ),
    h('span', { className: 'dvt-selection-meta' }, t('timeline.count.label', { count })),
    h(IconButton, {
      label: t('tree.showAll'),
      icon: IconClose,
      extraClass: 'dvt-selection-clear',
      onClick: () => handlers.onSelectFile(null),
    }),
  )
}

/** The change timeline body for the selected repository and filters. */
export function renderHistory(
  state: PanelState,
  deps: PanelDeps,
  handlers: PanelHandlers,
  view: TimelineView,
): React.ReactElement {
  const { t } = deps
  const repository = selectedRepository(state)
  const timeline = state.timeline

  if (state.boot === 'loading') return h(SkeletonRows, { rows: 6 })
  if (state.boot === 'error') {
    return h(EmptyState, {
      icon: IconError,
      tone: 'error',
      title: t('state.error.title'),
      hint: F.errorMessage(state.bootError, t),
      actions: h('button', { type: 'button', className: 'dvt-btn dvt-btn-sm', onClick: handlers.onRefreshRepositories }, t('common.retry')),
    })
  }
  if (repository === null) {
    if (state.noWorkspace) {
      return h(EmptyState, {
        icon: IconRepo,
        title: t('state.noWorkspace.title'),
        hint: t('state.noWorkspace.hint'),
        actions: h('button', { type: 'button', className: 'dvt-btn dvt-btn-sm', onClick: handlers.onRefreshRepositories }, t('common.refresh')),
      })
    }
    return h(EmptyState, {
      icon: IconRepo,
      title: t('state.noRepositories.title'),
      hint: t('state.noRepositories.hint'),
      actions: h('button', { type: 'button', className: 'dvt-btn dvt-btn-sm', onClick: handlers.onRefreshRepositories }, t('common.refresh')),
    })
  }
  const tool = missingTool(state, repository)
  if (tool !== null) {
    return h(EmptyState, {
      icon: IconError,
      tone: 'error',
      title: t('state.missingTool', { vcs: tool === 'git' ? 'Git' : 'SVN', tool: tool === 'git' ? 'Git' : 'SVN' }),
      hint: t('error.vcs-not-installed'),
      actions: h('button', { type: 'button', className: 'dvt-btn dvt-btn-sm', onClick: handlers.onRefreshRepositories }, t('common.retry')),
    })
  }
  if (timeline.loading) return h(SkeletonRows, { rows: 6 })
  if (timeline.error !== null) {
    return h(EmptyState, {
      icon: IconError,
      tone: 'error',
      title: t('state.error.title'),
      hint: F.errorMessage(timeline.error, t),
      actions: h('button', { type: 'button', className: 'dvt-btn dvt-btn-sm', onClick: handlers.onRetryTimeline }, t('common.retry')),
    })
  }

  const rows = view.visibleEvents
  const fileFilterActive = state.filters.treeQuery.trim() !== '' || state.filters.fileStatus !== 'all'
  const visiblePaths = fileFilterActive ? new Set(view.visibleFiles.map((entry) => entry.path)) : null
  const header = view.selected === null
    ? null
    : h(SelectionHeader, {
      path: view.selected.path,
      status: view.selected.status,
      count: rows.length,
      deps,
      handlers,
    })

  if (rows.length === 0) {
    if (view.selected !== null) {
      return h('div', { className: 'dvt-col' },
        header,
        h(EmptyState, {
          icon: IconTimeline,
          title: t('timeline.empty.file'),
          hint: t('timeline.empty.file.hint'),
          actions: h('button', { type: 'button', className: 'dvt-btn dvt-btn-sm', onClick: () => handlers.onSelectFile(null) }, t('tree.showAll')),
        }),
      )
    }
    if (hasActiveFilters(state)) {
      return h(EmptyState, {
        icon: IconTimeline,
        title: t('timeline.empty.filtered'),
        hint: t('timeline.filters.active'),
        actions: h('button', { type: 'button', className: 'dvt-btn dvt-btn-sm', onClick: handlers.onClearFilters }, t('filter.clear')),
      })
    }
    if (isUninitializedHistory(state, repository)) {
      return h(EmptyState, {
        icon: IconBranch,
        title: t('timeline.empty.uninitialized'),
        hint: t('timeline.empty.uninitialized.hint'),
        actions: h('button', { type: 'button', className: 'dvt-btn dvt-btn-sm', onClick: handlers.onRefreshRepositories }, t('common.refresh')),
      })
    }
    return h(EmptyState, {
      icon: IconTimeline,
      title: t('timeline.empty'),
      hint: t('common.retryHint'),
      actions: h('button', { type: 'button', className: 'dvt-btn dvt-btn-sm', onClick: handlers.onRefreshRepositories }, t('common.refresh')),
    })
  }

  const now = Date.now()
  const groups = groupEventsByDay(rows)
  return h('div', { className: 'dvt-col dvt-timeline-col' },
    timeline.partial
      ? h(Banner, {
        kind: 'warn',
        title: t('state.partial.title'),
        text: timeline.warnings[0] === undefined
          ? t('timeline.partial')
          : t('timeline.partial.detail', { detail: timeline.warnings[0] }),
      })
      : null,
    header,
    view.filesReported && view.files.length === 0 && timeline.events.length > 0
      ? h(Banner, { kind: 'info', text: t('timeline.noFilesNotice') })
      : null,
    h('div', { className: 'dvt-tl', role: 'list', 'aria-label': t('source.timeline') },
      groups.map((group) => h('section', { key: group.key, className: 'dvt-tl-group' },
        h(DayHeader, { group, deps, now }),
        h('ul', { className: 'dvt-tl-list' },
          group.events.map((event) => h(TimelineRow, {
            key: event.id,
            event,
            deps,
            handlers,
            selectedPath: state.selectedFilePath,
            visiblePaths,
            headRevision: repository.currentRevision,
            now,
          })),
        ),
      )),
    ),
    h('div', { className: 'dvt-list-count' },
      view.selected === null
        ? t('timeline.count.label', { count: rows.length })
        : t('timeline.filteredCount', { count: rows.length, total: timeline.events.length }),
    ),
    timeline.hasMore
      ? h('div', { className: 'dvt-list-more' },
        h('button', {
          type: 'button',
          className: 'dvt-btn dvt-btn-sm',
          disabled: timeline.loadingMore,
          onClick: handlers.onLoadMoreTimeline,
        }, timeline.loadingMore ? t('common.loadingMore') : t('timeline.more')),
      )
      : null,
    timeline.hasMore
      ? h('div', { className: 'dvt-list-window' }, t('timeline.windowNotice', { count: timeline.events.length }))
      : null,
  )
}
