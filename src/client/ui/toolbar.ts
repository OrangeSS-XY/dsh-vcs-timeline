/**
 * Panel chrome: repository toolbar, source tabs, search/filter strip, and the
 * write-operation overflow menu.
 * @module dsh-vcs-timeline/client/ui/toolbar
 */

import * as React from 'react'
import type { OperationType, Repository } from '../../shared/contracts.ts'
import * as F from '../format.ts'
import type { PanelDeps, PanelHandlers, PanelState, PanelSource, TimePreset } from '../types.ts'
import {
  IconAudit,
  IconBranch,
  IconCheck,
  IconChecklist,
  IconChevronDown,
  IconClock,
  IconClose,
  IconDownload,
  IconFilter,
  IconFlame,
  IconMore,
  IconPr,
  IconRefresh,
  IconRepo,
  IconSearch,
  IconTimeline,
  IconUpload,
} from './icons.ts'
import { Banner, IconButton } from './primitives.ts'
import { isContentLoading } from './skeleton.ts'
import { selectedRepository, WRITE_OPERATIONS, operationGroup } from './shared.ts'

const h = React.createElement

/** Hint copy for one write operation. */
function operationHint(operation: OperationType, t: PanelDeps['t']): string {
  switch (operation) {
    case 'fetch': return t('toolbar.hint.fetch')
    case 'pull': return t('toolbar.hint.pull')
    case 'push': return t('toolbar.hint.push')
    case 'update': return t('toolbar.hint.update')
    case 'commit': return t('toolbar.hint.commit')
    default: return ''
  }
}

/** Repository picker: styled shell with a native select for real keyboard support. */
function RepositoryPicker(props: {
  state: PanelState
  handlers: PanelHandlers
  t: PanelDeps['t']
}): React.ReactElement {
  const { state, handlers, t } = props
  const repository = selectedRepository(state)
  const name = repository?.displayName ?? t('toolbar.noRepository')
  const vcs = repository === null ? '' : repository.vcsType === 'git' ? 'Git' : 'SVN'
  return h('label', {
    className: 'dvt-repo',
    title: repository?.rootPath ?? t('toolbar.noRepository'),
  },
  h('span', { className: 'dvt-repo-icon' }, h(IconRepo, { size: 13 })),
  h('span', { className: 'dvt-repo-name' }, name),
  vcs === '' ? null : h('span', { className: 'dvt-repo-vcs' }, vcs),
  h('span', { className: 'dvt-repo-caret' }, h(IconChevronDown, { size: 12 })),
  h('select', {
    className: 'dvt-repo-native',
    'aria-label': t('aria.repository'),
    value: state.selectedRepositoryId ?? '',
    onChange: (event: React.ChangeEvent<HTMLSelectElement>) => handlers.onSelectRepository(event.currentTarget.value),
  },
  state.repositories.length === 0
    ? h('option', { value: '' }, t('repo.select'))
    : state.repositories.map((entry) => h('option', { key: entry.id, value: entry.id }, F.repositoryOptionLabel(entry))),
  ),
  )
}

/** Distinct branch decorations of the loaded page, current branch first. */
function branchDecorations(state: PanelState, repository: Repository): string[] {
  const seen = new Set<string>()
  const branches: string[] = []
  const add = (branch: string | undefined): void => {
    const name = branch === undefined ? '' : branch.trim()
    if (name === '' || seen.has(name)) return
    seen.add(name)
    branches.push(name)
  }
  add(repository.currentBranch)
  for (const event of state.timeline.events) add(event.branch)
  return branches
}

/**
 * Branch filter chip, hidden when the repository has neither branch nor revision.
 *
 * The wrapper keeps the `dvt-branch` hook so the stylesheet stays stable, but
 * the label is a native `<select>`: filtering then works with the keyboard and
 * the platform picker instead of a custom popover. The first option clears the
 * filter, which is why its value is the empty string. SVN exposes no branch
 * decorations, so it keeps the read-only branch/revision chip.
 */
function BranchChip(props: {
  state: PanelState
  handlers: PanelHandlers
  t: PanelDeps['t']
  repository: Repository | null
}): React.ReactElement | null {
  const { state, handlers, t, repository } = props
  if (repository === null) return null
  const current = repository.currentBranch ?? ''
  if (repository.vcsType !== 'git') {
    const text = current === '' ? F.shortHash(repository.currentRevision, 8) : current
    if (text === '') return null
    return h('span', {
      className: 'dvt-branch',
      title: current === '' ? t('repo.revisionLabel', { revision: text }) : t('repo.branchLabel', { branch: current }),
    },
    h(IconBranch, { size: 11 }),
    h('span', null, F.truncate(text, 16)),
    )
  }
  const branches = branchDecorations(state, repository)
  const selected = state.filters.branch
  // A filter can outlive the loaded page (refresh, branch renamed): keep the
  // value selectable so the dropdown never silently shows another branch.
  if (selected !== '' && !branches.includes(selected)) branches.push(selected)
  return h('span', {
    className: 'dvt-branch',
    title: current === '' ? t('toolbar.branch.placeholder') : t('repo.branchLabel', { branch: current }),
  },
  h(IconBranch, { size: 11 }),
  h('select', {
    className: 'dvt-branch-select',
    'aria-label': t('aria.branchSelect'),
    value: selected,
    disabled: state.boot === 'loading',
    onChange: (event: React.ChangeEvent<HTMLSelectElement>) => {
      const value = event.currentTarget.value
      if (value === '') handlers.onClearBranchFilter()
      else handlers.onSelectBranch(value)
    },
  },
  h('option', { value: '' }, t('toolbar.branch.all')),
  branches.map((branch) => h('option', { key: branch, value: branch }, branch)),
  ),
  )
}

/** One menu group of write operations. */
function WriteMenu(props: {
  repository: Repository
  handlers: PanelHandlers
  t: PanelDeps['t']
}): React.ReactElement {
  const { repository, handlers, t } = props
  const operations = WRITE_OPERATIONS[repository.vcsType]
  const groups: Array<{ key: 'sync' | 'commit' | 'remote'; title: string; icon: typeof IconDownload }> = [
    { key: 'sync', title: t('toolbar.menu.sync'), icon: IconDownload },
    { key: 'commit', title: t('toolbar.menu.commit'), icon: IconCheck },
    { key: 'remote', title: t('toolbar.menu.remote'), icon: IconUpload },
  ]
  const sections = groups
    .map((group) => ({ ...group, ops: operations.filter((operation) => operationGroup(operation) === group.key) }))
    .filter((group) => group.ops.length > 0)
  return h('div', { className: 'dvt-menu', role: 'menu', 'aria-label': t('aria.writeMenu') },
    sections.flatMap((section, index) => [
      index === 0 ? null : h('div', { key: `sep-${section.key}`, className: 'dvt-menu-sep' }),
      h('div', { key: `group-${section.key}`, className: 'dvt-menu-group' }, section.title),
      ...section.ops.map((operation) => h('button', {
        key: operation,
        type: 'button',
        role: 'menuitem',
        className: 'dvt-menu-item',
        onClick: () => {
          handlers.onCloseWriteMenu()
          handlers.onStartOperation(operation)
        },
      },
      h('span', { className: 'dvt-menu-icon' }, h(section.icon, { size: 12 })),
      h('span', { className: 'dvt-menu-labels' },
        h('span', { className: 'dvt-menu-label' }, t(`op.${operation}`)),
        h('span', { className: 'dvt-menu-hint' }, operationHint(operation, t)),
      ),
      )),
    ]),
    h('div', { key: 'sep-repo', className: 'dvt-menu-sep' }),
    h('div', { key: 'group-repo', className: 'dvt-menu-group' }, t('addRepo.menuGroup')),
    h('button', {
      key: 'add-repo',
      type: 'button',
      role: 'menuitem',
      className: 'dvt-menu-item',
      onClick: () => {
        handlers.onCloseWriteMenu()
        handlers.onToggleAddRepository()
      },
    },
    h('span', { className: 'dvt-menu-icon' }, h(IconRepo, { size: 12 })),
    h('span', { className: 'dvt-menu-labels' },
      h('span', { className: 'dvt-menu-label' }, t('addRepo.title')),
      h('span', { className: 'dvt-menu-hint' }, t('addRepo.menuHint')),
    ),
    ),
  )
}

/** Source tabs with optional counts. */
function SourceTabs(props: {
  state: PanelState
  handlers: PanelHandlers
  t: PanelDeps['t']
}): React.ReactElement {
  const { state, handlers, t } = props
  const timelineCount = state.timeline.events.length
  const pendingCount = state.status?.entries.length ?? 0
  const hotspotCount = state.hotspots.data?.files.length ?? 0
  const prCount = state.pullRequests.data?.pullRequests.length ?? 0
  const auditCount = state.audit.operations.length
  const tab = (source: PanelSource, label: string, count: number, Icon: typeof IconTimeline): React.ReactElement => h('button', {
    type: 'button',
    role: 'tab',
    className: 'dvt-tab',
    'aria-selected': state.source === source,
    onClick: () => handlers.onSetSource(source),
  },
  h(Icon, { size: 12 }),
  h('span', null, label),
  count > 0 ? h('span', { className: 'dvt-tab-count' }, count) : null,
  )
  return h('div', { role: 'tablist', className: 'dvt-tabstrip', 'aria-label': t('tab.title') },
    tab('timeline', t('source.timeline'), timelineCount, IconTimeline),
    tab('pending', t('source.pending'), pendingCount, IconChecklist),
    tab('hotspots', t('source.hotspots'), hotspotCount, IconFlame),
    tab('pr', t('source.pr'), prCount, IconPr),
    tab('audit', t('source.audit'), auditCount, IconAudit),
  )
}

/** Search + event-type chips + time window + advanced filter toggle. */
function FilterBar(props: {
  state: PanelState
  handlers: PanelHandlers
  t: PanelDeps['t']
}): React.ReactElement {
  const { state, handlers, t } = props
  const commitOnly = state.filters.eventTypes.includes('commit')
  const repository = selectedRepository(state)
  const gitRepository = repository !== null && repository.vcsType === 'git'
  const scopeButton = (scope: 'current' | 'all'): React.ReactElement => h('button', {
    type: 'button',
    className: 'dvt-seg-btn',
    'aria-pressed': state.filters.branchScope === scope,
    onClick: () => handlers.onSetBranchScope(scope),
  }, t(`timeline.branchScope.${scope}`))
  return h('div', null,
    h('div', { className: 'dvt-filterbar' },
      h('span', { className: 'dvt-search' },
        h(IconSearch, { size: 12 }),
        h('input', {
          className: 'dvt-search-input',
          type: 'search',
          value: state.filters.text,
          placeholder: t('filter.search.placeholder'),
          'aria-label': t('aria.search'),
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => handlers.onTextChange(event.currentTarget.value),
        }),
        state.filters.text === ''
          ? null
          : h('button', {
            type: 'button',
            className: 'dvt-search-clear',
            'aria-label': t('aria.clearSearch'),
            title: t('aria.clearSearch'),
            onClick: () => handlers.onClearFilters(),
          }, h(IconClose, { size: 11 })),
      ),
      h('span', { className: 'dvt-chips', role: 'group', 'aria-label': t('filter.toggle') },
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
      ),
      h('label', { className: 'dvt-time' },
        h(IconClock, { size: 11 }),
        h('select', {
          className: 'dvt-time-select',
          'aria-label': t('filter.time'),
          value: state.filters.timePreset,
          onChange: (event: React.ChangeEvent<HTMLSelectElement>) => {
            handlers.onSetTimePreset(event.currentTarget.value as TimePreset)
          },
        },
        F.TIME_PRESETS.map((preset) => h('option', { key: preset, value: preset }, F.timePresetLabel(preset, t))),        ),
      ),
      gitRepository
        ? h('div', { className: 'dvt-seg', role: 'group', 'aria-label': t('timeline.branchScope') },
          scopeButton('current'),
          scopeButton('all'),
        )
        : null,
      h('button', {
        type: 'button',
        className: 'dvt-chip',
        'aria-pressed': state.filters.auditInTimeline,
        title: t('timeline.audit.toggle'),
        onClick: handlers.onToggleAuditInTimeline,
      }, t('timeline.audit.toggleShort')),
      h(IconButton, {
        label: t('filter.toggle'),
        icon: IconFilter,
        pressed: state.filters.showAuthor,
        onClick: handlers.onToggleAuthor,
      }),
    ),
    state.filters.branch !== ''
      ? h('div', { className: 'dvt-active-filter' },
        h(IconBranch, { size: 10 }),
        h('span', { className: 'dvt-clip' }, t('timeline.branchFilter', { branch: state.filters.branch })),
        h(IconButton, {
          label: t('timeline.branchFilter.clear'),
          icon: IconClose,
          onClick: handlers.onClearBranchFilter,
        }),
      )
      : null,
    state.filters.showAuthor
      ? h('div', { className: 'dvt-author-row' },
        h('input', {
          className: 'dvt-input',
          type: 'text',
          value: state.filters.author,
          placeholder: t('filter.author.placeholder'),
          'aria-label': t('aria.author'),
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => handlers.onAuthorChange(event.currentTarget.value),
        }),
        h('button', { type: 'button', className: 'dvt-btn dvt-btn-ghost dvt-btn-sm', onClick: handlers.onClearFilters }, t('filter.clear')),
      )
      : null,
  )
}

/** The whole chrome: toolbar, menu, tabs and filters. */
export function renderChrome(
  state: PanelState,
  deps: PanelDeps,
  handlers: PanelHandlers,
): React.ReactElement {
  const { t } = deps
  const repository = selectedRepository(state)
  const menuOpen = state.menuOpen && repository !== null
  const gitRepository = repository !== null && repository.vcsType === 'git'
  // Write operations must not start while another one is being confirmed (the
  // dialog owns the single-use confirmation token) or before the first boot
  // read, because the preview would describe stale branch/cleanliness state.
  const operationLocked = state.dialog !== null || state.boot === 'loading'
  const syncRefreshing = state.sync.refreshing
  // The cold boot paints the layout skeleton, and a skeleton screen must not
  // carry a progress bar, a "正在更新…" capsule or live-region text: the gray
  // blocks already say "loading". Only a quiet refresh on top of real content
  // gets the subtle chrome feedback.
  const showSyncChrome = syncRefreshing && !isContentLoading(state)
  // A quiet refresh failed while the previously loaded data is still on screen:
  // say so above the content instead of letting the panel look current.
  const staleSync = state.sync.lastError !== null && !syncRefreshing && state.repositories.length > 0
  const operationButton = (
    operation: 'pull' | 'push',
    label: string,
    hint: string,
    Icon: typeof IconDownload,
  ): React.ReactElement => h('button', {
    key: operation,
    type: 'button',
    className: 'dvt-toolbar-op',
    title: hint,
    // The label span is hidden at sidebar widths, so the accessible name must
    // be the operation itself, not the long hint.
    'aria-label': label,
    disabled: operationLocked,
    onClick: () => handlers.onStartOperation(operation),
  },
  h(Icon, { size: 12 }),
  h('span', null, label),
  )
  return h('div', { className: 'dvt-chrome' },
    // Thin indeterminate bar pinned to the very top of the chrome. It is
    // rendered only while a quiet revalidation runs, and its zero-height
    // positioned slot keeps the toolbar from moving when it appears.
    showSyncChrome
      ? h('div', { className: 'dvt-syncslot' },
        h('div', {
          className: 'dvt-syncbar',
          role: 'progressbar',
          'aria-label': t('aria.syncProgress'),
          'aria-valuetext': t('sync.refreshing'),
        }, h('span', { className: 'dvt-syncbar-fill' })),
      )
      : null,
    h('div', { className: 'dvt-toolbar' },
      h(RepositoryPicker, { state, handlers, t }),
      h(BranchChip, { state, handlers, t, repository }),
      h('span', { className: 'dvt-toolbar-actions' },
        gitRepository ? operationButton('pull', t('toolbar.pull'), t('toolbar.hint.pull'), IconDownload) : null,
        gitRepository ? operationButton('push', t('toolbar.push'), t('toolbar.hint.push'), IconUpload) : null,
        h(IconButton, {
          label: t('addRepo.title'),
          icon: IconRepo,
          onClick: handlers.onToggleAddRepository,
        }),
        h(IconButton, {
          label: t('aria.refresh'),
          icon: IconRefresh,
          // Stays enabled during a quiet refresh: a manual refresh is allowed
          // to supersede the in-flight one, and the spinning icon shows why.
          disabled: state.boot === 'loading',
          extraClass: showSyncChrome ? 'dvt-syncing' : undefined,
          onClick: handlers.onRefreshRepositories,
        }),
        // The live region is always mounted but only carries text while a
        // quiet refresh runs, so "正在更新…" is announced once, not on every
        // render — and never on the cold-boot skeleton screen.
        h('span', {
          className: 'dvt-sync-state',
          role: 'status',
          'aria-live': 'polite',
        }, showSyncChrome
          ? [
            h('span', { key: 'dot', className: 'dvt-sync-state-dot', 'aria-hidden': 'true' }),
            h('span', { key: 'text', className: 'dvt-sync-state-text' }, t('sync.refreshing')),
          ]
          : null),
        h(IconButton, {
          label: t('aria.writeMenu'),
          icon: IconMore,
          expanded: menuOpen,
          disabled: repository === null,
          onClick: () => {
            if (state.menuOpen) handlers.onCloseWriteMenu()
            else handlers.onToggleWriteMenu()
          },
        }),
      ),
    ),
    menuOpen ? h('div', { className: 'dvt-menu-overlay', onClick: handlers.onCloseWriteMenu, 'aria-hidden': 'true' }) : null,
    menuOpen && repository !== null
      ? h(WriteMenu, { repository, handlers, t })
      : null,

    h(SourceTabs, { state, handlers, t }),
    state.source === 'timeline' ? h(FilterBar, { state, handlers, t }) : null,
    state.boot === 'error' && state.repositories.length > 0 && state.bootError !== null
      ? h(Banner, {
        kind: 'error',
        text: F.errorMessage(state.bootError, t),
        action: h('button', { type: 'button', className: 'dvt-btn dvt-btn-sm', onClick: handlers.onRefreshRepositories }, t('common.retry')),
      })
      : null,
    // Stale-while-revalidate: a failed quiet refresh keeps the last good data
    // visible, so the chrome has to say the data is from the last sync instead
    // of hiding it behind the old error state.
    staleSync
      ? h(Banner, {
        kind: 'warn',
        text: t('sync.staleWarning'),
        action: h('button', { type: 'button', className: 'dvt-btn dvt-btn-sm', onClick: handlers.onRefreshRepositories }, t('common.retry')),
      })
      : null,
    state.noWorkspace && state.repositories.length === 0
      ? h(Banner, { kind: 'info', text: `${t('state.noWorkspace.title')} — ${t('state.noWorkspace.hint')}` })
      : null,
  )
}
