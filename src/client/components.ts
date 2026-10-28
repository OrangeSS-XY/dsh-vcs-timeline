/**
 * dsh-vcs-timeline — panel composition root.
 *
 * Owns only layout: one `<style>` element, the chrome (toolbar/tabs/filters),
 * the source body, the collapsible diagnostics block, the status bar and the
 * write-operation dialog.
 *
 * The body is an IDE layout: the change timeline keeps its file tree on the
 * left and splits the remaining column into a list (top) and a detail pane
 * (bottom) — commit detail, file diff, audit record or pull request — so the
 * list never disappears when a row is opened. PR and audit sources use the
 * same list/detail split without the tree.
 * @module dsh-vcs-timeline/client/components
 */

import * as React from 'react'
import { buildTimelineView } from './file-index.ts'
import { computeGraph } from './graph.ts'
import { STYLES } from './styles.ts'
import type { PanelViewProps } from './types.ts'
import { auditDetailBody, auditDetailHeader, renderAuditList } from './ui/audit.ts'
import { commitDetailBody, commitDetailHeader, diffBody, diffHeader } from './ui/detail.ts'
import { renderDialog } from './ui/dialog.ts'
import { renderFileTree } from './ui/filetree.ts'
import { renderHistory } from './ui/history.ts'
import { prDetailBody, prDetailHeader, renderPullRequests } from './ui/pr.ts'
import { renderDiagnostics, renderStatusBar } from './ui/status.ts'
import { renderChrome } from './ui/toolbar.ts'

const h = React.createElement

/** One list/detail pane pair for the sources that do not use the file tree. */
function renderPane(
  list: React.ReactElement,
  detail: { header: React.ReactElement; body: React.ReactElement } | null,
): React.ReactElement {
  return h('div', { className: 'dvt-pane' },
    h('div', { key: 'list', className: 'dvt-list-pane' },
      h('div', { className: 'dvt-scroll' }, list),
    ),
    detail === null
      ? null
      : h('div', { key: 'detail', className: 'dvt-detail' },
        h('div', { className: 'dvt-detail-head' }, detail.header),
        h('div', { className: 'dvt-scroll dvt-detail-scroll' }, detail.body),
      ),
  )
}

/** Render the whole panel for one immutable state. */
export function renderPanelView(props: PanelViewProps): React.ReactElement {
  const { state, deps, handlers } = props
  const locale = deps.locale ?? 'zh'
  const audit = state.source === 'audit'
  const pr = state.source === 'pr'
  // Both timeline panes derive from the same loaded history page and filters.
  const view = buildTimelineView(state.timeline.events, {
    query: state.filters.treeQuery,
    status: state.filters.fileStatus,
    selectedPath: state.selectedFilePath,
  })
  const graph = computeGraph(state.timeline.events)

  // Detail pane content: diff > commit > audit record > pull request.
  let detail: { header: React.ReactElement; body: React.ReactElement } | null = null
  if (state.diff.filePath !== null) {
    detail = { header: diffHeader(state, deps, handlers), body: diffBody(state, deps, handlers) }
  } else if (state.changeSet.event !== null) {
    detail = { header: commitDetailHeader(state, deps, handlers), body: commitDetailBody(state, deps, handlers) }
  } else if (audit && state.audit.selected !== null) {
    detail = { header: auditDetailHeader(state, deps, handlers), body: auditDetailBody(state, deps, handlers) }
  } else if (pr && state.pullRequests.selectedNumber !== null) {
    detail = { header: prDetailHeader(state, deps, handlers), body: prDetailBody(state, deps, handlers) }
  }

  let list: React.ReactElement
  if (pr) {
    list = renderPullRequests(state, deps, handlers)
  } else if (audit) {
    list = renderAuditList(state, deps, handlers)
  } else {
    list = renderHistory(state, deps, handlers, view, graph)
  }

  const pane = renderPane(list, detail)
  const bodyElement = audit || pr
    ? pane
    : h('div', { key: 'split', className: 'dvt-split' },
      renderFileTree(state, deps, handlers, view),
      pane,
    )

  return h('div', {
    className: 'dvt-root',
    'data-dvt-panel': 'vcs-timeline',
    lang: locale === 'en' ? 'en' : 'zh-CN',
    ...(props.rootRef === undefined ? {} : { ref: props.rootRef }),
  },
  h('style', { key: 'dvt-styles' }, deps.styles ?? STYLES),
  h('div', { key: 'chrome' }, renderChrome(state, deps, handlers)),
  h('div', { key: 'body', className: 'dvt-body' }, bodyElement),
  renderDiagnostics(state, deps),
  renderStatusBar(state, deps, handlers),
  renderDialog(state, deps, handlers),
  )
}
