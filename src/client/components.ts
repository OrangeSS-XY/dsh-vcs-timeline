/**
 * dsh-vcs-timeline — panel composition root.
 *
 * Owns only layout: one `<style>` element, the chrome (toolbar/tabs/filters),
 * a pinned breadcrumb for detail views, the scrollable body, the collapsible
 * diagnostics block, the status bar, and the write-operation dialog. All
 * content lives in `ui/*` pure views.
 * @module dsh-vcs-timeline/client/components
 */

import * as React from 'react'
import { STYLES } from './styles.ts'
import type { PanelViewProps } from './types.ts'
import { auditDetailBody, auditDetailHeader, renderAuditList } from './ui/audit.ts'
import { commitDetailBody, commitDetailHeader, diffBody, diffHeader } from './ui/detail.ts'
import { renderDialog } from './ui/dialog.ts'
import { renderHistory } from './ui/history.ts'
import { renderDiagnostics, renderStatusBar } from './ui/status.ts'
import { renderChrome } from './ui/toolbar.ts'

const h = React.createElement

/** Render the whole panel for one immutable state. */
export function renderPanelView(props: PanelViewProps): React.ReactElement {
  const { state, deps, handlers } = props
  const locale = deps.locale ?? 'zh'

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
  } else if (state.source === 'audit' && state.audit.selected !== null) {
    pinned = auditDetailHeader(state, deps, handlers)
    body = auditDetailBody(state, deps, handlers)
  } else if (state.source === 'timeline') {
    body = renderHistory(state, deps, handlers)
  } else {
    body = renderAuditList(state, deps, handlers)
  }

  return h('div', {
    className: 'dvt-root',
    'data-dvt-panel': 'vcs-timeline',
    lang: locale === 'en' ? 'en' : 'zh-CN',
  },
  h('style', { key: 'dvt-styles' }, deps.styles ?? STYLES),
  h('div', { key: 'chrome' }, renderChrome(state, deps, handlers)),
  h('div', { key: 'body', className: 'dvt-body' },
    pinned === null ? null : h('div', { key: 'pinned', className: 'dvt-pinned' }, pinned),
    h('div', { key: 'scroll', className: 'dvt-scroll' }, body),
  ),
  renderDiagnostics(state, deps),
  renderStatusBar(state, deps, handlers),
  renderDialog(state, deps, handlers),
  )
}
