/**
 * dsh-vcs-timeline — presentational panel views.
 *
 * Pure functions of `(state, deps, handlers)`: no effects, no fetch, no
 * timers. That keeps them renderable with `react-dom/server` in tests and
 * makes every state explicit instead of inferred from component internals.
 * @module dsh-vcs-timeline/client/components
 */

import * as React from 'react'
import type {
  ApiError,
  ChangedFile,
  OperationAttempt,
  OperationType,
  Repository,
  VcsEvent,
  VcsType,
} from '../shared/contracts.ts'
import * as F from './format.ts'
import type { TranslateFn } from './i18n.ts'
import { STYLES } from './styles.ts'
import type {
  DialogState,
  PanelDeps,
  PanelHandlers,
  PanelState,
  PanelViewProps,
} from './types.ts'

const h = React.createElement

/** Write operations offered for one VCS type. */
const WRITE_OPERATIONS: Record<VcsType, OperationType[]> = {
  git: ['fetch', 'pull', 'push'],
  svn: ['update', 'commit'],
}

/** Whether any timeline filter is narrowing the result. */
function hasActiveFilters(state: PanelState): boolean {
  return state.filters.debouncedText.trim() !== ''
    || state.filters.eventTypes.length > 0
    || state.filters.author.trim() !== ''
}

/** Selected repository, if any. */
function selectedRepository(state: PanelState): Repository | null {
  if (state.selectedRepositoryId === null) return null
  return state.repositories.find((repository) => repository.id === state.selectedRepositoryId) ?? null
}

/** The VCS type whose client is missing for the selected repository, if any. */
function missingTool(state: PanelState, repository: Repository | null): VcsType | null {
  if (repository === null || state.diagnostics === null) return null
  if (repository.vcsType === 'git' && state.diagnostics.gitVersion === null) return 'git'
  if (repository.vcsType === 'svn' && state.diagnostics.svnVersion === null) return 'svn'
  return null
}

/** Localized display name of one VCS type. */
function vcsLabel(vcsType: VcsType, t: TranslateFn): string {
  return vcsType === 'git' ? t('footer.git') : t('footer.svn')
}

/** One inline banner with an optional action. */
function notice(
  kind: 'info' | 'warn' | 'error',
  title: string,
  body?: string | null,
  action?: React.ReactElement | null,
  key?: string,
): React.ReactElement {
  return h('div', { key, className: `dvt-banner dvt-banner-${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    h('div', { className: 'dvt-banner-title' }, title),
    body !== undefined && body !== null && body !== '' ? h('div', { className: 'dvt-break' }, body) : null,
    action ?? null,
  )
}

/** Error banner built from one stable API error code. */
function errorNotice(
  t: TranslateFn,
  error: ApiError | null | undefined,
  onRetry?: () => void,
  key?: string,
): React.ReactElement {
  const message = F.errorMessage(error, t)
  const code = error !== null && error !== undefined ? error.code : 'internal'
  const action = onRetry === undefined
    ? null
    : h('div', { className: 'dvt-row' },
      h('button', { type: 'button', className: 'dvt-btn', onClick: onRetry }, t('common.retry')),
    )
  return h('div', { key, className: 'dvt-banner dvt-banner-error', role: 'alert' },
    h('div', { className: 'dvt-banner-title' }, t('common.error')),
    h('div', { className: 'dvt-break' }, message),
    h('div', { className: 'dvt-error-code dvt-mono' }, code),
    action,
  )
}

/** Loading skeleton rows. */
function skeleton(key?: string): React.ReactElement {
  return h('div', { key, className: 'dvt-skeleton', 'aria-busy': 'true' },
    h('div', { className: 'dvt-skeleton-row' }),
    h('div', { className: 'dvt-skeleton-row' }),
    h('div', { className: 'dvt-skeleton-row' }),
  )
}

/** Centered empty state. */
function emptyBox(message: string, hint?: string | null, key?: string): React.ReactElement {
  return h('div', { key, className: 'dvt-empty' },
    h('div', null, message),
    hint !== undefined && hint !== null && hint !== '' ? h('div', { className: 'dvt-faint' }, hint) : null,
  )
}

/** Small source badge that keeps repository and audit facts visually distinct. */
function sourceBadge(source: VcsEvent['source'], t: TranslateFn): React.ReactElement {
  return h('span', { className: `dvt-badge dvt-badge-source-${source}` }, F.sourceLabel(source, t))
}

/** Operation state badge: text plus token color, never color alone. */
function stateBadge(state: OperationAttempt['state'], t: TranslateFn): React.ReactElement {
  const tone = state === 'succeeded'
    ? 'success'
    : state === 'failed'
      ? 'error'
      : state === 'unknown' || state === 'partial'
        ? 'warn'
        : ''
  return h('span', { className: `dvt-badge${tone === '' ? '' : ` dvt-badge-${tone}`}` },
    F.operationStateLabel(state, t),
  )
}

/** One repository option label including the branch/revision hint. */
function repositoryOption(repository: Repository): string {
  return F.repositoryOptionLabel(repository)
}

/** Repository picker, refresh control, and the source tabs. */
function renderHeader(state: PanelState, t: TranslateFn, handlers: PanelHandlers): React.ReactElement {
  const repository = selectedRepository(state)
  const hint = repository === null
    ? null
    : repository.currentBranch !== undefined && repository.currentBranch !== ''
      ? t('repo.branchLabel', { branch: repository.currentBranch })
      : repository.currentRevision !== undefined && repository.currentRevision !== ''
        ? t('repo.revisionLabel', { revision: F.shortHash(repository.currentRevision, 8) })
        : null
  return h('div', { className: 'dvt-col' },
    h('div', { className: 'dvt-row' },
      h('label', { className: 'dvt-sr-only', htmlFor: 'dvt-repository-select' }, t('aria.repository')),
      h('select', {
        id: 'dvt-repository-select',
        className: 'dvt-select dvt-grow',
        value: state.selectedRepositoryId ?? '',
        'aria-label': t('aria.repository'),
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) => handlers.onSelectRepository(event.currentTarget.value),
      },
      state.repositories.length === 0
        ? h('option', { value: '' }, t('repo.select'))
        : state.repositories.map((entry) => h('option', { key: entry.id, value: entry.id }, repositoryOption(entry))),
      ),
      h('button', {
        type: 'button',
        className: 'dvt-icon-btn',
        onClick: handlers.onRefreshRepositories,
        disabled: state.boot === 'loading',
        'aria-label': t('aria.refresh'),
        title: t('aria.refresh'),
      }, '⟳'),
    ),
    hint === null
      ? null
      : h('div', { className: 'dvt-row dvt-faint dvt-clip', title: repository?.rootPath ?? '' }, hint),
    h('div', { className: 'dvt-tabs', role: 'tablist', 'aria-label': t('tab.title') },
      h('button', {
        type: 'button',
        role: 'tab',
        className: 'dvt-tab',
        'aria-selected': state.source === 'timeline',
        onClick: () => handlers.onSetSource('timeline'),
      }, t('source.timeline')),
      h('button', {
        type: 'button',
        role: 'tab',
        className: 'dvt-tab',
        'aria-selected': state.source === 'audit',
        onClick: () => handlers.onSetSource('audit'),
      }, t('source.audit')),
    ),
  )
}

/** Search box, event-type chips, and the optional author row. */
function renderFilters(state: PanelState, t: TranslateFn, handlers: PanelHandlers): React.ReactElement {
  const commitOnly = state.filters.eventTypes.includes('commit')
  const active = hasActiveFilters(state)
  return h('div', { className: 'dvt-col' },
    h('div', { className: 'dvt-row' },
      h('input', {
        className: 'dvt-input dvt-grow',
        type: 'search',
        value: state.filters.text,
        placeholder: t('filter.search.placeholder'),
        'aria-label': t('aria.search'),
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => handlers.onTextChange(event.currentTarget.value),
      }),
      h('button', {
        type: 'button',
        className: 'dvt-chip',
        'aria-pressed': state.filters.showAuthor,
        'aria-label': t('aria.toggleFilters'),
        title: t('filter.toggle'),
        onClick: handlers.onToggleAuthor,
      }, t('filter.toggle')),
    ),
    h('div', { className: 'dvt-row-wrap' },
      h('button', {
        type: 'button',
        className: 'dvt-chip',
        'aria-pressed': !commitOnly,
        onClick: handlers.onShowAllEventTypes,
      }, t('filter.chip.all')),
      h('button', {
        type: 'button',
        className: 'dvt-chip',
        'aria-pressed': commitOnly,
        onClick: () => handlers.onToggleEventType('commit'),
      }, t('filter.chip.commit')),
      active
        ? h('button', { type: 'button', className: 'dvt-btn', onClick: handlers.onClearFilters }, t('filter.clear'))
        : null,
    ),
    state.filters.showAuthor
      ? h('div', { className: 'dvt-row' },
        h('label', { className: 'dvt-sr-only', htmlFor: 'dvt-author-filter' }, t('filter.author')),
        h('input', {
          id: 'dvt-author-filter',
          className: 'dvt-input dvt-grow',
          type: 'text',
          value: state.filters.author,
          placeholder: t('filter.author.placeholder'),
          'aria-label': t('aria.author'),
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => handlers.onAuthorChange(event.currentTarget.value),
        }),
      )
      : null,
  )
}

/** Write-operation bar for the selected repository. */
function renderOperationBar(repository: Repository, t: TranslateFn, handlers: PanelHandlers): React.ReactElement {
  const operations = WRITE_OPERATIONS[repository.vcsType]
  return h('div', { className: 'dvt-card' },
    h('div', { className: 'dvt-row' },
      h('span', { className: 'dvt-section-title dvt-grow' }, t('op.bar.title')),
      h('span', { className: 'dvt-faint dvt-clip', title: t('op.neverRetry') }, t('op.neverRetry')),
    ),
    h('div', { className: 'dvt-opbar' }, operations.map((operation) => h('button', {
      key: operation,
      type: 'button',
      className: 'dvt-btn',
      onClick: () => handlers.onStartOperation(operation),
    }, t(`op.${operation}`)))),
  )
}

/** One timeline row. */
function timelineRow(event: VcsEvent, locale: string, t: TranslateFn, handlers: PanelHandlers): React.ReactElement {
  const revision = event.revision ?? event.commitHash ?? ''
  const label = revision === '' ? event.id : F.shortHash(revision, 8)
  const meta: string[] = []
  if (revision !== '') meta.push(F.shortHash(revision, 7))
  if (event.eventType !== 'commit') meta.push(F.eventTypeLabel(event.eventType, t))
  if (event.actor !== undefined && event.actor !== '') meta.push(event.actor)
  const time = F.formatTime(event.timestamp, locale)
  if (time !== '') meta.push(time)
  return h('li', { key: event.id, className: 'dvt-list-item' },
    h('button', {
      type: 'button',
      className: 'dvt-row-btn',
      title: event.summary,
      onClick: () => handlers.onOpenEvent(event),
    },
    h('span', { className: 'dvt-row-main' },
      h('span', { className: 'dvt-glyph', 'aria-hidden': 'true' }, F.typeGlyph(event.eventType)),
      h('span', { className: 'dvt-row-summary', title: event.summary }, F.truncate(event.summary, 200)),
      sourceBadge(event.source, t),
    ),
    h('span', { className: 'dvt-row-meta' },
      meta.map((entry, index) => h('span', { key: `meta-${index}` }, entry)),
      h('span', { key: 'label', className: 'dvt-sr-only' }, label),
    ),
    ),
  )
}

/** Timeline list with every required state. */
function renderTimeline(state: PanelState, locale: string, t: TranslateFn, handlers: PanelHandlers): React.ReactElement {
  const timeline = state.timeline
  const repository = selectedRepository(state)
  if (state.boot === 'loading') return skeleton('timeline-loading')
  if (state.boot === 'error') {
    return h('div', { className: 'dvt-col' },
      errorNotice(t, state.bootError, handlers.onRefreshRepositories),
      notice('info', t('error.hostUnavailable'), null, null),
    )
  }
  if (repository === null) {
    return emptyBox(t('repo.empty'), t('repo.empty.next'))
  }
  const tool = missingTool(state, repository)
  if (tool !== null) {
    const label = vcsLabel(tool, t)
    return notice('error', t('common.error'), t('state.missingTool', { vcs: label, tool: label }), null)
  }
  if (timeline.loading) return skeleton('timeline-loading')
  if (timeline.error !== null) return errorNotice(t, timeline.error, handlers.onRetryTimeline)
  return h('div', { className: 'dvt-col' },
    timeline.partial ? notice('warn', t('common.warning'), t('timeline.partial'), null) : null,
    timeline.events.length === 0
      ? emptyBox(hasActiveFilters(state) ? t('timeline.empty.filtered') : t('timeline.empty'))
      : h('div', { className: 'dvt-col' },
        h('div', { className: 'dvt-row dvt-faint' },
          h('span', { className: 'dvt-grow' }, F.truncate(t('timeline.count', { count: timeline.events.length }), 80)),
        ),
        h('ul', { className: 'dvt-list' }, timeline.events.map((event) => timelineRow(event, locale, t, handlers))),
      ),
    timeline.hasMore
      ? h('button', {
        type: 'button',
        className: 'dvt-btn',
        disabled: timeline.loadingMore,
        onClick: handlers.onLoadMoreTimeline,
      }, timeline.loadingMore ? t('common.loadingMore') : t('timeline.more'))
      : null,
  )
}

/** One changed-file row. */
function fileRow(file: ChangedFile, index: number, t: TranslateFn, handlers: PanelHandlers): React.ReactElement {
  const additions = file.additions ?? 0
  const deletions = file.deletions ?? 0
  return h('button', {
    key: `${file.path}:${index}`,
    type: 'button',
    className: 'dvt-file-row',
    title: file.path,
    onClick: () => handlers.onOpenFile(file.path),
  },
  h('span', { className: `dvt-file-status dvt-file-status-${file.status}` }, F.statusLetter(file.status)),
  h('span', { className: 'dvt-sr-only' }, F.statusLabel(file.status, t)),
  h('span', { className: 'dvt-file-path' },
    file.oldPath !== undefined && file.oldPath !== ''
      ? h('span', { className: 'dvt-faint' }, `${file.oldPath} → `)
      : null,
    file.path,
  ),
  h('span', { className: 'dvt-file-counts' },
    additions > 0 ? h('span', null, t('detail.additions', { count: additions })) : null,
    deletions > 0 ? h('span', null, t('detail.deletions', { count: deletions })) : null,
    file.binary === true ? h('span', null, 'bin') : null,
  ),
  )
}

/** Metadata grid of one event. */
function renderMetadata(event: VcsEvent, locale: string, t: TranslateFn): React.ReactElement {
  const pairs: Array<[string, React.ReactNode]> = []
  const time = F.formatTime(event.timestamp, locale)
  pairs.push(['time', time === '' ? t('common.unknown') : time])
  pairs.push(['author', event.actor !== undefined && event.actor !== '' ? event.actor : t('common.unknown')])
  const revision = event.revision ?? event.commitHash
  pairs.push(['revision', revision !== undefined && revision !== '' ? revision : t('common.unknown')])
  if (event.branch !== undefined && event.branch !== '') pairs.push(['branch', event.branch])
  pairs.push(['source', F.sourceLabel(event.source, t)])
  if (event.parentHashes !== undefined && event.parentHashes.length > 0) {
    pairs.push(['parents', event.parentHashes.map((parent) => F.shortHash(parent, 7)).join(', ')])
  }
  return h('dl', { className: 'dvt-grid' }, pairs.flatMap(([key, value]) => [
    h('dt', { key: `${key}-dt` }, t(`detail.${key}`)),
    h('dd', { key: `${key}-dd` }, value),
  ]))
}

/** Event detail with changed-file list. */
function renderChangeSet(state: PanelState, locale: string, t: TranslateFn, handlers: PanelHandlers): React.ReactElement {
  const event = state.changeSet.event
  if (event === null) return emptyBox(t('common.empty'))
  return h('div', { className: 'dvt-col' },
    h('div', { className: 'dvt-detail-head' },
      h('button', {
        type: 'button',
        className: 'dvt-icon-btn',
        'aria-label': t('aria.back'),
        title: t('aria.back'),
        onClick: handlers.onBackFromDetail,
      }, '←'),
      h('strong', { className: 'dvt-title dvt-grow dvt-clip', title: event.summary }, t('detail.title')),
    ),
    h('div', { className: 'dvt-card' },
      h('div', { className: 'dvt-row' },
        h('span', { className: 'dvt-glyph', 'aria-hidden': 'true' }, F.typeGlyph(event.eventType)),
        h('span', { className: 'dvt-grow dvt-break' }, event.summary),
        sourceBadge(event.source, t),
      ),
      h('div', { className: 'dvt-row dvt-faint' }, F.eventTypeLabel(event.eventType, t)),
    ),
    h('div', { className: 'dvt-card' },
      h('div', { className: 'dvt-section-title' }, t('detail.metadata')),
      renderMetadata(event, locale, t),
    ),
    h('div', { className: 'dvt-card' },
      h('div', { className: 'dvt-row' },
        h('span', { className: 'dvt-section-title dvt-grow' }, t('detail.files')),
        state.changeSet.data === null
          ? null
          : h('span', { className: 'dvt-faint' }, t('detail.files.count', { count: state.changeSet.data.files.length })),
      ),
      state.changeSet.loading ? skeleton('changeset-loading') : null,
      state.changeSet.error !== null
        ? errorNotice(t, state.changeSet.error, () => {
          if (state.changeSet.event !== null) handlers.onOpenEvent(state.changeSet.event)
        })
        : null,
      state.changeSet.data === null
        ? state.changeSet.loading ? null : emptyBox(t('detail.files.empty'))
        : h('div', { className: 'dvt-col' },
          state.changeSet.data.truncated === true
            ? notice('warn', t('common.warning'), t('detail.files.truncated'), null)
            : null,
          state.changeSet.data.files.length === 0
            ? emptyBox(t('detail.files.empty'))
            : h('div', { className: 'dvt-col' },
              state.changeSet.data.files.map((file, index) => fileRow(file, index, t, handlers)),
            ),
        ),
    ),
  )
}

/** Diff viewer. */
function renderDiff(state: PanelState, t: TranslateFn, handlers: PanelHandlers): React.ReactElement {
  const diff = state.diff
  const lines = diff.data === null ? [] : F.diffLines(diff.data.text)
  return h('div', { className: 'dvt-col' },
    h('div', { className: 'dvt-detail-head' },
      h('button', {
        type: 'button',
        className: 'dvt-icon-btn',
        'aria-label': t('aria.back'),
        title: t('aria.back'),
        onClick: handlers.onBackFromDiff,
      }, '←'),
      h('strong', { className: 'dvt-title dvt-grow dvt-clip', title: diff.filePath ?? '' }, t('diff.title')),
      diff.data !== null && diff.data.binary !== true && diff.data.text !== ''
        ? h('button', {
          type: 'button',
          className: 'dvt-btn',
          'aria-label': t('aria.copyDiff'),
          title: t('aria.copyDiff'),
          onClick: handlers.onCopyDiff,
        }, state.copied ? t('diff.copied') : t('diff.copy'))
        : null,
    ),
    diff.filePath === null ? null : h('div', { className: 'dvt-mono dvt-break' }, diff.filePath),
    diff.loading ? skeleton('diff-loading') : null,
    diff.error !== null ? errorNotice(t, diff.error, handlers.onBackFromDiff) : null,
    diff.data === null
      ? (diff.loading || diff.error !== null ? null : emptyBox(t('diff.empty')))
      : h('div', { className: 'dvt-col' },
        diff.data.binary === true
          ? notice('info', t('diff.binary'), null, null)
          : diff.data.truncated === true
            ? notice('warn', t('common.warning'), t('diff.truncated.generic'), null)
            : null,
        diff.data.binary === true
          ? null
          : lines.length === 0
            ? emptyBox(t('diff.empty'))
            : h('pre', { className: 'dvt-diff-pre', 'aria-label': t('diff.title') },
              lines.map((line, index) => h('span', {
                key: `line-${index}`,
                className: F.diffLineClassName(F.diffLineKind(line)),
              }, line === '' ? ' ' : line)),
            ),
        diff.data.binary !== true && lines.length > 0
          ? h('div', { className: 'dvt-row dvt-faint' },
            h('span', null, t('diff.lines', { count: lines.length })),
            h('span', null, F.formatBytes(diff.data.bytes)),
          )
          : null,
      ),
  )
}

/** One audit row. */
function auditRow(
  attempt: OperationAttempt,
  repository: Repository | null,
  locale: string,
  t: TranslateFn,
  handlers: PanelHandlers,
): React.ReactElement {
  const label = F.operationLabel(attempt.operation, t)
  const time = F.formatTime(attempt.startedAt, locale)
  return h('li', { key: attempt.id, className: 'dvt-list-item' },
    h('button', {
      type: 'button',
      className: 'dvt-row-btn',
      title: attempt.requestSummary,
      onClick: () => handlers.onOpenOperation(attempt),
    },
    h('span', { className: 'dvt-row-main' },
      h('span', { className: 'dvt-glyph', 'aria-hidden': 'true' }, '⚙'),
      h('span', { className: 'dvt-row-summary' }, label),
      h('span', { className: 'dvt-audit-row-state' }, stateBadge(attempt.state, t)),
    ),
    h('span', { className: 'dvt-row-meta' },
      repository === null ? null : h('span', { key: 'repo' }, repository.displayName),
      time === '' ? null : h('span', { key: 'time' }, time),
      h('span', { key: 'source' }, t('source.plugin-audit.badge')),
      attempt.state === 'unknown'
        ? h('span', { key: 'unconfirmed', className: 'dvt-badge dvt-badge-warn' }, t('audit.unknownResult'))
        : null,
    ),
    ),
  )
}

/** Audit list. */
function renderAudit(state: PanelState, locale: string, t: TranslateFn, handlers: PanelHandlers): React.ReactElement {
  const audit = state.audit
  const repository = selectedRepository(state)
  if (state.boot === 'loading') return skeleton('audit-loading')
  if (state.boot === 'error') return errorNotice(t, state.bootError, handlers.onRefreshRepositories)
  if (repository === null) return emptyBox(t('repo.empty'), t('repo.empty.next'))
  if (audit.loading) return skeleton('audit-loading')
  if (audit.error !== null) return errorNotice(t, audit.error, handlers.onRetryAudit)
  return h('div', { className: 'dvt-col' },
    audit.warnings.length > 0 ? notice('warn', t('common.warning'), t('audit.partial'), null) : null,
    audit.operations.length === 0
      ? emptyBox(t('audit.empty'))
      : h('ul', { className: 'dvt-list' }, audit.operations.map((attempt) => auditRow(
        attempt,
        state.repositories.find((entry) => entry.id === attempt.repositoryId) ?? null,
        locale,
        t,
        handlers,
      ))),
    audit.hasMore
      ? h('button', {
        type: 'button',
        className: 'dvt-btn',
        disabled: audit.loadingMore,
        onClick: handlers.onLoadMoreAudit,
      }, audit.loadingMore ? t('common.loadingMore') : t('audit.more'))
      : null,
  )
}

/** One key/value line of the audit detail. */
function auditField(key: string, value: React.ReactNode): React.ReactElement {
  return h('div', { key, className: 'dvt-col' },
    h('div', { className: 'dvt-faint' }, key),
    h('div', { className: 'dvt-break' }, value),
  )
}

/** Audit detail. */
function renderAuditDetail(state: PanelState, locale: string, t: TranslateFn, handlers: PanelHandlers): React.ReactElement {
  const attempt = state.audit.selected
  if (attempt === null) return emptyBox(t('common.empty'))
  const repository = state.repositories.find((entry) => entry.id === attempt.repositoryId) ?? null
  const rows: React.ReactElement[] = [
    auditField(t('audit.operation'), F.operationLabel(attempt.operation, t)),
    auditField(t('audit.state'), stateBadge(attempt.state, t)),
    auditField(t('audit.repository'), repository === null ? attempt.repositoryId : repository.displayName),
    auditField(t('audit.startedAt'), F.formatTime(attempt.startedAt, locale) || t('common.unknown')),
  ]
  if (attempt.finishedAt !== undefined) rows.push(auditField(t('audit.finishedAt'), F.formatTime(attempt.finishedAt, locale)))
  if (attempt.exitCode !== undefined) rows.push(auditField(t('audit.exitCode'), String(attempt.exitCode)))
  if (attempt.errorCode !== undefined && attempt.errorCode !== '') rows.push(auditField(t('audit.errorCode'), attempt.errorCode))
  if (attempt.safeErrorMessage !== undefined && attempt.safeErrorMessage !== '') {
    rows.push(auditField(t('audit.safeError'), attempt.safeErrorMessage))
  }
  rows.push(auditField(t('audit.requestSummary'), attempt.requestSummary))
  if (attempt.beforeRevision !== undefined) rows.push(auditField(t('audit.beforeRevision'), attempt.beforeRevision))
  if (attempt.afterRevision !== undefined) rows.push(auditField(t('audit.afterRevision'), attempt.afterRevision))
  if (attempt.remoteOutcome !== undefined) {
    rows.push(auditField(t('audit.remoteOutcome'), F.remoteOutcomeLabel(attempt.remoteOutcome, t)))
  }
  if (attempt.changedPaths !== undefined && attempt.changedPaths.length > 0) {
    rows.push(auditField(t('audit.changedPaths'), attempt.changedPaths.join(', ')))
  }
  rows.push(auditField(t('audit.correlationId'), attempt.correlationId))
  return h('div', { className: 'dvt-col' },
    h('div', { className: 'dvt-detail-head' },
      h('button', {
        type: 'button',
        className: 'dvt-icon-btn',
        'aria-label': t('aria.back'),
        title: t('aria.back'),
        onClick: handlers.onBackFromAuditDetail,
      }, '←'),
      h('strong', { className: 'dvt-title dvt-grow dvt-clip' }, t('audit.detail')),
    ),
    attempt.state === 'unknown'
      ? notice('warn', t('audit.unknownResult'), t('audit.unknownResult.hint'), null)
      : null,
    h('div', { className: 'dvt-card' }, rows),
  )
}

/** State-before grid inside the preview. */
function renderBeforeState(state: PanelState, t: TranslateFn): React.ReactElement {
  const before = state.dialog?.preview?.before
  const rows: React.ReactElement[] = []
  if (before === undefined) return h('div', null)
  if (before.branch !== undefined) rows.push(auditField(t('op.before.branch'), before.branch))
  if (before.revision !== undefined) rows.push(auditField(t('op.before.revision'), before.revision))
  if (before.clean !== undefined) rows.push(auditField(t('op.before.clean'), before.clean ? t('op.before.clean.yes') : t('op.before.clean.no')))
  if (before.stagedFiles !== undefined) rows.push(auditField(t('op.before.staged'), t('op.before.stagedCount', { count: before.stagedFiles.length })))
  if (before.ahead !== undefined) rows.push(auditField(t('op.before.ahead'), String(before.ahead)))
  if (before.behind !== undefined) rows.push(auditField(t('op.before.behind'), String(before.behind)))
  return h('div', { className: 'dvt-card' },
    h('div', { className: 'dvt-section-title' }, t('op.before')),
    rows.length === 0 ? h('div', { className: 'dvt-faint' }, t('common.none')) : h('div', { className: 'dvt-col' }, rows),
  )
}

/** Result panel shown after a terminal operation state. */
function renderOperationResult(attempt: OperationAttempt, t: TranslateFn): React.ReactElement {
  const rows: React.ReactElement[] = [
    auditField(t('audit.state'), stateBadge(attempt.state, t)),
  ]
  if (attempt.exitCode !== undefined) rows.push(auditField(t('audit.exitCode'), String(attempt.exitCode)))
  if (attempt.errorCode !== undefined && attempt.errorCode !== '') rows.push(auditField(t('audit.errorCode'), attempt.errorCode))
  if (attempt.safeErrorMessage !== undefined && attempt.safeErrorMessage !== '') {
    rows.push(auditField(t('audit.safeError'), attempt.safeErrorMessage))
  }
  if (attempt.beforeRevision !== undefined) rows.push(auditField(t('audit.beforeRevision'), attempt.beforeRevision))
  if (attempt.afterRevision !== undefined) rows.push(auditField(t('audit.afterRevision'), attempt.afterRevision))
  if (attempt.changedPaths !== undefined && attempt.changedPaths.length > 0) {
    rows.push(auditField(t('audit.changedPaths'), attempt.changedPaths.join(', ')))
  }
  if (attempt.remoteOutcome !== undefined) {
    rows.push(auditField(t('audit.remoteOutcome'), F.remoteOutcomeLabel(attempt.remoteOutcome, t)))
  }
  return h('div', { className: 'dvt-col' },
    attempt.state === 'unknown'
      ? notice('warn', t('audit.unknownResult'), t('audit.unknownResult.hint'), null)
      : null,
    h('div', { className: 'dvt-card' }, rows),
    h('div', { className: 'dvt-faint' }, t('op.refreshNote')),
  )
}

/**
 * Commit/push inputs of the confirmation dialog.
 *
 * Rendered independently of the preview: the Host refuses a commit preview
 * without a message, so the field must be visible in the `previewing`,
 * `blocked` and `error` phases as well, otherwise a blocked preview could
 * never be corrected.
 */
function renderOperationFields(
  state: PanelState,
  handlers: PanelHandlers,
  t: TranslateFn,
  dialog: DialogState,
): React.ReactElement | null {
  const disabled = dialog.phase === 'executing' || dialog.phase === 'result'
  if (dialog.operation === 'commit') {
    const staged = F.stagedCount(state.status?.entries)
    const missing = dialog.message.trim() === ''
    return h('div', { key: 'commit-fields', className: 'dvt-card' },
      h('label', { className: 'dvt-section-title', htmlFor: 'dvt-commit-message' }, t('op.commit.message')),
      h('textarea', {
        id: 'dvt-commit-message',
        className: 'dvt-textarea',
        value: dialog.message,
        placeholder: t('op.commit.message.placeholder'),
        'aria-label': t('op.commit.message'),
        disabled,
        onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => handlers.onDialogMessageChange(event.currentTarget.value),
      }),
      h('div', { className: 'dvt-faint dvt-break' }, t('op.commit.stagedOnly')),
      h('div', { className: 'dvt-faint' }, t('op.commit.stagedCount', { count: staged })),
      staged === 0 ? notice('warn', t('common.warning'), t('op.commit.noStaged'), null) : null,
      missing ? h('div', { className: 'dvt-error' }, t('op.commit.message.required')) : null,
    )
  }
  if (dialog.operation === 'push') {
    return h('div', { key: 'push-fields', className: 'dvt-card' },
      h('label', { className: 'dvt-section-title', htmlFor: 'dvt-push-remote' }, t('op.push.remote')),
      h('input', {
        id: 'dvt-push-remote',
        className: 'dvt-input',
        type: 'text',
        value: dialog.remote,
        'aria-label': t('op.push.remote'),
        disabled,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => handlers.onDialogRemoteChange(event.currentTarget.value),
      }),
      h('label', { className: 'dvt-section-title', htmlFor: 'dvt-push-branch' }, t('op.push.branch')),
      h('input', {
        id: 'dvt-push-branch',
        className: 'dvt-input',
        type: 'text',
        value: dialog.branch,
        'aria-label': t('op.push.branch'),
        disabled,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => handlers.onDialogBranchChange(event.currentTarget.value),
      }),
      h('div', { className: 'dvt-faint dvt-break' }, t('op.push.hint')),
    )
  }
  return null
}

/** The confirmation dialog; only rendered while `state.dialog` is set. */
function renderDialog(state: PanelState, deps: PanelDeps, handlers: PanelHandlers): React.ReactElement | null {
  const dialog = state.dialog
  if (dialog === null) return null
  const { t } = deps
  const repository = selectedRepository(state)
  const preview = dialog.preview
  const now = deps.now ?? Date.now
  const expired = preview !== null && preview.allowed
    && preview.expiresAt !== ''
    && Number.isFinite(Date.parse(preview.expiresAt))
    && Date.parse(preview.expiresAt) < now()
  const commitMissing = dialog.operation === 'commit' && dialog.message.trim() === ''
  const busy = dialog.phase === 'previewing' || dialog.phase === 'executing'
  const canConfirm = dialog.phase === 'previewed'
    && preview !== null
    && preview.allowed
    && !expired
    && !commitMissing

  const body: React.ReactNode[] = []
  if (dialog.phase === 'previewing') {
    body.push(h('div', { key: 'previewing', className: 'dvt-row' }, h('span', null, t('op.previewing'))))
    body.push(skeleton('dialog-loading'))
  }
  if (dialog.previewError !== null) {
    body.push(errorNotice(t, dialog.previewError, handlers.onDialogRepreview, 'preview-error'))
    body.push(h('div', { key: 'preview-failed', className: 'dvt-faint' }, t('op.previewFailed')))
  }
  if (preview !== null) {
    body.push(h('div', { key: 'summary', className: 'dvt-card' },
      h('div', { className: 'dvt-section-title' }, t('op.summary')),
      h('div', { className: 'dvt-break' }, preview.summary),
    ))
    if (!preview.allowed) {
      body.push(notice(
        'error',
        t('common.error'),
        t('op.blocked', { reason: preview.blockedReason !== undefined && preview.blockedReason !== '' ? preview.blockedReason : t('op.blocked.generic') }),
        null,
        'blocked',
      ))
    }
    body.push(h('div', { key: 'argv', className: 'dvt-card' },
      h('div', { className: 'dvt-section-title' }, t('op.argv')),
      h('pre', { className: 'dvt-argv' }, preview.argv.join(' ')),
    ))
    if (preview.warnings.length > 0) {
      body.push(h('div', { key: 'warnings', className: 'dvt-card' },
        h('div', { className: 'dvt-section-title' }, t('op.warnings')),
        h('ul', { className: 'dvt-warning-list' }, preview.warnings.map((warning, index) => h('li', { key: `warn-${index}` }, warning))),
      ))
    }
    body.push(h('div', { key: 'before', className: 'dvt-card' }, renderBeforeState(state, t)))
    if (repository !== null) {
      body.push(h('div', { key: 'target', className: 'dvt-card' },
        h('div', { className: 'dvt-section-title' }, t('op.target')),
        h('div', { className: 'dvt-break' }, `${repository.displayName} (${vcsLabel(repository.vcsType, t)})`),
        h('div', { className: 'dvt-mono dvt-break' }, repository.rootPath),
      ))
    }
    if (preview.expiresAt !== '') {
      body.push(h('div', { key: 'expires', className: 'dvt-mono dvt-faint' },
        `${t('op.expires')}: ${F.formatTime(preview.expiresAt, deps.locale)}`,
      ))
    }
    if (expired) body.push(notice('warn', t('common.warning'), t('op.expired'), null, 'expired'))
  }
  const fields = renderOperationFields(state, handlers, t, dialog)
  if (fields !== null) body.push(fields)
  if (dialog.phase === 'executing') {
    body.push(h('div', { key: 'executing', className: 'dvt-row' }, h('span', null, t('op.executing'))))
    body.push(skeleton('executing'))
  }
  if (dialog.executeError !== null) {
    body.push(errorNotice(t, dialog.executeError, undefined, 'execute-error'))
    body.push(h('div', { key: 'execute-note', className: 'dvt-faint' }, t('op.executeError')))
  }
  if (dialog.result !== null) {
    body.push(h('div', { key: 'result' }, renderOperationResult(dialog.result, t)))
  }

  const actions: React.ReactNode[] = []
  if (dialog.phase === 'previewed' && preview !== null && preview.allowed) {
    actions.push(h('button', {
      key: 'confirm',
      type: 'button',
      className: 'dvt-btn dvt-btn-primary',
      disabled: !canConfirm,
      autoFocus: true,
      onClick: handlers.onDialogConfirm,
    }, t('op.confirm')))
  }
  if (dialog.phase === 'error' || (dialog.phase === 'blocked') || (dialog.phase === 'previewed' && expired)) {
    actions.push(h('button', {
      key: 'repreview',
      type: 'button',
      className: 'dvt-btn',
      disabled: busy,
      onClick: handlers.onDialogRepreview,
    }, t('op.repreview')))
  }
  if (dialog.phase === 'result') {
    actions.push(h('button', {
      key: 'close-result',
      type: 'button',
      className: 'dvt-btn',
      onClick: handlers.onDialogClose,
    }, t('common.close')))
  }
  actions.push(h('button', {
    key: 'cancel',
    type: 'button',
    className: 'dvt-btn',
    disabled: dialog.phase === 'executing',
    onClick: handlers.onDialogClose,
  }, t('common.cancel')))

  return h('div', { className: 'dvt-dialog-backdrop' },
    h('div', {
      className: 'dvt-dialog',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': t('aria.dialog', { operation: F.operationLabel(dialog.operation, t) }),
    },
    h('div', { className: 'dvt-dialog-head' },
      h('strong', { className: 'dvt-title dvt-grow dvt-clip' }, t('op.dialogTitle', { operation: F.operationLabel(dialog.operation, t) })),
      h('button', {
        type: 'button',
        className: 'dvt-icon-btn',
        'aria-label': t('aria.closeDialog'),
        title: t('aria.closeDialog'),
        disabled: dialog.phase === 'executing',
        onClick: handlers.onDialogClose,
      }, '×'),
    ),
    body,
    h('div', { className: 'dvt-faint dvt-break' }, t('op.neverRetry')),
    h('div', { className: 'dvt-dialog-actions' }, actions),
    ),
  )
}

/** Footer status line. */
function renderFooter(state: PanelState, t: TranslateFn, handlers: PanelHandlers): React.ReactElement {
  const repository = selectedRepository(state)
  const diagnostics = state.diagnostics
  const status = state.status
  const parts: React.ReactNode[] = []
  if (repository === null) {
    parts.push(h('span', { key: 'repo' }, t('footer.noRepo')))
  } else {
    parts.push(h('span', { key: 'repo', className: 'dvt-clip', title: repository.rootPath }, `${repository.vcsType === 'git' ? t('footer.git') : t('footer.svn')} · ${repository.displayName}`))
    if (status !== null && status.branch !== undefined) parts.push(h('span', { key: 'branch' }, `${t('footer.branch')}: ${status.branch}`))
    if (status !== null && status.head !== undefined) parts.push(h('span', { key: 'head' }, `${t('footer.revision')}: ${F.shortHash(status.head, 8)}`))
  }
  const statusLine: React.ReactNode[] = []
  if (state.statusLoading) {
    statusLine.push(h('span', { key: 'loading' }, t('footer.statusLoading')))
  } else if (state.statusError !== null) {
    statusLine.push(h('span', { key: 'status-error' }, t('footer.statusError')))
    statusLine.push(h('button', {
      key: 'status-retry',
      type: 'button',
      className: 'dvt-link',
      'aria-label': t('aria.retryStatus'),
      onClick: handlers.onRetryStatus,
    }, t('common.retry')))
  } else if (status !== null) {
    statusLine.push(h('span', { key: 'clean', className: status.clean ? 'dvt-muted' : 'dvt-faint' }, status.clean ? t('footer.clean') : t('footer.dirty')))
    if (status.conflicts.length > 0) {
      statusLine.push(h('span', { key: 'conflicts', className: 'dvt-badge dvt-badge-error' }, t('footer.conflicts', { count: status.conflicts.length })))
    }
  }
  const tools: React.ReactNode[] = []
  if (diagnostics === null) {
    tools.push(h('span', { key: 'diag-loading' }, t('common.loading')))
  } else {
    tools.push(h('span', { key: 'git' }, diagnostics.gitVersion === null ? t('footer.unavailable', { tool: t('footer.git') }) : `${t('footer.git')} ${diagnostics.gitVersion}`))
    tools.push(h('span', { key: 'svn' }, diagnostics.svnVersion === null ? t('footer.unavailable', { tool: t('footer.svn') }) : `${t('footer.svn')} ${diagnostics.svnVersion}`))
    tools.push(h('span', { key: 'data', className: 'dvt-clip', title: diagnostics.dataDir }, `${t('footer.dataDir')}: ${diagnostics.dataDir}`))
    tools.push(h('span', { key: 'version' }, t('footer.version', { version: diagnostics.pluginVersion })))
  }
  return h('div', { className: 'dvt-footer' },
    h('div', { className: 'dvt-footer-line' }, parts),
    statusLine.length > 0 ? h('div', { className: 'dvt-footer-line' }, statusLine) : null,
    h('div', { className: 'dvt-footer-line' }, tools),
  )
}

/** Banners describing environment state, above the list. */
function renderNotices(state: PanelState, t: TranslateFn, handlers: PanelHandlers): React.ReactNode {
  const repository = selectedRepository(state)
  const tool = missingTool(state, repository)
  const items: React.ReactNode[] = []
  if (state.noWorkspace) {
    items.push(notice('info', t('repo.noWorkspace'), t('repo.noWorkspace.hint'), null, 'no-workspace'))
  }
  if (tool !== null && repository !== null) {
    const label = vcsLabel(tool, t)
    items.push(notice(
      'error',
      t('common.error'),
      t('state.missingTool', { vcs: label, tool: label }),
      null,
      'missing-tool',
    ))
  }
  if (state.boot === 'error' && state.repositories.length === 0) {
    items.push(errorNotice(t, state.bootError, handlers.onRefreshRepositories, 'boot-error'))
  }
  if (items.length === 0) return null
  return h('div', { key: 'notices', className: 'dvt-col' }, items)
}

/** The whole panel body. Renders one `<style>` and nothing global. */
export function renderPanelView(props: PanelViewProps): React.ReactElement {
  const { state, deps, handlers } = props
  const { t } = deps
  const locale = deps.locale ?? 'zh'
  const repository = selectedRepository(state)

  let body: React.ReactElement
  if (state.diff.filePath !== null) body = renderDiff(state, t, handlers)
  else if (state.changeSet.event !== null) body = renderChangeSet(state, locale, t, handlers)
  else if (state.source === 'audit' && state.audit.selected !== null) body = renderAuditDetail(state, locale, t, handlers)
  else body = h('div', { className: 'dvt-col' },
    state.source === 'audit' ? null : renderFilters(state, t, handlers),
    repository !== null && state.diff.filePath === null ? renderOperationBar(repository, t, handlers) : null,
    state.source === 'timeline' ? renderTimeline(state, locale, t, handlers) : renderAudit(state, locale, t, handlers),
  )

  return h('div', { className: 'dvt-root', 'data-dvt-panel': 'vcs-timeline', lang: locale === 'en' ? 'en' : 'zh-CN' },
    h('style', { key: 'dvt-styles' }, deps.styles ?? STYLES),
    h('div', { key: 'header' }, renderHeader(state, t, handlers)),
    renderNotices(state, t, handlers),
    h('div', { key: 'body', className: 'dvt-col' }, body),
    h('div', { key: 'footer' }, renderFooter(state, t, handlers)),
    renderDialog(state, deps, handlers),
  )
}
