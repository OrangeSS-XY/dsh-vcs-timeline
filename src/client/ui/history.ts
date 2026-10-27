/**
 * Commit-history list: graph gutter, summary line, real per-commit stats, and
 * every empty/loading/error/partial variant the panel must distinguish.
 * @module dsh-vcs-timeline/client/ui/history
 */

import * as React from 'react'
import type { VcsEvent } from '../../shared/contracts.ts'
import * as F from '../format.ts'
import type { PanelDeps, PanelHandlers, PanelState } from '../types.ts'
import { IconBranch, IconError, IconRepo, IconTimeline } from './icons.ts'
import {
  Banner,
  DotSep,
  EmptyState,
  fileCountLabel,
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

/** One commit row. */
function CommitRow(props: {
  event: VcsEvent
  deps: PanelDeps
  handlers: PanelHandlers
}): React.ReactElement {
  const { event, deps, handlers } = props
  const { t } = deps
  const merge = F.isMergeCommit(event)
  const hash = F.shortHash(event.commitHash, 7)
  const revision = revisionLabel(event)
  const time = F.formatCompactTime(event.timestamp, deps.locale)
  const stats = F.eventStats(event)
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
        h(LineStats, {
          ...(stats.additions === undefined ? {} : { additions: stats.additions }),
          ...(stats.deletions === undefined ? {} : { deletions: stats.deletions }),
          t,
        }),
      ),
      h('span', { className: 'dvt-commit-bottom' },
        hash === '' ? null : h('span', { className: `dvt-hash dvt-mono` }, hash),
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
        stats.files === undefined
          ? null
          : h('span', { className: 'dvt-stat-files', title: t('aria.stats') }, fileCountLabel(stats.files, t)),
      ),
    ),
    ),
  )
}

/** The history body for the selected repository. */
export function renderHistory(state: PanelState, deps: PanelDeps, handlers: PanelHandlers): React.ReactElement {
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

  if (timeline.events.length === 0) {
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

  return h('div', { className: 'dvt-col' },
    timeline.partial
      ? h(Banner, {
        kind: 'warn',
        title: t('state.partial.title'),
        text: timeline.warnings[0] === undefined
          ? t('timeline.partial')
          : t('timeline.partial.detail', { detail: timeline.warnings[0] }),
      })
      : null,
    h('ul', { className: 'dvt-list', 'aria-label': t('source.timeline') },
      timeline.events.map((event) => h(CommitRow, { key: event.id, event, deps, handlers })),
    ),
    h('div', { className: 'dvt-list-count' }, t('timeline.count.label', { count: timeline.events.length })),
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
  )
}
