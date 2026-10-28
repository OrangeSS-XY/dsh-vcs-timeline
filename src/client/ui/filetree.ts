/**
 * dsh-vcs-timeline — repository file tree pane (left column).
 *
 * IDE-style change tree: one collapsible node per directory (with the number
 * of changed files below it), one leaf per file (with its change status), a
 * file-name search, and a status filter that both panes share. The whole tree
 * is a pure render of {@link TimelineView}, so its counts always equal the
 * filtered rows the right pane lists.
 * @module dsh-vcs-timeline/client/ui/filetree
 */

import * as React from 'react'
import * as F from '../format.ts'
import type { FileTreeNode, TimelineView } from '../file-index.ts'
import { filterFileEntries, statusCounts } from '../file-index.ts'
import type { PanelDeps, PanelHandlers, PanelState } from '../types.ts'
import {
  IconCollapseAll,
  IconExpandAll,
  IconFile,
  IconFolder,
  IconFolderOpen,
  IconSearch,
} from './icons.ts'
import { EmptyState, IconButton } from './primitives.ts'

const h = React.createElement

/** Width a directory level adds to the row's left padding, in px. */
const INDENT_STEP = 12

/** Status tabs offered above the tree, in display order. */
const STATUS_TABS: ReadonlyArray<{ status: FileTabStatus; letter: string }> = [
  { status: 'all', letter: '∗' },
  { status: 'modified', letter: 'M' },
  { status: 'added', letter: 'A' },
  { status: 'deleted', letter: 'D' },
  { status: 'renamed', letter: 'R' },
]

/** The exact status values the tree chips address. */
type FileTabStatus = 'all' | 'modified' | 'added' | 'deleted' | 'renamed'

/** Whether one directory is open under the current state. */
function isOpen(state: PanelState, path: string, searching: boolean): boolean {
  if (searching) return true
  return state.expandedDirs[path] === true
}

/** One tree row, recursive (views are pure functions of the state). */
function TreeNodeRow(props: {
  node: FileTreeNode
  depth: number
  state: PanelState
  deps: PanelDeps
  handlers: PanelHandlers
  searching: boolean
}): React.ReactElement | null {
  const { node, depth, state, deps, handlers, searching } = props
  const { t } = deps
  const indent = 4 + depth * INDENT_STEP
  if (node.kind === 'dir') {
    const open = isOpen(state, node.path, searching)
    return h('li', { key: node.path, className: 'dvt-tree-item', role: 'treeitem', 'aria-expanded': open },
      h('button', {
        type: 'button',
        className: 'dvt-tree-row dvt-tree-dir',
        style: { paddingLeft: `${indent}px` },
        title: node.path,
        onClick: () => handlers.onToggleDir(node.path),
      },
      h('span', { className: `dvt-tree-caret${open ? ' dvt-tree-caret-open' : ''}`, 'aria-hidden': 'true' }, '›'),
      h('span', { className: 'dvt-tree-icon', 'aria-hidden': 'true' },
        h(open ? IconFolderOpen : IconFolder, { size: 13 }),
      ),
      h('span', { className: 'dvt-tree-name dvt-clip' }, node.name),
      h('span', { className: 'dvt-tree-badge', title: t('tree.dirCount', { count: node.count }) }, String(node.count)),
      ),
      open && node.children.length > 0
        ? h('ul', { className: 'dvt-tree-children', role: 'group' },
          node.children.map((child) => h(TreeNodeRow, {
            key: child.path,
            node: child,
            depth: depth + 1,
            state,
            deps,
            handlers,
            searching,
          })),
        )
        : null,
    )
  }
  const selected = state.selectedFilePath === node.path
  return h('li', { key: node.path, className: 'dvt-tree-item', role: 'treeitem', 'aria-selected': selected },
    h('button', {
      type: 'button',
      className: `dvt-tree-row dvt-tree-file${selected ? ' dvt-tree-file-selected' : ''}`,
      style: { paddingLeft: `${indent}px` },
      title: node.entry.oldPath === undefined ? node.path : `${node.entry.oldPath} → ${node.path}`,
      'aria-label': t('aria.treeFile', {
        path: node.path,
        status: F.statusLabel(node.entry.status, t),
      }),
      onClick: () => handlers.onSelectFile(selected ? null : node.path),
    },
    h('span', { className: 'dvt-tree-icon', 'aria-hidden': 'true' }, h(IconFile, { size: 12 })),
    h('span', { className: 'dvt-tree-name dvt-clip' }, node.name),
    node.entry.changes > 1
      ? h('span', { className: 'dvt-tree-changes', title: t('tree.changeCount', { count: node.entry.changes }) }, `×${node.entry.changes}`)
      : null,
    h('span', {
      className: `dvt-file-status dvt-status-${node.entry.status}`,
      title: F.statusLabel(node.entry.status, t),
      'aria-hidden': 'true',
    }, F.statusLetter(node.entry.status)),
    ))
}

/** Left pane: filters, "all files" entry, and the sorted change tree. */
export function renderFileTree(
  state: PanelState,
  deps: PanelDeps,
  handlers: PanelHandlers,
  view: TimelineView,
): React.ReactElement {
  const { t } = deps
  const searching = state.filters.treeQuery.trim() !== ''
  // Chip counts describe what a click would show: the search-matched set
  // before the status filter. The header total describes what is rendered now.
  const counts = statusCounts(filterFileEntries(view.files, state.filters.treeQuery, 'all'))
  const hasWindow = state.timeline.events.length > 0
  return h('aside', { className: 'dvt-tree', 'aria-label': t('tree.pane') },
    h('div', { className: 'dvt-tree-head' },
      h('span', { className: 'dvt-tree-title' },
        h('span', null, t('tree.title')),
        h('span', { className: 'dvt-tree-total', title: t('tree.filesInWindow', { count: view.files.length }) }, String(view.visibleFiles.length)),
      ),
      h('span', { className: 'dvt-tree-tools' },
        h(IconButton, {
          label: t('tree.expandAll'),
          icon: IconExpandAll,
          disabled: view.tree.length === 0,
          onClick: handlers.onExpandAllDirs,
        }),
        h(IconButton, {
          label: t('tree.collapseAll'),
          icon: IconCollapseAll,
          disabled: view.tree.length === 0,
          onClick: handlers.onCollapseAllDirs,
        }),
      ),
    ),
    h('div', { className: 'dvt-tree-search' },
      h(IconSearch, { size: 11 }),
      h('input', {
        className: 'dvt-tree-input',
        type: 'search',
        value: state.filters.treeQuery,
        placeholder: t('tree.search.placeholder'),
        'aria-label': t('tree.search'),
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => handlers.onTreeQueryChange(event.currentTarget.value),
      }),
    ),
    // Stat pills repeat the totals of exactly the files rendered below them, so
    // the tree never claims a change its rows cannot show. An empty window drops
    // the row entirely instead of printing "0 files", and a zero add/delete pill
    // is omitted because 0 is not a change. Sign and value stay separate spans:
    // the sign is decoration, and a row must not read as a fake "+0/+12" stat.
    view.visibleFiles.length === 0
      ? null
      : h('div', { className: 'dvt-row dvt-tree-stats' },
        view.totals.additions > 0
          ? h('span', {
            className: 'dvt-pill dvt-pill-add dvt-tag dvt-stat-add',
            title: t('tree.stats.add', { count: view.totals.additions }),
          },
          h('span', { className: 'dvt-pill-sign', 'aria-hidden': 'true' }, '+'),
          h('span', { className: 'dvt-pill-value' }, String(view.totals.additions)),
          )
          : null,
        view.totals.deletions > 0
          ? h('span', {
            className: 'dvt-pill dvt-pill-del dvt-tag dvt-stat-del',
            title: t('tree.stats.del', { count: view.totals.deletions }),
          },
          h('span', { className: 'dvt-pill-sign', 'aria-hidden': 'true' }, '−'),
          h('span', { className: 'dvt-pill-value' }, String(view.totals.deletions)),
          )
          : null,
        h('span', { className: 'dvt-pill dvt-tag', title: t('tree.stats.files', { count: view.totals.files }) },
          t('tree.stats.files', { count: view.totals.files })),
      ),
    h('div', { className: 'dvt-tree-chips', role: 'group', 'aria-label': t('tree.statusFilter') },
      STATUS_TABS.map((tab) => {
        const count = tab.status === 'all' ? counts.all : counts[tab.status]
        // Zero-count statuses are noise in a dense tree header; the "all" chip
        // always stays so the filter can be cleared.
        if (tab.status !== 'all' && count === 0) return null
        return h('button', {
          key: tab.status,
          type: 'button',
          className: 'dvt-tree-chip',
          'aria-pressed': state.filters.fileStatus === tab.status,
          'aria-label': t('tree.statusChip', {
            status: tab.status === 'all' ? t('filter.chip.all') : F.statusLabel(tab.status, t),
            count,
          }),
          title: tab.status === 'all'
            ? t('filter.chip.all')
            : F.statusLabel(tab.status, t),
          onClick: () => handlers.onSetFileStatus(tab.status),
        },
        h('span', { className: 'dvt-tree-chip-letter', 'aria-hidden': 'true' }, tab.letter),
        h('span', { className: 'dvt-tree-chip-count' }, String(count)),
        )
      }),
    ),
    h('div', { className: 'dvt-tree-scroll' },
      h('button', {
        type: 'button',
        className: `dvt-tree-all${state.selectedFilePath === null ? ' dvt-tree-all-active' : ''}`,
        'aria-pressed': state.selectedFilePath === null,
        onClick: () => handlers.onSelectFile(null),
      },
      h('span', { className: 'dvt-tree-all-label' }, t('tree.all')),
      h('span', { className: 'dvt-tree-all-meta' }, t('tree.commitCount', { count: view.visibleEvents.length })),
      ),
      !view.filesReported
        ? h(EmptyState, {
          icon: IconFile,
          title: t('tree.unavailable.title'),
          hint: t('tree.unavailable.hint'),
          actions: h('button', {
            type: 'button',
            className: 'dvt-btn dvt-btn-sm',
            onClick: handlers.onRefreshRepositories,
          }, t('common.refresh')),
        })
        : !hasWindow
          ? h(EmptyState, { icon: IconFile, title: t('tree.empty') })
          : view.visibleFiles.length === 0
            ? h(EmptyState, {
              icon: IconFile,
              title: t('tree.filtered'),
              hint: t('tree.filtered.hint'),
              actions: h('button', { type: 'button', className: 'dvt-btn dvt-btn-sm', onClick: handlers.onClearFilters }, t('filter.clear')),
            })
            : h('ul', { className: 'dvt-tree-list', role: 'tree', 'aria-label': t('tree.pane') },
              view.tree.map((node) => h(TreeNodeRow, {
                key: node.path,
                node,
                depth: 0,
                state,
                deps,
                handlers,
                searching,
              })),
            ),
    ),
  )
}
