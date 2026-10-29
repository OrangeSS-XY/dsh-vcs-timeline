/**
 * Bottom status bar and the collapsible environment diagnostics block.
 * @module dsh-vcs-timeline/client/ui/status
 */

import * as React from 'react'
import * as F from '../format.ts'
import type { PanelDeps, PanelHandlers, PanelState } from '../types.ts'
import { IconChevronDown, IconChevronRight, IconSliders } from './icons.ts'
import { DotSep } from './primitives.ts'
import { isContentLoading, SkeletonBlock } from './skeleton.ts'
import { selectedRepository, vcsLabel } from './shared.ts'

const h = React.createElement

/** Working-tree dot class: conflicts dominate, then clean/dirty. */
function treeState(state: PanelState): { cls: string; label: string } {
  const status = state.status
  if (status === null) return { cls: 'dvt-dot-none', label: '' }
  if (status.conflicts.length > 0) return { cls: 'dvt-dot-conflict', label: 'conflict' }
  return status.clean ? { cls: 'dvt-dot-clean', label: 'clean' } : { cls: 'dvt-dot-dirty', label: 'dirty' }
}

/** 24px status bar: repository state left, diagnostics control right. */
export function renderStatusBar(state: PanelState, deps: PanelDeps, handlers: PanelHandlers): React.ReactElement {
  // A skeleton screen must stay text-free: while the layout skeleton is up the
  // status bar renders placeholder blocks instead of "未选择仓库/读取状态中…".
  if (isContentLoading(state)) {
    return h('div', { className: 'dvt-statusbar dvt-skel-statusbar', 'aria-hidden': 'true' },
      h(SkeletonBlock, { width: 10, height: 10, radius: '50%' }),
      h(SkeletonBlock, { width: 96, height: 8, radius: 4 }),
      h(SkeletonBlock, { width: 52, height: 8, radius: 4 }),
      h('span', { className: 'dvt-status-spacer' }),
      h(SkeletonBlock, { width: 48, height: 8, radius: 4 }),
    )
  }
  const { t } = deps
  const repository = selectedRepository(state)
  const status = state.status
  const tree = treeState(state)
  const branch = status?.branch ?? repository?.currentBranch ?? (repository?.currentRevision === undefined
    ? ''
    : F.shortHash(repository.currentRevision, 8))

  const left: React.ReactNode[] = []
  const push = (node: React.ReactElement): void => {
    if (left.length > 0) left.push(h(DotSep, { key: `sep-${left.length}` }))
    left.push(node)
  }
  if (repository === null) {
    push(h('span', { key: 'none', className: 'dvt-status-item' },
      h('span', { className: 'dvt-dot dvt-dot-none', 'aria-hidden': 'true' }),
      h('span', null, t('status.noRepo')),
    ))
  } else {
    push(h('span', { key: 'tree', className: 'dvt-status-item', title: tree.label === '' ? '' : tree.label === 'clean' ? t('status.clean') : tree.label === 'dirty' ? t('status.dirty') : t('status.conflicts', { count: status?.conflicts.length ?? 0 }) },
      h('span', { className: `dvt-dot ${tree.cls}`, 'aria-hidden': 'true' }),
      status === null
        ? h('span', null, state.statusLoading ? t('status.loading') : t('footer.statusError'))
        : h('span', null, tree.label === 'clean' ? t('status.clean') : tree.label === 'dirty' ? t('status.dirty') : t('status.conflicts', { count: status.conflicts.length })),
    ))
    if (branch !== '') {
      push(h('span', { key: 'branch', className: 'dvt-status-item' },
        h('span', { className: 'dvt-mono dvt-clip', title: branch }, branch),
      ))
    }
    if (status !== null && status.entries.length > 0) {
      push(h('span', { key: 'changes', className: 'dvt-status-item' },
        h('span', null, t('status.changes', { count: status.entries.length })),
      ))
    }
    if (status !== null && status.conflicts.length > 0) {
      push(h('span', { key: 'conflicts', className: 'dvt-status-item dvt-badge dvt-badge-error' },
        h('span', null, t('status.conflicts', { count: status.conflicts.length })),
      ))
    }
  }

  return h('div', { className: 'dvt-statusbar' },
    left,
    h('span', { className: 'dvt-status-spacer' }),
    repository === null
      ? null
      : h('span', { key: 'vcs', className: 'dvt-status-item dvt-faint' }, vcsLabel(repository.vcsType, t)),
    h('button', {
      type: 'button',
      className: 'dvt-statusbtn',
      'aria-expanded': state.diagnosticsOpen,
      'aria-label': t('aria.diagnostics'),
      title: t('aria.diagnostics'),
      onClick: handlers.onToggleDiagnostics,
    },
    h(IconSliders, { size: 11 }),
    h('span', null, t('status.diagnostics')),
    h(state.diagnosticsOpen ? IconChevronDown : IconChevronRight, { size: 11 }),
    ),
  )
}

/** One diagnostics row: a label cell and a value cell. */
function diagCells(row: { key: string; label: string; value: React.ReactNode; warn?: boolean }): React.ReactElement[] {
  return [
    h('span', { key: `${row.key}-k`, className: 'dvt-diag-key' }, row.label),
    h('span', { key: `${row.key}-v`, className: `dvt-diag-val${row.warn === true ? ' dvt-diag-warn' : ''}` }, row.value),
  ]
}

/** Collapsible diagnostics block above the status bar. */
export function renderDiagnostics(state: PanelState, deps: PanelDeps): React.ReactElement | null {
  if (!state.diagnosticsOpen) return null
  const { t } = deps
  const diagnostics = state.diagnostics
  const rows: Array<{ key: string; label: string; value: React.ReactNode; warn?: boolean }> = []
  if (diagnostics === null) {
    rows.push({ key: 'loading', label: t('common.loading'), value: t('status.loading') })
  } else {
    rows.push({ key: 'plugin', label: t('status.diag.plugin'), value: `v${diagnostics.pluginVersion}` })
    rows.push({
      key: 'runtime',
      label: t('status.diag.runtime'),
      value: `${diagnostics.platform} · DSH ${diagnostics.dshVersion ?? t('status.diag.versionUnknown')}`,
    })
    rows.push({
      key: 'git',
      label: t('footer.git'),
      value: diagnostics.gitVersion ?? t('status.diag.missing'),
      warn: diagnostics.gitVersion === null,
    })
    rows.push({
      key: 'svn',
      label: t('footer.svn'),
      value: diagnostics.svnVersion ?? t('status.diag.missing'),
      warn: diagnostics.svnVersion === null,
    })
    rows.push({ key: 'workspaces', label: t('status.diag.workspaces'), value: String(diagnostics.workspaceCount) })
    rows.push({ key: 'data', label: t('status.diag.dataDir'), value: diagnostics.dataDir })
    for (const [index, warning] of diagnostics.warnings.entries()) {
      rows.push({ key: `warn-${index}`, label: t('status.diag.warnings'), value: warning, warn: true })
    }
  }
  return h('div', { className: 'dvt-diag' },
    h('div', { className: 'dvt-diag-title' }, t('status.diag.title')),
    h('div', { className: 'dvt-diag-grid' }, rows.flatMap(diagCells)),
  )
}
