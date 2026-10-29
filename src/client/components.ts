/**
 * dsh-vcs-timeline — panel composition root.
 *
 * Owns only layout: one `<style>` element, the swimlane page shell (sidebar,
 * chrome and content slots), the collapsible diagnostics block, the status bar
 * and the write-operation dialogs.
 *
 * The shell is a page layout: the change timeline keeps its file tree in the
 * left white card and the right column stacks the chrome (header/toolbar/tabs/
 * filters) above a list (top) + detail pane (bottom) split — commit detail,
 * file diff, audit record or pull request — so the list never disappears when
 * a row is opened. PR, audit, pending and hotspot sources hide the sidebar and
 * use the full width; the per-file view keeps its own tree|diff|info columns
 * because there the tree is part of the content, not page navigation.
 * @module dsh-vcs-timeline/client/components
 */

import * as React from 'react'
import { buildTimelineView } from './file-index.ts'
import { computeGraph } from './graph.ts'
import { STYLES } from './styles.ts'
import type { PanelViewProps } from './types.ts'
import { renderAddRepositoryDialog } from './ui/addrepo.ts'
import { auditDetailBody, auditDetailHeader, renderAuditList } from './ui/audit.ts'
import { commitDetailBody, commitDetailHeader, diffBody, diffHeader } from './ui/detail.ts'
import { renderDialog } from './ui/dialog.ts'
import { renderFileInfo } from './ui/fileinfo.ts'
import { renderFileTree } from './ui/filetree.ts'
import { renderHistory, swimlaneLabels } from './ui/history.ts'
import { renderHotspots } from './ui/hotspots.ts'
import { prDetailBody, prDetailHeader, renderPullRequests } from './ui/pr.ts'
import { renderDiagnostics, renderStatusBar } from './ui/status.ts'
import { SwimlaneShell } from './ui/swimlane.ts'
import { renderChrome } from './ui/toolbar.ts'
import { renderPendingWorkbench } from './ui/workbench.ts'
import { isContentLoading, SkeletonContent, SkeletonSwap, SkeletonTree } from './ui/skeleton.ts'

const h = React.createElement

/** One list/detail pane pair for the sources that do not use the file tree. */
function renderPane(
  list: React.ReactElement | null,
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
  const pending = state.source === 'pending'
  const hotspots = state.source === 'hotspots'
  const timelineSource = state.source === 'timeline'
  // Both timeline panes derive from the same loaded history page and filters.
  // The live panel passes memoized values; the preview/test harness may omit
  // them, in which case a pure render still computes them once.
  const view = props.view ?? buildTimelineView(state.timeline.events, {
    query: state.filters.treeQuery,
    status: state.filters.fileStatus,
    selectedPath: state.selectedFilePath,
  })
  const graph = props.graph ?? computeGraph(state.timeline.events)

  // Detail pane content: diff > commit > audit record > pull request.
  let detail: { header: React.ReactElement; body: React.ReactElement } | null = null
  if (state.diff.filePath !== null) {
    detail = { header: diffHeader(state, deps, handlers), body: diffBody(state, deps, handlers) }
  } else if (state.changeSet.event !== null) {
    detail = { header: commitDetailHeader(state, deps, handlers), body: commitDetailBody(state, deps, handlers) }
  } else if (state.audit.selected !== null && (audit || state.filters.auditInTimeline)) {
    detail = { header: auditDetailHeader(state, deps, handlers), body: auditDetailBody(state, deps, handlers) }
  } else if (pr && state.pullRequests.selectedNumber !== null) {
    detail = { header: prDetailHeader(state, deps, handlers), body: prDetailBody(state, deps, handlers) }
  }

  let list: React.ReactElement | null
  if (pr) {
    list = renderPullRequests(state, deps, handlers)
  } else if (audit) {
    list = renderAuditList(state, deps, handlers)
  } else {
    list = renderHistory(state, deps, handlers, view, graph)
  }

  // File view: tree | diff | operation info. The diff is the primary surface
  // and the info column answers "who touched it, when, how much" beside it.
  const fileMode = !audit && !pr && state.selectedFilePath !== null
  const pane = renderPane(list, detail)
  let bodyElement: React.ReactElement | null
  if (audit || pr) {
    bodyElement = pane
  } else if (pending) {
    bodyElement = renderPendingWorkbench(state, deps, handlers)
  } else if (hotspots) {
    bodyElement = renderHotspots(state, deps, handlers)
  } else if (fileMode) {
    const diffPane = h('div', { key: 'diffpane', className: 'dvt-pane dvt-file-diffpane' },
      detail === null
        ? h('div', { key: 'empty', className: 'dvt-file-diff-empty' }, deps.t('file.info.pickDiff'))
        : [
          h('div', { key: 'head', className: 'dvt-pinned' }, detail.header),
          h('div', { key: 'body', className: 'dvt-scroll' }, detail.body),
        ],
    )
    // The tree lives in the shell sidebar for the whole timeline source, so
    // selecting a file no longer unmounts/remounts it here (that remount was
    // the visible lag + scroll loss when opening a file).
    bodyElement = h('div', { key: 'split', className: 'dvt-split dvt-file-split' },
      diffPane,
      renderFileInfo(state, deps, handlers, view),
    )
  } else {
    // The tree moved into the shell's sidebar, so the content slot is only the
    // list/detail pane; rendering it twice would duplicate every tree row.
    bodyElement = pane
  }

  // A skeleton is only for a surface with nothing to show yet: the cold boot,
  // or the first load of the active source. A quiet revalidation of data that
  // is already painted must never flash a skeleton over it.
  const contentLoading = isContentLoading(state)

  // One stateful wrapper owns the skeleton → content cross-fade, so a finished
  // first load keeps the skeleton's box for a beat instead of collapsing it.
  const content = h(SkeletonSwap, {
    key: 'content',
    loading: contentLoading,
    skeleton: h(SkeletonContent, { source: state.source, boot: state.boot }),
  }, bodyElement)

  // The tree is page navigation for the whole timeline source (list and file
  // view alike); other sources have no tree at all. While the first history
  // page is loading there are no paths yet, so the sidebar keeps its two-column
  // shape with a tree skeleton instead of flashing a text-heavy empty state.
  const sidebar = timelineSource
    ? contentLoading
      ? h(SkeletonTree, { key: 'tree-skeleton', rows: 10 })
      : renderFileTree(state, deps, handlers, view)
    : null

  return h('div', {
    className: 'dvt-root',
    'data-dvt-panel': 'vcs-timeline',
    lang: locale === 'en' ? 'en' : 'zh-CN',
    ...(props.rootRef === undefined ? {} : { ref: props.rootRef }),
  },
  h('style', { key: 'dvt-styles' }, deps.styles ?? STYLES),
  h(SwimlaneShell, {
    key: 'shell',
    className: 'dvt-split',
    sidebar,
    // The shell renders only its own chrome copy (the narrow-layout drawer
    // toggle and its aria label), so it gets the same dictionary-driven labels
    // as the timeline instead of the demo page's Chinese defaults.
    labels: swimlaneLabels(deps),
    sidebarCount: timelineSource && !contentLoading ? view.visibleFiles.length : undefined,
    chrome: renderChrome(state, deps, handlers),
    content,
  }),
  renderDiagnostics(state, deps),
  renderStatusBar(state, deps, handlers),
  renderDialog(state, deps, handlers),
  renderAddRepositoryDialog(state, deps, handlers),
  )
}
