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
import type { FileChangeStatus, OperationAttempt, VcsEvent } from '../../shared/contracts.ts'
import * as F from '../format.ts'
import type { DayGroup, TimelineView } from '../file-index.ts'
import { groupEventsByDay } from '../file-index.ts'
import type { GraphModel, GraphRow } from '../graph.ts'
import { renderGraphGutter } from './graph.ts'
import type { PanelDeps, PanelHandlers, PanelState } from '../types.ts'
import {
  IconAudit,
  IconBranch,
  IconCheck,
  IconClock,
  IconClose,
  IconError,
  IconFile,
  IconRepo,
  IconTimeline,
  IconWarning,
} from './icons.ts'
import {
  Banner,
  DotSep,
  EmptyState,
  fileCountLabel,
  IconButton,
  LineStats,
  SkeletonRows,
  StateBadge,
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
function DayHeader(props: { group: DayGroup; audits: number; deps: PanelDeps; now: number }): React.ReactElement {
  const { group, audits, deps, now } = props
  const label = F.dayLabel(group.timestamp, deps.locale, new Date(now))
  const text = label.kind === 'today'
    ? deps.t('group.today')
    : label.kind === 'yesterday'
      ? deps.t('group.yesterday')
      : label.text
  return h('div', { className: 'dvt-tl-day' },
    h('span', { className: 'dvt-tl-day-label' }, text),
    group.events.length > 0
      ? h('span', { className: 'dvt-tl-day-count' }, deps.t('timeline.count.label', { count: group.events.length }))
      : null,
    audits > 0
      ? h('span', { className: 'dvt-tl-day-audit' }, deps.t('timeline.audit.count', { count: audits }))
      : null,
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
  /** Lane placement of this commit on the page graph. */
  graphRow: GraphRow | null
  /** Total lanes on the page, so every gutter keeps one width. */
  graphLanes: number
  /** Where this commit came from when the session/audit facts allow saying so. */
  attribution: 'audit' | 'inferred' | null
  now: number
}): React.ReactElement {
  const { event, deps, handlers, selectedPath, visiblePaths, headRevision, graphRow, graphLanes, attribution, now } = props
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
    graphRow === null
      ? h('span', { className: 'dvt-tl-graph', 'aria-hidden': 'true' })
      : renderGraphGutter({ row: graphRow, lanes: graphLanes }),
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
      // A detached HEAD reports the literal pseudo-branch "HEAD"; the HEAD
      // marker already says that, so the tag would duplicate it.
      event.branch === undefined || event.branch === '' || event.branch === 'HEAD'
        ? null
        : h('span', {
          className: 'dvt-tag dvt-tl-branch dvt-branch-btn',
          role: 'button',
          tabIndex: 0,
          title: t('timeline.filterBranch', { branch: event.branch }),
          'aria-label': t('timeline.filterBranch', { branch: event.branch }),
          onClick: (clickEvent: React.MouseEvent) => {
            clickEvent.stopPropagation()
            handlers.onSelectBranch(event.branch as string)
          },
          onKeyDown: (keyEvent: React.KeyboardEvent) => {
            if (keyEvent.key !== 'Enter' && keyEvent.key !== ' ') return
            keyEvent.preventDefault()
            keyEvent.stopPropagation()
            handlers.onSelectBranch(event.branch as string)
          },
        },
        h(IconBranch, { size: 9 }),
        h('span', null, F.truncate(event.branch, 22)),
        ),
      attribution === null
        ? null
        : h('span', {
          className: `dvt-tag ${attribution === 'audit' ? 'dvt-tag-attrib' : 'dvt-tag-inferred'}`,
          title: t(`timeline.attribution.${attribution}.hint`),
        }, t(`timeline.attribution.${attribution}`)),
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

/** Icon for one audit state on an interleaved operation node. */
function auditIcon(state: OperationAttempt['state']): typeof IconAudit {
  if (state === 'succeeded') return IconCheck
  if (state === 'failed') return IconError
  if (state === 'unknown' || state === 'partial') return IconWarning
  return IconAudit
}

/**
 * One plugin-audit node interleaved into the timeline.
 *
 * It is deliberately a different shape from a commit row (audit icon on the
 * rail, an operation title and a state badge) and never joins the commit
 * count. Clicking it opens the audit detail beside the list.
 */
function AuditNode(props: { attempt: OperationAttempt; deps: PanelDeps; handlers: PanelHandlers }): React.ReactElement {
  const { attempt, deps, handlers } = props
  const { t } = deps
  const Icon = auditIcon(attempt.state)
  const when = whenLabel(attempt.startedAt, deps, Date.now())
  return h('li', { className: 'dvt-tl-row dvt-tl-audit-li' },
    h('span', { className: 'dvt-tl-graph dvt-tl-audit-rail', 'aria-hidden': 'true' },
      h(Icon, { size: 10 }),
    ),
    h('button', {
      type: 'button',
      className: 'dvt-tl-card dvt-tl-audit-card',
      title: `${attempt.requestSummary}\n${F.formatTime(attempt.startedAt, deps.locale)}`,
      'aria-label': t('aria.auditRow', { label: F.operationLabel(attempt.operation, t) }),
      onClick: () => handlers.onOpenOperation(attempt),
    },
    h('span', { className: 'dvt-tl-top' },
      h('span', { className: 'dvt-tl-audit-icon' }, h(Icon, { size: 12 })),
      h('span', { className: 'dvt-tl-summary' },
        `${t('timeline.audit.node')} · ${F.operationLabel(attempt.operation, t)}`,
      ),
      h(StateBadge, { state: attempt.state, t }),
    ),
    h('span', { className: 'dvt-tl-meta' },
      h('span', { className: 'dvt-tl-when' }, h(IconClock, { size: 10 }), h('span', null, when)),
      h(DotSep),
      h('span', { className: 'dvt-tl-hash dvt-mono' },
        F.shortHash(attempt.correlationId.replace(/^corr-/, ''), 8)),
      h('span', { className: 'dvt-tag dvt-tag-attrib', title: t('timeline.audit.sourceHint') },
        t('timeline.audit.source')),
      ),
    ),
  )
}

/** 26px bar naming the file the right pane is narrowed to. */
function SelectionHeader(props: {
  path: string
  status: FileChangeStatus
  count: number
  /** Newest change of this file in the loaded window. */
  latest?: { author: string; when: string }
  /** Distinct authors that changed this file in the loaded window. */
  authorCount: number
  deps: PanelDeps
  handlers: PanelHandlers
}): React.ReactElement {
  const { path, status, count, latest, authorCount, deps, handlers } = props
  const { t } = deps
  const { dir, name } = F.splitRepoPath(path)
  return h('div', { className: 'dvt-selection' },
    h('span', { className: `dvt-file-status dvt-status-${status}`, 'aria-hidden': 'true' },
      F.statusLetter(status)),
    h('span', { className: 'dvt-selection-path dvt-mono', title: path },
      dir === '' ? null : h('span', { className: 'dvt-file-dir' }, dir),
      h('span', { className: 'dvt-selection-name' }, name),
    ),
    latest === undefined
      ? null
      : h('span', { className: 'dvt-selection-meta dvt-selection-who', title: t('file.whoTitle') },
        h('span', null, t('file.latestBy', { author: latest.author, when: latest.when })),
        authorCount > 0 ? h('span', { className: 'dvt-selection-authors' }, t('file.authors', { count: authorCount })) : null,
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
  graph: GraphModel,
): React.ReactElement {
  const { t } = deps
  const repository = selectedRepository(state)
  const timeline = state.timeline
  const now = Date.now()

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
    const actions = h(React.Fragment, null,
      h('button', { type: 'button', className: 'dvt-btn dvt-btn-sm dvt-btn-primary', onClick: handlers.onToggleAddRepository }, t('addRepo.title')),
      h('button', { type: 'button', className: 'dvt-btn dvt-btn-sm', onClick: handlers.onRefreshRepositories }, t('common.refresh')),
    )
    if (state.noWorkspace) {
      return h(EmptyState, {
        icon: IconRepo,
        title: t('state.noWorkspace.title'),
        hint: t('state.noWorkspace.hint'),
        actions,
      })
    }
    return h(EmptyState, {
      icon: IconRepo,
      title: t('state.noRepositories.title'),
      hint: t('state.noRepositories.hint'),
      actions,
    })
  }
  const tool = missingTool(state, repository)
  if (tool !== null) {
    return h(EmptyState, {
      icon: IconError,
      tone: 'error',
      title: t('state.missingTool', { vcs: tool === 'git' ? 'Git' : 'SVN', tool: tool === 'git' ? 'Git' : 'SVN' }),
      hint: tool === 'svn' ? t('addRepo.svnHint') : t('error.vcs-not-installed'),
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
  const graphRowById = new Map(graph.rows.map((entry) => [entry.id, entry]))
  const latest = rows[0]
  const latestRelative = latest === undefined ? null : F.relativeTime(latest.timestamp, now)
  const latestWhen = latest === undefined
    ? ''
    : latestRelative === null
      ? F.formatCompactTime(latest.timestamp, deps.locale)
      : latestRelative.unit === 'justNow'
        ? t('rel.justNow')
        : latestRelative.unit === 'minutes'
          ? t('rel.minutesAgo', { count: latestRelative.count })
          : latestRelative.unit === 'hours'
            ? t('rel.hoursAgo', { count: latestRelative.count })
            : t('rel.daysAgo', { count: latestRelative.count })
  const authorSet = new Set<string>()
  for (const entry of rows) if (typeof entry.actor === 'string' && entry.actor !== '') authorSet.add(entry.actor)
  const header = view.selected === null
    ? null
    : h(SelectionHeader, {
      path: view.selected.path,
      status: view.selected.status,
      count: rows.length,
      ...(latest === undefined || latest.actor === undefined || latest.actor === ''
        ? {}
        : { latest: { author: latest.actor, when: latestWhen } }),
      authorCount: authorSet.size,
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

  // Session/audit attribution: exact only when the plugin's own commit audit
  // records this hash; a session-touched file set makes it an inference. Both
  // are labelled in the row, and neither changes any count.
  const auditedCommits = new Set<string>()
  for (const attempt of state.audit.operations) {
    if (attempt.operation === 'commit'
      && typeof attempt.afterRevision === 'string'
      && attempt.afterRevision !== '') {
      auditedCommits.add(attempt.afterRevision)
    }
  }
  const session = state.pending.session
  const sessionPaths = session !== null && session.available === true
    ? new Set(session.files.map((file) => file.path))
    : null
  const attributionOf = (event: VcsEvent): 'audit' | 'inferred' | null => {
    if (event.commitHash !== undefined && event.commitHash !== '' && auditedCommits.has(event.commitHash)) {
      return 'audit'
    }
    if (sessionPaths === null || sessionPaths.size === 0) return null
    const files = Array.isArray(event.changedFiles) ? event.changedFiles : []
    if (files.length === 0) return null
    return files.every((file) => sessionPaths.has(file.path)) ? 'inferred' : null
  }
  const commitRow = (event: VcsEvent): React.ReactElement => h(TimelineRow, {
    key: event.id,
    event,
    deps,
    handlers,
    selectedPath: state.selectedFilePath,
    visiblePaths,
    headRevision: repository.currentRevision,
    graphRow: graphRowById.get(event.id) ?? null,
    graphLanes: graph.lanes,
    attribution: attributionOf(event),
    now,
  })

  // Interleave plugin-audit nodes with commit rows only when asked. The nodes
  // keep their own icon/badge and never join `timeline.events`, so the commit
  // count and the graph describe commits only.
  const showAudit = state.filters.auditInTimeline && state.source === 'timeline'
  let listBody: React.ReactElement
  if (!showAudit) {
    listBody = h(React.Fragment, null, groupEventsByDay(rows).map((group) => h('section', {
      key: group.key,
      className: 'dvt-tl-group',
    },
    h(DayHeader, { group, audits: 0, deps, now }),
    h('ul', { className: 'dvt-tl-list' }, group.events.map((event) => commitRow(event))),
    )))
  } else {
    interface MergedGroup {
      key: string
      timestamp: string
      commits: VcsEvent[]
      audits: OperationAttempt[]
      entries: Array<{ kind: 'commit'; event: VcsEvent } | { kind: 'audit'; attempt: OperationAttempt }>
    }
    const byDay = new Map<string, MergedGroup>()
    const push = (timestamp: string, add: (group: MergedGroup) => void): void => {
      const key = F.localDayKey(timestamp) ?? 'unknown'
      let group = byDay.get(key)
      if (group === undefined) {
        group = { key, timestamp, commits: [], audits: [], entries: [] }
        byDay.set(key, group)
      }
      add(group)
    }
    for (const event of rows) {
      push(event.timestamp, (group) => {
        group.commits.push(event)
        group.entries.push({ kind: 'commit', event })
      })
    }
    for (const attempt of state.audit.operations) {
      push(attempt.startedAt, (group) => {
        group.audits.push(attempt)
        group.entries.push({ kind: 'audit', attempt })
      })
    }
    const merged = [...byDay.values()].sort(
      (a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0),
    )
    listBody = h(React.Fragment, null, merged.map((group) => h('section', {
      key: group.key,
      className: 'dvt-tl-group',
    },
    h(DayHeader, {
      group: { key: group.key, timestamp: group.timestamp, events: group.commits },
      audits: group.audits.length,
      deps,
      now,
    }),
    h('ul', { className: 'dvt-tl-list' },
      group.entries
        .sort((a, b) => {
          const left = a.kind === 'commit' ? Date.parse(a.event.timestamp) : Date.parse(a.attempt.startedAt)
          const right = b.kind === 'commit' ? Date.parse(b.event.timestamp) : Date.parse(b.attempt.startedAt)
          return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0)
        })
        .map((entry) => entry.kind === 'commit'
          ? commitRow(entry.event)
          : h(AuditNode, { key: entry.attempt.id, attempt: entry.attempt, deps, handlers })),
    ),
    )))
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
    showAudit
      ? h(Banner, { kind: 'info', text: t('timeline.audit.notice') })
      : null,
    view.filesReported && view.files.length === 0 && timeline.events.length > 0
      ? h(Banner, { kind: 'info', text: t('timeline.noFilesNotice') })
      : null,
    h('div', { className: 'dvt-tl', role: 'list', 'aria-label': t('source.timeline') },
      listBody,
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
