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
  IconChevronDown,
  IconClock,
  IconClose,
  IconDownload,
  IconFilter,
  IconMore,
  IconPr,
  IconRefresh,
  IconRepo,
  IconSearch,
  IconTimeline,
  IconUpload,
} from './icons.ts'
import { Banner, IconButton } from './primitives.ts'
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

/** Branch / revision chip, hidden when the repository has neither. */
function BranchChip(props: { repository: Repository | null; t: PanelDeps['t'] }): React.ReactElement | null {
  const repository = props.repository
  if (repository === null) return null
  const text = repository.currentBranch ?? F.shortHash(repository.currentRevision, 8)
  if (text === '') return null
  return h('span', {
    className: 'dvt-branch',
    title: repository.currentBranch !== undefined && repository.currentBranch !== ''
      ? props.t('repo.branchLabel', { branch: repository.currentBranch })
      : props.t('repo.revisionLabel', { revision: text }),
  },
  h(IconBranch, { size: 11 }),
  h('span', null, F.truncate(text, 16)),
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
      h(IconButton, {
        label: t('filter.toggle'),
        icon: IconFilter,
        pressed: state.filters.showAuthor,
        onClick: handlers.onToggleAuthor,
      }),
    ),
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
  return h('div', { className: 'dvt-chrome' },
    h('div', { className: 'dvt-toolbar' },
      h(RepositoryPicker, { state, handlers, t }),
      h(BranchChip, { repository, t }),
      h('span', { className: 'dvt-toolbar-actions' },
        h(IconButton, {
          label: t('addRepo.title'),
          icon: IconRepo,
          onClick: handlers.onToggleAddRepository,
        }),
        h(IconButton, {
          label: t('aria.refresh'),
          icon: IconRefresh,
          disabled: state.boot === 'loading',
          onClick: handlers.onRefreshRepositories,
        }),
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
    state.noWorkspace && state.repositories.length === 0
      ? h(Banner, { kind: 'info', text: `${t('state.noWorkspace.title')} — ${t('state.noWorkspace.hint')}` })
      : null,
  )
}
