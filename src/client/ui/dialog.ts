/**
 * Write-operation confirmation dialog.
 *
 * Sections separated by hairlines inside a panel-scoped overlay: summary,
 * exact argv, current repository state, warnings, the operation's own inputs,
 * then a sticky action row. The dialog is rendered inside the panel root
 * (`position:absolute`), never as a viewport-wide modal, so the host layout is
 * not covered.
 * @module dsh-vcs-timeline/client/ui/dialog
 */

import * as React from 'react'
import * as F from '../format.ts'
import type { DialogState, PanelDeps, PanelHandlers, PanelState } from '../types.ts'
import { IconCheck, IconClose, IconError, IconWarning } from './icons.ts'
import { Banner, IconButton, Progress, SkeletonRows, StateBadge } from './primitives.ts'
import { selectedRepository, vcsLabel } from './shared.ts'

const h = React.createElement

/** Whether a report carries a finding the user must acknowledge. */
function hasBlocking(dialog: DialogState): boolean {
  return (dialog.checks?.findings ?? []).some((finding) => finding.severity === 'blocking')
}

/** Pre-commit checks of the staged diff, shown before a commit is confirmed. */
function ChecksSection(props: { dialog: DialogState; deps: PanelDeps; handlers: PanelHandlers }): React.ReactElement | null {
  const { dialog, deps, handlers } = props
  if (dialog.operation !== 'commit') return null
  const { t } = deps
  const report = dialog.checks ?? null
  const loading = dialog.checksLoading === true
  const blocking = hasBlocking(dialog)
  return h('div', { className: 'dvt-dialog-section' },
    h('div', { className: 'dvt-dialog-label' }, t('dialog.checks.title')),
    loading ? h(SkeletonRows, { rows: 2 }) : null,
    !loading && report !== null && report.findings.length === 0
      ? h('div', { className: 'dvt-dialog-note' }, t('dialog.checks.none'))
      : null,
    !loading && report === null
      ? h(Banner, { kind: 'warn', text: t('dialog.checks.unavailable') })
      : null,
    !loading && report !== null && report.findings.length > 0
      ? h('ul', { className: 'dvt-checks dvt-checks-compact' },
        report.findings.map((finding) => h('li', {
          key: `${finding.rule}:${finding.path ?? ''}:${finding.line ?? ''}`,
          className: `dvt-check dvt-check-${finding.severity}`,
        },
        h('span', { className: 'dvt-check-icon' },
          h(finding.severity === 'blocking' ? IconError : finding.severity === 'warning' ? IconWarning : IconCheck, { size: 12 })),
        h('span', { className: 'dvt-check-main' },
          h('span', { className: 'dvt-check-title' }, t(`check.${finding.rule}`)),
          finding.path === undefined ? null : h('span', { className: 'dvt-check-path dvt-mono', title: finding.path }, finding.path),
        ),
        )),
      )
      : null,
    blocking
      ? h('label', { className: 'dvt-ack' },
        h('input', {
          type: 'checkbox',
          checked: dialog.acknowledged === true,
          disabled: dialog.phase === 'executing' || dialog.phase === 'result',
          onChange: handlers.onToggleDialogAck,
        }),
        h('span', null, t('dialog.checks.ack')),
      )
      : null,
    blocking ? h(Banner, { kind: 'warn', text: t('dialog.checks.blocking') }) : null,
  )
}

/** One `key / value` row inside a dialog section. */
function kvRow(key: string, value: React.ReactNode, mono = false): React.ReactElement {
  return h('div', { key, className: 'dvt-row', style: { gap: 6 } },
    h('span', { className: 'dvt-kv-key', style: { flex: '0 0 78px' } }, key),
    h('span', { className: `dvt-kv-val${mono ? ' dvt-mono' : ''}` }, value),
  )
}

/** The operation-specific inputs; visible before a preview exists so a
 * blocked commit preview can be corrected and previewed again. */
function OperationFields(props: {
  state: PanelState
  dialog: DialogState
  handlers: PanelHandlers
  t: PanelDeps['t']
}): React.ReactElement | null {
  const { state, dialog, handlers, t } = props
  const disabled = dialog.phase === 'executing' || dialog.phase === 'result'
  if (dialog.operation === 'commit') {
    const staged = F.stagedCount(state.status?.entries)
    return h('div', { className: 'dvt-dialog-section' },
      h('div', { className: 'dvt-dialog-label' }, t('op.commit.message')),
      h('textarea', {
        id: 'dvt-commit-message',
        className: 'dvt-textarea',
        value: dialog.message,
        placeholder: t('op.commit.message.placeholder'),
        'aria-label': t('op.commit.message'),
        disabled,
        onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => handlers.onDialogMessageChange(event.currentTarget.value),
      }),
      h('div', { className: 'dvt-row', style: { marginTop: 4, gap: 6 } },
        h('span', { className: 'dvt-faint', style: { fontSize: 10 } },
          `${t('op.commit.stagedCount', { count: staged })} · ${t('op.commit.stagedOnly')}`,
        ),
      ),
      staged === 0 ? h(Banner, { kind: 'warn', text: t('op.commit.noStaged') }) : null,
      dialog.message.trim() === '' ? h(Banner, { kind: 'warn', text: t('op.commit.message.required') }) : null,
    )
  }
  if (dialog.operation === 'push') {
    return h('div', { className: 'dvt-dialog-section' },
      h('div', { className: 'dvt-row', style: { gap: 6 } },
        h('label', { className: 'dvt-grow' },
          h('span', { className: 'dvt-dialog-label' }, t('op.push.remote')),
          h('input', {
            id: 'dvt-push-remote',
            className: 'dvt-input',
            type: 'text',
            value: dialog.remote,
            'aria-label': t('op.push.remote'),
            disabled,
            onChange: (event: React.ChangeEvent<HTMLInputElement>) => handlers.onDialogRemoteChange(event.currentTarget.value),
          }),
        ),
        h('label', { className: 'dvt-grow' },
          h('span', { className: 'dvt-dialog-label' }, t('op.push.branch')),
          h('input', {
            id: 'dvt-push-branch',
            className: 'dvt-input',
            type: 'text',
            value: dialog.branch,
            'aria-label': t('op.push.branch'),
            disabled,
            onChange: (event: React.ChangeEvent<HTMLInputElement>) => handlers.onDialogBranchChange(event.currentTarget.value),
          }),
        ),
      ),
      h('div', { className: 'dvt-dialog-note', style: { marginTop: 4 } }, t('op.push.hint')),
    )
  }
  return null
}

/** Current state of the repository, as the preview read it. */
function BeforeState(props: { state: PanelState; t: PanelDeps['t'] }): React.ReactElement | null {
  const before = props.state.dialog?.preview?.before
  if (before === undefined) return null
  const { t } = props
  const rows: React.ReactElement[] = []
  if (before.branch !== undefined) rows.push(kvRow(t('op.before.branch'), before.branch, true))
  if (before.revision !== undefined) rows.push(kvRow(t('op.before.revision'), F.shortHash(before.revision, 12), true))
  if (before.clean !== undefined) rows.push(kvRow(t('op.before.clean'), before.clean ? t('op.before.clean.yes') : t('op.before.clean.no')))
  if (before.stagedFiles !== undefined) rows.push(kvRow(t('op.before.staged'), t('op.before.stagedCount', { count: before.stagedFiles.length })))
  if (before.ahead !== undefined) rows.push(kvRow(t('op.before.ahead'), String(before.ahead)))
  if (before.behind !== undefined) rows.push(kvRow(t('op.before.behind'), String(before.behind)))
  if (rows.length === 0) return null
  return h('div', { className: 'dvt-dialog-section' },
    h('div', { className: 'dvt-dialog-label' }, t('op.before')),
    rows,
  )
}

/** Terminal result of an executed operation. */
function OperationResult(props: { state: PanelState; t: PanelDeps['t'] }): React.ReactElement | null {
  const attempt = props.state.dialog?.result
  if (attempt === undefined || attempt === null) return null
  const { t } = props
  const rows: React.ReactElement[] = [
    h('div', { key: 'state', className: 'dvt-row' },
      h('span', { className: 'dvt-kv-key', style: { flex: '0 0 78px' } }, t('audit.state')),
      h(StateBadge, { state: attempt.state, t }),
    ),
  ]
  if (attempt.exitCode !== undefined) rows.push(kvRow(t('audit.exitCode'), String(attempt.exitCode), true))
  if (attempt.errorCode !== undefined && attempt.errorCode !== '') rows.push(kvRow(t('audit.errorCode'), attempt.errorCode, true))
  if (attempt.beforeRevision !== undefined) rows.push(kvRow(t('audit.beforeRevision'), F.shortHash(attempt.beforeRevision, 12), true))
  if (attempt.afterRevision !== undefined) rows.push(kvRow(t('audit.afterRevision'), F.shortHash(attempt.afterRevision, 12), true))
  if (attempt.remoteOutcome !== undefined) rows.push(kvRow(t('audit.remoteOutcome'), F.remoteOutcomeLabel(attempt.remoteOutcome, t)))
  if (attempt.changedPaths !== undefined && attempt.changedPaths.length > 0) {
    rows.push(kvRow(t('audit.changedPaths'), F.pathsSummary(attempt.changedPaths, 4)))
  }
  return h('div', { className: 'dvt-dialog-section' },
    h('div', { className: 'dvt-result' },
      attempt.state === 'unknown' ? h(Banner, { kind: 'warn', title: t('audit.unknownResult'), text: t('audit.state.unknown.hint') }) : null,
      rows,
      h('div', { className: 'dvt-dialog-note' }, t('op.refreshNote')),
    ),
  )
}

/** The dialog; rendered only while `state.dialog` is set. */
export function renderDialog(state: PanelState, deps: PanelDeps, handlers: PanelHandlers): React.ReactElement | null {
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
  const commitBlockedByChecks = dialog.operation === 'commit' && hasBlocking(dialog) && !dialog.acknowledged
  const busy = dialog.phase === 'previewing' || dialog.phase === 'executing'
  const updating = dialog.updating === true
  const canConfirm = dialog.phase === 'previewed'
    && !updating
    && preview !== null
    && preview.allowed
    && !expired
    && !commitMissing
    && !commitBlockedByChecks

  const sections: React.ReactNode[] = []
  if (dialog.phase === 'previewing') {
    sections.push(h(Progress, { key: 'previewing', label: t('op.previewing') }))
    sections.push(h('div', { key: 'preview-skeleton' }, h(SkeletonRows, { rows: 2 })))
  }
  if (preview !== null) {
    sections.push(h('div', { key: 'summary', className: 'dvt-dialog-section' },
      h('div', { className: 'dvt-dialog-label' }, t('op.summary')),
      h('div', { className: 'dvt-dialog-summary' }, preview.summary),
      repository === null
        ? null
        : h('div', { className: 'dvt-dialog-note', style: { marginTop: 2 } },
          `${repository.displayName} · ${vcsLabel(repository.vcsType, t)} · ${repository.rootPath}`),
    ))
    sections.push(h('div', { key: 'argv', className: 'dvt-dialog-section' },
      h('div', { className: 'dvt-dialog-label' }, t('op.argv')),
      h('pre', { className: 'dvt-argv' }, preview.argv.join(' ')),
    ))
    if (!preview.allowed) {
      sections.push(h('div', { key: 'blocked', className: 'dvt-dialog-section' },
        h(Banner, {
          kind: 'error',
          title: t('common.error'),
          text: t('op.blocked', { reason: F.blockedReasonLabel(preview.blockedReason, t) }),
        }),
      ))
    }
    if (preview.warnings.length > 0) {
      sections.push(h('div', { key: 'warnings', className: 'dvt-dialog-section' },
        h('div', { className: 'dvt-dialog-label' }, t('op.warnings')),
        h('ul', { className: 'dvt-warnings' }, preview.warnings.map((warning, index) => h('li', { key: index }, warning))),
      ))
    }
    sections.push(h(BeforeState, { key: 'before', state, t }))
    if (preview.expiresAt !== '' && preview.allowed && !expired) {
      sections.push(h('div', { key: 'expires', className: 'dvt-dialog-note', style: { padding: '0 10px 6px' } },
        `${t('op.expires')} ${F.formatTime(preview.expiresAt, deps.locale)}`,
      ))
    }
    if (expired) {
      sections.push(h('div', { key: 'expired', className: 'dvt-dialog-section' },
        h(Banner, { kind: 'warn', text: t('op.expired') }),
      ))
    }
  }
  const fields = h(OperationFields, { key: 'fields', state, dialog, handlers, t })
  if (dialog.operation === 'commit' || dialog.operation === 'push') sections.push(fields)
  sections.push(h(ChecksSection, { key: 'checks', dialog, deps, handlers }))
  if (dialog.phase === 'executing') {
    sections.push(h(Progress, { key: 'executing', label: t('op.executing') }))
  }
  if (updating) {
    // Keep the previous preview on screen and explain the pending refresh
    // instead of swapping in a pulsing skeleton (that flash was the dialog
    // "blinking" while typing a commit message).
    sections.push(h('div', {
      key: 'updating',
      className: 'dvt-dialog-note',
      style: { padding: '0 10px 6px' },
    }, t('op.updating')))
  }
  if (dialog.previewError !== null) {
    sections.push(h('div', { key: 'preview-error', className: 'dvt-dialog-section' },
      h(Banner, { kind: 'error', text: F.errorMessage(dialog.previewError, t) }),
      h('div', { className: 'dvt-dialog-note' }, t('op.previewFailed')),
    ))
  }
  if (dialog.executeError !== null) {
    sections.push(h('div', { key: 'execute-error', className: 'dvt-dialog-section' },
      h(Banner, { kind: 'error', text: F.errorMessage(dialog.executeError, t) }),
      h('div', { className: 'dvt-dialog-note' }, t('op.executeError')),
    ))
  }
  sections.push(h(OperationResult, { key: 'result', state, t }))

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
  if (dialog.phase === 'error' || dialog.phase === 'blocked' || (dialog.phase === 'previewed' && expired)) {
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
      className: 'dvt-btn dvt-btn-primary',
      onClick: handlers.onDialogClose,
    }, t('common.close')))
  }
  actions.push(h('button', {
    key: 'cancel',
    type: 'button',
    className: dialog.phase === 'result' ? 'dvt-btn dvt-btn-ghost' : 'dvt-btn',
    disabled: dialog.phase === 'executing',
    onClick: handlers.onDialogClose,
  }, t('common.cancel')))

  return h('div', { className: 'dvt-overlay' },
    h('div', {
      className: 'dvt-dialog',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': t('aria.dialog', { operation: F.operationLabel(dialog.operation, t) }),
    },
    h('div', { className: 'dvt-dialog-head' },
      h('span', { className: 'dvt-dialog-title dvt-clip' }, t('op.dialogTitle', { operation: F.operationLabel(dialog.operation, t) })),
      h(IconButton, {
        label: t('aria.closeDialog'),
        icon: IconClose,
        disabled: dialog.phase === 'executing',
        onClick: handlers.onDialogClose,
      }),
    ),
    h('div', { className: 'dvt-dialog-body' }, sections),
    h('div', { className: 'dvt-dialog-foot' },
      h('span', { className: 'dvt-dialog-note' }, updating ? t('op.updating') : t('op.neverRetry')),
      actions,
    ),
    ),
  )
}
