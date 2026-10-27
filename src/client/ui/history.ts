/**
 * dsh-vcs-timeline — change timeline list (right column).
 *
 * Rows are grouped per commit and filtered by the same state as the file tree:
 * a selected file narrows every row to that path and shows its per-commit
 * status and line counts; the tree's search/status filters narrow the rows
 * through {@link TimelineView.visibleEvents}. Nothing here invents a file
 * count or a `+0/−0` statistic.
 * @module dsh-vcs-timeline/client/ui/history
 */

import * as React from 'react'
import type { FileChangeStatus, VcsEvent } from '../../shared/contracts.ts'
import * as F from '../format.ts'
import type { TimelineView } from '../file-index.ts'
import type { PanelDeps, PanelHandlers, PanelState } from '../types.ts'
import { IconBranch, IconClose, IconError, IconFile, IconRepo, IconTimeline } from './icons.ts'
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

/** One commit row, optionally narrowed to the selected file. */
function CommitRow(props: {
  event: VcsEvent
  deps: PanelDeps
  handlers: PanelHandlers
  selectedPath: string | null
  /** Visible file paths when a client-side file filter is active. */
  visiblePaths: ReadonlySet<string> | null
}): React.ReactElement {
  const { event, deps, handlers, selectedPath, visiblePaths } = props
  const { t } = deps
  const merge = F.isMergeCommit(event)
  const hash = F.shortHash(event.commitHash, 7)
  const revision = revisionLabel(event)
  const time = F.formatCompactTime(event.timestamp, deps.locale)
  const stats = F.eventStats(event)
  const narrow = selectedPath === null ? null : selectedFileOf(event, selectedPath)
  const matched = selectedPath !== null || visiblePaths === null
    ? null
    : (Array.isArray(event.changedFiles) ? event.changedFiles : []).filter((file) => visiblePaths.has(file.path)).length
  const label = t('aria.timelineRow', {
    revision: revision === '' ? event.id : revision,
    summary: F.truncate(event.summary, 80),
  })
  return h('li', { className: 'dvt-commit' },
    h('button', {
      type: 'button',
      className: 'dvt-commit-btn',
      'aria-label': label,
      title: event.summary,
      onClick: () => handlers.onOpenEvent(event),
    },
    h('span', { className: 'dvt-graph', 'aria-hidden': 'true' },
      h('span', { className: `dvt-node${merge ? ' dvt-node-merge' : ''}` }),
    ),
    h('span', { className: 'dvt-commit-body' },
      h('span', { className: 'dvt-commit-top' },
        h('span', { className: 'dvt-summary' }, F.truncate(event.summary, 200) === '' ? t('timeline.noRevision') : F.truncate(event.summary, 200)),
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
      h('span', { className: 'dvt-commit-bottom' },
        hash === '' ? null : h('span', { className: 'dvt-hash dvt-mono' }, hash),
        hash === '' ? null : h(DotSep),
        event.actor === undefined || event.actor === ''
          ? null
          : h('span', { className: 'dvt-author', title: event.actor }, event.actor),
        event.actor === undefined || event.actor === '' ? null : h(DotSep),
        time === '' ? null : h('span', { className: 'dvt-time', title: F.formatTime(event.timestamp, deps.locale) }, time),
        merge
          ? h('span', { className: 'dvt-tag dvt-tag-merge', title: t('timeline.merge') }, t('timeline.merge'))
          : null,
        event.branch === undefined || event.branch === ''
          ? null
          : h('span', { className: 'dvt-tag', title: event.branch },
            h(IconBranch, { size: 9 }),
            h('span', null, F.truncate(event.branch, 20)),
          ),
        narrow === null
          ? null
          : h('span', {
            className: `dvt-file-status dvt-status-${narrow.status}`,
            title: t('aria.fileStatus'),
          }, narrow.letter),
        matched === null || matched === 0
          ? null
          : h('span', { className: 'dvt-stat-files', title: t('aria.stats') }, t('timeline.matchedFiles', { count: matched })),
        narrow === null && stats.files !== undefined && visiblePaths === null
          ? h('span', { className: 'dvt-stat-files', title: t('aria.stats') }, fileCountLabel(stats.files, t))
          : null,
        narrow !== null && narrow.binary
          ? h('span', { className: 'dvt-bin', title: t('diff.binary') }, 'BIN')
          : null,
      ),
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
    h('ul', { className: 'dvt-list', 'aria-label': t('source.timeline') },
      rows.map((event) => h(CommitRow, {
        key: event.id,
        event,
        deps,
        handlers,
        selectedPath: state.selectedFilePath,
        visiblePaths,
      })),
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
