/**
 * dsh-vcs-timeline — panel composition root.
 *
 * Owns only layout: one `<style>` element, the chrome (toolbar/tabs/filters),
 * the file-centered two-column body (tree | change timeline), the collapsible
 * diagnostics block, the status bar, and the write-operation dialog. The same
 * tree renders inside the fullscreen overlay (`mode: 'overlay'`); only the
 * frame-level controls differ.
 * @module dsh-vcs-timeline/client/components
 */

import * as React from 'react'
import { buildTimelineView } from './file-index.ts'
import { STYLES } from './styles.ts'
import type { PanelViewProps } from './types.ts'
import { auditDetailBody, auditDetailHeader, renderAuditList } from './ui/audit.ts'
import { commitDetailBody, commitDetailHeader, diffBody, diffHeader } from './ui/detail.ts'
import { renderDialog } from './ui/dialog.ts'
import { renderFileTree } from './ui/filetree.ts'
import { renderHistory } from './ui/history.ts'
import { renderDiagnostics, renderStatusBar } from './ui/status.ts'
import { renderChrome } from './ui/toolbar.ts'

const h = React.createElement

/** Render the whole panel for one immutable state. */
export function renderPanelView(props: PanelViewProps): React.ReactElement {
  const { state, deps, handlers } = props
  const locale = deps.locale ?? 'zh'
  const overlay = props.mode === 'overlay'
  const audit = state.source === 'audit'
  // Both panes derive from the same loaded history page and filter state.
  const view = buildTimelineView(state.timeline.events, {
    query: state.filters.treeQuery,
    status: state.filters.fileStatus,
    selectedPath: state.selectedFilePath,
  })

  // Detail views keep their breadcrumb pinned above the scroll area, like an
  // editor tab; list views let the whole body scroll.
  let pinned: React.ReactElement | null = null
  let body: React.ReactElement
  if (state.diff.filePath !== null) {
    pinned = diffHeader(state, deps, handlers)
    body = diffBody(state, deps, handlers)
  } else if (state.changeSet.event !== null) {
    pinned = commitDetailHeader(state, deps, handlers)
    body = commitDetailBody(state, deps, handlers)
  } else if (audit && state.audit.selected !== null) {
    pinned = auditDetailHeader(state, deps, handlers)
    body = auditDetailBody(state, deps, handlers)
  } else if (audit) {
    body = renderAuditList(state, deps, handlers)
  } else {
    body = renderHistory(state, deps, handlers, view)
  }

  const pane = h('div', { key: 'pane', className: 'dvt-pane' },
    pinned === null ? null : h('div', { key: 'pinned', className: 'dvt-pinned' }, pinned),
    h('div', { key: 'scroll', className: 'dvt-scroll' }, body),
  )

  const bodyElement = audit
    ? pane
    : h('div', { key: 'split', className: 'dvt-split' },
      renderFileTree(state, deps, handlers, view),
      pane,
    )

  return h('div', {
    className: `dvt-root${overlay ? ' dvt-root-overlay' : ''}`,
    'data-dvt-panel': 'vcs-timeline',
    'data-dvt-mode': overlay ? 'overlay' : 'sidebar',
    lang: locale === 'en' ? 'en' : 'zh-CN',
  },
  // The dock host may have already emitted the stylesheet for its own row; in
  // that case the overlay panel reuses it instead of duplicating 17 KiB.
  props.withStyles === false ? null : h('style', { key: 'dvt-styles' }, deps.styles ?? STYLES),
  h('div', { key: 'chrome' }, renderChrome(state, deps, handlers, {
    mode: overlay ? 'overlay' : 'sidebar',
    ...(props.fullscreen === undefined ? {} : { fullscreen: props.fullscreen }),
    ...(props.onClose === undefined ? {} : { onClose: props.onClose }),
    ...(props.onToggleFullscreen === undefined ? {} : { onToggleFullscreen: props.onToggleFullscreen }),
  })),
  h('div', { key: 'body', className: 'dvt-body' }, bodyElement),
  renderDiagnostics(state, deps),
  renderStatusBar(state, deps, handlers),
  renderDialog(state, deps, handlers),
  )
}
