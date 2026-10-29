/**
 * Plugin operation-audit view: a compact list of audited attempts and the
 * detail of one attempt. Audit facts never mix with repository history.
 * @module dsh-vcs-timeline/client/ui/audit
 */

import * as React from 'react'
import type { OperationAttempt } from '../../shared/contracts.ts'
import * as F from '../format.ts'
import type { PanelDeps, PanelHandlers, PanelState } from '../types.ts'
import { IconAudit, IconCheck, IconError, IconWarning } from './icons.ts'
import {
  Banner,
  EmptyState,
  errorText,
  SectionHeader,
  StateBadge,
} from './primitives.ts'
import { missingTool, selectedRepository } from './shared.ts'
import { Subbar } from './detail.ts'

const h = React.createElement

/** Icon + color class for one audit state. */
function stateVisual(state: OperationAttempt['state']): { Icon: typeof IconCheck; cls: string } {
  if (state === 'succeeded') return { Icon: IconCheck, cls: 'dvt-audit-icon-success' }
  if (state === 'failed') return { Icon: IconError, cls: 'dvt-audit-icon-error' }
  if (state === 'unknown' || state === 'partial') return { Icon: IconWarning, cls: 'dvt-audit-icon-warn' }
  return { Icon: IconAudit, cls: '' }
}

/** Human duration between start and finish, when both exist. */
function durationLabel(attempt: OperationAttempt, locale?: string): string {
  void locale
  if (attempt.finishedAt === undefined) return ''
  const start = Date.parse(attempt.startedAt)
  const end = Date.parse(attempt.finishedAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return ''
  const ms = end - start
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

/** One audit row. */
function AuditRow(props: {
  attempt: OperationAttempt
  repositoryName: string | null
  deps: PanelDeps
  handlers: PanelHandlers
}): React.ReactElement {
  const { attempt, repositoryName, deps, handlers } = props
  const { t } = deps
  const { Icon, cls } = stateVisual(attempt.state)
  const time = F.formatCompactTime(attempt.startedAt, deps.locale)
  return h('li', { className: 'dvt-audit-row' },
    h('button', {
      type: 'button',
      className: 'dvt-audit-btn',
      title: attempt.requestSummary,
      'aria-label': t('aria.auditRow', {
        label: `${F.operationLabel(attempt.operation, t)} · ${F.operationStateLabel(attempt.state, t)} · ${F.shortHash(attempt.id.replace(/^op-/, ''), 8)}`,
      }),
      onClick: () => handlers.onOpenOperation(attempt),
    },
    h('span', { className: `dvt-audit-icon ${cls}` }, h(Icon, { size: 13 })),
    h('span', { className: 'dvt-audit-main' },
      h('span', { className: 'dvt-audit-title' },
        F.operationLabel(attempt.operation, t),
        repositoryName === null ? null : h('span', { className: 'dvt-faint' }, ` · ${repositoryName}`),
      ),
      h('span', { className: 'dvt-audit-meta' },
        time === '' ? null : h('span', null, time),
        h('span', { className: 'dvt-faint dvt-mono' }, F.shortHash(attempt.correlationId.replace(/^corr-/, ''), 8)),
      ),
    ),
    h(StateBadge, { state: attempt.state, t }),
    ),
  )
}

/** Audit list with its own loading/empty/error states. */
export function renderAuditList(state: PanelState, deps: PanelDeps, handlers: PanelHandlers): React.ReactElement | null {
  const { t } = deps
  const repository = selectedRepository(state)
  const audit = state.audit
  // First load of this source: the composition root's SkeletonSwap owns the
  // loading surface, so the view returns no element of its own.
  if (state.boot === 'loading') return null
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
    return h(EmptyState, {
      icon: IconAudit,
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
      hint: t('error.vcs-not-installed'),
    })
  }
  // Same rule as history: only a first page with no records yields to the
  // composition root's skeleton; a quiet reload keeps the recorded list.
  if (audit.loading && audit.operations.length === 0) return null
  if (audit.error !== null) {
    return h(EmptyState, {
      icon: IconError,
      tone: 'error',
      title: t('state.error.title'),
      hint: errorText(audit.error, t),
      actions: h('button', { type: 'button', className: 'dvt-btn dvt-btn-sm', onClick: handlers.onRetryAudit }, t('common.retry')),
    })
  }
  if (audit.operations.length === 0) {
    return h(EmptyState, {
      icon: IconAudit,
      title: t('audit.empty'),
      hint: t('audit.empty.hint'),
    })
  }
  // One glance at what the audit actually recorded, plus a state filter.
  const states: Array<import('../../shared/contracts.ts').OperationState> = ['succeeded', 'failed', 'unknown', 'running', 'partial']
  const counts = new Map<string, number>()
  for (const attempt of audit.operations) counts.set(attempt.state, (counts.get(attempt.state) ?? 0) + 1)
  const filtered = state.filters.auditState === 'all'
    ? audit.operations
    : audit.operations.filter((attempt) => attempt.state === state.filters.auditState)
  const chip = (value: 'all' | import('../../shared/contracts.ts').OperationState, label: string, count: number): React.ReactElement => h('button', {
    key: value,
    type: 'button',
    className: 'dvt-audit-chip',
    'aria-pressed': state.filters.auditState === value,
    onClick: () => handlers.onSetAuditState(value),
  },
  h('span', null, label),
  h('span', { className: 'dvt-audit-chip-count' }, String(count)),
  )
  return h('div', { className: 'dvt-col dvt-audit-view' },
    audit.warnings.length > 0
      ? h(Banner, { kind: 'warn', text: t('audit.partial') })
      : null,
    h('div', { className: 'dvt-audit-chips', role: 'group', 'aria-label': t('audit.filter.state') },
      chip('all', t('audit.state.all'), audit.operations.length),
      states.filter((value) => (counts.get(value) ?? 0) > 0).map((value) => chip(value, t(`op.state.${value}`), counts.get(value) ?? 0)),
    ),
    h('div', { className: 'dvt-audit-summary' }, t('audit.summary', { count: audit.operations.length })),
    filtered.length === 0
      ? h(EmptyState, {
        icon: IconAudit,
        title: t('audit.empty.filtered'),
        hint: t('audit.empty.filtered.hint'),
      })
      : h('ul', { className: 'dvt-list', 'aria-label': t('source.audit') },
        filtered.map((attempt) => h(AuditRow, {
          key: attempt.id,
          attempt,
          repositoryName: state.repositories.find((entry) => entry.id === attempt.repositoryId)?.displayName ?? null,
          deps,
          handlers,
        })),
      ),
    h('div', { className: 'dvt-list-count' }, t('audit.count', { count: filtered.length })),
    audit.hasMore
      ? h('div', { className: 'dvt-list-more' },
        h('button', {
          type: 'button',
          className: 'dvt-btn dvt-btn-sm',
          disabled: audit.loadingMore,
          onClick: handlers.onLoadMoreAudit,
        }, audit.loadingMore ? t('common.loadingMore') : t('audit.more')),
      )
      : null,
  )
}

/** One field row of the audit detail. */
function field(key: string, value: React.ReactNode, mono = false): React.ReactElement {
  return h('div', { key, className: 'dvt-kv' },
    h('div', { className: 'dvt-kv-key' }, key),
    h('div', { className: `dvt-kv-val${mono ? ' dvt-mono' : ''}` }, value),
  )
}

/** Pinned breadcrumb of the audit detail. */
export function auditDetailHeader(state: PanelState, deps: PanelDeps, handlers: PanelHandlers): React.ReactElement {
  const { t } = deps
  const attempt = state.audit.selected
  return h(Subbar, {
    onBack: handlers.onBackFromAuditDetail,
    backLabel: t('aria.back'),
    title: t('audit.detail'),
    subtitle: attempt === null ? '' : F.shortHash(attempt.id.replace(/^op-/, ''), 8),
    trailing: attempt === null ? null : h(StateBadge, { state: attempt.state, t }),
  })
}

/** Scrollable audit detail. */
export function auditDetailBody(state: PanelState, deps: PanelDeps, handlers: PanelHandlers): React.ReactElement {
  const { t } = deps
  const attempt = state.audit.selected
  if (attempt === null) return h(EmptyState, { icon: IconAudit, title: t('common.empty') })
  const repository = state.repositories.find((entry) => entry.id === attempt.repositoryId) ?? null
  const duration = durationLabel(attempt, deps.locale)
  return h('div', { className: 'dvt-col' },
    attempt.state === 'unknown'
      ? h(Banner, { kind: 'warn', title: t('audit.unknownResult'), text: t('audit.state.unknown.hint') })
      : null,
    attempt.safeErrorMessage === undefined
      ? null
      : h(Banner, {
        kind: attempt.state === 'failed' ? 'error' : 'warn',
        title: t('audit.safeError'),
        text: attempt.safeErrorMessage,
      }),
    h('div', { className: 'dvt-section' },
      h(SectionHeader, { title: t('audit.operation') }),
      h('div', { style: { padding: '0 10px 6px' } },
        field(t('audit.state'), h(StateBadge, { state: attempt.state, t })),
        field(t('audit.repository'), repository === null ? attempt.repositoryId : repository.displayName),
        field(t('audit.startedAt'), F.formatTime(attempt.startedAt, deps.locale) || t('common.unknown')),
        attempt.finishedAt === undefined ? null : field(t('audit.finishedAt'), F.formatTime(attempt.finishedAt, deps.locale)),
        duration === '' ? null : field(t('audit.duration'), duration),
        attempt.exitCode === undefined ? null : field(t('audit.exitCode'), String(attempt.exitCode), true),
        attempt.errorCode === undefined || attempt.errorCode === '' ? null : field(t('audit.errorCode'), attempt.errorCode, true),
        attempt.requestSummary === '' ? null : field(t('audit.requestSummary'), attempt.requestSummary),
        attempt.beforeRevision === undefined ? null : field(t('audit.beforeRevision'), F.shortHash(attempt.beforeRevision, 12), true),
        attempt.afterRevision === undefined ? null : field(t('audit.afterRevision'), F.shortHash(attempt.afterRevision, 12), true),
        attempt.remoteOutcome === undefined ? null : field(t('audit.remoteOutcome'), F.remoteOutcomeLabel(attempt.remoteOutcome, t)),
        attempt.changedPaths === undefined || attempt.changedPaths.length === 0
          ? null
          : field(t('audit.changedPaths'), F.pathsSummary(attempt.changedPaths, 6)),
        field(t('audit.correlation'), attempt.correlationId, true),
      ),
    ),
  )
}
